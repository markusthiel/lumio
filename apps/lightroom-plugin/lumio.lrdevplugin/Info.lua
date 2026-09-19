--[[
    Lumio Lightroom Classic Plugin — Info.lua

    Two directions:
      1. Selection-Import: bring customer picks from Lumio into the LR
         catalog (Library -> Plug-in Extras -> "Import Lumio selection…")
      2. Publish-Service: upload photos from LR into Lumio galleries
         (Library -> Publishing Services -> "Lumio")

    Requirements:
      - Lightroom Classic >= 9.0 (SDK 9 has been stable since 2020)
      - API token, created in Lumio Studio under Settings -> API tokens

    Installation:
      1. Put this folder anywhere on disk (can be renamed to
         "lumio.lrplugin" if .lrdevplugin gets in the way in Finder as a
         bundle)
      2. In Lightroom: File -> Plug-in Manager -> Add
      3. Enter host + token in the plug-in options
      4a. Selection-Import: Library -> Plug-in Extras -> "Import Lumio selection…"
      4b. Publish:          Library -> Publishing Services -> "Set up Lumio…"

    Author: Lumio
    License: FSL-1.1-ALv2
]]

return {
    LrSdkVersion        = 10.0,
    LrSdkMinimumVersion = 6.0,

    LrToolkitIdentifier = "tools.thiel.lumio",
    LrPluginName        = "Lumio",
    LrPluginInfoUrl     = "https://github.com/markusthiel/lumio",

    -- Section in the Plug-in Manager: host + token + test button
    LrPluginInfoProvider = "PluginManager.lua",

    -- Menu entry under Library -> Plug-in Extras
    LrLibraryMenuItems = {
        {
            title = "Import Lumio selection…",
            file  = "ImportSelectionDialog.lua",
        },
    },

    -- Publish service: appears under "Publishing Services" in LR
    LrExportServiceProvider = {
        title    = "Lumio",
        file     = "LumioPublishService.lua",
        builtInPresetsDir = "presets",
    },

    VERSION = {
        major    = 0,
        minor    = 3,
        revision = 0,
    },
}
