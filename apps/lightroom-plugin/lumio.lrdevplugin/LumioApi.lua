--[[
    LumioApi.lua

    HTTP wrapper for the Lumio plug-in API. Reads host + token from the
    plug-in preferences, builds the Authorization header, parses JSON.

    All methods must run from an LrTask (LrHttp does not block the UI
    thread, but it is asynchronous -- Lightroom SDK convention).

    Read side (Selection-Import into LR):
      testConnection, listGalleries, getSelection

    Write side (Publish-Service: LR -> Lumio):
      createGallery, patchGallery, listGalleryFiles, deleteGalleryFile,
      initUpload, completeUpload, uploadFileToS3
]]

local LrHttp           = import "LrHttp"
local LrTasks          = import "LrTasks"
local LrPrefs          = import "LrPrefs"
local LrPathUtils      = import "LrPathUtils"
local LrFileUtils      = import "LrFileUtils"

local json   = require "Json"
local log    = require "Logger"

local M = {}

local prefs = LrPrefs.prefsForPlugin()

-- Read host + token from prefs, strip a trailing slash just in case
local function getBase()
    local host = (prefs.host or ""):gsub("/+$", "")
    if host == "" then
        error("Lumio: please configure the host in the plug-in options")
    end
    return host
end

local function getToken()
    local token = prefs.token or ""
    if token == "" then
        error("Lumio: please configure the API token in the plug-in options")
    end
    return token
end

-- RETRY.
-- Before: a single HTTP 429 failed the call permanently. Observed in real use
-- (Lumio.log 14:15:45): at the end of a 23-photo batch the PATCH status=live
-- got a 429 and the gallery stayed a draft. The rate limit is 300/min and is
-- SHARED with the browser.
-- Now: 429, transient 5xx and network errors are retried with delays of
-- 5/15/45 s (four attempts in total), honouring the Retry-After header.
local RETRY_DELAYS   = { 5, 15, 45 }
local MAX_DELAY      = 30   -- cap for a single wait, including Retry-After
local MAX_TOTAL_WAIT = 90   -- total budget per call
local MAX_NET_RETRIES = 1   -- a network error is often PERMANENT (wrong host) -> only 1 retry

-- A caller can set this so that long waits are interrupted by a cancellation.
-- Without it LrTasks.sleep does not react to the Cancel button at all.
M.isCanceled = nil

local function interruptibleSleep(seconds)
    local slept = 0
    while slept < seconds do
        if M.isCanceled and M.isCanceled() then
            error("Lumio: canceled")
        end
        local step = math.min(1, seconds - slept)
        LrTasks.sleep(step)
        slept = slept + step
    end
end

local function retryAfterSeconds(responseHeaders, fallback)
    for _, h in ipairs(responseHeaders or {}) do
        if h.field and tostring(h.field):lower() == "retry-after" then
            local n = tonumber(h.value)  -- HTTP date format -> nil -> fallback
            if n and n > 0 then return math.min(n, MAX_DELAY) end
        end
    end
    return math.min(fallback, MAX_DELAY)
end

local function httpDispatch(method, url, headers, body)
    if method == "GET" then
        return LrHttp.get(url, headers)
    elseif method == "POST" then
        table.insert(headers, { field = "Content-Type", value = "application/json" })
        return LrHttp.post(url, body and json.encode(body) or "", headers)
    elseif method == "PATCH" then
        table.insert(headers, { field = "Content-Type", value = "application/json" })
        return LrHttp.post(url, body and json.encode(body) or "", headers, "PATCH")
    elseif method == "DELETE" then
        return LrHttp.post(url, "", headers, "DELETE")
    else
        error("unsupported method: " .. method)
    end
end

-- Low-level request. Returns body + status, throws on an auth error.
function M.request(method, path, body)
    local url = getBase() .. "/api/v1" .. path
    log:info("HTTP " .. method .. " " .. url)

    -- POST IS NOT IDEMPOTENT. /uploads/init, /uploads/complete and
    -- /plugin/galleries change server state: if the response is lost to a
    -- network error, the request may still have been processed. A retry would
    -- create a second file row (stuck in 'uploading' forever) or an entirely
    -- second gallery. A 429 is safe for every method, because the rate limit
    -- rejects the request BEFORE the handler runs.
    local isPost = (method == "POST")

    local responseBody, responseHeaders, status
    local totalWait, netRetries = 0, 0

    for attempt = 0, #RETRY_DELAYS do
        local headers = {
            { field = "Authorization", value = "Bearer " .. getToken() },
            { field = "Accept",        value = "application/json" },
        }
        responseBody, responseHeaders = httpDispatch(method, url, headers, body)

        -- LrHttp signals a network error in responseHeaders.error, NOT as an exception
        local netErr = responseHeaders and responseHeaders.error
        status = responseHeaders and tonumber(responseHeaders.status) or nil
        local isNetworkFailure = (not responseHeaders) or netErr or (status == nil)

        local retryable
        if status == 429 then
            retryable = true
        elseif isPost then
            retryable = false
        elseif isNetworkFailure then
            retryable = (netRetries < MAX_NET_RETRIES)
            if retryable then netRetries = netRetries + 1 end
        else
            retryable = (status == 502 or status == 503 or status == 504)
        end

        if not retryable or attempt >= #RETRY_DELAYS then
            if isNetworkFailure then
                if netErr then
                    error("Lumio: connection failed: " ..
                        tostring(netErr.name or netErr.errorCode or "unknown network error"))
                end
                -- Was `responseHeaders.status or 0`, which let a response with no
                -- status pass as a "success" and silently returned nil.
                error("Lumio: server did not respond as expected (status code missing)")
            end
            break -- 4xx/5xx: handled below as a normal HTTP error
        end

        local delay = retryAfterSeconds(responseHeaders, RETRY_DELAYS[attempt + 1])
        if totalWait + delay > MAX_TOTAL_WAIT then
            log:warn("wait budget exhausted (" .. totalWait .. " s), no more attempts")
            break
        end
        totalWait = totalWait + delay
        log:warn(string.format("HTTP %s %s -> attempt %d/%d failed (%s), waiting %d s",
            method, path, attempt + 1, #RETRY_DELAYS + 1,
            netErr and "network error" or tostring(status), delay))
        interruptibleSleep(delay)
    end

    if not responseHeaders then
        error("Lumio: no response from server (is the host reachable?)")
    end
    if status == 401 then
        error("Lumio: API token invalid or expired")
    elseif status == 204 then
        return nil
    elseif status and status >= 400 then
        error("Lumio: HTTP " .. tostring(status) ..
            " " .. (responseBody or ""):sub(1, 200))
    end

    if not responseBody or responseBody == "" then
        return nil
    end
    local ok, parsed = pcall(json.decode, responseBody)
    if not ok then
        error("Lumio: response is not valid JSON")
    end
    return parsed
end

-- ============================================================================
-- Read side
-- ============================================================================

function M.testConnection()
    -- Throws on error, otherwise returns { ok = true, apiVersion = "1" }
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
-- Write side (Publish)
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

-- ============================================================================
-- Chapters (Lumio "GallerySection")
-- ============================================================================
-- No plug-in-specific /plugin/... routes for these -- like /uploads/init
-- and /uploads/complete above, the generic Studio routes already accept
-- Bearer-token auth, so we call them directly (galleries.ts's Section-CRUD
-- block). Used by processRenderedPhotos/renamePublishedCollection/
-- deletePublishedCollection for a chapter (non-default) child collection.

function M.createSection(galleryId, title)
    local res = M.request("POST", "/galleries/" .. galleryId .. "/sections", { title = title })
    return res and res.section
end

function M.patchSection(galleryId, sectionId, fields)
    local res = M.request("PATCH", "/galleries/" .. galleryId .. "/sections/" .. sectionId, fields)
    return res and res.section
end

function M.deleteSection(galleryId, sectionId)
    -- NB: the server returns 200 { ok = true }, not 204 -- M.request already
    -- handles both shapes fine (returns the decoded body either way), no
    -- special-casing needed here.
    M.request("DELETE", "/galleries/" .. galleryId .. "/sections/" .. sectionId)
end

-- fileIds: sectionAssignSchema caps this at 500 per call server-side --
-- callers with a larger batch (e.g. a big wedding publish) must chunk
-- before calling this, see processRenderedPhotos.
function M.assignFilesToSection(galleryId, sectionId, fileIds)
    local res = M.request(
        "POST",
        "/galleries/" .. galleryId .. "/sections/" .. sectionId .. "/files",
        { fileIds = fileIds }
    )
    return res and res.assigned
end

-- Upload-init: registers n files, gets back presigned PUT URLs. We use the
-- existing Studio upload endpoint -- no plug-in-specific path needed, since
-- it already supports Bearer-token auth.
function M.initUpload(galleryId, files)
    local res = M.request("POST", "/uploads/init", {
        galleryId = galleryId,
        files = files,
    })
    return (res and res.uploads) or {}
end

-- Upload-complete: after the S3 PUT, the plug-in reports success to Lumio
-- so worker processing (thumbs/preview/web/watermark) starts.
function M.completeUpload(fileId, parts)
    local res = M.request("POST", "/uploads/complete", {
        fileId = fileId,
        parts = parts,  -- nil for single-PUT, array for multipart
    })
    return res
end

-- Single-part upload to S3 via a presigned PUT URL.
-- Lightroom renders are typically < 50 MB JPEGs (even at 100% quality), so
-- single-PUT instead of multipart. Multipart support can come later if
-- someone exports RAW.
function M.uploadFileToS3(presignedUrl, filepath, mimeType)
    -- Read the file -- the LR SDK offers no streamed-upload API, so we
    -- load it entirely into RAM. For huge files (100 MB+) that would be
    -- problematic, but JPEG renders are rarely that large.
    local f, err = io.open(filepath, "rb")
    if not f then
        error("Lumio: cannot open file: " .. tostring(err))
    end
    local data = f:read("*all")
    f:close()
    if not data then
        error("Lumio: file is empty or unreadable: " .. filepath)
    end

    local headers = {
        { field = "Content-Type", value = mimeType or "application/octet-stream" },
    }
    log:info("S3 PUT " .. presignedUrl:sub(1, 80) .. "... (" .. #data .. " bytes)")

    -- Retry here as well. This is the only multi-megabyte transfer and at the
    -- same time the only call that is SAFE to repeat: a presigned PUT to the
    -- same key with the same content is idempotent, unlike POST /uploads/init.
    -- Without this, a single network hiccup discarded the whole photo.
    local responseBody, responseHeaders
    local waited = 0
    for attempt = 0, #RETRY_DELAYS do
        responseBody, responseHeaders = LrHttp.post(presignedUrl, data, headers, "PUT")

        local netErr = responseHeaders and responseHeaders.error
        local st = responseHeaders and tonumber(responseHeaders.status) or nil
        local shouldRetry = (not responseHeaders) or netErr or (st == nil)
            or st == 500 or st == 502 or st == 503 or st == 504

        if not shouldRetry or attempt >= #RETRY_DELAYS then break end

        local delay = math.min(RETRY_DELAYS[attempt + 1], MAX_DELAY)
        if waited + delay > MAX_TOTAL_WAIT then break end
        waited = waited + delay
        log:warn(string.format("S3 PUT attempt %d failed (%s), waiting %d s",
            attempt + 1, netErr and "network error" or tostring(st), delay))
        interruptibleSleep(delay)
    end

    if not responseHeaders then
        error("Lumio: no response from S3 (network problem?)")
    end
    -- Was `responseHeaders.status or 0`, so a MISSING status code (connection
    -- dropped mid-transfer) was read as SUCCESS -> the server was left with a
    -- file row and no object, and the user saw no error at all.
    -- An explicit 2xx is now required.
    local netErr = responseHeaders.error
    local status = tonumber(responseHeaders.status)
    if netErr then
        error("Lumio: S3 upload failed due to a network error: " ..
            tostring(netErr.name or netErr.errorCode or "unknown"))
    end
    if type(status) ~= "number" or status < 200 or status >= 300 then
        error("Lumio: S3 upload failed (status " .. tostring(status) .. ") " ..
            (responseBody or ""):sub(1, 200))
    end
    -- S3 returns an ETag header -- not strictly needed for single-PUT, but
    -- we return it for a possible future multipart extension.
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
