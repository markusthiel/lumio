--[[
    ImportSelectionTask.lua

    Holt die aggregierte Auswahl einer Lumio-Galerie und schreibt sie in
    den aktiven Lightroom-Katalog. Match erfolgt anhand des
    Original-Dateinamens (case-insensitive).

    Mapping:
      Lumio picked=true   →  photo:setRawMetadata("pickStatus", 1)
      Lumio liked=true    →  Rating = max(rating, 1)
      Lumio rating=N      →  photo:setRawMetadata("rating", N)
      Lumio color=red/yellow/green
                          →  photo:setRawMetadata("colorNameForLabel", ...)

    Color-Label-Mapping: in Lumio gibt es derzeit red/yellow/green;
    Lightroom kennt Red/Yellow/Green/Blue/Purple. Wir mappen 1:1.
]]

local LrApplication    = import "LrApplication"
local LrTasks          = import "LrTasks"
local LrFunctionContext = import "LrFunctionContext"
local LrProgressScope  = import "LrProgressScope"
local LrDialogs        = import "LrDialogs"

local LumioApi = require "LumioApi"
local log      = require "Logger"

local M = {}

local COLOR_MAP = {
    red    = "Red",
    yellow = "Yellow",
    green  = "Green",
}

-- Index aufbauen: lowercase filename → photo. Wenn mehrere Photos denselben
-- Dateinamen haben (z.B. zwei Kameras mit DSC_0001.NEF im selben Katalog),
-- speichern wir alle und matchen jeden Lumio-File gegen ALLE Treffer.
local function buildIndex(photos)
    local idx = {}
    for _, p in ipairs(photos) do
        local fname = p:getFormattedMetadata("fileName")
        if fname then
            local key = fname:lower()
            idx[key] = idx[key] or {}
            table.insert(idx[key], p)
        end
    end
    return idx
end

local function applyOne(photo, file, opts)
    -- Pick-Flag
    if opts.applyPick and file.picked then
        photo:setRawMetadata("pickStatus", 1)  -- 1 = picked, 0 = none, -1 = rejected
    end

    -- Rating: explicit rating gewinnt; Likes geben mindestens 1 Stern, falls
    -- noch kein Rating gesetzt ist
    if opts.applyRating and file.rating and file.rating > 0 then
        photo:setRawMetadata("rating", file.rating)
    elseif opts.applyLikes and file.liked then
        local current = photo:getRawMetadata("rating") or 0
        if current < 1 then
            photo:setRawMetadata("rating", 1)
        end
    end

    -- Color-Label
    if opts.applyColor and file.color then
        local lr = COLOR_MAP[file.color]
        if lr then
            photo:setRawMetadata("colorNameForLabel", lr)
        end
    end
end

function M.run(opts)
    LrTasks.startAsyncTask(function()
        LrFunctionContext.callWithContext("ImportSelectionTask", function(context)

            local catalog = LrApplication.activeCatalog()
            local progress = LrProgressScope {
                title = "Lumio-Auswahl wird importiert",
                functionContext = context,
            }
            progress:setCancelable(true)

            -- 1. Selection vom Server holen
            progress:setCaption("Lade Auswahl von Lumio…")
            local ok, data = pcall(LumioApi.getSelection, opts.galleryId)
            if not ok or not data then
                LrDialogs.message(
                    "Lumio",
                    tostring(data):gsub("^.-: ", ""),
                    "critical"
                )
                return
            end

            local files = data.files or {}
            if #files == 0 then
                LrDialogs.message(
                    "Lumio",
                    "Diese Galerie hat noch keine Files mit Status 'ready'."
                )
                return
            end

            -- 2. Photo-Pool bestimmen
            progress:setCaption("Durchsuche Katalog…")
            local pool
            if opts.matchScope == "collection" then
                local sources = catalog:getActiveSources()
                pool = {}
                for _, source in ipairs(sources) do
                    -- getPhotos auf Collection / Folder funktioniert beides
                    if source.getPhotos then
                        for _, p in ipairs(source:getPhotos()) do
                            table.insert(pool, p)
                        end
                    end
                end
                if #pool == 0 then
                    LrDialogs.message(
                        "Lumio",
                        "Aktive Sammlung ist leer. Wähle eine andere oder " ..
                        "stelle auf 'Im aktuellen Katalog' um."
                    )
                    return
                end
            else
                pool = catalog:getAllPhotos()
            end

            local idx = buildIndex(pool)

            -- 3. Pro File matchen und Metadaten anwenden — alles innerhalb
            --    EINER withWriteAccessDo, damit der User es als einzigen
            --    Undo-Step rückgängig machen kann.
            local matchedFiles = 0
            local matchedPhotos = 0
            local missing = {}

            catalog:withWriteAccessDo("Lumio-Auswahl importieren", function()
                for i, file in ipairs(files) do
                    if progress:isCanceled() then break end

                    progress:setPortionComplete(i, #files)
                    progress:setCaption(
                        "Wende Auswahl an (" .. i .. "/" .. #files .. ")"
                    )

                    local matches = idx[(file.filename or ""):lower()]
                    if matches and #matches > 0 then
                        matchedFiles = matchedFiles + 1
                        for _, photo in ipairs(matches) do
                            applyOne(photo, file, opts)
                            matchedPhotos = matchedPhotos + 1
                        end
                    else
                        table.insert(missing, file.filename)
                    end
                end
            end)

            progress:done()

            -- 4. Zusammenfassung
            local summary = string.format(
                "Importiert für %d von %d Files (%d Photos im Katalog aktualisiert).",
                matchedFiles, #files, matchedPhotos
            )
            if #missing > 0 then
                summary = summary .. "\n\nNicht gefunden:\n"
                for i = 1, math.min(20, #missing) do
                    summary = summary .. "  • " .. missing[i] .. "\n"
                end
                if #missing > 20 then
                    summary = summary .. "  …und " .. (#missing - 20) .. " weitere"
                end
            end

            log:info("import done: " .. summary:gsub("\n", " | "))
            LrDialogs.message("Lumio-Import fertig", summary)
        end)
    end)
end

return M
