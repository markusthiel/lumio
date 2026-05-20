(*
    Lumio — Pull Selection
    ~~~~~~~~~~~~~~~~~~~~~~

    Holt die aggregierte Kunden-Auswahl aus einer Lumio-Galerie und
    wendet sie auf den aktuell offenen Capture-One-Katalog/-Session
    an. Match per Dateiname (lowercase, ohne Pfad), Mehrfach-Matches
    werden alle markiert (selbes Verhalten wie das Lightroom-Plugin).

    Mapping Lumio → Capture One:
        Color "red"     → C1 Color-Tag 1 (Rot)
        Color "yellow"  → C1 Color-Tag 3 (Gelb)
        Color "green"   → C1 Color-Tag 4 (Grün)
        Rating 1..5     → C1 Rating 1..5
        Picks ohne Color → wir kennzeichnen mit Color-Tag 5 (Blau).
                           In C1 wird dieser Tag bei vielen Studios
                           als "ausgewählt"-Marker verwendet. Echte
                           Color-Tags (red/yellow/green vom Kunden)
                           überstimmen das.
        Liked           → Rating mindestens 1
                           Konsistent mit dem Lightroom-Plugin —
                           „Liked" bringt einen Stern, falls noch
                           keiner gesetzt war. Echte Rating-Werte vom
                           Kunden überstimmen das.

    Voraussetzungen:
        - Capture One Pro 14 oder neuer
        - Python 3 unter /usr/bin/python3 (in macOS 12.3+ Standard)
        - lumio-c1-sync.py im selben Ordner wie dieses Script
        - ~/.lumio-c1.json mit host + token

    Aufruf:
        Capture One → Scripts → Lumio - Pull Selection
        oder über das Skripteditor-Icon in der Menüleiste.
*)


-- =========================================================================
-- 1) Helfer: Pfad zum Python-Script ermitteln (relativ zum Skript-Ordner)
-- =========================================================================
-- Der User legt das Bundle (Python + AppleScripts) als einen Ordner ab.
-- Wir kennen unseren eigenen Pfad und nehmen das Python-Script daneben.

on pythonHelperPath()
    set thisScriptPath to POSIX path of (path to me)
    -- thisScriptPath enthält .scpt; ein parent-up und dann lumio-c1-sync.py
    set AppleScript's text item delimiters to "/"
    set parts to text items of thisScriptPath
    -- letztes Element ist die .scpt; entfernen
    set parts to items 1 thru -2 of parts
    set parentDir to (parts as text)
    set AppleScript's text item delimiters to ""
    return parentDir & "/lumio-c1-sync.py"
end pythonHelperPath


-- =========================================================================
-- 2) Helfer: Python-CLI aufrufen, JSON-String zurückgeben
-- =========================================================================
-- "do shell script" liefert stdout. Bei Exit-Code != 0 wirft AS einen Fehler
-- mit der ersten Zeile von stderr — perfekt für unsere defensive UX.

on runHelper(args)
    set scriptPath to pythonHelperPath()
    -- Quote-safe via 'quoted form of'
    set cmd to "/usr/bin/python3 " & (quoted form of scriptPath) & " " & args
    try
        return do shell script cmd
    on error errMsg number errNum
        display dialog ("Lumio-Verbindung fehlgeschlagen:" & return & return & errMsg) ¬
            buttons {"OK"} default button 1 with icon stop
        error number -128
    end try
end runHelper


-- =========================================================================
-- 3) JSON-Parser
-- =========================================================================
-- Wir verzichten auf eine externe Lib (kein scripting-additions-Setup im
-- Plugin-Ordner). Stattdessen: AppleScriptObjC + NSJSONSerialization.
-- Funktioniert in Capture One Pro 14+ ohne Zusatzinstallation.

use framework "Foundation"
use scripting additions

on jsonParse(jsonString)
    set theString to current application's NSString's stringWithString:jsonString
    set theData to theString's dataUsingEncoding:(current application's NSUTF8StringEncoding)
    set {parsed, parseError} to current application's NSJSONSerialization's ¬
        JSONObjectWithData:theData options:0 |error|:(reference)
    if parsed is missing value then
        error "JSON-Antwort konnte nicht gelesen werden: " & (parseError's localizedDescription as text)
    end if
    return parsed
end jsonParse


-- =========================================================================
-- 4) Galerie wählen lassen (Picker-Dialog)
-- =========================================================================

on pickGallery()
    set raw to runHelper("list-galleries")
    set obj to jsonParse(raw)
    set galls to (obj's objectForKey:"galleries") as list
    if (count of galls) = 0 then
        display dialog "Keine Galerien in diesem Konto gefunden." buttons {"OK"} default button 1
        error number -128
    end if

    -- Labels für den Auswahldialog. Wir bauen "Titel (slug)" Strings und
    -- behalten einen Index → Gallery-ID Mapping.
    set choices to {}
    set idsByLabel to {}
    repeat with g in galls
        set gTitle to ((g's objectForKey:"title") as text)
        set gSlug to ((g's objectForKey:"slug") as text)
        set gId to ((g's objectForKey:"id") as text)
        set label to gTitle & "  ·  " & gSlug
        copy label to end of choices
        copy {label, gId} to end of idsByLabel
    end repeat

    set picked to choose from list choices ¬
        with prompt "Welche Galerie soll synchronisiert werden?" ¬
        OK button name "Synchronisieren" cancel button name "Abbrechen"
    if picked is false then error number -128
    set chosenLabel to item 1 of picked

    repeat with pair in idsByLabel
        if (item 1 of pair) is chosenLabel then
            return item 2 of pair
        end if
    end repeat
    error "Galerie-ID nicht gefunden"
end pickGallery


-- =========================================================================
-- 5) Mapping-Funktionen
-- =========================================================================

-- Lumio-Color-String → C1 Color-Tag-Integer
on colorToTag(colorName)
    if colorName is "red" then
        return 1
    else if colorName is "yellow" then
        return 3
    else if colorName is "green" then
        return 4
    else
        return 0
    end if
end colorToTag

-- Effektives Rating: explicit rating gewinnt; Likes geben mindestens 1 Stern
-- als sanften Marker (analog Lightroom-Plugin). Beide Werte können 0 sein.
on effectiveRating(rating, isLiked)
    set r to 0
    if rating is not missing value then
        try
            set r to rating as integer
        end try
    end if
    if isLiked and r < 1 then
        set r to 1
    end if
    return r
end effectiveRating


-- =========================================================================
-- 6) Main
-- =========================================================================

on run
    -- Galerie wählen
    set galleryId to pickGallery()

    -- Selection holen
    set raw to runHelper("selection " & (quoted form of galleryId))
    set obj to jsonParse(raw)
    set fileList to (obj's objectForKey:"files") as list
    if (count of fileList) = 0 then
        display dialog "Diese Galerie hat noch keine ausgewählten Bilder." ¬
            buttons {"OK"} default button 1
        return
    end if

    -- Dateinamen-Index aus C1 aufbauen.
    -- Wir iterieren über das aktuell aktive Dokument (Katalog oder Session)
    -- und sammeln alle Variants nach lowercase-Dateiname.
    tell application "Capture One"
        if not (exists current document) then
            display dialog "Bitte zuerst einen Capture-One-Katalog oder eine Session öffnen." ¬
                buttons {"OK"} default button 1 with icon stop
            return
        end if
        set theDoc to current document
        set allVariants to every variant of theDoc
    end tell

    -- variantsByName: assoc list aus lowercased Filename → Liste of variant
    -- AppleScript hat keine echten Dicts; wir behelfen uns mit einem Pair-Array
    -- und linearer Suche. Bei ~10k Files ist das immer noch tolerabel —
    -- für größere Kataloge müsste man hier eine Lookup-Optimierung einbauen.
    set variantsByName to {}
    tell application "Capture One"
        repeat with v in allVariants
            try
                -- "name of parent image" liefert den Dateinamen ohne Pfad
                set fname to (name of parent image of v) as text
                set fnameLower to my toLower(fname)
                set found to false
                repeat with pair in variantsByName
                    if (item 1 of pair) is fnameLower then
                        copy v to end of (item 2 of pair)
                        set found to true
                        exit repeat
                    end if
                end repeat
                if not found then
                    copy {fnameLower, {v}} to end of variantsByName
                end if
            on error
                -- Variant ohne parent image (z.B. virtuell) — überspringen
            end try
        end repeat
    end tell

    -- Anwenden
    set matchedCount to 0
    set missingNames to {}

    tell application "Capture One"
        repeat with f in fileList
            set fName to ((f's objectForKey:"filename") as text)
            set fLower to my toLower(fName)
            set fColor to ((f's objectForKey:"color") as text)
            set fRating to (f's objectForKey:"rating")
            set fLiked to ((f's objectForKey:"liked") as boolean)
            set fPicked to ((f's objectForKey:"picked") as boolean)

            -- Effektive Werte berechnen
            set rating to my effectiveRating(fRating, fLiked)
            set colorTag to my colorToTag(fColor)
            -- Pick ohne Color → Color 5 (Blau)
            if colorTag is 0 and fPicked then
                set colorTag to 5
            end if

            -- Match suchen
            set matches to {}
            repeat with pair in (my variantsByName)
                if (item 1 of pair) is fLower then
                    set matches to (item 2 of pair)
                    exit repeat
                end if
            end repeat

            if (count of matches) = 0 then
                copy fName to end of missingNames
            else
                set matchedCount to matchedCount + 1
                repeat with v in matches
                    try
                        if rating > 0 then
                            set rating of v to rating
                        end if
                        if colorTag > 0 then
                            set color tag of v to colorTag
                        end if
                    on error errMsg
                        -- z.B. read-only Variant — überspringen
                    end try
                end repeat
            end if
        end repeat
    end tell

    -- Status-Dialog
    set totalFiles to count of fileList
    set missingCount to count of missingNames
    set summary to (matchedCount as text) & " von " & (totalFiles as text) ¬
        & " Files synchronisiert."
    if missingCount > 0 then
        set summary to summary & return & return ¬
            & (missingCount as text) ¬
            & " Files nicht im Katalog gefunden — Beispiel:" & return ¬
            & (item 1 of missingNames) as text
    end if
    display dialog summary buttons {"OK"} default button 1
end run


-- =========================================================================
-- Util: lowercase ohne Locale-Tricks
-- =========================================================================
on toLower(s)
    set nsStr to current application's NSString's stringWithString:s
    return (nsStr's lowercaseString) as text
end toLower
