--[[
    PluginManager.lua

    Sektion im Lightroom Plug-in-Manager: Host + Token + Test-Button.

    sectionsForTopOfDialog wird vom SDK aufgerufen, wenn der User in
    Datei → Zusatzmodul-Manager auf das Lumio-Plugin klickt.
]]

local LrView           = import "LrView"
local LrPrefs          = import "LrPrefs"
local LrTasks          = import "LrTasks"
local LrDialogs        = import "LrDialogs"
local LrBinding        = import "LrBinding"
local LrFunctionContext = import "LrFunctionContext"

local LumioApi = require "LumioApi"
local log      = require "Logger"

local prefs = LrPrefs.prefsForPlugin()

local function testConnection(propertyTable)
    LrFunctionContext.callWithContext("testConnection", function()
        -- Prefs flushen, damit getToken/getBase die aktuellen Werte sieht
        prefs.host  = propertyTable.host
        prefs.token = propertyTable.token

        LrTasks.startAsyncTask(function()
            propertyTable.testStatus = "Teste…"
            local ok, result = pcall(LumioApi.testConnection)
            if ok and result and result.ok then
                propertyTable.testStatus = "✓ Verbunden (API v" ..
                    (result.apiVersion or "?") .. ")"
                log:info("connection test ok")
            else
                propertyTable.testStatus = "✗ " ..
                    tostring(result):gsub("^.-: ", ""):sub(1, 80)
                log:warn("connection test failed: " .. tostring(result))
            end
        end)
    end)
end

return {
    sectionsForTopOfDialog = function(viewFactory, _propertyTable)
        local f = viewFactory

        local bindable = LrBinding.makePropertyTable(_propertyTable.context)
        bindable.host       = prefs.host or "https://studio.lumio-cloud.de"
        bindable.token      = prefs.token or ""
        bindable.testStatus = ""

        -- Prefs live synchronisieren — beim Schließen ist der Wert dann drin
        bindable:addObserver("host",  function() prefs.host  = bindable.host  end)
        bindable:addObserver("token", function() prefs.token = bindable.token end)

        return {
            {
                title = "Lumio Verbindung",
                bind_to_object = bindable,

                f:row {
                    f:static_text {
                        title = "Server",
                        width = 80,
                    },
                    f:edit_field {
                        value = LrView.bind("host"),
                        width_in_chars = 40,
                        immediate = true,
                        placeholder_string = "https://studio.lumio-cloud.de",
                    },
                },
                f:row {
                    f:static_text {
                        title = "API-Token",
                        width = 80,
                    },
                    f:password_field {
                        value = LrView.bind("token"),
                        width_in_chars = 40,
                        immediate = true,
                    },
                },
                f:row {
                    f:static_text { title = "", width = 80 },
                    f:push_button {
                        title = "Verbindung testen",
                        action = function() testConnection(bindable) end,
                    },
                    f:static_text {
                        title = LrView.bind("testStatus"),
                        width_in_chars = 40,
                    },
                },
                f:row {
                    f:static_text { title = "", width = 80 },
                    f:static_text {
                        title = "Token erzeugen in: Studio → Einstellungen → API-Tokens",
                        size = "small",
                    },
                },
            },
        }
    end,
}
