--[[
    Lumio Lightroom Classic Plugin — Info.lua

    Zwei Richtungen:
      1. Selection-Import: Kunden-Picks aus Lumio in den LR-Katalog
         (Bibliothek → Zusatzmoduloptionen → "Lumio-Auswahl importieren…")
      2. Publish-Service: Bilder aus LR in Lumio-Galerien hochladen
         (Bibliothek → Veroeffentlichungsdienste → "Lumio")

    Voraussetzungen:
      - Lightroom Classic >= 9.0 (SDK 9 ist seit 2020 stabil)
      - API-Token im Lumio Studio unter Einstellungen → API-Tokens erzeugen

    Installation:
      1. Diesen Ordner irgendwohin auf die Platte legen (umbenennbar nach
         "lumio.lrplugin", falls .lrdevplugin in Finder als Bundle hindert)
      2. In Lightroom: Datei → Zusatzmodul-Manager → Hinzufügen
      3. In den Plugin-Optionen Host + Token eingeben
      4a. Selection-Import: Bibliothek → Zusatzmoduloptionen → "Lumio-Auswahl importieren…"
      4b. Publish:          Bibliothek → Veroeffentlichungsdienste → "Lumio einrichten…"

    Author: Lumio
    License: AGPL-3.0
]]

return {
    LrSdkVersion        = 10.0,
    LrSdkMinimumVersion = 6.0,

    LrToolkitIdentifier = "tools.thiel.lumio",
    LrPluginName        = "Lumio",
    LrPluginInfoUrl     = "https://forgejo.thiel.tools/thiel/lumio",

    -- Sektion im Plug-in-Manager: Host + Token + Test-Button
    LrPluginInfoProvider = "PluginManager.lua",

    -- Menü-Eintrag in Bibliothek → Zusatzmoduloptionen
    LrLibraryMenuItems = {
        {
            title = "Lumio-Auswahl importieren…",
            file  = "ImportSelectionDialog.lua",
        },
    },

    -- Publish-Service: erscheint unter „Veröffentlichungsdienste" in LR
    LrExportServiceProvider = {
        title    = "Lumio",
        file     = "LumioPublishService.lua",
        builtInPresetsDir = "presets",
    },

    VERSION = {
        major    = 0,
        minor    = 2,
        revision = 0,
    },
}
