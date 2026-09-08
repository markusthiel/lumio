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
-- Two kinds of published collection now exist:
--   - a plain collection directly under the service = "Simple Gallery" in
--     our OWN dialog UI (see viewForCollectionSettings), the original flat
--     1:1 mode (no chapters)
--   - a Collection Set = "Chapters Gallery", whose child collections become
--     Chapters (see titleForPublishedCollectionSet below and
--     viewForCollectionSettings's classifyCollection branching)
--
-- titleForPublishedCollection is DELIBERATELY left unset (Lightroom's own
-- default, "Published Collection", is used instead of "Simple Gallery"):
-- this ONE string drives LR's native "Create ^1.../Rename ^1..." menu
-- wording for EVERY plain collection, including one created INSIDE a
-- Chapters Gallery -- which is a Chapter, not a "Simple Gallery". There is
-- no way to vary this string by context (confirmed: no equivalent of
-- viewForCollectionSettings's per-instance classifyCollection branching
-- exists for this native-menu-text layer), so showing "Simple Gallery" in
-- BOTH places would misname a Chapter; Lightroom's own generic wording is
-- the more honest compromise. The wording we DO fully control -- the
-- group_box title inside our own dialog -- still reads "Simple Gallery" /
-- "Chapters Gallery" / "Lumio Chapter" correctly per context.
--
-- Smart Collections are similarly NOT offered a custom title
-- (titleForPublishedSmartCollection) -- but note this does NOT remove the
-- "Create Smart Collection" menu entry, only its wording; there is no
-- documented SDK flag to remove the entry itself (confirmed against the
-- official SDK reference -- no canAddSmartCollection-equivalent exists in
-- getCollectionBehaviorInfo). Left unset so it reads as Lightroom's own
-- generic "Published Smart Collection" rather than a misleading
-- "Lumio ..." name for a feature this plug-in doesn't actually support.
exportServiceProvider.titleForPublishedCollectionSet          = "Chapters Gallery"
exportServiceProvider.titleForPublishedCollectionSet_standalone = "Chapters Gallery"
exportServiceProvider.titleForGoToPublishedCollection       = "Show in Lumio"
exportServiceProvider.titleForGoToPublishedPhoto            = "Show public gallery"
exportServiceProvider.small_icon = "icon.png"
exportServiceProvider.supportsCustomSortOrder = false
exportServiceProvider.disableRenamePublishedCollection      = false
-- Was `true`: a Collection Set (Chapters Gallery) can now be renamed in
-- Lightroom's UI. NOTE: the rename itself is NOT currently synced to the
-- Lumio gallery's title (renamePublishedCollection below only syncs a
-- CHAPTER's title, gated on collectionSettings.sectionId, which a Set
-- never has) -- renaming the Set only affects its local LR name today.
exportServiceProvider.disableRenamePublishedCollectionSet   = false

-- getCollectionBehaviorInfo was originally added with maxCollectionSetDepth
-- = 0 to dodge a crash: without it, Lightroom assumes Collection Set support
-- and fails with "?:0: attempt to call method 'hierarchyCreated' (a nil
-- value)" as soon as a collection is created, because the plug-in had NO
-- set-level callbacks at all. We now DO implement the required set-level
-- callbacks (viewForCollectionSetSettings / endDialogForCollectionSetSettings
-- / updateCollectionSetSettings, below), so one level of nesting is safe.
-- maxCollectionSetDepth = 1 on purpose, not unlimited: this plug-in only
-- ever needs Gallery -> Chapter, never Chapter -> Sub-chapter.
function exportServiceProvider.getCollectionBehaviorInfo(publishSettings)
    return {
        defaultCollectionName         = "Simple Gallery",
        defaultCollectionCanBeDeleted = true,
        canAddCollection              = true,
        maxCollectionSetDepth         = 1,
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
                    title = "Note: a plain collection is a Simple Gallery (1:1). A Collection Set is a Chapters Gallery whose child collections become Chapters.",
                    width_in_chars = 60,
                    height_in_lines = 2,
                    text_color = LrColor(0.5, 0.5, 0.5),
                },
            },
        },
    }
end

-- ============================================================================
-- Collection classification
-- ============================================================================
-- Once maxCollectionSetDepth > 0, a plain collection either sits directly
-- under the publish service (no parent -- "root", the original flat
-- "Simple Gallery" mode) or inside a Collection Set (a "Chapters Gallery" --
-- see viewForCollectionSetSettings below). Inside a Set, exactly one child
-- is the "Default" collection WE create explicitly, right when the Set
-- itself is created (see updateCollectionSetSettings) -- its photos fall
-- into the gallery's normal unsectioned bucket, same as Simple Gallery
-- photos. Every OTHER child becomes a real Lumio Chapter (GallerySection).
--
-- Deliberately NOT keyed off LR's own info.isDefaultCollection (SDK-
-- documented but never real-device-confirmed at this exact call site) or
-- off the collection's name (renaming "Default" must not silently turn it
-- into a chapter) -- collectionSettings.isDefaultChapter is a flag WE set
-- once, at creation time, so classification stays entirely under this
-- plug-in's own control.
--
-- info.parents is confirmed (official Lightroom Classic 15 SDK reference)
-- on LrPublishedCollection:getCollectionInfoSummary()'s return table --
-- reliable for classifying a collection at PUBLISH time (processRenderedPhotos),
-- which is all this plug-in's actual logic depends on. KNOWN COSMETIC GAP:
-- on viewForCollectionSettings's info table specifically, `parents` is
-- documented as "only present when editing an existing published
-- collection" -- so a brand-new chapter's very first settings dialog
-- (before it has ever been saved) misclassifies as "root" and shows the
-- Simple Gallery picker instead of the Lumio Chapter text. Harmless: the
-- dialog reopens correctly labeled on any later edit, and
-- processRenderedPhotos classifies correctly regardless since the
-- collection already exists by the time anything is ever published.
local function classifyCollection(info)
    local parents = info and info.parents
    if not parents or #parents == 0 then
        return "root"
    end
    local settings = info and info.collectionSettings
    if settings and settings.isDefaultChapter then
        return "default_child"
    end
    return "chapter"
end

-- Resolves a child collection's parent Collection Set's own Lumio-gallery
-- settings, via the collection object's own getParent() -- confirmed on
-- LrPublishedCollection in the official Lightroom Classic 15 SDK reference
-- (there is no catalog:getPublishedCollectionSetByLocalIdentifier method;
-- an earlier version of this function assumed one existed and threw
-- "attempt to call method ... (a nil value)" on every publish). Takes the
-- actual collection OBJECT (e.g. exportContext.publishedCollection), not
-- an info/summary table. Returns (settingsTable, setObject); both nil if
-- there is no parent or it can't be resolved.
local function getParentSetSettings(collectionObj)
    if not collectionObj then return nil, nil end
    local ok, setObj = LrTasks.pcall(function() return collectionObj:getParent() end)
    if not ok or not setObj then
        if not ok then
            log:warn("could not resolve parent collection set: " .. tostring(setObj))
        end
        return nil, nil
    end
    -- A LrPublishedCollectionSet's settings come from getCollectionSetInfoSummary
    -- -- NOT getCollectionInfoSummary, which is the plain-collection method and
    -- does not exist on a Set object.
    local ok2, summary = LrTasks.pcall(function() return setObj:getCollectionSetInfoSummary() end)
    if not ok2 or not summary then
        return nil, setObj
    end
    return summary.collectionSettings or {}, setObj
end

-- ============================================================================
-- Gallery-picker -- shared between a root ("Simple Gallery") collection's
-- own settings and a Collection Set's ("Chapters Gallery") settings. Both let
-- the photographer pick an existing Lumio gallery or create a new one the
-- same way; only the group_box title around it differs per caller.
-- ============================================================================

-- Sets defaults on `props` and (re)builds the gallery dropdown, synchronously
-- from the cache and then again asynchronously from the server.
--
-- Existing galleries did not show up in the menu. The server was not at
-- fault: GET /plugin/galleries returns 200 and the correct list (verified
-- with a direct API call). Two bugs in the plug-in:
--   1. The list was set ONLY asynchronously, after the dialog had been
--      built, by which time the binding no longer refreshed the popup_menu.
--   2. The old line was `props.availableGalleries = props.availableGalleries or {...}`
--      and because props PERSISTS, on the second open the `or` kept the
--      stale (usually "Loading…") value and the list never refreshed.
-- Fix: build the menu SYNCHRONOUSLY from the prefs cache right away, and
-- refresh that cache in the background for the next open.
local function initGalleryPickerProps(props)
    props.galleryId = props.galleryId or ""
    props.galleryMode = props.galleryMode or "collaboration"
    props.makeLive = props.makeLive or false

    local prefs = LrPrefs.prefsForPlugin()

    local function buildGalleryItems(list)
        -- No separate title field for a NEW gallery -- it's named after
        -- whatever the photographer already typed into Lightroom's own
        -- collection-name field (see processRenderedPhotos), so this
        -- popup is the only thing the picker needs to ask.
        local items = { { title = "— Create new (uses this item's name) —", value = "" } }
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
    -- the list read back empty. Store it as a JSON string instead.
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
            table.insert(props.availableGalleries, 2,
                { title = "(current) " .. tostring(props.galleryId), value = props.galleryId })
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
end

-- Builds the picker's inner content (no group_box wrapper -- callers title
-- their own box differently).
--
-- THIS was the real cause of the historic 'hierarchyCreated' failure.
-- sectionsForTopOfDialog returns a table of SECTIONS (title/synopsis/…),
-- but viewForCollectionSettings has to return a SINGLE VIEW. Returning a
-- sections-shaped table made LR try to call the method 'hierarchyCreated'
-- on it -> "An internal error has occurred". Kept as a warning for anyone
-- touching this area again.
local function buildGalleryPickerView(f, props)
    return f:column {
        spacing = f:control_spacing(),
        fill_horizontal = 1,
        f:row {
            f:static_text {
                title = "Gallery:",
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
    }
end

-- ============================================================================
-- Collection settings (per Lumio gallery)
-- ============================================================================
-- Fires for every plain published collection, whether it's a root
-- ("Simple Gallery") or a child of a Collection Set ("Chapters Gallery" --
-- see viewForCollectionSetSettings below). Three cases, via
-- classifyCollection:
--   "root"          -- unchanged flat-mode picker, just relabeled
--   "default_child" -- the Set's own "Default" collection (created by us
--                      in updateCollectionSetSettings): no picker, gallery
--                      is inherited from the parent Set at publish time,
--                      photos land in the gallery's unsectioned bucket
--   "chapter"        -- any OTHER child of a Set: becomes a Lumio Chapter,
--                      title follows this collection's own LR name
function exportServiceProvider.viewForCollectionSettings(viewFactory, publishSettings, info)
    local f = viewFactory
    local props = info.collectionSettings
    local kind = classifyCollection(info)

    if kind == "root" then
        initGalleryPickerProps(props)
        return f:group_box {
            title = "Simple Gallery",
            fill_horizontal = 1,
            buildGalleryPickerView(f, props),
        }
    end

    if kind == "default_child" then
        return f:group_box {
            title = "Chapters Gallery",
            fill_horizontal = 1,
            f:column {
                spacing = f:control_spacing(),
                fill_horizontal = 1,
                f:row {
                    f:static_text {
                        title = "Photos published here appear in the gallery without a chapter.",
                        width_in_chars = 55,
                        height_in_lines = 2,
                    },
                },
                f:row {
                    f:static_text {
                        title = "Gallery, mode and status are configured on the parent Collection Set itself.",
                        width_in_chars = 55,
                        text_color = LrColor(0.5, 0.5, 0.5),
                        height_in_lines = 2,
                    },
                },
            },
        }
    end

    -- kind == "chapter"
    return f:group_box {
        title = "Lumio Chapter",
        fill_horizontal = 1,
        f:column {
            spacing = f:control_spacing(),
            fill_horizontal = 1,
            f:row {
                f:static_text {
                    title = "This collection is a chapter of its parent Chapters Gallery.",
                    width_in_chars = 55,
                    height_in_lines = 2,
                },
            },
            f:row {
                f:static_text {
                    title = "The chapter title follows this collection's own name — rename the collection to rename the chapter.",
                    width_in_chars = 55,
                    text_color = LrColor(0.5, 0.5, 0.5),
                    height_in_lines = 3,
                },
            },
        },
    }
end

-- ============================================================================
-- Collection-Set settings (= a Chapters Gallery)
-- ============================================================================
-- Set-level counterpart of viewForCollectionSettings above. Required once
-- maxCollectionSetDepth > 0 -- without these three callbacks Lightroom
-- assumes Collection Set support and crashes the same way documented at
-- getCollectionBehaviorInfo ("hierarchyCreated" nil-method error).

function exportServiceProvider.viewForCollectionSetSettings(viewFactory, publishSettings, info)
    local f = viewFactory
    local props = info.collectionSettings
    initGalleryPickerProps(props)
    return f:group_box {
        title = "Chapters Gallery",
        fill_horizontal = 1,
        buildGalleryPickerView(f, props),
    }
end

-- Dialog closed (Cancel or Save). No server call here -- gallery creation
-- is deferred to the first publish of one of this Set's children, exactly
-- like a root "Simple Gallery" collection today (see processRenderedPhotos).
function exportServiceProvider.endDialogForCollectionSetSettings(publishSettings, info)
end

-- Dialog SAVED (not called on Cancel, so this only ever runs once the
-- photographer actually confirms the Set). The bound galleryId/galleryMode/
-- makeLive fields (if an existing gallery was picked, or mode/makeLive for
-- a new one) are already persisted into info.collectionSettings by LR
-- itself via the view's bindings -- nothing to do for those until first
-- publish (see processRenderedPhotos). There is no separate title field to
-- persist -- a new gallery's title is this Set's own LR name, read at
-- first-publish time, not asked for separately here.
--
-- What IS done here, immediately: create the Set's "Default" child
-- collection right away, rather than leaving the Set empty until the
-- photographer manually adds one. info.publishService (LrPublishService)
-- and info.publishedCollection (confirmed field name for THIS hook in the
-- official Lightroom Classic 15 SDK reference -- despite the value being a
-- LrPublishedCollectionSet here, the field is not called
-- "publishedCollectionSet" the way it is on endDialogForCollectionSetSettings;
-- an earlier version of this function used the wrong name and the Default
-- collection was silently never created) are both present on this info table.
-- createPublishedCollection(name, parent, canReturnExisting) must run
-- inside a catalog:with___WriteAccessDo gate; canReturnExisting = true
-- makes this idempotent if the dialog is saved again later with no
-- actual changes (returns the existing "Default" instead of erroring on
-- a name clash).
-- isDefaultChapter is OUR OWN flag (see classifyCollection above) -- set
-- once here so this specific collection is recognized as the unsectioned
-- default child for as long as it exists, independent of its LR name.
function exportServiceProvider.updateCollectionSetSettings(publishSettings, info)
    local publishService = info.publishService
    local newSet = info.publishedCollection
    if not publishService or not newSet then
        log:warn("updateCollectionSetSettings: missing publishService/publishedCollection, cannot create Default chapter")
        return
    end
    local catalog = LrApplication.activeCatalog()

    -- Two SEPARATE write-access gates on purpose. Confirmed via real-device
    -- log: querying a collection's info in the SAME withWriteAccessDo call
    -- that created it throws "Can't get collection information after
    -- creating collection inside the same withWriteAccessDo function" --
    -- the original single-gate version of this function hit that on every
    -- Set creation, and the whole gate (including the create) rolled back,
    -- so "Default" silently never existed. LrPublishedCollection:getParent's
    -- own doc already warned of an equivalent same-gate restriction; this
    -- confirms it isn't unique to getParent.
    local defaultColl
    local okCreate, createErr = LrTasks.pcall(function()
        catalog:withWriteAccessDo("Lumio: create default chapter collection", function()
            defaultColl = publishService:createPublishedCollection("Default", newSet, true)
            if not defaultColl then
                error("createPublishedCollection returned nil (name clash?)")
            end
        end)
    end)
    if not okCreate then
        log:warn("could not create Default chapter collection: " .. tostring(createErr))
        return
    end

    local okMark, markErr = LrTasks.pcall(function()
        catalog:withWriteAccessDo("Lumio: mark default chapter collection", function()
            local current = defaultColl:getCollectionInfoSummary().collectionSettings or {}
            current.isDefaultChapter = true
            defaultColl:setCollectionSettings(current)
        end)
    end)
    if not okMark then
        log:warn("Default chapter collection created, but could not set isDefaultChapter flag: " .. tostring(markErr))
    end
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

    -- File size (measure AFTER embedding, see above). fileAttributes can
    -- return nil (temp render deleted/moved from under us, disk hiccup) --
    -- guard before indexing so this fails with a clear message instead of
    -- an "attempt to index a nil value" Lua error.
    local attrs = LrFileUtils.fileAttributes(filepath)
    if not attrs then
        error("Rendered file is missing or inaccessible: " .. filepath)
    end
    local sizeBytes = attrs.fileSize or 0
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
    local okUpload, resultOrErr = LrTasks.pcall(function()
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

        -- Handed back to processRenderedPhotos so a chapter publish can
        -- batch-assign this publish's uploaded files to its Section
        -- afterwards (see assignFilesToSection there).
        return u.fileId
    end)

    if not okUpload then
        if deletedPrevious then
            -- The old remote file is already gone at this point -- unlike a
            -- first-time publish failure, the photo is now genuinely MISSING
            -- from the online gallery, not just "not yet uploaded". Make that
            -- loud instead of letting it read like an ordinary upload error.
            error("WARNING: the previous version was removed from Lumio but the new " ..
                "upload failed -- this photo is NO LONGER visible in the online " ..
                "gallery, republish as soon as possible: " .. tostring(resultOrErr))
        else
            -- Level 0: resultOrErr already carries a "file:line:" prefix from
            -- the inner error() call, re-adding one would just double it up.
            error(resultOrErr, 0)
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
    return resultOrErr -- the Lumio fileId, on success
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
    -- create the gallery now (the user gave a "new gallery" title) -- or,
    -- for a Set's default/chapter child, inherit it from the parent Set,
    -- creating the Set's gallery on its own first-ever publish if needed
    -- (mirrors the root/flat "create on first publish" pattern below,
    -- just one level up).
    -- gallerySlug is only used by goToPublishedPhoto (public gallery link,
    -- see below) -- goToPublishedCollection itself now uses galleryId.
    local galleryId, gallerySlug, collProps, collInfo
    if exportContext.publishedCollection then
        collInfo = exportContext.publishedCollection:getCollectionInfoSummary()
        if collInfo and collInfo.collectionSettings then
            collProps = collInfo.collectionSettings
            galleryId = collProps.galleryId
            gallerySlug = collProps.gallerySlug
        end
    end

    local kind = classifyCollection(collInfo)
    -- Resolved once, up front, for a default/chapter child: reused both to
    -- inherit/create the gallery below and, further down, to read a fresh
    -- makeLive (never cached on the child -- it's a live toggle owned by
    -- the Set, may be flipped after chapters already exist).
    local parentSettings, parentSetObj
    if kind == "default_child" or kind == "chapter" then
        parentSettings, parentSetObj = getParentSetSettings(exportContext.publishedCollection)
    end

    if collProps and (kind == "default_child" or kind == "chapter") then
        -- Checked via `kind` FIRST, unconditionally -- NOT gated on
        -- galleryId already being empty. viewForCollectionSettings cannot
        -- tell "root" from "chapter" apart while a collection is still
        -- being created (info.parents is only populated once editing an
        -- EXISTING collection -- see classifyCollection's comment), so the
        -- full root-style picker (including "pick an existing gallery")
        -- may have been shown, and used, for what turns out to be a
        -- chapter. Always trusting the parent Set here overrides any such
        -- stray galleryId rather than silently publishing to the wrong
        -- gallery.
        if not parentSettings then
            LrDialogs.message("Lumio",
                "Could not resolve this chapter's parent Chapters Gallery. Re-open the Collection Set's settings and try again.",
                "critical")
            return
        end
        local resolvedGalleryId = parentSettings.galleryId
        local resolvedGallerySlug = parentSettings.gallerySlug
        if not resolvedGalleryId or resolvedGalleryId == "" then
            -- The Set itself has no gallery yet -- this is effectively the
            -- Set's first-ever publish, via whichever child ran first.
            -- Title = the Set's own LR name, exactly like a chapter's title
            -- is its own collection's LR name -- no separate, redundant
            -- title field to fill in anywhere in this flow.
            local title = ""
            if parentSetObj then
                local okName, name = LrTasks.pcall(function() return parentSetObj:getName() end)
                if okName and name then title = name end
            end
            title = title:gsub("^%s+", ""):gsub("%s+$", "")
            if title == "" then
                LrDialogs.message("Lumio", "Could not read this Chapters Gallery's name.", "critical")
                return
            end
            local ok, created = LrTasks.pcall(api.createGallery, title, parentSettings.galleryMode, nil)
            if not ok then
                LrDialogs.message("Lumio", "Could not create gallery: " .. tostring(created), "critical")
                return
            end
            resolvedGalleryId = created.id
            resolvedGallerySlug = created.slug
            if parentSetObj then
                local catalog = LrApplication.activeCatalog()
                catalog:withWriteAccessDo("Lumio: assign gallery to Set", function()
                    -- A LrPublishedCollectionSet uses the SetInfoSummary/
                    -- SetSettings pair, not the plain-collection methods.
                    local current = parentSetObj:getCollectionSetInfoSummary().collectionSettings or {}
                    current.galleryId = resolvedGalleryId
                    current.gallerySlug = resolvedGallerySlug
                    parentSetObj:setCollectionSetSettings(current)
                end)
            end
        end
        -- Cache onto the child's OWN settings too -- this is what keeps
        -- deletePhotosFromPublishedCollection/goToPublishedCollection/
        -- goToPublishedPhoto working unchanged: they all read straight off
        -- the child's own settings and never need to walk up to the parent.
        -- Only write when something actually changed (first inherit, or
        -- correcting a stray value) -- avoids an unnecessary catalog write
        -- (and Undo History entry) on every single publish once correct.
        if galleryId ~= resolvedGalleryId or gallerySlug ~= resolvedGallerySlug then
            galleryId = resolvedGalleryId
            gallerySlug = resolvedGallerySlug
            local catalog = LrApplication.activeCatalog()
            catalog:withWriteAccessDo("Lumio: inherit gallery from Set", function()
                local current = exportContext.publishedCollection:getCollectionInfoSummary().collectionSettings or {}
                current.galleryId = galleryId
                current.gallerySlug = gallerySlug
                exportContext.publishedCollection:setCollectionSettings(current)
            end)
        end
    elseif (not galleryId or galleryId == "") and collProps then
        -- kind == "root": title = this collection's own LR name -- no
        -- separate, redundant title field in the dialog (see
        -- buildGalleryPickerView).
        local title = (exportContext.publishedCollection:getName() or ""):gsub("^%s+", ""):gsub("%s+$", "")
        if title == "" then
            LrDialogs.message("Lumio", "This collection has no name.", "critical")
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
        -- -- which only refreshes when "Edit Published Collection" is
        -- reopened, so it goes stale as soon as a gallery is created/renamed in
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

    -- Chapter-only: resolve (or create, on first publish) this collection's
    -- Lumio Section. A default-child collection never gets one -- its
    -- photos stay in the gallery's unsectioned bucket (kind == "default_child"
    -- or "root" both leave sectionId nil, same effect).
    local sectionId
    if kind == "chapter" then
        sectionId = collProps and collProps.sectionId
        if not sectionId or sectionId == "" then
            local chapterTitle = exportContext.publishedCollection:getName()
            local ok, created = LrTasks.pcall(api.createSection, galleryId, chapterTitle)
            if not ok then
                LrDialogs.message("Lumio", "Could not create chapter: " .. tostring(created), "critical")
                return
            end
            sectionId = created.id
            local catalog = LrApplication.activeCatalog()
            catalog:withWriteAccessDo("Lumio: assign chapter", function()
                local current = exportContext.publishedCollection:getCollectionInfoSummary().collectionSettings or {}
                current.sectionId = sectionId
                exportContext.publishedCollection:setCollectionSettings(current)
                -- Not read anywhere in this plug-in today, but it's the
                -- SDK-standard place to record a remote ID for a published
                -- collection (mirrors rendition:recordPublishedPhotoId at
                -- photo level) -- costs nothing here and gives
                -- info.remoteId "for free" in rename/delete callbacks,
                -- verified working on a real install (@canja006).
                exportContext.publishedCollection:setRemoteId(sectionId)
            end)
        end
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
    -- Chapter-only: this run's successfully uploaded fileIds, batch-assigned
    -- to the Section after the loop (see below) instead of one call per
    -- photo -- far fewer HTTP round-trips on a large publish.
    local uploadedFileIds = {}

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
            local ok, resultOrErr = LrTasks.pcall(uploadOnePhoto, rendition, pathOrMessage, galleryId)
            if ok then
                uploaded = uploaded + 1
                if sectionId and sectionId ~= "" then
                    table.insert(uploadedFileIds, resultOrErr)
                end
            else
                failed = failed + 1
                local fname = rendition.photo:getFormattedMetadata("fileName") or "?"
                table.insert(failedList, fname .. ": " .. tostring(resultOrErr))
                log:warn("Upload failed for " .. fname .. ": " .. tostring(resultOrErr))
                rendition:uploadFailed(tostring(resultOrErr))
            end
            -- Clean up the temp file
            if pathOrMessage and LrFileUtils.exists(pathOrMessage) then
                LrFileUtils.delete(pathOrMessage)
            end
        end

        progressScope:setPortionComplete(i / nPhotos)
    end

    -- Chapter-only: assign this run's uploaded files to the Section, chunked
    -- to sectionAssignSchema's 500-per-call server limit -- a large wedding
    -- publish can easily exceed that in one go.
    local sectionAssignError = nil
    if sectionId and sectionId ~= "" and #uploadedFileIds > 0 then
        local CHUNK = 500
        for offset = 1, #uploadedFileIds, CHUNK do
            local chunk = {}
            for j = offset, math.min(offset + CHUNK - 1, #uploadedFileIds) do
                table.insert(chunk, uploadedFileIds[j])
            end
            local ok, err = LrTasks.pcall(api.assignFilesToSection, galleryId, sectionId, chunk)
            if not ok then
                sectionAssignError = tostring(err)
                log:warn("section assignment failed: " .. sectionAssignError)
                break
            end
        end
    end

    -- Set status to 'live' if requested. For a default/chapter child,
    -- makeLive is never cached locally -- it's owned by the parent Set and
    -- read fresh here (parentSettings was resolved at the top of this
    -- function, a local catalog read, no extra network call).
    local effectiveMakeLive
    if kind == "default_child" or kind == "chapter" then
        effectiveMakeLive = parentSettings and parentSettings.makeLive or false
    else
        effectiveMakeLive = collProps and collProps.makeLive or false
    end
    -- A failure here used to surface only in the log, so the photographer
    -- believed the gallery was published and sent the client a link to a
    -- gallery that was still a draft. This actually happened at 14:15 (HTTP 429).
    local statusPatchError = nil
    if effectiveMakeLive and uploaded > 0 then
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
    if sectionAssignError then
        table.insert(notes,
            "Some photos could NOT be assigned to their chapter:\n" .. sectionAssignError ..
            "\nThe photos are uploaded and visible in the gallery — assign them to the chapter manually in Lumio Studio.")
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
-- renamePublishedCollection / deletePublishedCollection -- Chapter sync
-- ============================================================================
-- Fired when the photographer renames or deletes a published collection OR
-- collection set in Lightroom (confirmed via the official SDK reference:
-- both hooks are shared between plain collections and Sets --
-- info.publishedCollection can be either an LrPublishedCollection or an
-- LrPublishedCollectionSet). Only a "chapter" collection (a non-default
-- child of a Collection Set, with a sectionId) has anything to sync --
-- root ("Simple Gallery"), a Set's default child, and the Set itself
-- never have a sectionId, so all three are a no-op here (renaming/
-- deleting the Set itself is deliberately NOT synced to the Lumio gallery
-- -- see the note at disableRenamePublishedCollectionSet above). Best-
-- effort throughout: a sync failure here must never block the rename/
-- delete Lightroom already performed locally, so everything is wrapped in
-- pcall + logged, matching this file's existing swallow-and-log
-- philosophy (see uploadOnePhoto's re-publish delete-old-file handling
-- above).
--
-- info.collectionSettings is NOT a documented field on either hook's info
-- table (only isDefaultCollection/name/parents/publishService/
-- publishedCollection/remoteId/remoteUrl are) -- settings must be read
-- back via info.publishedCollection:getCollectionInfoSummary(), which only
-- exists on a plain collection (Sets use getCollectionSetInfoSummary
-- instead, see getParentSetSettings above). Both functions below check
-- info.publishedCollection:type() FIRST (confirmed to return exactly
-- "LrPublishedCollection" or "LrPublishedCollectionSet") and return early
-- for a Set, rather than inferring "it's a Set" from
-- getCollectionInfoSummary() throwing -- that used to conflate "this
-- really is a Set" (fine) with "this is a chapter but the read genuinely
-- failed for some other reason" under the same silent no-op; the latter
-- now surfaces as a log:warn instead (@canja006, real-device-confirmed
-- both the original throw on a Set -- "attempt to call method
-- 'getCollectionInfoSummary' (a nil value)" -- and that the type() switch
-- behaves identically for the three cases that matter).
-- info.publishedCollection is confirmed singular (one call per collection,
-- not an array) even for a multi-select delete in the Publish Services
-- panel.

local function syncChapterRename(collSettings, newName)
    if not collSettings or not collSettings.sectionId or collSettings.sectionId == "" then
        return -- not a chapter (or not yet published once) -- nothing to sync
    end
    if not collSettings.galleryId or collSettings.galleryId == "" then
        return
    end
    if not newName or newName == "" then
        return
    end
    local ok, err = LrTasks.pcall(
        api.patchSection, collSettings.galleryId, collSettings.sectionId, { title = newName }
    )
    if not ok then
        log:warn("chapter rename sync failed: " .. tostring(err))
    end
end

-- Explicit type check (LrPublishedCollection:type() / LrPublishedCollectionSet:type(),
-- both confirmed against the official Lightroom Classic 15 SDK reference to
-- return exactly these two strings) instead of inferring "it's a Set" from
-- getCollectionInfoSummary() failing. The previous version conflated two
-- different situations under one silent no-op: "this really is a Set" (fine,
-- intentional) and "this is a chapter but the call genuinely failed for some
-- other reason" (a real bug that deserves a log line). Suggested by
-- @canja006 after confirming the Set no-op is otherwise correct.
local function isPublishedCollectionSet(obj)
    if not obj then return false end
    local ok, objType = LrTasks.pcall(function() return obj:type() end)
    return ok and objType == "LrPublishedCollectionSet"
end

function exportServiceProvider.renamePublishedCollection(publishSettings, info)
    info = info or {}
    if not info.publishedCollection then return end
    if isPublishedCollectionSet(info.publishedCollection) then
        -- A Set rename must never touch the Lumio gallery (see the note at
        -- disableRenamePublishedCollectionSet above).
        return
    end

    local okSummary, summary = LrTasks.pcall(function()
        return info.publishedCollection:getCollectionInfoSummary()
    end)
    if not okSummary then
        log:warn("renamePublishedCollection: could not read collection info: " .. tostring(summary))
        return
    end
    -- info.name is documented as "the new name being assigned to this
    -- collection" -- reliable directly, no need to read it back off the
    -- object.
    syncChapterRename(summary and summary.collectionSettings, info.name)
end

local function syncChapterDelete(collSettings)
    if not collSettings or not collSettings.sectionId or collSettings.sectionId == "" then
        return
    end
    if not collSettings.galleryId or collSettings.galleryId == "" then
        return
    end
    local ok, err = LrTasks.pcall(api.deleteSection, collSettings.galleryId, collSettings.sectionId)
    if not ok then
        log:warn("chapter delete sync failed: " .. tostring(err))
    end
end

function exportServiceProvider.deletePublishedCollection(publishSettings, info)
    info = info or {}
    if not info.publishedCollection then return end
    if isPublishedCollectionSet(info.publishedCollection) then
        -- Deleting the Set must never touch the Lumio gallery (see the
        -- note at disableRenamePublishedCollectionSet above).
        return
    end

    local okSummary, summary = LrTasks.pcall(function()
        return info.publishedCollection:getCollectionInfoSummary()
    end)
    if not okSummary then
        log:warn("deletePublishedCollection: could not read collection info: " .. tostring(summary))
        return
    end
    syncChapterDelete(summary and summary.collectionSettings)
end

-- ============================================================================
-- goToPublishedCollection
-- ============================================================================
-- Called from the "Show in Lumio" menu entry (right-click a published
-- collection OR a Collection Set -- confirmed this fires for both: a real-
-- device test throwing an unguarded error on a Set is what surfaced this).
-- Opens the gallery's STUDIO management page (photographer-facing:
-- branding, status, files) -- NOT the public customer-facing gallery. A
-- photographer right-clicking the COLLECTION wants to manage it, not see
-- what the customer sees; goToPublishedPhoto below (right-click a PHOTO)
-- covers the "show me the public link" case instead.
-- The Studio route is keyed by galleryId, not slug, so this does not need
-- resolveGallerySlug.
--
-- info.publishedCollection can be a plain LrPublishedCollection OR an
-- LrPublishedCollectionSet -- they use DIFFERENT info-summary methods
-- (getCollectionInfoSummary vs getCollectionSetInfoSummary, no shared
-- superclass method), so try the plain-collection one first and fall back
-- to the Set one. Previously this only tried the plain-collection method,
-- unguarded -- calling it on a Set threw "attempt to call method ... (a
-- nil value)", which is why "Show in Lumio" on a Chapters Gallery always
-- errored while the same command on a chapter (a plain collection) worked.
function exportServiceProvider.goToPublishedCollection(publishSettings, info)
    local LrHttp = import "LrHttp"
    if not info.publishedCollection then return end

    local collSettings
    local okPlain, summary = LrTasks.pcall(function()
        return info.publishedCollection:getCollectionInfoSummary()
    end)
    if okPlain and summary then
        collSettings = summary.collectionSettings
    else
        local okSet, setSummary = LrTasks.pcall(function()
            return info.publishedCollection:getCollectionSetInfoSummary()
        end)
        if okSet and setSummary then
            collSettings = setSummary.collectionSettings
        end
    end
    if not collSettings then return end

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
