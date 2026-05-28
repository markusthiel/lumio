--[[
    LumioApi.lua

    HTTP-Wrapper für die Lumio Plugin-API. Liest Host + Token aus den
    Plugin-Preferences, baut Authorization-Header, parst JSON.

    Alle Methoden müssen aus einer LrTask laufen (LrHttp blockiert nicht
    den UI-Thread, ist aber asynchron — Lightroom-SDK-Konvention).

    Read-Side (Selection-Import nach LR):
      testConnection, listGalleries, getSelection

    Write-Side (Publish-Service: LR → Lumio):
      createGallery, patchGallery, listGalleryFiles, deleteGalleryFile,
      initUpload, completeUpload, uploadFileToS3
]]

local LrHttp           = import "LrHttp"
local LrPrefs          = import "LrPrefs"
local LrPathUtils      = import "LrPathUtils"
local LrFileUtils      = import "LrFileUtils"

local json   = require "Json"
local log    = require "Logger"

local M = {}

local prefs = LrPrefs.prefsForPlugin()

-- Host + Token aus Prefs holen, sicherheitshalber Trailing-Slash strippen
local function getBase()
    local host = (prefs.host or ""):gsub("/+$", "")
    if host == "" then
        error("Lumio: Bitte Host in den Plug-in-Optionen konfigurieren")
    end
    return host
end

local function getToken()
    local token = prefs.token or ""
    if token == "" then
        error("Lumio: Bitte API-Token in den Plug-in-Optionen konfigurieren")
    end
    return token
end

-- Low-Level Request. Gibt body + status zurück, throws bei Auth-Fehler.
function M.request(method, path, body)
    local url = getBase() .. "/api/v1" .. path
    local headers = {
        { field = "Authorization", value = "Bearer " .. getToken() },
        { field = "Accept",        value = "application/json" },
    }
    log:info("HTTP " .. method .. " " .. url)

    local responseBody, responseHeaders
    if method == "GET" then
        responseBody, responseHeaders = LrHttp.get(url, headers)
    elseif method == "POST" then
        table.insert(headers, {
            field = "Content-Type", value = "application/json"
        })
        responseBody, responseHeaders = LrHttp.post(
            url, body and json.encode(body) or "", headers
        )
    elseif method == "PATCH" then
        table.insert(headers, {
            field = "Content-Type", value = "application/json"
        })
        responseBody, responseHeaders = LrHttp.post(
            url, body and json.encode(body) or "", headers, "PATCH"
        )
    elseif method == "DELETE" then
        responseBody, responseHeaders = LrHttp.post(
            url, "", headers, "DELETE"
        )
    else
        error("unsupported method: " .. method)
    end

    if not responseHeaders then
        error("Lumio: keine Antwort vom Server (Host erreichbar?)")
    end
    local status = responseHeaders.status or 0
    if status == 401 then
        error("Lumio: API-Token ungültig oder abgelaufen")
    elseif status == 204 then
        return nil
    elseif status >= 400 then
        error("Lumio: HTTP " .. tostring(status) ..
            " " .. (responseBody or ""):sub(1, 200))
    end

    if not responseBody or responseBody == "" then
        return nil
    end
    local ok, parsed = pcall(json.decode, responseBody)
    if not ok then
        error("Lumio: Antwort ist kein gültiges JSON")
    end
    return parsed
end

-- ============================================================================
-- Read-Side
-- ============================================================================

function M.testConnection()
    -- Wirft bei Fehler, gibt sonst { ok = true, apiVersion = "1" } zurück
    return M.request("GET", "/plugin/version")
end

function M.listGalleries()
    local res = M.request("GET", "/plugin/galleries")
    return (res and res.galleries) or {}
end

function M.getSelection(galleryId)
    return M.request("GET", "/plugin/galleries/" .. galleryId .. "/selection")
end

-- ============================================================================
-- Write-Side (Publish)
-- ============================================================================

function M.createGallery(title, mode, description)
    local res = M.request("POST", "/plugin/galleries", {
        title = title,
        mode = mode or "collaboration",
        description = description,
    })
    return res and res.gallery
end

function M.patchGallery(galleryId, fields)
    local res = M.request("PATCH", "/plugin/galleries/" .. galleryId, fields)
    return res and res.gallery
end

function M.listGalleryFiles(galleryId)
    local res = M.request("GET", "/plugin/galleries/" .. galleryId .. "/files")
    return (res and res.files) or {}
end

function M.deleteGalleryFile(galleryId, fileId)
    M.request(
        "DELETE",
        "/plugin/galleries/" .. galleryId .. "/files/" .. fileId
    )
end

-- Upload-Init: meldet n Files an, bekommt presigned PUT-URLs zurueck.
-- Wir nutzen den existierenden Studio-Upload-Endpoint — kein Plugin-
-- Sonderpfad noetig, da er bereits Bearer-Token-faehig ist.
function M.initUpload(galleryId, files)
    local res = M.request("POST", "/uploads/init", {
        galleryId = galleryId,
        files = files,
    })
    return (res and res.uploads) or {}
end

-- Upload-Complete: nach S3-PUT meldet das Plugin den Erfolg an Lumio,
-- damit Worker-Verarbeitung (Thumbs/Preview/Web/Watermark) startet.
function M.completeUpload(fileId, parts)
    local res = M.request("POST", "/uploads/complete", {
        fileId = fileId,
        parts = parts,  -- nil bei single-PUT, array bei multipart
    })
    return res
end

-- Single-Part-Upload zu S3 via presigned PUT-URL.
-- Lightroom-Renders sind typischerweise < 50 MB JPEG (selbst bei 100%
-- Quality), also single-PUT statt multipart. multipart-Support kommt
-- spaeter wenn jemand RAW exportiert.
function M.uploadFileToS3(presignedUrl, filepath, mimeType)
    -- Datei lesen — Lr SDK liefert keine streamed-Upload-API,
    -- also komplett in RAM laden. Bei riesigen Files (100 MB+) wuerde
    -- das problematisch, aber JPEG-Renders sind selten so gross.
    local f, err = io.open(filepath, "rb")
    if not f then
        error("Lumio: kann Datei nicht oeffnen: " .. tostring(err))
    end
    local data = f:read("*all")
    f:close()
    if not data then
        error("Lumio: Datei ist leer oder unlesbar: " .. filepath)
    end

    local headers = {
        { field = "Content-Type", value = mimeType or "application/octet-stream" },
    }
    log:info("S3 PUT " .. presignedUrl:sub(1, 80) .. "... (" .. #data .. " bytes)")
    local responseBody, responseHeaders = LrHttp.post(
        presignedUrl, data, headers, "PUT"
    )
    if not responseHeaders then
        error("Lumio: kein Response von S3 (Netzwerkproblem?)")
    end
    local status = responseHeaders.status or 0
    if status >= 400 then
        error("Lumio: S3 HTTP " .. tostring(status) ..
            " " .. (responseBody or ""):sub(1, 200))
    end
    -- S3 liefert ein ETag-Header zurueck — nicht zwingend benoetigt
    -- bei single-PUT, aber wir geben ihn zurueck fuer evtl. multipart-
    -- Erweiterung.
    local etag
    for _, h in ipairs(responseHeaders) do
        if (h.field or ""):lower() == "etag" then
            etag = h.value
            break
        end
    end
    return etag
end

return M
