--[[
    ImportSelectionDialog.lua

    Wird vom Menüpunkt "Lumio-Auswahl importieren…" aufgerufen.

    Flow:
      1. Galerie-Liste vom Server holen
      2. Modal: User wählt eine Galerie aus + Optionen (was anwenden:
         Pick-Flag, Sterne, Color-Label)
      3. ImportSelectionTask.run() startet die eigentliche Anwendung
]]

local LrTasks          = import "LrTasks"
local LrDialogs        = import "LrDialogs"
local LrFunctionContext = import "LrFunctionContext"
local LrView           = import "LrView"
local LrBinding        = import "LrBinding"
local LrPrefs          = import "LrPrefs"

local LumioApi = require "LumioApi"
local Task     = require "ImportSelectionTask"
local log      = require "Logger"

LrTasks.startAsyncTask(function()
    LrFunctionContext.callWithContext("ImportSelectionDialog", function(context)

        -- Galerien laden, mit User-friendly Error
        local ok, galleries = pcall(LumioApi.listGalleries)
        if not ok then
            LrDialogs.message(
                "Lumio: Verbindung fehlgeschlagen",
                tostring(galleries):gsub("^.-: ", ""),
                "critical"
            )
            return
        end
        if #galleries == 0 then
            LrDialogs.message(
                "Lumio",
                "Keine Galerien gefunden. Lege im Studio eine an oder prüfe, " ..
                "dass der Token zum richtigen User gehört."
            )
            return
        end

        -- View bauen
        local props = LrBinding.makePropertyTable(context)
        local prefs = LrPrefs.prefsForPlugin()

        -- Galerien-Optionen für popup_menu
        local galleryItems = {}
        for _, g in ipairs(galleries) do
            table.insert(galleryItems, {
                title = g.title .. "  (" .. g.fileCount .. " Files, " .. g.mode .. ")",
                value = g.id,
            })
        end

        props.galleryId      = prefs.lastGalleryId or galleries[1].id
        props.applyPick      = prefs.applyPick      ~= false  -- default true
        props.applyLikes     = prefs.applyLikes     ~= false
        props.applyRating    = prefs.applyRating    ~= false
        props.applyColor     = prefs.applyColor     ~= false
        props.matchScope     = prefs.matchScope     or "library"

        local f = LrView.osFactory()

        local contents = f:column {
            bind_to_object = props,
            spacing = f:control_spacing(),

            f:row {
                f:static_text {
                    title = "Galerie:",
                    width = 100,
                },
                f:popup_menu {
                    items = galleryItems,
                    value = LrView.bind("galleryId"),
                    width_in_chars = 50,
                },
            },

            f:separator { fill_horizontal = 1 },

            f:static_text {
                title = "Was importieren?",
                font = "<system/bold>",
            },
            f:checkbox {
                title = "Picks als Lightroom-Flag setzen",
                value = LrView.bind("applyPick"),
            },
            f:checkbox {
                title = "Likes als 1-Stern-Bewertung (zusätzlich zu Picks)",
                value = LrView.bind("applyLikes"),
            },
            f:checkbox {
                title = "Bewertungen (1–5 Sterne) übernehmen",
                value = LrView.bind("applyRating"),
            },
            f:checkbox {
                title = "Color-Labels übernehmen",
                value = LrView.bind("applyColor"),
            },

            f:separator { fill_horizontal = 1 },

            f:static_text {
                title = "Suche nach Dateinamen:",
                font = "<system/bold>",
            },
            f:radio_button {
                title    = "Im aktuellen Katalog",
                value    = LrView.bind("matchScope"),
                checked_value = "library",
            },
            f:radio_button {
                title    = "Nur in der aktiven Sammlung",
                value    = LrView.bind("matchScope"),
                checked_value = "collection",
            },

            f:static_text {
                title = "Hinweis: Lumio matcht am Original-Dateinamen. Wenn du Dateien " ..
                        "umbenannt hast, finden wir sie nicht.",
                width_in_chars = 70,
                height_in_lines = 2,
                size = "small",
            },
        }

        local result = LrDialogs.presentModalDialog {
            title = "Lumio-Auswahl importieren",
            contents = contents,
            resizable = false,
        }
        if result ~= "ok" then return end

        -- Auswahl in Prefs für nächstes Mal merken
        prefs.lastGalleryId = props.galleryId
        prefs.applyPick     = props.applyPick
        prefs.applyLikes    = props.applyLikes
        prefs.applyRating   = props.applyRating
        prefs.applyColor    = props.applyColor
        prefs.matchScope    = props.matchScope

        log:info("starting import for gallery " .. tostring(props.galleryId))
        Task.run({
            galleryId   = props.galleryId,
            applyPick   = props.applyPick,
            applyLikes  = props.applyLikes,
            applyRating = props.applyRating,
            applyColor  = props.applyColor,
            matchScope  = props.matchScope,
        })
    end)
end)
