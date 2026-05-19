--[[
    LumioApi.lua

    HTTP-Wrapper für die Lumio Plugin-API. Liest Host + Token aus den
    Plugin-Preferences, baut Authorization-Header, parst JSON.

    Alle Methoden müssen aus einer LrTask laufen (LrHttp blockiert nicht
    den UI-Thread, ist aber asynchron — Lightroom-SDK-Konvention).
]]

local LrHttp           = import "LrHttp"
local LrPrefs          = import "LrPrefs"
local LrPathUtils      = import "LrPathUtils"

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
    else
        error("unsupported method: " .. method)
    end

    if not responseHeaders then
        error("Lumio: keine Antwort vom Server (Host erreichbar?)")
    end
    local status = responseHeaders.status or 0
    if status == 401 then
        error("Lumio: API-Token ungültig oder abgelaufen")
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

-- Convenience-Wrapper

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

return M
