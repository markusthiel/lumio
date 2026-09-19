--[[
    LumioPublishService.lua

    Lightroom Publish-Service provider for Lumio.

    What it does
    ============
    The photographer creates a "Lumio" publish service in the Lightroom
    "Library" module under "Publishing Services". One published collection
    per Lumio gallery. Drag-and-drop or Smart Collection rules decide which
    photos go into the gallery. Clicking "Publish" makes Lightroom render
    the photos to JPEGs (export engine), and we upload them to Lumio.

    Lightroom hooks cheat sheet
    ============================
    Service level (= all collections):
      - startDialog / endDialog               : service setup
      - sectionsForTopOfDialog                : auth check + token hint

    Collection level (= one Lumio gallery):
      - viewForCollectionSettings             : pick/create gallery,
                                                 status toggle
      - updateCollectionSettings              : after settings save

    Photo level (= upload + delete):
      - processRenderedPhotos                 : per publish batch
      - deletePhotosFromPublishedCollection   : photos removed from LR coll.

    "Go to" menu entries:
      - goToPublishedCollection                : right-click a collection ->
                                                  Studio management view
      - goToPublishedPhoto                     : right-click a photo ->
                                                  public customer-facing gallery

    Metadata-triggered:
      - metadataThatTriggersRepublish         : what has to change for LR
                                                 to show the 'Republish' button

    Data flow
    =========
    1. LR renders photo -> temp JPEG
    2. processRenderedPhotos receives each rendered photo
    3. We call initUpload(gallery, [{ filename, sizeBytes, mimeType }])
    4. S3 PUT to the presigned URL
    5. completeUpload(fileId)
    6. rendition:recordPublishedPhotoId(fileId) -- LR remembers the Lumio ID
]]

local LrApplication        = import "LrApplication"
local LrBinding            = import "LrBinding"
local LrColor              = import "LrColor"
local LrDate               = import "LrDate"
local LrDialogs            = import "LrDialogs"
local LrMD5                = import "LrMD5"
local LrFunctionContext    = import "LrFunctionContext"
local LrPathUtils          = import "LrPathUtils"
local LrPrefs              = import "LrPrefs"
local LrTasks              = import "LrTasks"
local LrView               = import "LrView"
local LrFileUtils          = import "LrFileUtils"

local api     = require "LumioApi"
local log     = require "Logger"
local json    = require "Json"
local jpegXmp = require "JpegXmp"

local exportServiceProvider = {}

-- ============================================================================
-- Plug-in metadata
-- ============================================================================
exportServiceProvider.supportsIncrementalPublish = "only"
exportServiceProvider.exportPresetFields = {
    -- Service-wide defaults (come from the Plugin Manager section)
}
exportServiceProvider.hideSections = {
    -- Default export sections we do NOT want to show
    "exportLocation",  -- Lumio has no 'Where to save' -- goes straight online
    "fileNaming",       -- we use the original filename
    "video",            -- no video upload yet
    "watermarking",     -- watermarking happens server-side in Lumio
    "postProcessing",   -- handled by Lumio (renditions/watermark/HLS)
}
exportServiceProvider.allowFileFormats = { "JPEG" }
exportServiceProvider.allowColorSpaces = { "sRGB" }
exportServiceProvider.titleForPublishedCollection           = "Lumio Gallery"
exportServiceProvider.titleForPublishedCollection_standalone = "Lumio Gallery"
exportServiceProvider.titleForPublishedSmartCollection      = "Lumio Smart Gallery"
exportServiceProvider.titleForPublishedSmartCollection_standalone = "Lumio Smart Gallery"
exportServiceProvider.titleForGoToPublishedCollection       = "Show in Lumio"
exportServiceProvider.titleForGoToPublishedPhoto            = "Show public gallery"
exportServiceProvider.small_icon = "icon.png"
exportServiceProvider.supportsCustomSortOrder = false
exportServiceProvider.disableRenamePublishedCollection      = false
exportServiceProvider.disableRenamePublishedCollectionSet   = true

-- This was missing entirely. Without getCollectionBehaviorInfo, Lightroom
-- assumes Collection Set support and fails with
-- "?:0: attempt to call method 'hierarchyCreated' (a nil value)" when a
-- collection is created in the publish service. The plug-in has NO set-level
-- callbacks (e.g. updateCollectionSetSettings), so tell LR outright that
-- hierarchies are unsupported: maxCollectionSetDepth = 0.
function exportServiceProvider.getCollectionBehaviorInfo(publishSettings)
    return {
        defaultCollectionName         = "Lumio Gallery",
        defaultCollectionCanBeDeleted = true,
        canAddCollection              = true,
        maxCollectionSetDepth         = 0,
    }
end

-- Republish trigger: file content only, not metadata. Lightroom filename
-- changes WOULD trigger a republish, but that's rare -- we list
-- 'default = false' so the Republish button doesn't light up by default
-- after every edit. The photographer has to click 'Republish' explicitly.
function exportServiceProvider.metadataThatTriggersRepublish(publishSettings)
    return {
        default = false,
    }
end

-- ============================================================================
-- Service setup dialog (in the Plug-in Manager)
-- ============================================================================
-- The Plug-in Manager UI (PluginManager.lua) already has host + token.
-- Here we just show a hint in the publish service section.

function exportServiceProvider.sectionsForTopOfDialog(viewFactory, propertyTable)
    return {
        {
            title = "Lumio Connection",
            synopsis = "API token is managed in the plug-in options",
            viewFactory:row {
                viewFactory:static_text {
                    title = "Host and API token are managed globally in the plug-in options.",
                    width_in_chars = 60,
                },
            },
            viewFactory:row {
                viewFactory:static_text {
                    title = "Note: one published collection is created per Lumio gallery.",
                    width_in_chars = 60,
                    text_color = LrColor(0.5, 0.5, 0.5),
                },
            },
        },
    }
end

-- ============================================================================
-- Collection settings (per Lumio gallery)
-- ============================================================================
-- Here the photographer picks which Lumio gallery belongs to this LR
-- collection. If none exists yet: create one.

function exportServiceProvider.viewForCollectionSettings(viewFactory, publishSettings, info)
    local f = viewFactory
    local props = info.collectionSettings

    -- Set defaults -- otherwise the property fields are nil and LR complains
    props.galleryId = props.galleryId or ""
    props.galleryTitle = props.galleryTitle or ""
    props.galleryMode = props.galleryMode or "collaboration"
    props.galleryStatus = props.galleryStatus or "draft"
    props.makeLive = props.makeLive or false

    -- Existing galleries did not show up in the menu. The server was not at
    -- fault: GET /plugin/galleries returns 200 and the correct list (verified
    -- with a direct API call). Two bugs in the plug-in:
    --   1. The list was set ONLY asynchronously, after the dialog had been
    --      built, by which time the binding no longer refreshed the popup_menu.
    --   2. The old line was `props.availableGalleries = props.availableGalleries or {...}`
    --      and because props = info.collectionSettings PERSISTS, on the second
    --      open the `or` kept the stale (usually "Loading…") value and the list
    --      never refreshed.
    -- Fix: build the menu SYNCHRONOUSLY from the prefs cache right away, and
    -- refresh that cache in the background for the next open.
    local prefs = LrPrefs.prefsForPlugin()

    local function buildGalleryItems(list)
        local items = { { title = "— Create new gallery (enter title below) —", value = "" } }
        for _, g in ipairs(list or {}) do
            table.insert(items, {
                title = string.format("%s (%s, %d files)",
                    tostring(g.title), tostring(g.status), g.fileCount or 0),
                value = g.id,
            })
        end
        return items
    end

    -- The cache does NOT go into prefs as a table. LrPrefs only stores simple
    -- values reliably; a table of tables was lost silently, so on the next open
    -- the list read back empty. The log proved it: "gallery list refreshed:
    -- 1 galleries" was written, yet the menu stayed empty. Store it as a JSON
    -- string instead.
    local cached = {}
    if type(prefs.galleryCacheJson) == "string" and prefs.galleryCacheJson ~= "" then
        local okDecode, decoded = pcall(json.decode, prefs.galleryCacheJson)
        if okDecode and type(decoded) == "table" then cached = decoded end
    end

    -- 1) show immediately: the last fetched list (empty only on the very first run)
    props.availableGalleries = buildGalleryItems(cached)

    -- If the collection already has a gallery but the cache is empty (the first
    -- open after this change), the menu would show ONLY the "Create new gallery"
    -- row with the value "". The user would pick it, galleryId would reset, and
    -- the NEXT publish would create a stray extra gallery for the client.
    -- Always keep the currently bound value in the list.
    if props.galleryId and props.galleryId ~= "" then
        local found = false
        for _, it in ipairs(props.availableGalleries) do
            if it.value == props.galleryId then found = true break end
        end
        if not found then
            local label = (props.galleryTitle and props.galleryTitle ~= "")
                and props.galleryTitle or props.galleryId
            table.insert(props.availableGalleries, 2,
                { title = "(current) " .. tostring(label), value = props.galleryId })
        end
    end

    -- 2) fresh fetch in the background: refreshes the cache and also tries live binding
    LrTasks.startAsyncTask(function()
        local ok, galleries = LrTasks.pcall(api.listGalleries)
        if not ok then
            log:warn("gallery list could not be loaded: " .. tostring(galleries))
            return
        end
        -- NOTE: an empty list is cached on purpose. The error path is already
        -- handled above (if not ok then ... return end), so an empty result that
        -- reaches this point genuinely means an empty account. If we skipped
        -- caching it, a gallery deleted in the Studio would linger in the menu
        -- forever.
        local okEnc, encoded = pcall(json.encode, galleries)
        if okEnc then prefs.galleryCacheJson = encoded end
        props.availableGalleries = buildGalleryItems(galleries)
        log:info("gallery list refreshed: " .. #galleries ..
                 " galleries, cache " .. (okEnc and "written" or "FAILED"))
    end)

    -- THIS was the real cause of the 'hierarchyCreated' failure.
    -- sectionsForTopOfDialog returns a table of SECTIONS (title/synopsis/…),
    -- but viewForCollectionSettings has to return a SINGLE VIEW. This returned
    -- a sections-shaped table, so LR tried to call the method
    -- 'hierarchyCreated' on it -> "An internal error has occurred". The
    -- function itself ran to completion (hence the gallery fetches in the log),
    -- but the dialog died on the return value -- which is why the dropdown was
    -- never seen at all.
    return f:group_box {
        title = "Lumio Gallery",
        fill_horizontal = 1,
        f:column {
            spacing = f:control_spacing(),
            fill_horizontal = 1,
            f:row {
                f:static_text {
                    title = "Existing gallery:",
                    width = LrView.share "label_width",
                    alignment = "right",
                },
                f:popup_menu {
                    bind_to_object = props,
                    value = LrView.bind("galleryId"),
                    items = LrView.bind("availableGalleries"),
                    width_in_chars = 40,
                },
            },
            f:row {
                f:static_text {
                    title = "OR create new:",
                    width = LrView.share "label_width",
                    alignment = "right",
                },
                f:edit_field {
                    bind_to_object = props,
                    value = LrView.bind("galleryTitle"),
                    placeholder_string = "Gallery title (e.g. 'Mäyränkatu 14')",
                    width_in_chars = 40,
                },
            },
            f:row {
                f:static_text {
                    title = "Mode:",
                    width = LrView.share "label_width",
                    alignment = "right",
                },
                f:popup_menu {
                    bind_to_object = props,
                    value = LrView.bind("galleryMode"),
                    items = {
                        { title = "Selection / proofing (client likes & picks)", value = "collaboration" },
                        { title = "Presentation (view only)", value = "presentation" },
                    },
                    width_in_chars = 40,
                },
            },
            f:row {
                f:static_text {
                    title = " ",
                    width = LrView.share "label_width",
                },
                f:checkbox {
                    bind_to_object = props,
                    value = LrView.bind("makeLive"),
                    title = "Set gallery live automatically after upload",
                },
            },
            f:row {
                f:static_text {
                    title = " ",
                    width = LrView.share "label_width",
                },
                f:static_text {
                    title = "Tip: configure header, branding and password in Lumio Studio after the first upload.",
                    width_in_chars = 50,
                    text_color = LrColor(0.5, 0.5, 0.5),
                    height_in_lines = 2,
                },
            },
        },
    }
end

-- ============================================================================
-- Upload helper (forward-declared so processRenderedPhotos can reach it)
-- ============================================================================
-- uploadOnePhoto: sends ONE rendition to Lumio. Throws on failure.
-- rendition:recordPublishedPhotoId(fileId) is set so LR remembers which
-- Lumio file corresponds to this photo.
--
-- HASH-MATCHING. Filename-only matching in ImportSelectionTask.lua breaks
-- the moment a photo is renamed in LR, or when several masters share one
-- basename (documented as a known limitation). Fix: hash the ORIGINAL
-- master file (not the JPEG render) with LrMD5 -- a native SDK API
-- (stable since SDK 1.3), no external dependency -- and stamp it into the
-- uploaded JPEG via
-- JpegXmp so the server (and later the Selection-Import) can identify the
-- photo by content, independent of its current filename.
-- Best-effort: reading the whole master into RAM to hash it can be slow
-- for very large files (medium-format RAW, 150+ MP), and the master may be
-- offline (external/network drive). Neither should ever block a publish,
-- so failures here are logged and swallowed -- the upload proceeds without
-- the hash, exactly like publishing did before this feature existed.
--
-- Also returns the master's byte size, at zero extra cost (the file is
-- already fully in RAM to hash it). Selection-Import uses this as a cheap
-- pre-filter -- an OS stat call, no file content read -- before hashing a
-- rename-recovery candidate, instead of hashing every candidate in the
-- catalog. See ImportSelectionTask.lua.
local function computeOriginalMd5(photo)
    local path = photo:getRawMetadata("path")
    if not path then return nil end
    local f, ferr = io.open(path, "rb")
    if not f then
        log:warn("original hash: cannot open master (" .. tostring(path) .. "): " .. tostring(ferr))
        return nil
    end
    local data = f:read("*all")
    f:close()
    if not data or #data == 0 then
        log:warn("original hash: master is empty or unreadable: " .. tostring(path))
        return nil
    end
    return LrMD5.digest(data):lower(), #data
end

-- RE-PUBLISH. Before: every re-publish (edit -> "Republish", or a manual
-- "Republish" click) uploaded a brand-new file and never touched the
-- previous one. rendition.publishedPhotoId, set by LR from the ID we
-- recorded on the LAST publish of this exact photo (nil on the very first
-- publish), was never read. Result: the online gallery accumulated one
-- extra copy of the same photo per re-publish cycle.
-- Now: if this photo was published before, we delete the old remote file
-- FIRST, then upload the new one -- matching the delete+recreate workflow
-- already documented server-side (routes/plugin.ts, DELETE
-- /plugin/galleries/:id/files/:fileId). This trades a small window (old
-- file gone, new upload not yet done) for never leaving two copies behind;
-- see the loud failure message below for why that window is acceptable.
local function uploadOnePhoto(rendition, filepath, galleryId)
    -- Read the original filename from the LR photo (NOT from the render
    -- path, which is a temp.jpg)
    local photo = rendition.photo
    local origName = photo:getFormattedMetadata("fileName") or LrPathUtils.leafName(filepath)
    -- Fix the extension: we render as JPEG, so .jpg
    local nameNoExt = LrPathUtils.removeExtension(origName)
    local filename = nameNoExt .. ".jpg"

    -- Compute + embed the original hash BEFORE measuring the file size --
    -- embedding changes the file size, and initUpload needs the actual
    -- (final) size for the S3 presign.
    local okHash, hashResult, sizeResult = LrTasks.pcall(computeOriginalMd5, photo)
    local originalMd5 = okHash and hashResult or nil
    if not okHash then
        log:warn("original hash: computation failed: " .. tostring(hashResult))
    elseif originalMd5 then
        local okEmbed, embedErr = LrTasks.pcall(jpegXmp.embedOriginalMd5, filepath, originalMd5, sizeResult)
        if not okEmbed then
            log:warn("original hash: embedding into JPEG failed: " .. tostring(embedErr))
        end
    end

    -- File size (measure AFTER embedding, see above)
    local sizeBytes = LrFileUtils.fileAttributes(filepath).fileSize or 0
    if sizeBytes == 0 then
        error("File is empty: " .. filepath)
    end

    -- Re-publish: remove the old Lumio file first. Best-effort -- a 404
    -- (e.g. already deleted manually in Lumio) or any other error is
    -- logged but does NOT block uploading the new version. If the upload
    -- fails afterwards, the error message below makes that explicit,
    -- instead of letting it vanish silently into the log.
    local previousRemoteId = rendition.publishedPhotoId
    local deletedPrevious = false
    if previousRemoteId then
        local okDel, delErr = LrTasks.pcall(api.deleteGalleryFile, galleryId, previousRemoteId)
        if okDel then
            deletedPrevious = true
        else
            log:warn("re-publish: could not delete old file (" ..
                tostring(previousRemoteId) .. "): " .. tostring(delErr))
        end
    end

    -- Init call: returns a presigned PUT URL
    local okUpload, uploadErr = LrTasks.pcall(function()
        local uploads = api.initUpload(galleryId, {
            {
                filename = filename,
                sizeBytes = sizeBytes,
                mimeType = "image/jpeg",
            },
        })
        if not uploads or not uploads[1] then
            error("init: no upload instructions received")
        end
        local u = uploads[1]
        if u.method ~= "single" then
            error("multipart upload not currently supported (photo > 100 MB)")
        end

        -- S3 PUT
        api.uploadFileToS3(u.uploadUrl, filepath, "image/jpeg")

        -- Complete: kicks off worker processing
        api.completeUpload(u.fileId, nil)

        -- LR remembers the Lumio file ID. On a later republish/delete, LR
        -- hands this ID to deletePhotosFromPublishedCollection.
        rendition:recordPublishedPhotoId(u.fileId)
    end)

    if not okUpload then
        if deletedPrevious then
            -- The old remote file is already gone at this point -- unlike a
            -- first-time publish failure, the photo is now genuinely MISSING
            -- from the online gallery, not just "not yet uploaded". Make that
            -- loud instead of letting it read like an ordinary upload error.
            error("WARNING: the previous version was removed from Lumio but the new " ..
                "upload failed -- this photo is NO LONGER visible in the online " ..
                "gallery, republish as soon as possible: " .. tostring(uploadErr))
        else
            -- Level 0: uploadErr already carries a "file:line:" prefix from
            -- the inner error() call, re-adding one would just double it up.
            error(uploadErr, 0)
        end
    end
    -- This was `rendition:recordPublishedPhotoUrl(nil)`. LR requires a string
    -- and failed every photo with
    -- "AgExportRendition:recordRemotePhotoUrl: URL must be a string".
    -- The photos DID reach Lumio (the upload happens before this line), but LR
    -- never marked them as published -> they stayed in "New Photos to Publish"
    -- and would have been uploaded again on every publish = duplicates.
    -- The URL call is optional in the SDK and the upload response carries no
    -- viewable address (only a presigned PUT), so it is removed.
    -- "Show in Lumio" at gallery level still works (host + /studio/<id>).
end

-- Looks up a gallery's public slug: prefer the value already stored on the
-- collection (only set when the gallery was CREATED from this plug-in, or
-- self-healed on an existing one -- see the self-heal branch in
-- processRenderedPhotos below), falling back to the background-refreshed
-- gallery list cache built in viewForCollectionSettings. Returns nil if it
-- cannot be determined. Used both by that self-heal branch and by
-- goToPublishedPhoto further below.
local function resolveGallerySlug(collSettings)
    local slug = collSettings.gallerySlug
    if slug and slug ~= "" then return slug end
    if not collSettings.galleryId or collSettings.galleryId == "" then return nil end

    local prefs = LrPrefs.prefsForPlugin()
    if type(prefs.galleryCacheJson) ~= "string" or prefs.galleryCacheJson == "" then
        return nil
    end
    local okDecode, cached = pcall(json.decode, prefs.galleryCacheJson)
    if not (okDecode and type(cached) == "table") then return nil end
    for _, g in ipairs(cached) do
        if g.id == collSettings.galleryId then return g.slug end
    end
    return nil
end

-- ============================================================================
-- processRenderedPhotos — upload loop
-- ============================================================================
-- Lightroom has rendered the photos to temp JPEGs and hands us the
-- exportContext. We iterate over all renditions and upload them.

function exportServiceProvider.processRenderedPhotos(functionContext, exportContext)
    local exportSession = exportContext.exportSession

    -- Get the gallery ID from the collection settings. If there is none:
    -- create the gallery now (the user gave a "new gallery" title).
    -- gallerySlug is only used by goToPublishedPhoto (public gallery link,
    -- see below) -- goToPublishedCollection itself now uses galleryId.
    local galleryId, gallerySlug, collProps
    if exportContext.publishedCollection then
        local collInfo = exportContext.publishedCollection:getCollectionInfoSummary()
        if collInfo and collInfo.collectionSettings then
            collProps = collInfo.collectionSettings
            galleryId = collProps.galleryId
            gallerySlug = collProps.gallerySlug
        end
    end

    if (not galleryId or galleryId == "") and collProps then
        -- Create a new gallery
        local title = (collProps.galleryTitle or ""):gsub("^%s+", ""):gsub("%s+$", "")
        if title == "" then
            LrDialogs.message(
                "Lumio",
                "This collection has no gallery assigned. Open 'Edit Published Collection' and either choose an existing gallery or enter a title for a new one.",
                "critical"
            )
            return
        end
        local ok, created = LrTasks.pcall(
            api.createGallery, title, collProps.galleryMode, nil
        )
        if not ok then
            LrDialogs.message("Lumio", "Could not create gallery: " .. tostring(created), "critical")
            return
        end
        galleryId = created.id
        gallerySlug = created.slug
        -- Persist into the collection settings -- LR saves this on the
        -- next dialog open. Direct write access to the published
        -- collection's settings goes through catalog:withWriteAccessDo.
        local catalog = LrApplication.activeCatalog()
        catalog:withWriteAccessDo("Lumio: assign gallery", function()
            local current = exportContext.publishedCollection:getCollectionInfoSummary().collectionSettings or {}
            current.galleryId = galleryId
            current.gallerySlug = gallerySlug
            exportContext.publishedCollection:setCollectionSettings(current)
        end)
    elseif collProps and (not gallerySlug or gallerySlug == "") then
        -- SELF-HEAL. gallerySlug is only ever captured above, when a NEW
        -- gallery is created from this dialog. A collection bound to an
        -- EXISTING gallery (picked from the dropdown in
        -- viewForCollectionSettings) never gets one, leaving
        -- goToPublishedPhoto dependent entirely on the gallery-list cache
        -- -- which only refreshes when "Edit Lumio Gallery" is reopened,
        -- so it goes stale as soon as a gallery is created/renamed in
        -- Studio instead. Resolve it here (same cache-fallback lookup
        -- used for the public-gallery link) and persist it the same
        -- proven way used above for a newly created gallery, so it
        -- self-heals on the very next publish to any collection bound to
        -- an existing gallery. Best-effort: unlike gallery creation this
        -- must never fail the publish itself, so it's wrapped in pcall.
        local resolvedSlug = resolveGallerySlug(collProps)
        if resolvedSlug and resolvedSlug ~= "" then
            gallerySlug = resolvedSlug
            local okHeal, healErr = LrTasks.pcall(function()
                local catalog = LrApplication.activeCatalog()
                catalog:withWriteAccessDo("Lumio: repair gallery slug", function()
                    local current = exportContext.publishedCollection:getCollectionInfoSummary().collectionSettings or {}
                    current.gallerySlug = gallerySlug
                    exportContext.publishedCollection:setCollectionSettings(current)
                end)
            end)
            if not okHeal then
                log:warn("gallerySlug self-heal failed: " .. tostring(healErr))
            end
        end
    end

    if not galleryId or galleryId == "" then
        LrDialogs.message("Lumio", "No Lumio gallery assigned.", "critical")
        return
    end

    local nPhotos = exportSession:countRenditions()
    local progressScope = exportContext:configureProgress {
        title = nPhotos > 1
            and (nPhotos .. " photos uploading to Lumio")
            or "1 photo uploading to Lumio",
    }

    local uploaded = 0
    local failed = 0
    local failedList = {}

    -- Wire cancellation into the API layer's waits. Without this the retry
    -- sleeps do not react to the Cancel button at all, because cancellation is
    -- only checked BETWEEN photos.
    api.isCanceled = function() return progressScope:isCanceled() end

    for i, rendition in exportContext:renditions { stopIfCanceled = true } do
        progressScope:setPortionComplete((i - 1) / nPhotos)

        -- Wait for the render -- LR renders on background threads, we get
        -- the finished path via waitForRender.
        local success, pathOrMessage = rendition:waitForRender()
        if progressScope:isCanceled() then break end

        if not success then
            failed = failed + 1
            table.insert(failedList,
                (rendition.photo:getFormattedMetadata("fileName") or "?") ..
                ": " .. tostring(pathOrMessage))
            log:warn("Render failed: " .. tostring(pathOrMessage))
            -- Tell LR that THIS photo failed. Without it LR's publish state is
            -- left undefined and the photo can appear published even though it
            -- was never uploaded.
            rendition:uploadFailed(tostring(pathOrMessage))
        else
            local ok, errMsg = LrTasks.pcall(uploadOnePhoto, rendition, pathOrMessage, galleryId)
            if ok then
                uploaded = uploaded + 1
            else
                failed = failed + 1
                local fname = rendition.photo:getFormattedMetadata("fileName") or "?"
                table.insert(failedList, fname .. ": " .. tostring(errMsg))
                log:warn("Upload failed for " .. fname .. ": " .. tostring(errMsg))
                rendition:uploadFailed(tostring(errMsg))
            end
            -- Clean up the temp file
            if pathOrMessage and LrFileUtils.exists(pathOrMessage) then
                LrFileUtils.delete(pathOrMessage)
            end
        end

        progressScope:setPortionComplete(i / nPhotos)
    end

    -- Set status to 'live' if requested.
    -- A failure here used to surface only in the log, so the photographer
    -- believed the gallery was published and sent the client a link to a
    -- gallery that was still a draft. This actually happened at 14:15 (HTTP 429).
    local statusPatchError = nil
    if collProps and collProps.makeLive and uploaded > 0 then
        local ok, err = LrTasks.pcall(function()
            api.patchGallery(galleryId, { status = "live" })
        end)
        if not ok then
            statusPatchError = tostring(err)
            log:warn("status=live failed: " .. statusPatchError)
        end
    end

    -- Close the progress bar and detach the cancellation hook BEFORE showing
    -- dialogs. done() used to run only after all the modals, which left the bar
    -- spinning for as long as the user was reading them.
    progressScope:done()
    api.isCanceled = nil

    -- Combined summary: LR already shows its own "Export Results" modal for
    -- failed renditions (rendition:uploadFailed), so rather than stacking three
    -- dialogs we show a single message of our own.
    local notes = {}
    if statusPatchError then
        table.insert(notes,
            "Gallery status could NOT be set to live:\n" .. statusPatchError ..
            "\nThe gallery is still a draft — set it live in Lumio Studio.")
    end
    if failed > 0 then
        local msg = uploaded .. " succeeded, " .. failed .. " failed.\n"
        for i, line in ipairs(failedList) do
            if i > 10 then
                msg = msg .. "(and " .. (failed - 10) .. " more)\n"
                break
            end
            msg = msg .. line .. "\n"
        end
        table.insert(notes, msg)
    end
    if #notes > 0 then
        LrDialogs.message("Lumio", table.concat(notes, "\n\n"), "warning")
    end
end

-- ============================================================================
-- deletePhotosFromPublishedCollection
-- ============================================================================
-- Called when the photographer removes photos from the published
-- collection, or deletes the collection entirely. We delete the
-- corresponding Lumio files via the API.

function exportServiceProvider.deletePhotosFromPublishedCollection(
    publishSettings, arrayOfPhotoIds, deletedCallback, localCollectionId
)
    -- Resolve the Lumio gallery: from the publishedCollection property,
    -- which LR does not hand to publishSettings directly. We have to go
    -- through LrApplication.activeCatalog():getPublishedCollectionByLocalIdentifier.
    local catalog = LrApplication.activeCatalog()
    local publishedColl = catalog:getPublishedCollectionByLocalIdentifier(localCollectionId)
    if not publishedColl then
        log:warn("delete: publishedCollection not found")
        return
    end
    local collInfo = publishedColl:getCollectionInfoSummary()
    local galleryId = collInfo and collInfo.collectionSettings and collInfo.collectionSettings.galleryId
    if not galleryId or galleryId == "" then
        log:warn("delete: galleryId not set")
        return
    end

    for _, photoId in ipairs(arrayOfPhotoIds) do
        local ok, err = LrTasks.pcall(api.deleteGalleryFile, galleryId, photoId)
        if ok then
            deletedCallback(photoId)
            log:info("deleted file " .. photoId)
        else
            log:warn("delete failed " .. photoId .. ": " .. tostring(err))
        end
    end
end

-- ============================================================================
-- goToPublishedCollection
-- ============================================================================
-- Called from the "Show in Lumio" menu entry (right-click a published
-- collection). Opens the gallery's STUDIO management page (photographer-
-- facing: branding, status, files) -- NOT the public customer-facing
-- gallery. A photographer right-clicking the COLLECTION wants to manage
-- it, not see what the customer sees; goToPublishedPhoto below (right-
-- click a PHOTO) covers the "show me the public link" case instead.
-- The Studio route is keyed by galleryId, not slug, so this does not need
-- resolveGallerySlug.
function exportServiceProvider.goToPublishedCollection(publishSettings, info)
    local LrHttp = import "LrHttp"
    local collInfo = info.publishedCollection and info.publishedCollection:getCollectionInfoSummary()
    if not collInfo then return end
    local collSettings = collInfo.collectionSettings or {}
    local galleryId = collSettings.galleryId
    -- Was `publishSettings.host`, which does not exist -- the host is set in
    -- the plug-in's own settings (PluginManager), not in the publish service
    -- settings. That is why "Show in Lumio" could never have worked.
    local host = (LrPrefs.prefsForPlugin().host or ""):gsub("/+$", "")

    if not galleryId or galleryId == "" or host == "" then
        LrDialogs.message("Lumio",
            "Gallery ID or host is missing. Publish the collection once, " ..
            "or set the server address in Plug-in Manager.", "warning")
        return
    end
    -- Studio gallery management URL
    LrHttp.openUrlInBrowser(host .. "/studio/" .. galleryId)
end

-- ============================================================================
-- goToPublishedPhoto
-- ============================================================================
-- Called from the per-photo "Show public gallery" menu entry (right-click
-- a single published photo). Complements goToPublishedCollection: that one
-- opens the Studio management view, this one opens the PUBLIC customer-
-- facing gallery link -- for the times a photographer genuinely wants to
-- see what the client sees, which a Studio-only link can't cover (it also
-- needs an active Studio browser session, unlike the public link).
-- Opens the whole gallery, not a link anchored to this one photo -- the
-- public gallery view has no per-photo deep link today.
--
-- REAL-DEVICE FIX (credit: @canja006, tested against a real LrC install,
-- see PR #27). The first version assumed info.publishedCollectionInfo had
-- the same shape as getCollectionInfoSummary() elsewhere in this file (in
-- particular a .collectionSettings field) -- wrong. Logged on a real
-- install, info.publishedCollectionInfo only ever carries
-- {isDefaultCollection, name, parents}, and LrPublishedPhoto has no
-- getPublishedCollection() either. The only route to the collection's
-- settings is via the PHOTO: photo:getContainedPublishedCollections().
-- That call reads the catalog and therefore yields, so it cannot run
-- inside a plain pcall ("Yielding is not allowed within a C or metamethod
-- call") -- hence the LrTasks.startAsyncTask wrapper.
function exportServiceProvider.goToPublishedPhoto(publishSettings, info)
    local LrHttp = import "LrHttp"
    info = info or {}

    LrTasks.startAsyncTask(function()
        -- publishedCollectionInfo.name is the one usable hint for WHICH
        -- collection we want, in case the photo is published to more than
        -- one Lumio gallery at once.
        local wantedName = (type(info.publishedCollectionInfo) == "table")
                           and info.publishedCollectionInfo.name or nil

        local collSettings = {}
        if info.photo then
            local ok, colls = LrTasks.pcall(function()
                return info.photo:getContainedPublishedCollections()
            end)
            if ok and type(colls) == "table" then
                local fallback
                for _, coll in ipairs(colls) do
                    local okName, name = LrTasks.pcall(function() return coll:getName() end)
                    local okSummary, summary = LrTasks.pcall(function()
                        return coll:getCollectionInfoSummary()
                    end)
                    local settings = okSummary and summary and summary.collectionSettings or nil
                    if type(settings) == "table" and settings.galleryId and settings.galleryId ~= "" then
                        if okName and wantedName and name == wantedName then
                            collSettings = settings
                            break
                        end
                        fallback = fallback or settings
                    end
                end
                if next(collSettings) == nil and fallback then collSettings = fallback end
            end
        end

        local host = (LrPrefs.prefsForPlugin().host or ""):gsub("/+$", "")
        local slug = resolveGallerySlug(collSettings)
        if not slug or slug == "" or host == "" then
            LrDialogs.message("Lumio",
                "Gallery slug or host is missing. Publish the collection once, " ..
                "or set the server address in Plug-in Manager.", "warning")
            return
        end
        LrHttp.openUrlInBrowser(host .. "/g/" .. slug)
    end)
end

return exportServiceProvider
