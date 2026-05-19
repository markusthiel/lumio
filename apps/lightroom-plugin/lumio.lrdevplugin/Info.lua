--[[
    Lumio Lightroom Classic Plugin — Info.lua

    Bringt die Kunden-Auswahl aus einer Lumio-Galerie direkt in den
    Lightroom-Katalog: Picks werden als Flag markiert, Likes als Stern-
    Rating, Color-Labels werden gespiegelt.

    Voraussetzungen:
      - Lightroom Classic >= 9.0 (SDK 9 ist seit 2020 stabil)
      - API-Token im Lumio Studio unter Einstellungen → API-Tokens erzeugen

    Installation:
      1. Diesen Ordner irgendwohin auf die Platte legen (umbenennbar nach
         "lumio.lrplugin", falls .lrdevplugin in Finder als Bundle hindert)
      2. In Lightroom: Datei → Zusatzmodul-Manager → Hinzufügen
      3. In den Plugin-Optionen Host + Token eingeben
      4. Bibliothek → Zusatzmoduloptionen → "Lumio-Auswahl importieren…"

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

    VERSION = {
        major    = 0,
        minor    = 1,
        revision = 0,
    },
}
