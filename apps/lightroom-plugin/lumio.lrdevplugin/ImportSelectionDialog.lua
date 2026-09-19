--[[
    ImportSelectionDialog.lua

    Invoked from the "Import Lumio selection…" menu item.

    Flow:
      1. Fetch the gallery list from the server
      2. Modal: the user picks a gallery + options (what to apply:
         pick flag, stars, colour label)
      3. ImportSelectionTask.run() starts the actual application
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

        -- Load galleries, with a user-friendly error
        local ok, galleries = LrTasks.pcall(LumioApi.listGalleries)
        if not ok then
            LrDialogs.message(
                "Lumio: connection failed",
                tostring(galleries):gsub("^.-: ", ""),
                "critical"
            )
            return
        end
        if #galleries == 0 then
            LrDialogs.message(
                "Lumio",
                "No galleries found. Create one in the studio, or check " ..
                "that the token belongs to the right user."
            )
            return
        end

        -- Build the view
        local props = LrBinding.makePropertyTable(context)
        local prefs = LrPrefs.prefsForPlugin()

        -- Gallery options for the popup_menu
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
        -- HASH-MATCHING (opt-in, off by default): only present for files
        -- published via the plug-in's Publish-Service from this version
        -- onward (see JpegXmp.lua) -- older uploads have no hash to match
        -- against, so this is a slower, best-effort recovery pass rather
        -- than something to turn on unconditionally.
        props.matchByHash    = prefs.matchByHash    or false

        local f = LrView.osFactory()

        local contents = f:column {
            bind_to_object = props,
            spacing = f:control_spacing(),

            f:row {
                f:static_text {
                    title = "Gallery:",
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
                title = "What to import?",
                font = "<system/bold>",
            },
            f:checkbox {
                title = "Set picks as Lightroom flags",
                value = LrView.bind("applyPick"),
            },
            f:checkbox {
                title = "Likes as 1-star rating (in addition to picks)",
                value = LrView.bind("applyLikes"),
            },
            f:checkbox {
                title = "Apply ratings (1–5 stars)",
                value = LrView.bind("applyRating"),
            },
            f:checkbox {
                title = "Apply colour labels",
                value = LrView.bind("applyColor"),
            },

            f:separator { fill_horizontal = 1 },

            f:static_text {
                title = "Match by filename:",
                font = "<system/bold>",
            },
            f:radio_button {
                title    = "In the whole catalog",
                value    = LrView.bind("matchScope"),
                checked_value = "library",
            },
            f:radio_button {
                title    = "Only in the active collection",
                value    = LrView.bind("matchScope"),
                checked_value = "collection",
            },
            f:checkbox {
                title = "Also try to recover renamed files by content hash (slower)",
                value = LrView.bind("matchByHash"),
            },

            f:static_text {
                title = "Note: Lumio matches on the original filename. If you have renamed " ..
                        "the files, they cannot be found -- unless the content-hash option " ..
                        "above is enabled AND the file was published with a plug-in version " ..
                        "that embeds the original hash.",
                width_in_chars = 70,
                height_in_lines = 3,
                size = "small",
            },
        }

        local result = LrDialogs.presentModalDialog {
            title = "Import Lumio selection",
            contents = contents,
            resizable = false,
        }
        if result ~= "ok" then return end

        -- Remember the choices in prefs for next time
        prefs.lastGalleryId = props.galleryId
        prefs.applyPick     = props.applyPick
        prefs.applyLikes    = props.applyLikes
        prefs.applyRating   = props.applyRating
        prefs.applyColor    = props.applyColor
        prefs.matchScope    = props.matchScope
        prefs.matchByHash   = props.matchByHash

        log:info("starting import for gallery " .. tostring(props.galleryId))
        Task.run({
            galleryId   = props.galleryId,
            applyPick   = props.applyPick,
            applyLikes  = props.applyLikes,
            applyRating = props.applyRating,
            applyColor  = props.applyColor,
            matchScope  = props.matchScope,
            matchByHash = props.matchByHash,
        })
    end)
end)
