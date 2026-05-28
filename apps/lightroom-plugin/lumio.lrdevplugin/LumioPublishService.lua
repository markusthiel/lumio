--[[
    LumioPublishService.lua

    Lightroom Publish-Service-Provider fuer Lumio.

    Was es macht
    ============
    Der Fotograf legt im Lightroom-Modul „Bibliothek" → „Veroeffentlichungs-
    dienste" einen „Lumio"-Publish-Service an. Pro Lumio-Galerie eine
    Published-Collection. Drag-and-Drop oder Smart-Collection-Regeln
    bestimmen, welche Fotos in die Galerie kommen. Klick auf
    „Veroeffentlichen" rendert Lightroom die Fotos zu JPEGs (Export-
    Engine), wir laden sie zu Lumio hoch.

    Lightroom-Hooks-Cheatsheet
    ==========================
    Service-Level (= alle Collections):
      - startDialog / endDialog               : Service-Setup
      - sectionsForTopOfDialog                : Auth-Check + Token-Hinweis

    Collection-Level (= eine Lumio-Galerie):
      - viewForCollectionSettings             : Galerie waehlen / anlegen,
                                                Status-Schalter
      - updateCollectionSettings              : nach Settings-Save

    Photo-Level (= Upload + Delete):
      - processRenderedPhotos                 : pro Veroeffentlichen-Batch
      - deletePhotosFromPublishedCollection   : Fotos aus LR-Coll. entfernt

    Metadaten-getriggert:
      - metadataThatTriggersRepublish         : was muss sich aendern damit
                                                LR den Knopf 'Republish' setzt

    Datenflow
    =========
    1. LR rendert Photo → temp JPEG
    2. processRenderedPhotos bekommt jedes gerenderte Photo
    3. Wir initUpload(gallery, [{ filename, sizeBytes, mimeType }])
    4. S3-PUT zu der presigned URL
    5. completeUpload(fileId)
    6. rendition:recordPublishedPhotoId(fileId) - LR merkt sich die Lumio-ID
]]

local LrApplication        = import "LrApplication"
local LrBinding            = import "LrBinding"
local LrColor              = import "LrColor"
local LrDate               = import "LrDate"
local LrDialogs            = import "LrDialogs"
local LrFunctionContext    = import "LrFunctionContext"
local LrPathUtils          = import "LrPathUtils"
local LrTasks              = import "LrTasks"
local LrView               = import "LrView"
local LrFileUtils          = import "LrFileUtils"

local api  = require "LumioApi"
local log  = require "Logger"
local json = require "Json"

local exportServiceProvider = {}

-- ============================================================================
-- Plugin-Metadaten
-- ============================================================================
exportServiceProvider.supportsIncrementalPublish = "only"
exportServiceProvider.exportPresetFields = {
    -- Service-weite Defaults (kommen aus Plugin-Manager-Section)
}
exportServiceProvider.hideSections = {
    -- Default-Export-Sektionen die wir NICHT anzeigen wollen
    "exportLocation",  -- Lumio kennt keine 'Where to save' — geht direkt online
    "fileNaming",       -- wir nutzen den Original-Filename
    "video",            -- aktuell kein Video-Upload
    "watermarking",     -- Watermark macht Lumio server-side
    "postProcessing",   -- macht Lumio (Renditions/Watermark/HLS)
}
exportServiceProvider.allowFileFormats = { "JPEG" }
exportServiceProvider.allowColorSpaces = { "sRGB" }
exportServiceProvider.titleForPublishedCollection           = "Lumio-Galerie"
exportServiceProvider.titleForPublishedCollection_standalone = "Lumio-Galerie"
exportServiceProvider.titleForPublishedSmartCollection      = "Lumio Smart-Galerie"
exportServiceProvider.titleForPublishedSmartCollection_standalone = "Lumio Smart-Galerie"
exportServiceProvider.titleForGoToPublishedCollection       = "In Lumio anzeigen"
exportServiceProvider.titleForGoToPublishedPhoto            = "In Lumio anzeigen"
exportServiceProvider.small_icon = "icon.png"
exportServiceProvider.supportsCustomSortOrder = false
exportServiceProvider.disableRenamePublishedCollection      = false
exportServiceProvider.disableRenamePublishedCollectionSet   = true

-- Republish-Trigger: nur Datei-Inhalt, nicht Metadaten. Lightroom-Filename-
-- Aenderungen wuerden zwar einen Republish triggern, sind aber selten — wir
-- listen 'default = false' damit der Republish-Knopf nicht standardmaessig
-- nach jedem Edit angeht. Photographer muss explizit auf 'Republish' klicken.
function exportServiceProvider.metadataThatTriggersRepublish(publishSettings)
    return {
        default = false,
    }
end

-- ============================================================================
-- Service-Setup-Dialog (im Plug-in-Manager)
-- ============================================================================
-- Das Plug-in-Manager-UI (PluginManager.lua) hat schon Host + Token.
-- Hier zeigen wir nur einen Hinweis im Publish-Service-Sektion.

function exportServiceProvider.sectionsForTopOfDialog(viewFactory, propertyTable)
    return {
        {
            title = "Lumio-Verbindung",
            synopsis = "API-Token wird in den Plug-in-Optionen verwaltet",
            viewFactory:row {
                viewFactory:static_text {
                    title = "Host + API-Token werden global in den Plug-in-Optionen verwaltet.",
                    width_in_chars = 60,
                },
            },
            viewFactory:row {
                viewFactory:static_text {
                    title = "Hinweis: Pro Lumio-Galerie wird eine Veröffentlichte Sammlung angelegt.",
                    width_in_chars = 60,
                    text_color = LrColor(0.5, 0.5, 0.5),
                },
            },
        },
    }
end

-- ============================================================================
-- Collection-Settings (pro Lumio-Galerie)
-- ============================================================================
-- Hier waehlt der Fotograf, welche Lumio-Galerie zu dieser LR-Sammlung
-- gehoert. Wenn keine existiert: neu anlegen.

function exportServiceProvider.viewForCollectionSettings(viewFactory, publishSettings, info)
    local f = viewFactory
    local props = info.collectionSettings

    -- Defaults setzen — sonst sind die Property-Felder nil und LR meckert
    props.galleryId = props.galleryId or ""
    props.galleryTitle = props.galleryTitle or ""
    props.galleryMode = props.galleryMode or "collaboration"
    props.galleryStatus = props.galleryStatus or "draft"
    props.makeLive = props.makeLive or false

    -- Galerie-Liste async laden
    LrTasks.startAsyncTask(function()
        local ok, galleries = pcall(api.listGalleries)
        if not ok then
            log:warn("Galerie-Liste konnte nicht geladen werden: " .. tostring(galleries))
            props.availableGalleries = {}
            return
        end
        local items = { { title = "— Neue Galerie anlegen (Titel unten eingeben) —", value = "" } }
        for _, g in ipairs(galleries) do
            table.insert(items, {
                title = string.format("%s (%s, %d Files)",
                    g.title, g.status, g.fileCount or 0),
                value = g.id,
            })
        end
        props.availableGalleries = items
    end)

    -- Default-Items waehrend Loading
    props.availableGalleries = props.availableGalleries or {
        { title = "Lade…", value = "" }
    }

    return {
        title = "Lumio-Galerie",
        synopsis = LrView.bind { key = "galleryTitle" },
        f:column {
            spacing = f:control_spacing(),
            fill_horizontal = 1,
            f:row {
                f:static_text {
                    title = "Vorhandene Galerie:",
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
                    title = "ODER neue anlegen:",
                    width = LrView.share "label_width",
                    alignment = "right",
                },
                f:edit_field {
                    bind_to_object = props,
                    value = LrView.bind("galleryTitle"),
                    placeholder_string = "Galerie-Titel (z.B. 'Anna & Max Hochzeit')",
                    width_in_chars = 40,
                },
            },
            f:row {
                f:static_text {
                    title = "Modus:",
                    width = LrView.share "label_width",
                    alignment = "right",
                },
                f:popup_menu {
                    bind_to_object = props,
                    value = LrView.bind("galleryMode"),
                    items = {
                        { title = "Auswahl / Proofing (Kunde liked/picked)", value = "collaboration" },
                        { title = "Praesentation (nur Anzeige)", value = "presentation" },
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
                    title = "Nach Upload automatisch auf 'live' schalten",
                },
            },
            f:row {
                f:static_text {
                    title = " ",
                    width = LrView.share "label_width",
                },
                f:static_text {
                    title = "Tipp: Header, Branding und Passwort konfigurierst du im Lumio-Studio nach dem ersten Upload.",
                    width_in_chars = 50,
                    text_color = LrColor(0.5, 0.5, 0.5),
                    height_in_lines = 2,
                },
            },
        },
    }
end

-- ============================================================================
-- Upload-Helper (forward-declared damit processRenderedPhotos zugreifen kann)
-- ============================================================================
-- uploadOnePhoto: schickt EINE Rendition zu Lumio. Wirft bei Fehler.
-- rendition:recordPublishedPhotoId(fileId) wird gesetzt damit LR sich
-- merkt welches Lumio-File diesem LR-Photo entspricht.
local function uploadOnePhoto(rendition, filepath, galleryId)
    -- Original-Filename aus dem LR-Photo lesen (NICHT vom Renderpfad,
    -- der ist eine temp.jpg)
    local photo = rendition.photo
    local origName = photo:getFormattedMetadata("fileName") or LrPathUtils.leafName(filepath)
    -- Endung anpassen: wir rendern als JPEG, also .jpg
    local nameNoExt = LrPathUtils.removeExtension(origName)
    local filename = nameNoExt .. ".jpg"

    -- Filesize
    local sizeBytes = LrFileUtils.fileAttributes(filepath).fileSize or 0
    if sizeBytes == 0 then
        error("Datei ist leer: " .. filepath)
    end

    -- Init-Call: bekommt presigned PUT-URL zurueck
    local uploads = api.initUpload(galleryId, {
        {
            filename = filename,
            sizeBytes = sizeBytes,
            mimeType = "image/jpeg",
        },
    })
    if not uploads or not uploads[1] then
        error("init: keine Upload-Anweisung erhalten")
    end
    local u = uploads[1]
    if u.method ~= "single" then
        error("multipart-Upload aktuell nicht unterstuetzt (Photo > 100 MB)")
    end

    -- S3-PUT
    api.uploadFileToS3(u.uploadUrl, filepath, "image/jpeg")

    -- Complete: Worker-Verarbeitung anstossen
    api.completeUpload(u.fileId, nil)

    -- LR merkt sich die Lumio-File-ID. Bei spaeterem Republish/Delete
    -- liefert LR diese ID an deletePhotosFromPublishedCollection.
    rendition:recordPublishedPhotoId(u.fileId)
    rendition:recordPublishedPhotoUrl(nil)
end

-- ============================================================================
-- processRenderedPhotos — Upload-Schleife
-- ============================================================================
-- Lightroom hat die Photos zu temp-JPEGs gerendert und uebergibt uns
-- den exportContext. Wir iterieren ueber alle Renditions und laden hoch.

function exportServiceProvider.processRenderedPhotos(functionContext, exportContext)
    local exportSession = exportContext.exportSession

    -- Galerie-ID aus den Collection-Settings holen. Wenn keine: Galerie
    -- jetzt anlegen (User hatte "neue Galerie" + Titel angegeben).
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
        -- Neue Galerie anlegen
        local title = (collProps.galleryTitle or ""):gsub("^%s+", ""):gsub("%s+$", "")
        if title == "" then
            LrDialogs.message(
                "Lumio",
                "Diese Sammlung hat keine Galerie zugeordnet. Bitte oeffne 'Veroeffentlichungs-Sammlung bearbeiten' und waehle eine Galerie aus oder gib einen Titel fuer eine neue ein.",
                "critical"
            )
            return
        end
        local ok, created = pcall(
            api.createGallery, title, collProps.galleryMode, nil
        )
        if not ok then
            LrDialogs.message("Lumio", "Galerie konnte nicht angelegt werden: " .. tostring(created), "critical")
            return
        end
        galleryId = created.id
        gallerySlug = created.slug
        -- In den Collection-Settings persistieren — LR speichert das beim
        -- naechsten Dialog-Open. Direkter Schreibzugriff auf
        -- publishedCollection-Settings ist via catalog:withWriteAccessDo.
        local catalog = LrApplication.activeCatalog()
        catalog:withWriteAccessDo("Lumio: Galerie zuordnen", function()
            local current = exportContext.publishedCollection:getCollectionInfoSummary().collectionSettings or {}
            current.galleryId = galleryId
            current.gallerySlug = gallerySlug
            exportContext.publishedCollection:setCollectionSettings(current)
        end)
    end

    if not galleryId or galleryId == "" then
        LrDialogs.message("Lumio", "Keine Lumio-Galerie zugeordnet.", "critical")
        return
    end

    local nPhotos = exportSession:countRenditions()
    local progressScope = exportContext:configureProgress {
        title = nPhotos > 1
            and (nPhotos .. " Photos nach Lumio hochladen")
            or "1 Photo nach Lumio hochladen",
    }

    local uploaded = 0
    local failed = 0
    local failedList = {}

    for i, rendition in exportContext:renditions { stopIfCanceled = true } do
        progressScope:setPortionComplete((i - 1) / nPhotos)

        -- Render abwarten — LR rendert in Threads, wir bekommen den
        -- fertigen Pfad per waitForRender.
        local success, pathOrMessage = rendition:waitForRender()
        if progressScope:isCanceled() then break end

        if not success then
            failed = failed + 1
            table.insert(failedList,
                (rendition.photo:getFormattedMetadata("fileName") or "?") ..
                ": " .. tostring(pathOrMessage))
            log:warn("Render failed: " .. tostring(pathOrMessage))
        else
            local ok, errMsg = pcall(uploadOnePhoto, rendition, pathOrMessage, galleryId)
            if ok then
                uploaded = uploaded + 1
            else
                failed = failed + 1
                local fname = rendition.photo:getFormattedMetadata("fileName") or "?"
                table.insert(failedList, fname .. ": " .. tostring(errMsg))
                log:warn("Upload failed for " .. fname .. ": " .. tostring(errMsg))
            end
            -- Temp-File aufraeumen
            if pathOrMessage and LrFileUtils.exists(pathOrMessage) then
                LrFileUtils.delete(pathOrMessage)
            end
        end

        progressScope:setPortionComplete(i / nPhotos)
    end

    -- Status auf 'live' setzen wenn gewuenscht
    if collProps and collProps.makeLive and uploaded > 0 then
        local ok, err = pcall(function()
            api.patchGallery(galleryId, { status = "live" })
        end)
        if not ok then
            log:warn("status=live failed: " .. tostring(err))
        end
    end

    -- Zusammenfassung
    if failed > 0 then
        local msg = uploaded .. " erfolgreich, " .. failed .. " fehlgeschlagen.\n\n"
        for i, line in ipairs(failedList) do
            if i > 10 then
                msg = msg .. "(weitere " .. (failed - 10) .. ")\n"
                break
            end
            msg = msg .. line .. "\n"
        end
        LrDialogs.message("Lumio Upload — teils fehlgeschlagen", msg, "warning")
    end

    progressScope:done()
end

-- ============================================================================
-- deletePhotosFromPublishedCollection
-- ============================================================================
-- Wird gerufen wenn der Photographer Photos aus der Published-Collection
-- entfernt oder die Collection insgesamt loescht. Wir loeschen die
-- entsprechenden Lumio-Files via API.

function exportServiceProvider.deletePhotosFromPublishedCollection(
    publishSettings, arrayOfPhotoIds, deletedCallback, localCollectionId
)
    -- Lumio-Galerie ermitteln: aus der publishedCollection-Property,
    -- die LR an der publishSettings nicht direkt durchgibt. Wir muessen
    -- es ueber LrApplication.activeCatalog():getPublishedCollectionByLocalIdentifier.
    local catalog = LrApplication.activeCatalog()
    local publishedColl = catalog:getPublishedCollectionByLocalIdentifier(localCollectionId)
    if not publishedColl then
        log:warn("delete: publishedCollection nicht gefunden")
        return
    end
    local collInfo = publishedColl:getCollectionInfoSummary()
    local galleryId = collInfo and collInfo.collectionSettings and collInfo.collectionSettings.galleryId
    if not galleryId or galleryId == "" then
        log:warn("delete: galleryId nicht gesetzt")
        return
    end

    for _, photoId in ipairs(arrayOfPhotoIds) do
        local ok, err = pcall(api.deleteGalleryFile, galleryId, photoId)
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
-- Wird vom "In Lumio anzeigen"-Menueeintrag gerufen. Oeffnet die
-- Galerie im Browser.
function exportServiceProvider.goToPublishedCollection(publishSettings, info)
    local LrHttp = import "LrHttp"
    local collInfo = info.publishedCollection and info.publishedCollection:getCollectionInfoSummary()
    if not collInfo then return end
    local slug = collInfo.collectionSettings and collInfo.collectionSettings.gallerySlug
    local host = publishSettings.host or ""
    if not slug or not host or host == "" then
        LrDialogs.message("Lumio", "Galerie-Slug oder Host fehlt", "warning")
        return
    end
    -- Public-Galerie-URL
    LrHttp.openUrlInBrowser(host:gsub("/+$", "") .. "/g/" .. slug)
end

return exportServiceProvider
