--[[
    PluginManager.lua

    Section in the Lightroom Plug-in Manager: host + token + test button.

    sectionsForTopOfDialog is called by the SDK when the user clicks the
    Lumio plug-in under File -> Plug-in Manager.
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
        -- Flush prefs so getToken/getBase see the current values
        prefs.host  = propertyTable.host
        prefs.token = propertyTable.token

        LrTasks.startAsyncTask(function()
            propertyTable.testStatus = "Testing…"
            local ok, result = LrTasks.pcall(LumioApi.testConnection)
            if ok and result and result.ok then
                propertyTable.testStatus = "✓ Connected (API v" ..
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

        -- The original line was
        --   local bindable = LrBinding.makePropertyTable(_propertyTable.context)
        -- but LR does not expose a .context field -> "LrBinding.makePropertyTable:
        -- missing functionContext" -> "Could not create info sections for
        -- plug-in" -> the whole plug-in was flagged broken and no menu items
        -- registered. LR already hands over a bindable table.
        local bindable = _propertyTable
        bindable.host       = prefs.host or "https://studio.lumio-cloud.de"
        bindable.token      = prefs.token or ""
        bindable.testStatus = ""

        -- Live-sync into prefs -- by the time the dialog closes, the value is in there
        bindable:addObserver("host",  function() prefs.host  = bindable.host  end)
        bindable:addObserver("token", function() prefs.token = bindable.token end)

        return {
            {
                title = "Lumio Connection",
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
                        title = "Test connection",
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
                        title = "Create a token in: Studio → Settings → API tokens",
                        size = "small",
                    },
                },
            },
        }
    end,
}
