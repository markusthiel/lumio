# Changelog

Alle nennenswerten Änderungen an Lumio werden hier dokumentiert. ·
*All notable changes to Lumio are documented here.*

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/). ·
*The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/).*

> **Für Self-Hoster:** Vor einem Update immer den Abschnitt der Zielversion lesen.
> Ein Eintrag unter **⚠️ Upgrade-Hinweise** bedeutet, dass nach `git pull` ein
> manueller Schritt nötig ist (z.B. `.env` anpassen, Compose-Befehl ändern).
> Ohne solchen Hinweis genügt der reguläre Deploy laut `README` / `docs/OPERATIONS.md`.
>
> **For self-hosters:** before an update, always read the target version's section.
> An entry under **⚠️ Upgrade notes** means a manual step is required after `git pull`
> (e.g. adjust `.env`, change the Compose command). Without such a note, the regular
> deploy per `README` / `docs/OPERATIONS.md` is enough.

## Versionsschema kurz · Versioning in brief

- **PATCH** (0.9.0 → 0.9.**1**): Bugfix, abwärtskompatibel, keine Aktion nötig. · *Bugfix, backward compatible, no action needed.*
- **MINOR** (0.**9** → 0.**10**.0): neues Feature, abwärtskompatibel. Pull genügt. · *New feature, backward compatible. Pull is enough.*
- **MAJOR** (0.x → **1**.0.0): Breaking Change, manueller Eingriff laut Upgrade-Hinweisen. · *Breaking change, manual intervention per the upgrade notes.*

Solange wir bei `0.x` sind, kann sich strukturell noch etwas bewegen; Breaking
Changes werden trotzdem klar als solche markiert. Details: `docs/VERSIONING.md`. ·
*While we're at `0.x`, structural things can still move; breaking changes are still clearly marked as such. Details: `docs/VERSIONING.md`.*

## [Unreleased]

### Added

- Galleries can now be permanently deleted. A gallery must be archived first, deletion respects studio roles (admins can delete any gallery they can see, owners only their own, members not at all), and any gallery with print orders is protected so order records are never lost.

## [0.74.1] - 2026-08-27

A pull is enough. Only the main server is affected.

### Changed

- The "show/hide label" control in the client gallery is now a small eye icon next to the share button, instead of a wide text button on the left of the toolbar. In a presentation gallery there is no sorting dropdown and no filter chips, so the text button ended up standing alone on the left and reading like the page's main action — and on a phone it took up a whole row of its own.
- The control no longer appears in a gallery that has no files yet, where there was nothing to label.

## [0.74.0] - 2026-08-27

A pull is enough — no changes to `.env` or the compose command. The database migrates automatically on start. Only the main server is affected; worker nodes are unchanged.

### Added

- Image labels can now be shown under each photo, in the studio and in the client gallery, and they can be turned off.
  - **In the studio** it is a per-device preference: a "Filenames" button in the gallery toolbar toggles the filename overlay in the grid, the lightbox and the proofing view. Nobody has to be given permission for this — internally the filename is a working tool, so each team member decides for their own view. The setting has no effect whatsoever on what clients see.
  - **In the client gallery** it is a per-gallery setting, because the filename carries information there. Three options: none (the previous behaviour), the real filename, or a neutral number ("Image 12 of 84"). The number is meant for the case where clients need to refer to a specific photo — a filename would reveal through its numbering how many shots were culled, and some studios carry internal shoot codes or client names in their filenames.
  - A second switch decides whether clients may show and hide the label themselves. They can only turn the label on and off, never change its type — what is displayed stays the studio's decision.
  - Both settings can be preset in a gallery template.
- The neutral number stays fixed to the gallery order. Filtering or re-sorting in the client gallery does not renumber the photos, so a number a client mentions still points at the same photo later.

### Changed

- When a gallery does not show filenames to clients, the filenames are no longer sent to the browser at all, rather than merely being hidden in the display. Otherwise they would still be readable in the browser's network inspector, which defeats the point of hiding them.
- As a consequence, the "Sort by name" option no longer appears in client galleries that do not show filenames — there is nothing to sort by. Existing galleries default to not showing filenames, so this option disappears from them. Set the label to "Filename" for a gallery to get it back.

## [0.73.5] - 2026-08-23

A pull is enough — no changes to `.env`, the compose command or the database. The worker is affected, so all worker nodes need the update too, after the main server.

### Fixed

- Downloading a gallery failed whenever it contained a file larger than 2 GiB — typically video. The download would run for several minutes and then report a generic build error. Cause: the archive entry for each file is opened before its contents are streamed in, and at that moment the packer had no size to go on, so it laid the entry out with 32-bit fields. It only noticed the overflow once the whole file had already been pulled from storage, and aborted. Splitting the gallery into several download packages did not help: a single file always lands whole in one package, no matter how small the size limit is set. The size is now known up front, and large entries use the ZIP64 layout. Archives that only contain photos are unchanged and stay maximally compatible with older unpacking tools.
- The same flaw affected the super-admin recovery archive for deleted objects; fixed alongside.

## [0.73.4] - 2026-08-21

A pull is enough — no changes to `.env`, the compose command or the database. The frontend is affected, so only the main server.


### Fixed

- Opening the download menu in a gallery on a phone and then turning the device made the page flicker rapidly. The menu was capped using the window width, but a menu that overhangs makes the page wider, which changes the window width, which resizes the menu — during the rotation animation, when the browser recalculates continuously, that loop became visible. The menu also kept the alignment it had worked out before the turn, so it could end up on the wrong side. It now re-measures when the device is turned, and its width no longer depends on anything it can itself affect.

## [0.73.3] - 2026-08-21

A pull is enough — no changes to `.env`, the compose command or the database. Frontend and API are affected, so only the main server.


### Fixed

- The print provider configuration fields showed German labels and help texts whatever language was selected — the currency field and the sandbox switch, along with their explanations. Technical names such as "API-Key" and "Client-ID" deliberately stay as they are.

## [0.73.2] - 2026-08-21

A pull is enough — no changes to `.env`, the compose command or the database. Frontend and API are affected, so only the main server.


### Fixed

- The download menu in a gallery ran off the left edge of the screen on a phone, cutting off the first entry. The menu now works out which way it can open from where the button actually is, which matters because the toolbar wraps: how many actions are visible decides whether the button ends up mid-row or at the start of the next one. The gallery tile menu in the studio had the same arrangement and is fixed too.
- The engagement funnel under gallery statistics stayed German whatever language was selected — the heading and all four step labels. The steps come from the API, which is the third time a set of API-supplied labels has shipped untranslated.
- The dictionary check now also scans the API for the *shape* of an untranslated catalogue — a stable key next to a German label — rather than only checking the handful of files someone remembered to list. That is what would have caught this one, and it also turned up the print provider configuration fields.

## [0.73.1] - 2026-08-21

A pull is enough — no changes to `.env`, the compose command or the database. The frontend is affected, so only the main server.


### Fixed

- The language setting was labelled "Language / Sprache" whatever language you were using, and its explanation was English only. German was there because there were once two languages; with four it just meant a Finnish studio was shown German. The heading now reads English plus your own language — "Language / Kieli" — and the explanation appears in both. The option names stay untranslated ("Suomi", not "Finnish"), which is the convention and the thing that actually helps someone who landed in a language they cannot read.
- The dictionary check was comparing German and Italian against English by name, so Finnish was not being checked at all and an incomplete file would have passed in silence. The list of languages now comes from the code.

## [0.73.0] - 2026-08-21

A pull is enough — no changes to `.env`, the compose command or the database. Frontend and API are affected, so only the main server.


### Added

- **Finnish is now available**, for the interface and for email alike. All 2567 interface strings and 340 mail phrases translated, with dates, numbers and currency following Finnish convention. Contributed by [@canja006](https://github.com/canja006).

### Fixed

- The dictionary check was only comparing German and Italian against English by name, so a newly added language could have shipped incomplete without anything noticing. It now takes the list of languages from the code, so the next one is covered automatically.

### Added

- `scripts/lumio-check-ports.sh` checks Lumio's ten TCP/UDP ports against the host before `docker compose up`, and offers to write an alternative into `.env` where a port has a dedicated variable. Without it a port conflict shows up as a container that quietly refuses to bind rather than as an error you can act on. Documented in `docs/PORT-CHECK.md`. Contributed by [@manuzzi](https://github.com/manuzzi).

## [0.72.0] - 2026-08-21

A pull is enough — no changes to `.env`, the compose command or the database. Frontend and API are affected, so only the main server.


### Added

- **Emails are now available in Italian.** All 338 mail phrases translated, so an Italian studio gets an Italian interface *and* Italian mail — the gap that remained after the interface translation landed. Contributed by [@manuzzi](https://github.com/manuzzi).
- Italian can now be selected as the mail language, both for your own notifications and for the mail your customers receive.

### Fixed

- Two lines in the print shop mails were German whatever language was selected — a heading and a closing line that never went through the translation layer at all. Found while translating around them.

## [0.71.1] - 2026-08-20

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen ist die API, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. The API is affected, so only the main server.*


### Fixed

- E-Mails kamen im Rahmen weiterhin in der Vorgabesprache der Instanz, auch wenn der Inhalt übersetzt war: Fußzeile und die Sprachkennzeichnung der Mail folgten nicht der angeschriebenen Person. Eine englische Mail auf einer deutschen Instanz hatte also englischen Text in deutschem Rahmen — was auch Vorleseprogramme und Spamfilter falsch informierte. Gemeldet und behoben von [@manuzzi](https://github.com/manuzzi).

**🇬🇧 English**

- Emails still used the instance default language for their frame even when the content was translated: the footer and the mail's language attribute did not follow the recipient. An English mail on a German instance had English text in a German frame, which also misinformed screen readers and spam filters. Reported and fixed by [@manuzzi](https://github.com/manuzzi).

## [0.71.0] - 2026-08-20

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen sind Frontend und API, also nur der Hauptserver. Die neue Einstellung findet sich im Super-Admin unter System.

*A pull is enough — no changes to `.env`, the compose command or the database. Frontend and API are affected, so only the main server. The new setting is in the super admin area under System.*


### Added

- Die Fußzeile der E-Mails lässt sich jetzt direkt in der Administrationsoberfläche einstellen, unter System. Wer die Instanz auf den eigenen Studionamen bringen will, braucht dafür keinen Zugriff mehr auf die `.env` und keine Kommandozeile. Ein Eintrag hier überstimmt `MAIL_FOOTER_TEXT` aus der Umgebung; bestehende Installationen behalten also ihre Einstellung, bis jemand hier etwas einträgt.

**🇬🇧 English**

- The email footer can now be set directly in the administration interface, under System. Putting your own studio name on an instance no longer requires access to `.env` or a command line. An entry here overrides `MAIL_FOOTER_TEXT` from the environment, so existing installations keep their setting until someone changes it here.

## [0.70.0] - 2026-08-20

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen ist die API, also nur der Hauptserver. Wer die neue Fußzeile anpassen möchte, findet die beiden optionalen Einträge in `.env.example`.

*A pull is enough — no changes to `.env`, the compose command or the database. The API is affected, so only the main server. If you want to customise the new footer, the two optional entries are documented in `.env.example`.*


### Added

- Die Fußzeile der E-Mails lässt sich jetzt selbst festlegen: `MAIL_FOOTER_TEXT` und `MAIL_FOOTER_URL` in der `.env`. Ohne Eintrag steht dort „Verschickt von Lumio" in der Sprache der angeschriebenen Person, verlinkt aufs Projekt. Ein eigener Text wird wörtlich übernommen und dabei **nicht** übersetzt — bei mehreren Sprachen auf einer Instanz ist die Vorgabe daher meist die bessere Wahl.
- Erste Tests für die Sprach-Helfer der Mails (16 Stück). Sie halten fest, dass jede Sprache ihr eigenes Datums- und Währungsformat bekommt — genau der Fehler, der vorher unbemerkt blieb. Beigesteuert von [@canja006](https://github.com/canja006).

### Fixed

- Die Fußzeile jeder E-Mail war fest auf Deutsch und behauptete „gehostet in Deutschland" — auf einer selbst betriebenen Instanz schlicht falsch. Sie folgt jetzt der Sprache der angeschriebenen Person. Gemeldet und behoben von [@canja006](https://github.com/canja006).

**🇬🇧 English**

- The email footer is now configurable: `MAIL_FOOTER_TEXT` and `MAIL_FOOTER_URL` in `.env`. Left unset, it reads "Sent via Lumio" in the recipient's language and links to the project. A custom text is used verbatim and is **not** translated — on an instance serving several languages the default is usually the better choice.
- First tests for the mail locale helpers (16 of them), asserting that each language gets its own date and currency format — precisely the bug that previously went unnoticed. Contributed by [@canja006](https://github.com/canja006).
- The footer of every email was hardcoded in German and claimed the service is "hosted in Germany", which is simply untrue on a self-hosted instance. It now follows the recipient's language. Reported and fixed by [@canja006](https://github.com/canja006).

## [0.69.0] - 2026-08-19

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen ist das Frontend, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. The frontend is affected, so only the main server.*


### Fixed

- Fehlermeldungen, die bisher als Browser-Hinweisfenster erschienen, werden jetzt von Lumio als Einblendung gezeigt. In Browsern, die solche Fenster unterdrücken, erfuhr man vorher gar nicht, dass etwas schiefgegangen war — die Aktion schlug still fehl. Betraf unter anderem das Widerrufen von Galerie-Zugängen und das Verschicken von Einladungen.
- Zwei dieser Meldungen waren fest auf Deutsch.
- Alle Rückfragen vor einer Aktion — Löschen, Widerrufen, Trennen, Archivieren — funktionieren jetzt auch in Browsern, die den eingebauten Bestätigungsdialog unterdrücken. Bisher passierte dort schlicht nichts: kein Dialog, keine Meldung, kein Vorgang. Betraf unter anderem Brave auf dem iPad und 27 Stellen quer durch Studio, Kundengalerien und Administrationsoberfläche.

**🇬🇧 English**

- Error messages that used to appear as browser alert boxes are now shown by Lumio as an inline notice. In browsers that suppress those boxes you previously had no way of knowing something had gone wrong — the action simply failed in silence. This affected revoking gallery access and sending invitations, among others.
- Two of those messages were hardcoded in German.
- Every confirmation before an action — deleting, revoking, disconnecting, archiving — now works in browsers that suppress the built-in confirm dialog. Previously nothing happened at all: no dialog, no message, no action. This affected Brave on iPad among others, across 27 places in the studio, customer galleries and administration interface.

## [0.68.0] - 2026-08-19

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen ist das Frontend, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. The frontend is affected, so only the main server.*


### Fixed

- Vier Stellen, an denen eine Eingabe verlangt wurde, funktionierten in manchen Browsern gar nicht — darunter Brave auf dem iPad: eine neue Section anlegen, einen Passkey benennen, eine Bestellung mit Grund stornieren und der Link zum manuellen Kopieren, wenn die Zwischenablage nicht verfügbar ist. Der Browser blendete das Eingabefenster wortlos aus, die Aktion brach ab, und der Knopf wirkte kaputt. Diese Dialoge werden jetzt von Lumio selbst gezeichnet.
- Die Beschriftung beim Benennen eines Passkeys war fest auf Deutsch.

**🇬🇧 English**

- Four places that ask for input did not work at all in some browsers, Brave on iPad among them: creating a section, naming a passkey, cancelling an order with a reason, and the manual-copy link shown when the clipboard is unavailable. The browser suppressed the input window without a word, the action aborted, and the button appeared broken. These dialogs are now drawn by Lumio itself.
- The prompt for naming a passkey was hardcoded in German.

## [0.67.1] - 2026-08-19

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen ist das Frontend, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. The frontend is affected, so only the main server.*


### Fixed

- 26 weitere Texte erschienen in jeder Sprache auf Deutsch — darunter „Abmelden" in der Administrationsoberfläche, „Angemeldet als …" im Studio, der Untertitel der Startseite, der Hinweis zur Team-Einladung und alle Rückfragen vor dem Suspendieren, Archivieren oder Umbenennen eines Studios. Gemeldet von [@canja006](https://github.com/canja006), zusammen mit dem Prüfverfahren, das sie gefunden hat.
- Die Warnung beim Ändern eines Studio-Kürzels nannte fest `lumio-cloud.de`, auch auf einer selbst betriebenen Instanz. Sie nimmt jetzt die tatsächlich konfigurierte Domain.

**🇬🇧 English**

- 26 further strings appeared in German whatever language was selected — including "Sign out" in the administration interface, "Signed in as …" in the studio, the landing page subtitle, the team invitation hint, and every confirmation before suspending, archiving or renaming a studio. Reported by [@canja006](https://github.com/canja006), along with the scanning method that found them.
- The warning shown when changing a studio slug named `lumio-cloud.de` verbatim, even on a self-hosted instance. It now uses the domain actually configured.

## [0.67.0] - 2026-08-19

Pull genügt für Server und Studio — hier ändert sich nichts. **Wer das Lightroom-Plugin nutzt, muss es neu installieren:** die Änderungen liegen ausschließlich im Plugin, das in Lightroom selbst installiert ist und nicht mit dem Server aktualisiert wird. Ordner `apps/lightroom-plugin/lumio.lrdevplugin` erneut in Lightroom laden.

*A pull is enough for the server and the studio — nothing changes there. **Anyone using the Lightroom plug-in has to reinstall it:** the changes are entirely inside the plug-in, which lives in Lightroom and is not updated along with the server. Re-add the `apps/lightroom-plugin/lumio.lrdevplugin` folder in Lightroom.*


### Fixed

- Das Lightroom-Plugin ließ sich nicht laden — Lightroom meldete „Could not create info sections for plug-in", und keiner der Menüpunkte erschien. Beigesteuert von [@canja006](https://github.com/canja006).
- Der Import der Kundenauswahl zurück in den Katalog fand bei RAW-Beständen praktisch nichts: die Auswahl wurde gegen Dateinamen mit Endung verglichen, hochgeladen wird aber immer als `.jpg`. Bei einem Katalog aus NEF- und DNG-Dateien blieben damit über 95 % der Bilder unauffindbar. Jetzt wird zusätzlich ohne Endung verglichen, und bei mehreren gleichnamigen Rohdateien wird bewusst keine geändert statt alle.
- Das Schreiben der Bewertungen und Farb-Labels in den Katalog schlug still fehl und meldete trotzdem Erfolg — „57 Fotos aktualisiert", geschrieben wurde nichts.
- Nach dem Hochladen markierte Lightroom die Fotos nicht als veröffentlicht, sodass beim nächsten Publish alles erneut hochgeladen wurde.
- Fehlgeschlagene Uploads werden jetzt als solche gemeldet, statt unbemerkt zu bleiben.

**🇬🇧 English**

- The Lightroom plug-in would not load — Lightroom reported "Could not create info sections for plug-in" and none of its menu items appeared. Contributed by [@canja006](https://github.com/canja006).
- Importing the client selection back into the catalog found almost nothing for RAW libraries: the selection was matched against filenames including the extension, while uploads are always named `.jpg`. On a catalog of NEF and DNG files, over 95% of photos could never be found. Matching now also compares without the extension, and where several raw files share a name, none is modified rather than all of them.
- Writing ratings and colour labels into the catalog failed silently while still reporting success — "57 photos updated", with nothing written.
- After uploading, Lightroom did not mark photos as published, so the next publish re-uploaded everything.
- Failed uploads are now reported as failures instead of passing unnoticed.

## [0.66.3] - 2026-08-19

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen sind Frontend und API, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. Frontend and API are affected, so only the main server.*


### Added

- Die Dokumentation gibt es jetzt auch auf Italienisch — README, CONTRIBUTING und alle 19 Dateien unter `docs/`, dazu die vier Plugin- und Werkzeug-READMEs, die es bisher nur auf Deutsch gab. Beigesteuert von [@manuzzi](https://github.com/manuzzi).

### Fixed

- Bei italienischer Oberfläche wurde die Sprachwahl nicht gespeichert: der Server kannte nur Deutsch und Englisch und lehnte „Italiano" ab, während die Oberfläche umschaltete. Benachrichtigungen kamen deshalb weiter in der Vorgabe-Sprache der Instanz. Danke an @canja006 für den Bericht.
- Datum und Zahlen in E-Mails fielen für jede Sprache außer Deutsch auf britisches Englisch zurück. Betraf Italienisch, sobald eine Person es eingestellt hatte.
- Übersetzern wurde zugesagt, `tsc --noEmit` melde fehlende Keys in einer Sprachdatei — das tat es nicht. Jetzt tut es das.

**🇬🇧 English**

- The documentation is now available in Italian too — README, CONTRIBUTING and all 19 files under `docs/`, plus the four plugin and tooling READMEs that previously existed only in German. Contributed by [@manuzzi](https://github.com/manuzzi).
- With an Italian interface the language choice was not saved: the server only knew German and English and rejected "Italiano" while the interface switched anyway. Notifications therefore kept arriving in the instance default language. Thanks to @canja006 for the report.
- Dates and numbers in email fell back to British English for every language other than German. This affected Italian as soon as anyone selected it.
- Translators were promised that `tsc --noEmit` reports missing keys in a locale file. It did not. Now it does.

## [0.66.2] - 2026-08-17

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen ist das Frontend, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. The frontend is affected, so only the main server.*


### Fixed

- Das Menü hinter „Herunterladen" in der Kundengalerie war weiterhin von der Kapitel-Leiste verdeckt — der Fix in 0.66.1 hat nur einen Teil der Ursache erwischt. Beide Leisten bekommen jetzt eine ausdrückliche Ebene, das Menü liegt vollständig sichtbar und anklickbar darüber. Wer 0.66.1 installiert hat, sollte direkt auf 0.66.2 gehen.

**🇬🇧 English**

- The menu behind "Download" in the customer gallery was still covered by the chapter bar — the 0.66.1 fix only addressed part of the cause. Both bars now get an explicit layer, and the menu sits fully visible and clickable on top. If you installed 0.66.1, go straight to 0.66.2.

## [0.66.1] - 2026-08-17

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen ist das Frontend, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. The frontend is affected, so only the main server.*


### Fixed

- In der Kundengalerie war das Menü hinter „Herunterladen" nicht lesbar: die Kapitel-Leiste lag darüber und verdeckte die Einträge. Menü und Kapitel-Leiste liegen jetzt sauber übereinander, das Menü ist vollständig sichtbar.
- Beim Scrollen schoben sich Werkzeug- und Kapitel-Leiste übereinander, statt untereinander zu bleiben. Beide bilden jetzt einen gemeinsamen Kopfbereich.
- Ein Klick auf ein Kapitel scrollte das Ziel manchmal zu weit nach oben — der Kapitel-Titel verschwand dann unter den Leisten. Der Abstand richtet sich jetzt nach der tatsächlichen Höhe des Kopfbereichs, auch wenn die Werkzeug-Leiste auf schmalen Bildschirmen umbricht.

**🇬🇧 English**

- In the customer gallery, the menu behind "Download" was unreadable: the chapter bar sat on top of it and hid the entries. Menu and chapter bar are now layered correctly and the menu is fully visible.
- When scrolling, the toolbar and the chapter bar slid on top of each other instead of staying stacked. Both now form a single header area.
- Clicking a chapter sometimes scrolled the target too far up, hiding the chapter title behind the bars. The offset now follows the actual header height, including when the toolbar wraps on narrow screens.

## [0.66.0] - 2026-08-14

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. **Achtung:** Diese Version ändert auch den Worker. Wer Worker-Nodes betreibt, muss dort ebenfalls aktualisieren — zuerst den Hauptserver, danach die Nodes.

*A pull is enough — no changes to `.env`, the compose command or the database. **Note:** this version also changes the worker. If you run worker nodes, update them too — the main server first, then the nodes.*


### Security

- Wenn die Erstellung eines ZIP-Downloads fehlschlug, bekam der Galerie-Besucher die technische Fehlermeldung des Servers zu sehen — je nach Ursache mit Namen von Speicher-Endpunkten oder Serverpfaden darin. Jetzt erscheint eine verständliche Meldung in der eingestellten Sprache; die technischen Details stehen nur noch im Server-Log.

### Fixed

- Fehlermeldungen aus der Hintergrund-Verarbeitung (ZIP-Downloads, Datenexporte) waren technisches Englisch und nicht übersetzbar. Sie sind jetzt in allen drei Sprachen verfügbar und sagen, ob man selbst etwas tun kann.

**🇬🇧 English**

- When building a ZIP download failed, the gallery visitor was shown the server's technical error message — depending on the cause, including storage endpoint names or server paths. They now see a comprehensible message in the selected language; the technical detail stays in the server log.
- Error messages from background processing (ZIP downloads, data exports) were technical English and could not be translated. They are now available in all three languages and say whether there is anything you can do.

## [0.65.0] - 2026-08-14

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen ist das Frontend, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. The frontend is affected, so only the main server.*


### Fixed

- Fehlermeldungen aus dem Server erschienen immer auf Deutsch — etwa „Aktuelles Passwort ist nicht korrekt." oder „Du kannst dich nicht selbst löschen.". Betroffen waren rund 160 Stellen quer durch Studio, Kundengalerien und Administrationsoberfläche. Sie erscheinen jetzt in der eingestellten Sprache.
- Eine Prüfung im Build meldet ab jetzt, wenn eine neue Fehlermeldung ohne Übersetzung ergänzt wird.

**🇬🇧 English**

- Error messages from the server always appeared in German — for example "Your current password is not correct." or "You cannot delete yourself." This affected around 160 places across the studio, customer galleries and the administration interface. They now appear in the selected language.
- A build check now reports when a new error message is added without a translation.

## [0.64.2] - 2026-08-14

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen ist das Frontend, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. The frontend is affected, so only the main server.*


### Fixed

- Weitere Texte, die die API mitliefert, waren in jeder Sprache deutsch: die Beschreibungen der Tarife unter Abrechnung, die Feature-Flags in der Tenant-Verwaltung und die Beschreibungen der Print-Anbieter — letztere sowohl im Studio als auch in der Administrationsoberfläche. Alle sind jetzt auf Deutsch, Englisch und Italienisch verfügbar.
- Eine Prüfung im Build meldet ab jetzt, wenn ein neuer Eintrag in einem dieser Kataloge angelegt wird, ohne die Übersetzungen zu ergänzen.

**🇬🇧 English**

- More text supplied by the API was German in every language: the plan descriptions under billing, the feature flags in tenant management, and the print provider descriptions — the latter in both the studio and the administration interface. All are now available in German, English and Italian.
- A build check now reports when a new entry is added to one of these catalogues without the accompanying translations.

## [0.64.1] - 2026-08-14

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen sind Frontend und API, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. Frontend and API are affected, so only the main server.*


### Fixed

- Die einzelnen Schalter unter Einstellungen → Benachrichtigungen waren immer deutsch beschriftet, auch bei englischer oder italienischer Oberfläche — die Überschriften darüber waren übersetzt, die sieben Einträge darunter nicht.

**🇬🇧 English**

- The individual toggles under Settings → Notifications were always labelled in German, even with an English or Italian interface — the headings above them were translated, the seven entries below were not.

## [0.64.0] - 2026-08-14

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen ist das Frontend, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. The frontend is affected, so only the main server.*


### Added

- **Die Oberfläche gibt es jetzt auf Italienisch.** Vollständig übersetzt, im Sprachwähler unter „Italiano" auswählbar — Studio, Kundengalerien und die Administrationsoberfläche. Beigesteuert von [@manuzzi](https://github.com/manuzzi). Datum, Zahlen und Preise folgen ebenfalls dem italienischen Format. Die E-Mails sind davon noch nicht erfasst, sie kommen weiterhin auf Deutsch oder Englisch.

**🇬🇧 English**

- **The interface is now available in Italian.** Fully translated and selectable as "Italiano" in the language picker — studio, customer galleries and the administration interface. Contributed by [@manuzzi](https://github.com/manuzzi). Dates, numbers and prices follow Italian formatting too. Email is not covered yet and still arrives in German or English.

## [0.63.0] - 2026-08-14

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen ist die API, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. The API is affected, so only the main server.*


### Fixed

- Vier E-Mails wurden bisher an den Vorlagen vorbei gebaut und waren deshalb in jeder Sprache deutsch: die Mitteilung über einen Support-Zugriff aufs eigene Studio, die Vorab-Ankündigung und die Erinnerung zur Konto-Archivierung sowie der Hinweis auf den bereitstehenden Datenexport. Sie haben jetzt richtige Vorlagen — mit HTML-Fassung, die der Support-Hinweis vorher gar nicht hatte — und folgen der Sprache der angeschriebenen Person. Drei davon siezten als einzige Mails im System und duzen jetzt wie alle anderen.
- Zwei E-Mails trugen ein deutsches Datum, obwohl der Text bereits in der Sprache des Empfängers verschickt wurde: die Ablauf-Warnung für Galerien und der tägliche Bericht an die Plattform-Verwaltung.

**🇬🇧 English**

- Four emails were assembled without going through a template and were therefore German in every language: the notice that support accessed your studio, the advance warning and the reminder about account archiving, and the pointer to a prepared data export. They now have proper templates — including an HTML version, which the support notice never had — and follow the language of the person being written to. Three of them were the only mails using formal German address; they now match everything else.
- Two emails carried a German date even though the surrounding text already went out in the recipient's language: the gallery expiry warning and the daily platform administration report.

## [0.62.0] - 2026-08-14

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen sind Frontend und API, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. Frontend and API are affected, so only the main server.*


### Added

- **Alle E-Mails sind jetzt mehrsprachig.** Auch die Löschbestätigung, die 7-Tage-Erinnerung und die beiden Archivierungs-Mails folgen der Sprache der angeschriebenen Person. Fristen und Zusagen sind wörtlich übersetzt — gleiche Tage, gleiche Verbindlichkeit.
- Die Mails zur Studio-Löschung (Anfrage bestätigt, Löschung zurückgenommen) und der tägliche Bericht an die Plattform-Verwaltung sind übersetzbar. Bei der Löschung sind die englischen Fassungen bewusst wörtlich gehalten: gleiche Fristen, gleiche Verbindlichkeit.
- Die Lifecycle-Mails rund um den Testzeitraum (Erinnerung, Stornierung, Rückhol-Mail) sind übersetzbar und folgen der Sprache der angeschriebenen Person.
- Auch die Willkommens-Mail, die Support-Bestätigung, die Print-Bestellmeldung ans Studio und die Benachrichtigung an die Plattform-Verwaltung sind jetzt übersetzbar.
- Weitere Benachrichtigungen ans Studio-Team sind jetzt übersetzbar und folgen der Sprache der jeweiligen Person: Auswahl abgeschlossen, Speicherwarnung, Galerie läuft ab, neue Uploads, neues Team-Mitglied, Konto-Einrichtung, Passwort zurücksetzen und der E-Mail-Wechsel. Bekommen mehrere Personen dieselbe Benachrichtigung, erhält jede sie in ihrer eigenen Sprache.

**🇬🇧 English**

- **Every email is now multilingual.** The deletion confirmation, the 7-day reminder and both archiving mails follow the language of the person being written to. Deadlines and commitments are translated literally — same days, same weight.
- The studio deletion emails (request confirmed, deletion reversed) and the daily platform administration report are translatable. For the deletion mails the English wording is deliberately literal: same deadlines, same commitments.
- The trial lifecycle emails (reminder, cancellation, win-back) are translatable and follow the language of the person being written to.
- The welcome email, the support confirmation, the print order notice to the studio and the platform administration notice are now translatable too.
- More notifications to the studio team are now translatable and follow each person's own language: selection finished, storage warning, gallery expiring, new uploads, new team member, account setup, password reset and the email change flow. Where several people receive the same notification, each gets it in their own language.

## [0.61.0] - 2026-08-14

Pull genügt. Die Datenbank wird beim Start automatisch erweitert (zwei neue, leere Spalten) — kein manueller Schritt. Betroffen sind Frontend und API, also nur der Hauptserver.

*A pull is enough. The database gains two new empty columns automatically on start — no manual step. Frontend and API are affected, so only the main server.*


### Added

- Studios können unter Einstellungen festlegen, in welcher Sprache Lumio ihre Kunden anschreibt — unabhängig davon, in welcher Sprache sie selbst arbeiten. Wer nichts einstellt, bleibt bei der Vorgabe der Instanz. Zusätzlich merkt sich Lumio pro Person die im Studio gewählte Sprache und verschickt Benachrichtigungen an sie darin; in einer Agentur kann also jede Person Deutsch oder Englisch bekommen, ohne dass das die Kundensprache verändert.
- Grundlage für mehrsprachige E-Mails. Studios können künftig festlegen, in welcher Sprache ihre Kunden angeschrieben werden, und jedes Team-Mitglied bekommt seine eigenen Benachrichtigungen in seiner Sprache. **Alle Mails an Kunden sind umgestellt**: Galerie-Einladung, Download-bereit, Bestellbestätigung und Versandmitteilung des Print-Shops — inklusive Preis- und Datumsformaten. Die Mails ans Studio-Team folgen. Neue optionale Einstellung `DEFAULT_MAIL_LOCALE` (`de` oder `en`, Standard `de`) für alles, wo noch nichts hinterlegt ist. Ohne Eingriff bleibt alles auf Deutsch wie bisher.

**🇬🇧 English**

- Studios can now choose, under settings, which language Lumio writes to their customers in — independently of the language they work in themselves. Leave it unset and the instance default applies. Lumio also remembers the language each person picked in the studio and sends their notifications in it, so in an agency each member can receive German or English without that affecting the customer language.
- Groundwork for multilingual email. Studios will be able to choose the language their customers are written in, and each team member gets their own notifications in their own language. **Every customer-facing email is converted**: gallery invitation, download ready, and the print shop's order confirmation and shipping notice — including price and date formats. Mail to the studio team follows. New optional setting `DEFAULT_MAIL_LOCALE` (`de` or `en`, default `de`) for anything not yet set. Without any action everything stays German exactly as before.

## [0.60.0] - 2026-08-14

Pull genügt — keine Änderungen an `.env`, am Compose-Befehl oder an der Datenbank. Betroffen ist ausschließlich das Frontend, also nur der Hauptserver.

*A pull is enough — no changes to `.env`, the compose command or the database. Only the frontend is affected, so only the main server.*

### Added

- Alle Fassungen der Bildmarke liegen jetzt unter `brand/` im Repo — Bildmarke, Wortmarke, Lockups, Produktvarianten mit *Cloud* und *Self-Hosted*, jeweils normal und invers, dazu Favicons, Mail-PNGs und die Skripte, aus denen das alles entsteht. `brand/preview.html` zeigt den Bestand im Browser, inklusive echter Pixelgrößen ab 16 px. Die verwendeten Schriften (Quicksand, Inter) liegen unter `brand/fonts/` samt SIL-OFL-Lizenztexten mit dabei, sodass sich alle Dateien ohne Netzzugang neu erzeugen lassen — ein Lauf aus einer frischen Kopie liefert sie bitgenau identisch. Die Regeln stehen weiterhin in `docs/BRAND.md`.

- Der README trägt jetzt die Bildmarke statt einer Textüberschrift, mit `<picture>` für hellen und dunklen GitHub-Modus, dazu Badges für Release, Lizenz und Deployment. Die Social-Preview-Karte für GitHub liegt unter `brand/social/` — die muss einmalig in den Repo-Einstellungen hochgeladen werden, GitHub liest sie nicht aus dem Repo.

**🇬🇧 English**

- Every version of the symbol now lives under `brand/` in the repository — symbol, wordmark, lockups, the *Cloud* and *Self-Hosted* product variants, each in regular and inverted form, plus favicons, email PNGs and the scripts that generate them. `brand/preview.html` shows the whole set in a browser, including real pixel sizes from 16 px up. The fonts used (Quicksand, Inter) ship under `brand/fonts/` together with their SIL OFL licence texts, so everything can be regenerated without network access — a run from a fresh copy reproduces the files byte for byte. The rules remain in `docs/BRAND.md`.

- The README now carries the symbol instead of a text heading, using `<picture>` for GitHub's light and dark modes, plus badges for release, licence and deployment. The social preview card for GitHub lives under `brand/social/` — it has to be uploaded once in the repository settings, GitHub does not read it from the repo.

### Changed

- Datum, Uhrzeit, Zahlen, Preise und Sortierungen folgen jetzt überall der eingestellten Sprache. Bisher war in der Oberfläche an rund 80 Stellen das deutsche Format festverdrahtet — bei englischer Bedienung standen dort deutsche Datumsangaben. Betrifft Studio, Kundengalerien und die Administrationsoberfläche.
- Die Seitenspalte der Administrationsoberfläche zeigt „MRR", „Plan-Katalog" und „Marketing-Mails" nur noch, wenn die Instanz mit Abrechnung läuft (`BILLING_ENABLED=true`). Wer Lumio selbst betreibt und mehrere Studios verwaltet, hatte dort drei Punkte, hinter denen nichts stand.
- Die Sprache des HTML-Dokuments wird mit der gewählten Oberflächensprache synchron gehalten. Vorlesehilfen und die Übersetzungsabfrage des Browsers gingen vorher immer von Englisch aus.
- Englisch ist ab jetzt als primäre Projektsprache festgeschrieben, Deutsch als Übersetzung — nachzulesen in `CONTRIBUTING.md`. Ausdrücklich ausgenommen und weiterhin deutsch: die E-Mails an Galeriekunden, der Auftragsverarbeitungsvertrag und die deutschsprachigen Webseiten.
- Im Studio-Bereich ist die Oberfläche jetzt durchgängig übersetzbar: Auswahl-Übersicht, Galerien-Liste, Templates, Collections, Team, Konto, Passkeys, Zwei-Faktor, Print-Shop, Video-Player und die Rechts-Fußzeile. Zwei Stellen bleiben absichtlich zweisprachig bzw. deutsch und sind im Code begründet — der Sprachumschalter selbst und der Studio-Wähler auf der Hauptdomain.
- Im Studio-Bereich wurden 66 Stellen nachgezogen, an denen eine Übersetzung längst vorlag, die Oberfläche aber trotzdem Deutsch anzeigte — Auswahl-Übersicht, Galerien-Liste, Templates, Collections, Team, Print-Shop und diverse Lade-Anzeigen. Betrifft nur die englische Bedienung; auf Deutsch ändert sich nichts außer dass „Wird geladen…" jetzt einheitlich „Lädt…" heißt.
- Die Administrationsoberfläche wird übersetzbar gemacht. Fertig sind: Tenant-Verwaltung, Audit-Log, Nutzerverwaltung, System-Status, Backup, Storage-Übersicht, Job-Fehler, E-Mail-Zustellbarkeit, CSP-Verstöße, Security, Compliance, Print-Provider, Broadcasts, der Login, die Tenant-Detailseite mit Billing, Notizen, Impersonate und Feature-Flags, System-Banner, Broadcast-Detail sowie MRR, Plan-Katalog und Marketing-Mails. Die Administrationsoberfläche ist damit vollständig übersetzbar. Das deckt die Strecke ab, die beim Selbstbetrieb mit mehreren Studios zwingend nötig ist — Studio anlegen, Inhaberin einladen, Nutzer verwalten, Betrieb überwachen, Vorgänge nachvollziehen. Bisher war dort alles fest auf Deutsch. Die restlichen Seiten folgen.

### Fixed

- Neun Stellen zeigten statt eines Textes den internen Schlüsselnamen an — etwa „studio.cancel" auf einem Knopf, oder „studio.tagConfirmDelete" in der Rückfrage vor dem Löschen eines Tags. Das trat in jeder Sprache auf. Betroffen waren Abschnitts-Editor, Template-Editor, Tag- und Webhook-Verwaltung sowie die Tonspur-Knöpfe der Diashow. Danke an @manuzzi, der drei davon gemeldet hat.
- In der Administrationsoberfläche waren „Marketing-Mails" und „angemeldet als" nicht übersetzbar.

**🇬🇧 English**

- Dates, times, numbers, prices and sorting now follow the selected language throughout. Around 80 places in the interface had the German format hardcoded, so an English interface still showed German dates. Affects the studio, customer galleries and the administration interface.
- The administration sidebar only shows "MRR", "Plan catalogue" and "Marketing emails" when the instance runs with billing (`BILLING_ENABLED=true`). Anyone self-hosting Lumio to manage several studios was looking at three entries with nothing behind them.
- The HTML document language is kept in sync with the selected interface language. Screen readers and the browser's translation prompt previously always assumed English.
- English is now established as the primary project language, with German as a translation — see `CONTRIBUTING.md`. Explicitly excluded and still German: the emails to gallery customers, the data processing agreement and the German-language websites.
- The studio interface is now translatable throughout: selection overview, gallery list, templates, collections, team, account, passkeys, two-factor, print shop, video player and the legal footer. Two places deliberately stay bilingual or German and say why in the code — the language switcher itself and the studio picker on the main domain.
- Wired up 66 places in the studio area where a translation already existed but the interface still showed German — selection overview, gallery list, templates, collections, team, print shop and various loading indicators. Only affects the English interface; nothing changes in German beyond "Wird geladen…" now consistently reading "Lädt…".
- The administration interface is being made translatable. Done so far: tenant management, audit log, user management, system status, backup, storage overview, job failures, email deliverability, CSP violations, security, compliance, print providers, broadcasts, the login, the tenant detail page including billing, notes, impersonation and feature flags, system banners, broadcast detail, and MRR, plan catalogue and marketing emails. The administration interface is now fully translatable. That covers the path a self-hosted multi-studio install cannot avoid — create a studio, invite its owner, manage users, watch the system, trace what happened. Everything there was previously hardcoded German. The remaining pages will follow.
- Nine places showed the internal key name instead of text — "studio.cancel" on a button, or "studio.tagConfirmDelete" in the confirmation before deleting a tag. This happened in every language. Affected the section editor, template editor, tag and webhook management, and the slideshow audio buttons. Thanks to @manuzzi, who reported three of them.
- In the administration interface, "Marketing emails" and "signed in as" could not be translated.

## [0.59.0] - 2026-08-07

_Pull + Rebuild genügt — nur Hauptserver. Keine `.env`-Änderung, keine Migration. Betrifft nur Instanzen mit Self-Service-Registrierung (`BILLING_ENABLED=true`). · Pull + rebuild is enough — main server only. No `.env` change, no migration. Only affects instances with self-service signup (`BILLING_ENABLED=true`)._

### Fixed

- Wer bereits als Mitglied in einem fremden Studio angelegt war, konnte kein eigenes Studio eröffnen — die Registrierung meldete „Diese E-Mail-Adresse ist bereits registriert." Die Sperre prüfte die Adresse instanzweit und traf damit genau den legitimen Fall. Sie greift jetzt nur noch, wenn die Adresse bereits **Inhaberin** eines bestehenden Studios ist. Mitglied oder Administrator anderswo zu sein steht einem eigenen Studio nicht mehr im Weg. Beim Anmelden erscheint dann wie gewohnt die Studio-Auswahl.
- „Passwort vergessen" blieb auf der Hauptdomain wirkungslos: ohne Studio-Adresse im Aufruf ließ sich kein Studio zuordnen, und es wurde stillschweigend keine Mail verschickt. Jetzt werden alle Studios ermittelt, in denen die Adresse aktiv ist, und je eine Mail verschickt — jede nennt das betreffende Studio. Auf zehn Mails gedeckelt.

**🇬🇧 English**

- Anyone who already existed as a member of someone else's studio could not create their own — signup reported "this email address is already registered". The check looked instance-wide and therefore blocked exactly the legitimate case. It now only applies when the address already **owns** an existing studio. Being a member or administrator elsewhere no longer stands in the way. At sign-in, the usual studio picker appears.
- "Forgot password" had no effect on the main domain: without a studio address in the request no studio could be resolved, and no email was sent, silently. All studios where the address is active are now found and each is sent its own email naming the studio in question. Capped at ten.

## [0.58.0] - 2026-08-07

_Pull + Rebuild genügt — nur Hauptserver. Keine `.env`-Änderung, keine Migration. Die Bildmarke in den Mails wird über `PUBLIC_URL` geladen; ist die falsch gesetzt, bleibt in Mails ein Platzhalter statt des Logos. · Pull + rebuild is enough — main server only. No `.env` change, no migration. The symbol in emails is loaded via `PUBLIC_URL`; if that is set incorrectly, emails will show a broken image instead of the logo._

### Added

- E-Mails zeigen jetzt die Bildmarke statt einer Textwortmarke. Als PNG, weil Gmail und Outlook kein SVG rendern, in doppelter Auflösung geliefert und halb angezeigt. Zwei Fassungen: auf einem farbigen Kopfbalken würde die orange Kachel im Untergrund verschwinden, dort greift eine einfarbig helle Variante.

**🇬🇧 English**

- Emails now show the symbol instead of a text wordmark. As PNG, because Gmail and Outlook do not render SVG, delivered at double resolution and displayed at half size. Two versions: on a coloured header bar the orange tile would vanish into the background, so a single-colour light variant is used there.

### Changed

- Die drei Print-Shop-Mails — Bestellbestätigung, Studio-Benachrichtigung, Versandmeldung — liefen bisher an der Gestaltung vorbei: kein Kopfbereich, kein Logo, keine Akzentfarbe. Sie nutzen jetzt dasselbe Layout wie alle anderen Mails und tragen damit dein Studio-Logo und deine Akzentfarbe. Ohne eigenes Logo erscheint die Lumio-Bildmarke.
- Hat dein Studio einen Namen, aber kein Logo hinterlegt, steht im Mail-Kopf weiterhin dein Name — dort erscheint bewusst *nicht* die Lumio-Marke.

**🇬🇧 English**

- The three print shop emails — order confirmation, studio notification, shipping notice — previously bypassed the design system entirely: no header, no logo, no accent colour. They now use the same layout as every other email and therefore carry your studio logo and accent colour. Without a custom logo, the Lumio symbol appears.
- If your studio has a name but no logo, the email header still shows your name — the Lumio symbol deliberately does *not* appear there.

## [0.57.0] - 2026-08-07

_Pull + Rebuild genügt — nur Hauptserver. Die Migration ändert nur Spalten-Defaults, keine Daten. **Sichtbar:** Studios ohne eigene Akzentfarbe zeigen danach Vermillion statt Amber — wie man Amber behält, steht unten. · Pull + rebuild is enough — main server only. The migration only changes column defaults, no data. **Visible:** studios without a custom accent colour will show vermillion instead of amber — see below on keeping amber._

### Changed

- Lumios Standard-Akzentfarbe ist Vermillion `#FF4D2E` statt Amber `#f59e0b` — passend zur Bildmarke. Das betrifft die Studio-Oberfläche, den Fokusring, die Lumio-eigenen E-Mail-Vorlagen und die Farbvorschläge für neue Brandings.
- **Deine Farbwahl bleibt.** Die Akzentfarbe des Studios liegt in `tenants.studioAccentColor` und ist leer, solange niemand unter *Gestaltung → Erscheinungsbild* etwas gesetzt hat. Nur diese leeren Fälle wechseln automatisch. Wer Amber behalten will, setzt dort einmal `#f59e0b` — dann bleibt es dabei, auch bei künftigen Updates.
- **Bestehende Galerien ändern sich nicht.** Die Farben eines Brandings stehen als Wert in der Datenbank; der neue Default gilt nur für Brandings, die ab jetzt angelegt werden. Wer seine Galerien mitziehen will, ändert die Akzentfarbe im Branding-Editor.
- Unberührt bleiben die Auto-Tag-Farben (*Hell*, *Vormittag*, *Lachen*, *Produkt*), die Autorenfarben in der Video-Annotation und die gelben Hinweisflächen in Proofing und Abrechnung — das ist Semantik, keine Markenfarbe.

**🇬🇧 English**

- Lumio's default accent colour is vermillion `#FF4D2E` instead of amber `#f59e0b`, matching the symbol. This affects the studio interface, the focus ring, Lumio's own email templates and the colour suggestions for new brandings.
- **Your own choice is kept.** The studio accent lives in `tenants.studioAccentColor` and stays empty until someone sets it under *Design → Appearance*. Only those empty cases switch automatically. To keep amber, set `#f59e0b` there once — it will then stay, including through future updates.
- **Existing galleries are unchanged.** A branding's colours are stored as values in the database; the new default only applies to brandings created from now on. To move your galleries along, change the accent colour in the branding editor.
- Untouched: the auto-tag colours (*bright*, *morning*, *laughter*, *product*), the author colours in video annotation, and the amber notice panels in proofing and billing — those are semantics, not brand.

## [0.56.1] - 2026-08-07

_Pull + Rebuild genügt — nur Hauptserver. Nach dem Deploy einmal hart neu laden, sonst hält der Browser das alte Favicon. · Pull + rebuild is enough — main server only. Do one hard reload afterwards, otherwise the browser keeps the cached favicon._

### Fixed

- Das Favicon folgt jetzt dem Browser-Theme. Die Kacheln der Bildmarke laufen auf `currentColor` und kippen per `prefers-color-scheme` auf Papier, sobald die Browserleiste dunkel ist. Vorher trugen sie feste Tinte — auf einer dunklen Leiste sind das 1,16 Kontrast, die Marke war dort praktisch unsichtbar. Die orange Kachel bleibt in beiden Fällen. Die PNG-Fallbacks bleiben unverändert; sie greifen nur in älteren Browsern, die ohnehin helle Leisten haben.

**🇬🇧 English**

- The favicon now follows the browser theme. The symbol's tiles run on `currentColor` and flip to paper via `prefers-color-scheme` once the browser chrome is dark. Previously they carried fixed ink — on a dark bar that is a contrast ratio of 1.16, leaving the mark all but invisible. The orange tile stays put in both cases. The PNG fallbacks are unchanged; they only apply in older browsers, which have light chrome anyway.

## [0.56.0] - 2026-08-07

_Pull + Rebuild genügt — nur Hauptserver. Keine `.env`-Änderung, keine Migration. · Pull + rebuild is enough — main server only. No `.env` change, no migration._

### Added

- Lumio hat eine eigene Bildmarke: vier Kacheln auf einem 2×2-Raster, diagonal angeschnitten — ein Kontaktbogen mit Auswahlschnitt. Sie liegt als SVG unter `apps/frontend/public/` (`mark.svg`, `logo.svg`, `wordmark.svg`, jeweils auch als `-inverse` für dunkle Flächen) plus Favicon-PNGs in 16/32/180/512 und `site.webmanifest`.
- Neue Komponente `Logo` (`@/components/ui`) mit den Varianten `mark` und `full`. Die Tinte läuft auf `currentColor`, der Akzent auf `--logo-accent` — das hängt an `--brand-accent` und damit an der Akzentfarbe, die im Studio unter *Gestaltung → Erscheinungsbild* gesetzt ist. Wer die Marke stattdessen fest in Lumio-Vermillion will, setzt `--logo-accent` in `globals.css` auf `#FF4D2E`. Die Wortmarke ist in Pfade gewandelt, es wird kein zusätzlicher Webfont geladen.

**🇬🇧 English**

- Lumio now has its own symbol: four tiles on a 2×2 grid with a diagonal cut through them — a contact sheet with a selection stroke. It ships as SVG under `apps/frontend/public/` (`mark.svg`, `logo.svg`, `wordmark.svg`, each also as `-inverse` for dark surfaces), plus favicon PNGs at 16/32/180/512 and `site.webmanifest`.
- New `Logo` component (`@/components/ui`) with `mark` and `full` variants. The ink follows `currentColor`, the accent follows `--logo-accent`, which is tied to `--brand-accent` and therefore to the accent colour configured in the studio under *Design → Appearance*. To pin the symbol to Lumio vermillion instead, set `--logo-accent` to `#FF4D2E` in `globals.css`. The wordmark is converted to outlines, so no additional webfont is loaded.

### Changed

- Favicon und Touch-Icon zeigen die neue Bildmarke statt des Platzhalters. Browser und iOS-Homescreen können das gecachte alte Icon noch eine Weile behalten — ein harter Reload hilft.
- Wo bisher der Text „Lumio" als Ersatz für ein fehlendes Studio-Logo stand (Studio-Kopfzeile, Login-Seite), steht jetzt die Bildmarke. Sie trägt dort weiterhin die Akzentfarbe des Studios, genau wie der Text vorher. Ein hochgeladenes Studio-Logo und ein gesetzter Tenant-Name haben unverändert Vorrang — an der Galerie-Gestaltung ändert sich nichts.

**🇬🇧 English**

- Favicon and touch icon now show the new symbol instead of the placeholder. Browsers and the iOS home screen may keep the cached old icon for a while — a hard reload helps.
- Where the plain text "Lumio" previously stood in for a missing studio logo (studio header, login page), the symbol now appears. It still carries the studio's accent colour there, exactly as the text did. An uploaded studio logo and a configured tenant name still take precedence — gallery branding is unchanged.

## [0.55.1] - 2026-08-06

_Pull + Rebuild genügt — nur Hauptserver. Wer `SMTP_REPLY_TO`, `SUPPORT_EMAIL` oder `FEEDBACK_EMAIL` in der `.env` gesetzt hat, sollte prüfen: diese Werte wirken erst ab dieser Version. · Pull + rebuild is enough — main server only. If you set `SMTP_REPLY_TO`, `SUPPORT_EMAIL` or `FEEDBACK_EMAIL` in your `.env`, note that those values only take effect from this version on._

### Fixed
- **`SMTP_REPLY_TO`, `SUPPORT_EMAIL` und `FEEDBACK_EMAIL` wurden nicht an den API-Container durchgereicht.** Die Variablen waren in `.env.example` dokumentiert und im Code ausgewertet, standen aber nicht im `environment`-Block der `docker-compose.yml` — Docker gibt nur weiter, was dort aufgeführt ist. Wer sie in der `.env` gesetzt hatte, bekam trotzdem das Verhalten ohne Wert: System-Mails ohne Kontaktadresse, kein Reply-To-Header, und das Support-Formular im Studio blieb ausgeblendet, weil `GET /instance` `supportFormEnabled: false` meldete. Betrifft `SMTP_REPLY_TO` rückwirkend seit seiner Einführung. · *`SMTP_REPLY_TO`, `SUPPORT_EMAIL` and `FEEDBACK_EMAIL` were not passed through to the API container. The variables were documented in `.env.example` and read by the code, but missing from the `environment` block in `docker-compose.yml` — Docker only forwards what is listed there. Anyone who set them in `.env` still got the no-value behaviour: system emails without a contact address, no Reply-To header, and the studio support form stayed hidden because `GET /instance` reported `supportFormEnabled: false`. Affects `SMTP_REPLY_TO` retroactively since it was introduced.*

## [0.55.0] - 2026-08-06

_Pull + Rebuild genügt — nur Hauptserver (API + Frontend), keine Migration. Das Support-Formular erscheint nur in SaaS-Instanzen (`BILLING_ENABLED`) mit gesetzter `SUPPORT_EMAIL` bzw. `SMTP_REPLY_TO`; selbstgehostete Instanzen sind unverändert. · Pull + rebuild is enough — main server only (API + frontend), no migration. The support form only appears on SaaS instances (`BILLING_ENABLED`) with `SUPPORT_EMAIL` or `SMTP_REPLY_TO` configured; self-hosted instances are unchanged._

### Added
- **Support-Formular im Studio.** Über den Sidebar-Eintrag „Support" lässt sich aus jeder Seite des Studios eine Anfrage schreiben, ohne den Mail-Client zu wechseln. Weil der Absender eingeloggt ist, hängt die API den Kontext selbst an: Studio-Name, Plan und Abo-Status, Rolle, Tenant-Status, Lumio-Version und die Seite, von der aus geschrieben wurde. Das sind genau die Rückfragen, die sonst eine Runde kosten — und die Absender meist nicht beantworten können. Bild- und Galerie-Inhalte werden nicht mitgesendet; der Hinweis darauf steht im Formular. Die Antwortadresse ist mit der Login-Mail vorbelegt und optional überschreibbar. · *Support form in the studio. A "Support" entry in the sidebar lets users send a request from any studio page without switching to their mail client. Because the sender is logged in, the API attaches the context itself: studio name, plan and subscription status, role, tenant status, Lumio version and the page it was sent from. Those are exactly the follow-up questions that otherwise cost a round trip — and that senders usually can't answer. No image or gallery content is included; the form says so. The reply address is pre-filled with the login email and can optionally be overridden.*
- **`GET /instance` meldet `supportFormEnabled`.** Damit weiß das Frontend, ob der Support-Button überhaupt sinnvoll ist. False bei Self-Hosting und auch dann, wenn keine Zieladresse konfiguriert ist — ein Formular, das ins Leere läuft, ist schlimmer als keins. · *`GET /instance` now reports `supportFormEnabled`, so the frontend knows whether the support button makes sense at all. False for self-hosting, and also when no destination address is configured — a form that goes nowhere is worse than none.*

### Changed
- **`sendMail()` meldet jetzt, ob der Versand geklappt hat.** Bisher schluckte die Funktion Fehler und gab nichts zurück, was für die meisten Aufrufer richtig ist (eine fehlgeschlagene Benachrichtigung soll keine Galerie-Erstellung abbrechen). Bei Support-Anfragen gibt es aber kein Auffangnetz in der Datenbank: geht die Mail nicht raus, ist die Anfrage weg. Der Endpoint antwortet deshalb mit einem Fehler statt mit „gesendet", und der Absender erfährt, dass er einen anderen Weg nehmen muss. Ein nicht konfiguriertes SMTP gilt bewusst nicht als Erfolg. Für alle bestehenden Aufrufer ändert sich nichts. · *`sendMail()` now reports whether delivery succeeded. It previously swallowed errors and returned nothing, which is right for most callers (a failed notification shouldn't abort gallery creation). Support requests have no fallback in the database, though: if the mail doesn't go out, the request is gone. The endpoint therefore returns an error instead of "sent", so the sender knows to take another route. An unconfigured SMTP deliberately does not count as success. Nothing changes for existing callers.*

## [0.54.0] - 2026-08-02

_Pull + Rebuild genügt — nur Hauptserver (API + Frontend), keine Migration. Zwei neue **optionale** Envs (`SUPPORT_EMAIL`, `FEEDBACK_EMAIL`), ohne die sich nur der Wortlaut der System-Mails ändert. · Pull + rebuild is enough — main server only (API + frontend), no migration. Two new **optional** envs (`SUPPORT_EMAIL`, `FEEDBACK_EMAIL`); without them only the wording of system emails changes._

### Added
- **Kontaktadressen in System-Mails sind jetzt konfigurierbar (`SUPPORT_EMAIL`, `FEEDBACK_EMAIL`).** Bisher nannten Willkommens-, Lösch- und Print-Shop-Mails fest `support@lumio-cloud.de` bzw. `feedback@lumio-cloud.de` — bei Self-Hostern also eine fremde Adresse, an die sich deren Kundinnen und Kunden gewandt hätten. Ohne eigenen Wert fällt `SUPPORT_EMAIL` auf die Adresse aus `SMTP_REPLY_TO` zurück und `FEEDBACK_EMAIL` auf `SUPPORT_EMAIL`; ist gar nichts gesetzt, nennen die Mails keine Kontaktadresse mehr statt einer falschen. · *Contact addresses in system emails are now configurable (`SUPPORT_EMAIL`, `FEEDBACK_EMAIL`). Previously the welcome, deletion and print-shop emails hard-coded `support@lumio-cloud.de` and `feedback@lumio-cloud.de` — for self-hosters a third-party address their own clients would have written to. Without an explicit value, `SUPPORT_EMAIL` falls back to the address from `SMTP_REPLY_TO` and `FEEDBACK_EMAIL` to `SUPPORT_EMAIL`; if nothing is set, the emails name no contact address instead of a wrong one.*

### Changed
- **Beantragt ein Studio seine Löschung, gehen alle öffentlichen Inhalte sofort offline.** Bisher blieben Galerien, Freigabe- und Upload-Links während der 60-tägigen Karenzphase erreichbar. Aufbewahren für das Undo-Fenster und Weiter-Veröffentlichen sind aber zwei verschiedene Dinge — nach einem Löschantrag (DSGVO Art. 17) lässt sich nur das Erste rechtfertigen. Betroffen sind Galerie-Ansicht, Downloads, ZIPs, Proofing, Print-Shop und Gast-Uploads; Besucher sehen die neutrale „Nicht verfügbar"-Seite. Die Daten bleiben vollständig erhalten: Wird die Löschung zurückgenommen, sind alle Galerien unverändert wieder erreichbar. Studio-Login bleibt während der Karenzphase möglich (read-only), damit der Owner die Löschung zurücknehmen kann. · *When a studio requests deletion, all public content now goes offline immediately. Previously galleries, share links and upload links stayed reachable throughout the 60-day grace period. But retaining data for the undo window and continuing to publish it are two different things — after a deletion request (GDPR Art. 17) only the former is justifiable. This affects the gallery view, downloads, ZIPs, proofing, print shop and guest uploads; visitors see the neutral "not available" page. The data is fully retained: if the deletion is undone, every gallery becomes reachable again unchanged. Studio login stays possible during the grace period (read-only) so the owner can undo the deletion.*
- **System-Mails versprechen keinen Rückkanal mehr, den es nicht gibt.** Willkommens-Mail, Trial-Erinnerung und Trial-Abbruch-Mail luden pauschal dazu ein, „einfach auf diese Mail zu antworten" — bei einem `SMTP_FROM` ohne Postfach dahinter liefen diese Antworten ins Leere, ohne dass der Absender es merkte. Der Wortlaut richtet sich jetzt danach, was konfiguriert ist: mit `SMTP_REPLY_TO` bleibt die Einladung zum Antworten, sonst wird auf die Support-Adresse verwiesen, und ohne beides entfällt der Satz. · *System emails no longer promise a reply channel that does not exist. The welcome, trial-reminder and trial-cancelled emails unconditionally invited recipients to "just reply to this email" — with an `SMTP_FROM` that has no mailbox behind it, those replies vanished without the sender noticing. The wording now follows the configuration: with `SMTP_REPLY_TO` the invitation to reply stays, otherwise the support address is referenced, and without either the sentence is dropped.*
- **Der Lösch-Dialog sagt jetzt, was mit den Galerien passiert.** Danger-Zone, Bestätigungs-Modal, Karenz-Banner und die Bestätigungs-Mail weisen explizit darauf hin, dass Galerien sofort offline gehen und beim Zurücknehmen sofort wieder erreichbar sind. Die Mail behauptete bisher das Gegenteil. · *The deletion dialog now says what happens to the galleries. The danger zone, confirmation modal, grace-period banner and confirmation email now explicitly state that galleries go offline immediately and become reachable again as soon as the deletion is undone. The email previously claimed the opposite.*

### Fixed
- **Endkunden-Routen prüften den Studio-Status nicht vollständig.** Galerie-Entsperrung (`POST /g/:slug/unlock`) und Gast-Upload-Links liefen auch dann noch, wenn das Studio gesperrt oder archiviert war — die Galerie-Ansicht selbst war bereits gesperrt, die dahinterliegenden Endpunkte aber nicht. Alle Endkunden-Pfade prüfen den Status jetzt einheitlich. · *Customer-facing routes did not fully check studio status. Gallery unlock (`POST /g/:slug/unlock`) and guest upload links still worked while a studio was suspended or archived — the gallery view itself was already blocked, but the endpoints behind it were not. All customer-facing paths now check the status consistently.*

## [0.53.1] - 2026-07-27

_Pull + Rebuild genügt — nur Hauptserver (Frontend), keine Migration. · Pull + rebuild is enough — main server only (frontend), no migration._

### Changed
- **Uploads laufen jetzt in zwei Lanes: Bilder blockieren nicht mehr hinter Videos.** Bisher teilten sich alle Dateien vier Upload-Slots — drei Videos konnten drei davon über Minuten belegen, während viele kleine Bilder einzeln durchtröpfelten. Jetzt laden bis zu 4 Bilder und parallel dazu bis zu 2 Videos/große Dateien (Multipart) gleichzeitig hoch. Der Modus „Langsame Verbindung?" bleibt unverändert strikt seriell. · *Uploads now run in two lanes: images no longer queue behind videos. Previously all files shared four upload slots — three videos could occupy three of them for minutes while many small images trickled through one by one. Now up to 4 images upload in parallel with up to 2 videos/large files (multipart). The "slow connection" mode remains strictly serial.*

### Fixed
- **Upload-Anzeige konnte trotz fertiger Dateien für immer „aktiv" bleiben.** Ein interner Weckmechanismus merkte sich nur den zuletzt wartenden Upload-Slot — gingen zwei Slots gleichzeitig in den Wartezustand, wurde einer nie wieder geweckt und die Upload-Liste wurde nie als abgeschlossen gemeldet. · *The upload panel could stay "active" forever despite all files being done. An internal wake-up mechanism only remembered the most recently waiting upload slot — if two slots went idle at the same time, one was never woken again and the upload list never reported completion.*

## [0.53.0] - 2026-07-21

_Pull + Rebuild. **Betrifft den Worker: Hauptserver UND alle Worker-Nodes neu bauen** (Nodes nach dem Hauptserver). Keine Migration, neue optionale Envs `WORKER_FAST_CONCURRENCY`. · Pull + rebuild. **Affects the worker: rebuild main server AND all worker nodes** (nodes after the main server). No migration, new optional env `WORKER_FAST_CONCURRENCY`._

### Changed
- **Video-/KI-Jobs können die Bildverarbeitung nicht mehr blockieren.** Bisher teilten sich alle Job-Typen dieselben Worker-Slots — wenige parallele Video-Transcodings plus Auto-Tagging konnten die komplette Kapazität belegen, und selbst simple Bild-Thumbnails hingen minutenlang auf „Wird verarbeitet". Der Worker startet jetzt zwei Lanes: eine schnelle für Bild-Renditions/ZIPs/Webhooks (`WORKER_FAST_CONCURRENCY`, Default 2) und eine schwere für Video/RAW/KI-Tagging (`WORKER_CONCURRENCY`, Default 4). Setups mit explizit gesetztem `WORKER_QUEUES` (Multi-Node-Worker) behalten unverändert einen Prozess mit genau diesen Queues. · *Video/AI jobs can no longer starve image processing. Previously all job types shared the same worker slots — a few parallel video transcodes plus auto-tagging could occupy the entire capacity, leaving even simple image thumbnails stuck on "processing" for minutes. The worker now runs two lanes: a fast one for image renditions/ZIPs/webhooks (`WORKER_FAST_CONCURRENCY`, default 2) and a heavy one for video/RAW/AI tagging (`WORKER_CONCURRENCY`, default 4). Setups with an explicit `WORKER_QUEUES` (multi-node workers) keep a single process with exactly those queues, unchanged.*

## [0.52.3] - 2026-07-21

_Pull + Rebuild genügt — nur Hauptserver (Frontend), keine Migration. Erstes Release mit Smoke-Test-Gate: der Quick-Start-Pfad dieses Stands wurde vor dem Tag automatisch auf GitHub Actions verifiziert. · Pull + rebuild is enough — main server only (frontend), no migration. First release with the smoke-test gate: this build's quick-start path was automatically verified on GitHub Actions before tagging._

### Added
- **CI-Smoke-Test für den Quick Start** (`.github/workflows/smoke-test.yml`): Bei jedem Push/PR wird der komplette Self-Hoster-Pfad auf GitHub Actions nachgestellt — frischer Checkout, `.env` exakt nach README, `docker compose up`, Health über Caddy (Port 80) inkl. Versions-Abgleich, `create-admin`, Login über HTTP (Session-Cookie), Galerie anlegen, Upload-Presign (Assertion: URL zeigt nie auf den internen Docker-Host) und ein echter PUT auf die presigned URL. Fängt die Bug-Klassen des Quick-Start-Testtags künftig vor dem Release. · *CI smoke test for the quick start: on every push/PR, GitHub Actions replays the full self-hosting path — fresh checkout, `.env` exactly as per README, `docker compose up`, health via Caddy (port 80) incl. version check, `create-admin`, login over HTTP (session cookie), gallery creation, upload presign (asserting the URL never points at the internal Docker host) and a real PUT to the presigned URL. Catches the quick-start bug classes before they reach a release.*


### Fixed
- **Videos „verschwanden" nach einem Reload scheinbar aus der Verarbeitung.** Video-Poster entstehen früh — nach einem Seiten-Reload sah die Kachel im Studio deshalb fertig aus, obwohl der Worker (z.B. HLS-Transcoding) noch rechnete und die Datei in geteilten Links noch fehlte. Jetzt tragen auch Kacheln mit Thumbnail ein „in Arbeit"-Badge mit Spinner, und über der Dateiliste zeigt ein Zähler „N in Verarbeitung" mit Erklärung (Tooltip), dass diese Dateien in geteilten Links automatisch erscheinen, sobald sie fertig sind. Die Liste aktualisiert sich dabei wie bisher alle 10 Sekunden von selbst. Außerdem waren die Kachel-Badges „Fehler" und „versteckt" hartkodiert deutsch und sind jetzt übersetzt. · *Videos seemingly "disappeared" from processing after a reload. Video posters are written early — after a page reload the studio tile looked finished although the worker (e.g. HLS transcoding) was still running and the file was still missing from shared links. Tiles with a thumbnail now carry a "processing" badge with a spinner, and a counter above the file list shows "N processing" with an explanation (tooltip) that these files appear in shared links automatically once ready. The list keeps auto-refreshing every 10 seconds as before. Also, the "error" and "hidden" tile badges were hard-coded German and are now translated.*

## [0.52.2] - 2026-07-21

_Pull + Rebuild genügt — nur Hauptserver (Frontend), keine Migration. · Pull + rebuild is enough — main server only (frontend), no migration._

### Fixed
- **„Alle herunterladen" / „Alle als Web-Version" in der Kundenansicht zeigte keine Reaktion.** Das Herunterladen-Dropdown schloss sich bei jedem Klick auf einen Menüpunkt sofort selbst und warf dabei den Zustand der Download-Buttons weg — der ZIP-Build wurde zwar serverseitig angestoßen, aber Spinner und der fertige Download-Link waren nie zu sehen. Das Menü bleibt jetzt beim Klick auf Einträge offen und behält den Fortschritt auch, wenn es zwischendurch geschlossen wird (laufende Builds und fertige Links sind beim Wiederöffnen noch da). · *"Download all" / "All as web version" in the customer view showed no reaction. The download dropdown closed itself on every click on a menu item, discarding the download buttons' state — the ZIP build was started server-side, but the spinner and the finished download link were never visible. The menu now stays open when clicking entries and keeps progress even when closed in between (running builds and finished links are still there on reopen).*

## [0.52.1] - 2026-07-21

_Pull + Rebuild genügt — nur Hauptserver (API), keine Migration. **Wichtig für Setups mit externem S3 ohne `S3_PUBLIC_URL`: dieses Update stellt die Bildanzeige wieder her.** · Pull + rebuild is enough — main server only (API), no migration. **Important for setups with external S3 and no `S3_PUBLIC_URL`: this update restores image display.**_

### Fixed
- **Bilder in Produktions-Setups mit externem S3 (z.B. Hetzner Object Storage) waren nach v0.51.0 kaputt.** Der in 0.51.0 eingeführte Presign-Fallback auf `http://<request-host>:9000` griff immer, sobald `S3_PUBLIC_URL` nicht gesetzt war — auch wenn `S3_ENDPOINT` bereits öffentlich erreichbar ist. Presigned URLs zeigten dann auf einen toten Port statt auf das externe S3; weder Logos noch Galeriebilder luden. Jetzt greift der Fallback nur noch bei intern erreichbaren Endpoints (Docker-Servicename wie `minio`, localhost, private IP); öffentliche Endpoints werden wie vor 0.51.0 direkt verwendet. Der Quick Start bleibt unverändert konfigurationsfrei. · *Images broken after v0.51.0 in production setups with external S3 (e.g. Hetzner Object Storage). The presign fallback to `http://<request-host>:9000` introduced in 0.51.0 kicked in whenever `S3_PUBLIC_URL` was unset — even when `S3_ENDPOINT` is already publicly reachable. Presigned URLs then pointed at a dead port instead of the external S3; neither logos nor gallery images loaded. The fallback now only applies to internally-reachable endpoints (Docker service name like `minio`, localhost, private IP); public endpoints are used directly as before 0.51.0. Quick start remains zero-config.*

## [0.52.0] - 2026-07-21

_Pull + Rebuild genügt — nur Hauptserver (API), keine Migration. Neue optionale Envs: `FEATURES_ENABLED`, `PRINT_PROVIDERS_ENABLED`. · Pull + rebuild is enough — main server only (API), no migration. New optional envs: `FEATURES_ENABLED`, `PRINT_PROVIDERS_ENABLED`._

### Added
- **Feature-Flags und Print-Provider self-hosted per Env aktivierbar.** Bisher waren alle Feature-Flags (`print_shop`, `lightroom_plugin`, `advanced_analytics`, `ai_tagging`, `video_streaming_4k`) und die Print-Provider-Freischaltung nur über das Super-Admin-UI erreichbar — das es im Single-Mode nicht gibt. Self-Hoster konnten diese Features also nie einschalten. Neu: `FEATURES_ENABLED=print_shop,…` und `PRINT_PROVIDERS_ENABLED=prodigi,gelato` in der `.env` aktivieren sie global; ein expliziter Super-Admin-Override (Multi-Mode) gewinnt weiterhin, auch zum Deaktivieren. Self-Print ist unverändert immer verfügbar. Unbekannte Keys werden beim Start mit Warnung ignoriert. Doku: SELFHOSTING + PRINT_SHOP (DE/EN). · *Feature flags and print providers can now be enabled via env when self-hosting. Previously all feature flags and the print-provider platform activation were only reachable through the super admin UI — which doesn't exist in single mode, so self-hosters could never enable these features. New: `FEATURES_ENABLED=print_shop,…` and `PRINT_PROVIDERS_ENABLED=prodigi,gelato` in `.env` enable them globally; an explicit super-admin override (multi mode) still wins, including for disabling. Self print remains always available. Unknown keys are ignored with a startup warning. Docs: SELFHOSTING + PRINT_SHOP (DE/EN).*

## [0.51.2] - 2026-07-21

_Pull + Rebuild genügt — nur Hauptserver (Frontend), keine Migration. · Pull + rebuild is enough — main server only (frontend), no migration._

### Added
-

### Changed
- Doku-Nachzug zum Quick-Start-Testtag: SELFHOSTING (DE+EN) empfahl für `S3_PUBLIC_URL` ein **funktional kaputtes** Pfad-Präfix (`…/s3` — MinIO kann wegen der V4-Signatur kein Path-Rewriting) und unterschlug `LUMIO_S3_HOST`; jetzt korrektes Subdomain-Setup inkl. DNS-Hinweis. REQUIREMENTS (DE+EN) nennt Port 9000 für Setups ohne S3-Subdomain. DEVELOPMENT-Troubleshooting (DE+EN) zum „DNS error: minio" auf den v0.51.0-Auto-Fallback aktualisiert. WILDCARD (DE+EN) erklärt den Caddy-Start-Fallback ohne `acmedns.json`. · *Docs follow-up to the Quick Start test day: SELFHOSTING (DE+EN) recommended a functionally broken path prefix for `S3_PUBLIC_URL` (`…/s3` — MinIO can't do path rewriting due to V4 signatures) and omitted `LUMIO_S3_HOST`; now documents the correct subdomain setup incl. DNS note. REQUIREMENTS (DE+EN) lists port 9000 for setups without an S3 subdomain. DEVELOPMENT troubleshooting (DE+EN) for "DNS error: minio" updated to the v0.51.0 auto-fallback. WILDCARD (DE+EN) explains the Caddy startup fallback without `acmedns.json`.*

### Fixed
- **Einheitliche Breadcrumbs („Studio / …") auf allen Studio-Seiten.** Team, Mein Konto, Plan & Speicher, Datenexport (Liste + Detail) und Analytics hatten gar keinen Breadcrumb; die Gestaltungs-Seiten hatten unterschiedliche Tiefen (Studio-Login mit zusätzlicher Zwischenebene). Jetzt überall dasselbe Schema: Bereichsseiten „Studio / Seite", Detailseiten „Studio / Liste / Element". Nebenbei mehrere hartkodierte Breadcrumb-Texte („Studio", „Templates", „Smart Collections", „Smart Collection bearbeiten") auf i18n umgestellt — sie waren bisher in der englischen Oberfläche deutsch. · *Consistent breadcrumbs ("Studio / …") on all studio pages. Team, My Account, Plan & Storage, Data Export (list + detail) and Analytics had no breadcrumb at all; the design pages had inconsistent depths (Studio Login with an extra intermediate level). Now the same scheme everywhere: section pages "Studio / Page", detail pages "Studio / List / Item". Also converted several hard-coded breadcrumb strings ("Studio", "Templates", "Smart Collections", edit title) to i18n — they previously appeared in German even in the English UI.*

## [0.51.1] - 2026-07-21

_Pull + Rebuild genügt — nur Hauptserver (API + Frontend), keine Migration. · Pull + rebuild is enough — main server only (API + frontend), no migration._

### Fixed
- **Der AV-Vertrag (AVV) wird self-hosted nicht mehr angezeigt.** Der AVV nach Art. 28 DSGVO betrifft nur die gehostete Cloud-Variante (Studio ↔ Anbieter als Auftragsverarbeiter); self-hosted ist der Betreiber selbst Verantwortlicher. Der Menüpunkt unter Einstellungen ist ohne Billing jetzt ausgeblendet, die AVV-API-Routen sind nicht registriert, und Direktaufrufe der Seite (Bookmarks) zeigen einen erklärenden Hinweis statt Fehlern. · *The data processing agreement (DPA) is no longer shown when self-hosted. The Art. 28 GDPR DPA only applies to the hosted cloud offering (studio ↔ provider as processor); self-hosted, the operator is the controller themselves. The settings menu item is now hidden without billing, the DPA API routes are not registered, and direct page visits (bookmarks) show an explanatory note instead of errors.*

## [0.51.0] - 2026-07-21

_Pull + Rebuild genügt — nur Hauptserver (API + Frontend), keine Migration. Quick-Start-/IP-Setups: Port 9000 in der Cloud-Firewall öffnen (Direct-to-S3). · Pull + rebuild is enough — main server only (API + frontend), no migration. Quick Start / IP setups: open port 9000 in your cloud firewall (direct-to-S3)._

### Added
- **Konto → Plan & Speicher funktioniert jetzt auch self-hosted (GitHub-Feedback).** Statt „Route not found" zeigt die Seite ohne Billing eine Self-Hosted-Info („keine Plan-Limits") plus den tatsächlichen Speicherverbrauch (Originale und abgeleitete Dateien getrennt). Dafür zwei neue, immer verfügbare API-Endpoints: `GET /api/v1/instance` (Instanz-Flags) und `GET /api/v1/account/storage` (Verbrauch des eigenen Studios). · *Account → Plan & Storage now works self-hosted too (GitHub feedback). Instead of "Route not found", the page without billing shows a self-hosted note ("no plan limits") plus actual storage usage (originals and derived files separately). Backed by two new always-available API endpoints: `GET /api/v1/instance` (instance flags) and `GET /api/v1/account/storage` (your studio's usage).*

### Changed
- Quick Start (README DE+EN): Der Zugriff über `http://<server-ip>` ist jetzt explizit als gleichwertiger Weg neben `http://localhost` dokumentiert, inkl. Hinweis auf erzwungene HTTPS-Upgrades mancher Browser. · *Quick Start (README DE+EN): access via `http://<server-ip>` is now explicitly documented as an equivalent path alongside `http://localhost`, incl. a note on some browsers forcing HTTPS upgrades.*

### Fixed
- **Uploads und Bild-Anzeige schlugen ohne gesetztes `S3_PUBLIC_URL` immer sofort fehl — in jedem Quick-Start-Setup.** Presigned URLs fielen auf den internen `S3_ENDPOINT` (`http://minio:9000`) zurück, einen Container-DNS-Namen, den kein Browser auflösen kann. Die API signiert jetzt automatisch auf `http://<aufgerufener-host>:9000` (localhost, Server-IP oder Domain — je nachdem, worüber man zugreift; Port konfigurierbar über `MINIO_API_PORT`). Setups mit gesetztem `S3_PUBLIC_URL` (eigene S3-Domain hinter TLS) sind unverändert. Wichtig: Port 9000 muss in der Cloud-Firewall offen sein — steht jetzt im Quick Start. · *Uploads and image display always failed immediately without `S3_PUBLIC_URL` set — in every Quick Start setup. Presigned URLs fell back to the internal `S3_ENDPOINT` (`http://minio:9000`), a container DNS name no browser can resolve. The API now automatically signs against `http://<requested-host>:9000` (localhost, server IP or domain — whichever you're using; port configurable via `MINIO_API_PORT`). Setups with `S3_PUBLIC_URL` set (own S3 domain behind TLS) are unchanged. Important: port 9000 must be open in your cloud firewall — now documented in the Quick Start.*

## [0.50.1] - 2026-07-21

_Pull + Rebuild genügt — nur Hauptserver, keine Migration. · Pull + rebuild is enough — main server only, no migration._

### Fixed
- **Verwirrende Compose-Warnung `The "ACME_DNS_BIND_IP" variable is not set` bei jedem `docker compose`-Aufruf beseitigt** — die Variable hat jetzt einen harmlosen Default (127.0.0.1); der acme-dns-Container startet ohne `--profile wildcard` ohnehin nicht. Für aktives Wildcard-TLS muss weiterhin die externe Server-IP gesetzt sein. Außerdem erklärt der Quick Start im README jetzt explizit, dass Updates `docker compose up -d --build` brauchen (Fixes stecken oft in den Images; ein bloßes `up -d` fährt die alten weiter). · *Removed the confusing Compose warning `The "ACME_DNS_BIND_IP" variable is not set` on every `docker compose` invocation — the variable now has a harmless default (127.0.0.1); the acme-dns container doesn't start without `--profile wildcard` anyway. Active wildcard TLS still requires the external server IP. The README Quick Start now also states explicitly that updates need `docker compose up -d --build` (fixes often live inside the images; a plain `up -d` keeps running the old ones).*

## [0.50.0] - 2026-07-21

_Für die meisten genügt Pull + Rebuild (nur Hauptserver, keine Migration). Betreiber der Marketing-Site-Blöcke: siehe ⚠️ Upgrade-Hinweise unten. · For most, pull + rebuild is enough (main server only, no migration). Operators of the marketing-site blocks: see ⚠️ upgrade notes below._

### Changed
- **Die Marketing-Site-Blöcke im Caddyfile (`lumio-cloud.de`, `lumio-app.de`, `lumio-cloud.com`, `www.lumio-cloud.com`) sind jetzt env-gesteuert und standardmäßig inaktiv.** Bisher waren diese Domains hart kodiert — jede frische Installation startete dadurch sofort Let's-Encrypt-Challenges für fremde Domains (Log-Spam, sinnloser Traffic). Ohne die neuen Variablen sind die Blöcke tot und Caddy holt keine Zertifikate dafür; normale Self-Hoster müssen nichts tun. · *The marketing-site blocks in the Caddyfile (`lumio-cloud.de`, `lumio-app.de`, `lumio-cloud.com`, `www.lumio-cloud.com`) are now env-driven and inactive by default. These domains used to be hard-coded — every fresh installation immediately started Let's Encrypt challenges for foreign domains (log spam, pointless traffic). Without the new variables the blocks are dead and Caddy fetches no certificates for them; regular self-hosters don't need to do anything.*

### ⚠️ Upgrade-Hinweise · Upgrade notes
Nur relevant, wenn du die Marketing-Site-Blöcke aktiv nutzt (Astro-/Nginx-Container am selben Caddy) — für alle anderen genügt Pull + Rebuild. Vor dem Rebuild in der `.env` die Domains setzen, sonst liefert Caddy die Marketing-Sites nicht mehr aus:

```
LUMIO_MARKETING_CLOUD_DE_HOST=lumio-cloud.de
LUMIO_MARKETING_APP_DE_HOST=lumio-app.de
LUMIO_MARKETING_CLOUD_COM_HOST=lumio-cloud.com
LUMIO_MARKETING_CLOUD_COM_WWW_HOST=www.lumio-cloud.com
```

*Only relevant if you actively use the marketing-site blocks (Astro/Nginx containers on the same Caddy) — for everyone else pull + rebuild is enough. Set the domains in `.env` before rebuilding, otherwise Caddy will stop serving the marketing sites.*

## [0.49.3] - 2026-07-21

_Pull + Rebuild genügt — nur Hauptserver (Caddy-Image wird neu gebaut, ~1–2 s Proxy-Unterbrechung), keine Migration. · Pull + rebuild is enough — main server only (Caddy image is rebuilt, ~1–2 s proxy interruption), no migration._

### Fixed
- **Caddy startete auf frischen Installationen nie — `ERR_CONNECTION_REFUSED` auf Port 80.** Drei übereinanderliegende Ursachen, die auf bestehenden Setups (mit gesetzten Hosts + vorhandener acme-dns-Datei) nie sichtbar wurden: (1) Das Compose übergab `LUMIO_HOST` als *leere* Variable — Caddys `{$VAR:default}` greift aber nur bei *ungesetzter*, ein leerer Site-Key bricht den Start. (2) Die toten Default-Adressen von Wildcard- und Umami-Block kollidierten beide auf `127.0.0.1:9` („ambiguous site definition"; TLS-Policies sind Host-basiert, daher jetzt eigene Loopback-IPs pro Block). (3) Das acme-dns-Plugin lädt seine Credentials-Datei bereits beim Caddy-Start — auf frischen Clones existiert `secrets/acmedns.json` nicht (gitignored); der neue Caddy-Entrypoint fällt dann auf eine eingebackene Dummy-Datei zurück. Bestehende Setups: kein Eingriff nötig, Pull + Rebuild genügt; gesetzte Hosts und eine vorhandene `acmedns.json` werden unverändert genutzt. · *Caddy never started on fresh installations — `ERR_CONNECTION_REFUSED` on port 80. Three stacked causes, invisible on existing setups (hosts set + acme-dns file present): (1) Compose passed `LUMIO_HOST` as an* empty *variable — Caddy's `{$VAR:default}` only applies when* unset*, and an empty site key breaks startup. (2) The dead default addresses of the wildcard and Umami blocks both collided on `127.0.0.1:9` ("ambiguous site definition"; TLS policies are host-based, hence distinct loopback IPs per block now). (3) The acme-dns plugin loads its credentials file at Caddy startup — on fresh clones `secrets/acmedns.json` doesn't exist (gitignored); the new Caddy entrypoint falls back to a baked-in dummy file. Existing setups: no action needed, pull + rebuild is enough; configured hosts and an existing `acmedns.json` are used unchanged.*

## [0.49.2] - 2026-07-21

_Pull + Rebuild genügt — nur Hauptserver (API), keine Migration. · Pull + rebuild is enough — main server only (API), no migration._

### Fixed
- **Login über die Server-IP (`http://<ip>`) hielt keine Session — man war sofort wieder ausgeloggt.** Das Session-Cookie wurde immer mit `Secure`-Flag gesetzt; Browser akzeptieren das auf `http://localhost`, verwerfen es aber auf einer nackten IP ohne TLS. Das Flag folgt jetzt dem tatsächlichen Protokoll (`X-Forwarded-Proto`): HTTPS-Setups behalten `Secure` unverändert, reiner HTTP-Zugriff (Quick-Start-Test über IP) funktioniert jetzt. Kein Eingriff nötig: Pull + Rebuild genügt. · *Login via the server IP (`http://<ip>`) didn't keep a session — you were logged out immediately. The session cookie was always set with the `Secure` flag; browsers accept that on `http://localhost` but drop it on a bare IP without TLS. The flag now follows the actual protocol (`X-Forwarded-Proto`): HTTPS setups keep `Secure` unchanged, plain HTTP access (Quick Start testing via IP) now works. No action needed: pull + rebuild is enough.*

## [0.49.1] - 2026-07-21

_Pull + Rebuild genügt — nur Hauptserver (Frontend), keine Migration. · Pull + rebuild is enough — main server only (frontend), no migration._

### Fixed
- **Kryptischer „JSON.parse: unexpected character"-Fehler beim Login, wenn die API nicht erreichbar war (GitHub-Issue #3).** Trat v.a. im Quick Start auf, wenn statt Port 80 (Caddy-Proxy) der Frontend-Port 3000 direkt aufgerufen wurde — etwa per SSH-Tunnel. Drei Verbesserungen: (1) Das Frontend zeigt bei Nicht-JSON-Antworten (HTML-404/502) jetzt eine verständliche Fehlermeldung mit Lösungshinweis. (2) Der Frontend-Port proxied `/api/*` und `/health` nun selbst als Fallback zur API — Direktzugriff auf Port 3000 funktioniert damit. (3) README und TROUBLESHOOTING erklären den richtigen Zugang (Port 80) inkl. SSH-Tunnel-Beispiel. Kein Eingriff nötig: Pull + Rebuild genügt. · *Cryptic "JSON.parse: unexpected character" error on login when the API was unreachable (GitHub issue #3). Occurred mainly in the Quick Start when the frontend port 3000 was accessed directly instead of port 80 (Caddy proxy) — e.g. via SSH tunnel. Three improvements: (1) the frontend now shows a descriptive error with a fix hint on non-JSON responses (HTML 404/502); (2) the frontend port itself now proxies `/api/*` and `/health` to the API as a fallback, so direct access to port 3000 works; (3) README and TROUBLESHOOTING explain the intended entry point (port 80) incl. an SSH tunnel example. No action needed: pull + rebuild is enough.*

## [0.49.0] - 2026-07-20

Pull genügt — kein manueller Eingriff nötig. Die neue Env-Variable `SMTP_REPLY_TO` ist optional. · *Pull is enough — no manual intervention required. The new `SMTP_REPLY_TO` env variable is optional.*

### Added
- **Antwortadresse für ausgehende Mails (`SMTP_REPLY_TO`).** Neue optionale Env-Variable: Wenn gesetzt, bekommt jede Mail einen Reply-To-Header — Empfänger können auch bei einem noreply-Absender einfach auf die Mail antworten und erreichen dich. Ohne den Wert ändert sich nichts. Format wie `SMTP_FROM`, z.B. `"Support <support@deine-domain.de>"`. · **🇬🇧 Reply address for outgoing mail (`SMTP_REPLY_TO`).** New optional env variable: when set, every email carries a Reply-To header — recipients can simply reply even when the sender is a no-reply address. Without the value, nothing changes. Same format as `SMTP_FROM`, e.g. `"Support <support@your-domain.com>"`.

### Fixed
- **Trial-Reminder respektiert Stripe-verwaltete Trials.** Der Sweeper schickt keine eigene Trial-Erinnerung mehr für Abos, deren Trial von Stripe verwaltet wird — dort verschickt Stripe bereits eigene Hinweise, Doppel-Mails entfallen. · **🇬🇧 Trial reminder respects Stripe-managed trials.** The sweeper no longer sends its own trial reminder for subscriptions whose trial is managed by Stripe — Stripe already sends its own notices there, so duplicate emails are gone.

## [0.48.4] - 2026-07-18

_Pull + Rebuild genügt — nur Hauptserver (API), keine Migration. · Pull + rebuild is enough — main server only (API), no migration._

### Fixed
- **Frische Docker-Builds/-Starts konnten still auf Prisma 7 upgraden und scheiterten mit Schema-Fehler P1012 (GitHub-Issue #1).** Die Prisma-CLI war nur devDependency und fehlte dadurch im Runtime-Image; `npx prisma migrate deploy` lud beim Container-Start ungepinnt die neueste CLI aus dem Netz — seit Prisma 7 bricht das mit „datasource `url` is no longer supported". Die CLI ist jetzt reguläre Dependency (im Image enthalten), das API-Dockerfile ruft `./node_modules/.bin/prisma` direkt auf (nie wieder Netz-Fallback), und das gedriftete `package-lock.json` wurde neu synchronisiert. Kein Eingriff nötig: `git pull` + Rebuild genügt. · *Fresh Docker builds/starts could silently upgrade to Prisma 7 and fail with schema error P1012 (GitHub issue #1). The Prisma CLI was only a devDependency and thus missing from the runtime image; `npx prisma migrate deploy` downloaded the latest unpinned CLI from the network at container start — since Prisma 7 this breaks with "datasource `url` is no longer supported". The CLI is now a regular dependency (shipped in the image), the API Dockerfile calls `./node_modules/.bin/prisma` directly (no network fallback ever again), and the drifted `package-lock.json` has been re-synchronized. No action needed: `git pull` + rebuild is enough.*

## [0.48.3] - 2026-07-11

_Pull genügt — nur Hauptserver (API + Frontend), keine Migration. · Pull is enough — main server only (API + frontend), no migration._

### Changed
- **Super-Admin: „AKTIV" wird gelb statt grün, wenn der Tenant read-only ist.** Ein aktives, aber gesperrtes Konto (Subscription read-only, noch nicht suspendiert) war bisher optisch nicht von einem gesunden Konto zu unterscheiden — Badge und Übersichts-Punkt waren grün. Jetzt zeigen sowohl der Status-Badge im Tenant-Detail („AKTIV · READ-ONLY", gelb) als auch der Punkt in der Tenant-Übersicht (gelb, Tooltip „Aktiv · Read-only") den Karenz-Zustand auf einen Blick. · *Super-admin: "ACTIVE" now shows yellow instead of green when the tenant is read-only. An active-but-locked account (subscription read-only, not yet suspended) was previously indistinguishable from a healthy one — badge and overview dot were green. Now both the status badge in the tenant detail ("ACTIVE · READ-ONLY", yellow) and the dot in the tenant overview (yellow, tooltip "Active · Read-only") surface the grace-period state at a glance.*

## [0.48.2] - 2026-07-11

_Pull genügt — nur Hauptserver (Frontend), keine Migration. · Pull is enough — main server only (frontend), no migration._

### Fixed
- **Super-Admin zeigte den Read-only-Hinweis bei gekündigten Abos nicht an.** Der „Read-Only seit …"-Hinweis im Tenant-Detail war an die Zahlungsproblem-Status (`past_due`/`unpaid`/`incomplete`) gekoppelt und blieb dadurch bei Status `canceled` unsichtbar — obwohl das Konto korrekt read-only war. Der Hinweis erscheint jetzt als eigener Banner bei **jedem** gesperrten Account, unabhängig vom Status. · *Super-admin didn't show the read-only indicator for cancelled subscriptions. The "read-only since …" note in the tenant detail was coupled to payment-problem statuses and stayed hidden for status canceled — even though the account was correctly in read-only. It now shows as its own banner for any locked account, regardless of status.*

## [0.48.1] - 2026-07-11

_Nur SaaS-/Billing-Betrieb betroffen. Self-Host ohne Billing: reiner Pull, keine Änderung. Billing-Betreiber: Worker neu bauen, damit `BILLING_ENABLED` im Worker ankommt. · SaaS/billing only. Self-host without billing: pull, no change. Billing operators: rebuild the worker so BILLING_ENABLED reaches it._

### Fixed
- **Billing-Lifecycle (Trial-Ablauf, Read-only, Suspend) lief im Worker nie.** Der Worker-Container startet den Scheduler (`consumer.py`), der `enforce_limits` alle 10 Minuten auslöst — aber nur, wenn `BILLING_ENABLED=true` im Worker-Env steht. Diese Variable wurde bisher ausschließlich an die API übergeben, nicht an den Worker. Dadurch wurde der komplette Read-only-Lifecycle (inkl. des Fixes aus 0.47.2) nie ausgeführt: abgelaufene bzw. gekündigte Abos blieben dauerhaft voll aktiv. `BILLING_ENABLED` wird jetzt auch an den `worker`-Service durchgereicht (`docker-compose.yml` + `docker-compose.worker.yml`), und die Variable ist in `.env.example` dokumentiert. · *Billing lifecycle (trial expiry, read-only, suspend) never ran in the worker. The worker starts the scheduler that triggers enforce_limits every 10 minutes, but only when BILLING_ENABLED=true — and that variable was only passed to the API, not the worker. As a result the entire read-only lifecycle (including the 0.47.2 fix) never executed: expired/cancelled subscriptions stayed fully active. BILLING_ENABLED is now passed to the worker service too, and documented in .env.example.*

## [0.48.0] - 2026-07-11

_Pull genügt — nur Hauptserver (Frontend + API), keine Migration. · Pull is enough — main server only (frontend + API), no migration._

### Added
- **Trial vorzeitig beenden & sofort starten.** Studios, die sich im Trial befinden und bereits eine Karte hinterlegt haben, finden auf der Billing-Seite jetzt den Button „Trial beenden & jetzt starten". Damit endet die Testphase sofort und die erste Zahlung wird umgehend über die hinterlegte Karte eingezogen — statt erst am Tag 14. Ein In-Page-Bestätigungsdialog verhindert versehentliches Abbuchen. Der finale Zahlungsstatus kommt wie gewohnt über die Stripe-Webhooks. · *End trial early & start now. Studios that are in trial and already have a card on file now get an "End trial & start now" button on the billing page. It ends the trial immediately and charges the first payment right away instead of waiting until day 14. An in-page confirmation dialog prevents accidental charges. The final payment status arrives via the Stripe webhooks as usual.*

## [0.47.2] - 2026-07-11

_Pull genügt — betrifft nur den Worker (kein Env/DB/Compose). Bei mehreren Worker-Nodes alle neu bauen. · Pull is enough — worker only (no env/DB/compose). Rebuild all worker nodes if you run more than one._

### Fixed
- **Gekündigte/ausgelaufene Abos landeten nicht im Read-only-Modus.** Der stündliche Lifecycle-Job sperrte bisher nur abgelaufene Trials OHNE hinterlegte Karte. Während des Trials gekündigte Abos (Karte hinterlegt), abgewanderte Zahler und ausgelaufene Zahlungsversuche behielten nach Periodenende vollen Schreibzugriff — kein Read-only, keine Archivierung, keine Suspendierung, kein Reaktivierungs-Banner. Der Job setzt `readOnlySince` jetzt auch bei Status `canceled`/`unpaid` nach Periodenende (comped-Accounts bleiben unberührt, laufende Perioden behalten Zugriff); bestehende Fälle werden beim nächsten Lauf automatisch nachgeholt. · *Cancelled/expired subscriptions were not put into read-only mode. The hourly lifecycle job previously only locked expired trials WITHOUT a card on file. Subscriptions cancelled during the trial (card on file), churned payers, and exhausted payment retries kept full write access after their period ended — no read-only, no archiving, no suspension, no reactivation banner. The job now also sets readOnlySince for status canceled/unpaid after period end (comped accounts untouched, running periods keep access); existing cases are picked up automatically on the next run.*

## [0.47.1] - 2026-07-11

_Pull genügt — nur API betroffen, keine Migration. · Pull is enough — API only, no migration._

### Fixed
- **Trial-Abbrecher bekamen zwei Abschieds-Mails statt einer.** Wer sein Abo während des Trials kündigte, erhielt sowohl die einmalige „Du hast abgebrochen"-Mail als auch — Stunden später beim Trial-Ende — die Churn-Winback-Mail („Schade, dass du gehst"), obwohl jede als einzige ihrer Art gedacht ist. Der Churn-Winback filtert jetzt Trial-Kündiger heraus (er ist ausschließlich für echte Ex-Zahler), und alle Abschieds-Mails schließen sich gegenseitig aus: ein Account bekommt höchstens eine. · *Trial cancellers received two goodbye emails instead of one. Cancelling during the trial triggered both the one-time "you cancelled" email and — hours later at trial end — the churn winback ("sorry you're leaving"), even though each is meant to be the only one of its kind. The churn winback now excludes trial cancellers (it targets genuine former payers only), and all goodbye emails are mutually exclusive: an account receives at most one.*
- **Trial-Reminder-Betreff spiegelt die tatsächlich verbleibenden Tage.** · *Trial reminder subject reflects the actual number of days left.*

## [0.47.0] - 2026-07-10

_Pull genügt — kein manueller Eingriff. Die additive DB-Migration läuft beim Deploy automatisch mit. · Pull is enough — no manual steps. The additive DB migration runs automatically on deploy._

### Added
- **Automatische Lifecycle-Mails für Trial und Kündigung.** Lumio sendet jetzt drei Kategorien von Marketing-Mails: einen Trial-Reminder 3 Tage vor Ablauf, eine einmalige Mail wenn ein Trial aktiv aber bereits storniert wurde, und eine einmalige Winback-Mail wenn ein Trial abläuft ohne Upgrade oder ein zahlendes Abo endet. Jede Mail enthält einen tokenbasierten Abmelde-Link (kein Login nötig). · *Automatic lifecycle emails for trial and cancellation. Lumio now sends three categories of marketing emails: a trial reminder 3 days before expiry, a one-time email when a trial is active but already cancelled, and a one-time winback email when a trial expires without upgrade or a paying subscription ends. Every email contains a token-based unsubscribe link (no login required).*
- **Globaler Marketing-Mail-Kill-Switch im Super-Admin.** Unter Super-Admin → Marketing-Mails können alle automatischen Lifecycle-Mails global deaktiviert werden. Die Seite zeigt auch eine Opt-out-Statistik (wie viele Tenants haben sich abgemeldet). Transaktionale Mails (Passwort-Reset, Galerieeinladungen etc.) sind nicht betroffen. · *Global marketing email kill-switch in Super-Admin. Under Super-Admin → Marketing Emails, all automatic lifecycle emails can be disabled globally. The page also shows an opt-out statistic. Transactional emails (password reset, gallery invitations, etc.) are not affected.*
- **Per-Tenant Marketing-Mail-Override.** Im Tenant-Detail-View des Super-Admins und in den Studio-Einstellungen (Benachrichtigungen → Produkt-Mails) kann der Marketing-Mail-Toggle pro Tenant ein- und ausgeschaltet werden. Opt-out via Abmelde-Link in jeder Mail setzt denselben Toggle. · *Per-tenant marketing email override. In the Super-Admin tenant detail view and in Studio settings (Notifications → Product emails) the marketing email toggle can be switched per tenant. Opting out via the unsubscribe link in any email sets the same toggle.*

## [0.46.0] - 2026-07-09

_Pull genügt — kein manueller Eingriff. Die additive DB-Migration läuft beim Deploy automatisch mit. Optional können `ZIP_PART_MAX_MIB` / `ZIP_PART_MAX_HARD_CAP_MIB` in der `.env` gesetzt werden. · Pull is enough — no manual steps. The additive DB migration runs automatically on deploy. Optionally set `ZIP_PART_MAX_MIB` / `ZIP_PART_MAX_HARD_CAP_MIB` in `.env`._

### Added
- **Maximale Größe pro Download-Paket ist jetzt pro Studio einstellbar.** In den Studio-Einstellungen lässt sich festlegen, ab welcher Größe große Galerie-Downloads in mehrere Teil-ZIPs aufgeteilt werden (Feld „Maximale Größe pro Download-Paket"). Leer = globaler Default (8 GiB). Der Wert ist durch einen Instanz-Hard-Cap (`ZIP_PART_MAX_HARD_CAP_MIB`, Default 50 GiB) nach oben begrenzt, damit in SaaS-Setups niemand die Worker-Platte sprengt. Der globale Default heißt jetzt `ZIP_PART_MAX_MIB` (in MiB); das alte `ZIP_PART_MAX_BYTES` aus v0.45.0 wird weiterhin als Fallback gelesen. · *The maximum download package size is now configurable per studio. The studio settings let you set the size at which large gallery downloads are split into multiple part ZIPs ("Maximum download package size" field). Empty = global default (8 GiB). The value is capped by an instance hard cap (`ZIP_PART_MAX_HARD_CAP_MIB`, default 50 GiB) so nobody can blow the worker disk in SaaS setups. The global default is now `ZIP_PART_MAX_MIB` (in MiB); the old `ZIP_PART_MAX_BYTES` from v0.45.0 is still read as a fallback.*

## [0.45.0] - 2026-07-09

_Pull genügt — kein manueller Eingriff. Die additive DB-Migration läuft beim Deploy automatisch mit. Optional kann `ZIP_PART_MAX_BYTES` in der `.env` gesetzt werden. · Pull is enough — no manual steps. The additive DB migration runs automatically on deploy. Optionally set `ZIP_PART_MAX_BYTES` in `.env`._

### Added
- **Große Galerie-Downloads werden in mehrere Teil-ZIPs aufgeteilt.** Überschreitet ein Download die Obergrenze `ZIP_PART_MAX_BYTES` (optionale Env, Default 8 GiB, gemessen an der Summe der Dateigrößen), baut Lumio mehrere Teil-Archive statt eines einzigen Riesen-ZIPs. Jeder Teil lässt sich einzeln herunterladen und bei Abbruch einzeln neu holen — das vermeidet fehlgeschlagene Downloads sehr großer Galerien über langsame Leitungen. Hat die Galerie Sektionen, werden die Teile entlang der Sektionsgrenzen geschnitten und danach benannt; ansonsten „Teil i/N". **Galerien unterhalb der Obergrenze ergeben unverändert genau ein ZIP** — für normale/kleine Galerien ändert sich nichts. · *Large gallery downloads are split into multiple part ZIPs. When a download exceeds the `ZIP_PART_MAX_BYTES` limit (optional env, default 8 GiB, measured by summed file sizes), Lumio builds several part archives instead of one giant ZIP. Each part can be downloaded — and, if interrupted, re-downloaded — individually, which avoids failed downloads of very large galleries over slow connections. If the gallery has sections, part boundaries follow the sections and are named after them; otherwise "Part i/N". **Galleries below the limit still produce exactly one ZIP** — nothing changes for normal/small galleries.*

## [0.44.0] - 2026-07-09

_Pull genügt — kein manueller Eingriff. Optional kann `ZIP_DOWNLOAD_TTL_SECONDS` in der `.env` gesetzt werden. · Pull is enough — no manual steps. Optionally set `ZIP_DOWNLOAD_TTL_SECONDS` in `.env`._

### Changed
- **Galerie-ZIP-Download-Links sind jetzt 24 Stunden gültig** (vorher 1 Stunde). Große ZIPs über langsame Leitungen liefen mitunter in den Ablauf der signierten URL — besonders wenn der Browser einen abgebrochenen Download wieder aufnehmen wollte. Die Dauer ist über die neue optionale Env `ZIP_DOWNLOAD_TTL_SECONDS` (Sekunden, Default `86400`) einstellbar. Betrifft nur den ZIP-Download; andere signierte URLs (Vorschaubilder etc.) bleiben unverändert. · *Gallery ZIP download links are now valid for 24 hours (previously 1 hour). Large ZIPs over slow connections sometimes outlived the signed URL — especially when the browser tried to resume an interrupted download. The lifetime is configurable via the new optional env `ZIP_DOWNLOAD_TTL_SECONDS` (seconds, default `86400`). Affects the ZIP download only; other signed URLs (thumbnails etc.) are unchanged.*

## [0.43.4] - 2026-07-07

Pull genügt — keine `.env`-, Compose- oder DB-Änderung nötig. Zwei
Sicherheits-Fixes; nach dem Deploy meldet `GET /health` die neue Version.

### Security
- **Stored XSS über den Branding-Font verhindert.** Der eingestellte
  Schriftname wird jetzt strikt auf Font-Name-Zeichen beschränkt, bevor er
  im Kunden-View angewendet wird. Zuvor konnte ein präparierter Wert aus dem
  Style-Block ausbrechen und im Browser der Galerie-Besucher Code ausführen.
  Bestehende Brandings werden zusätzlich beim Anzeigen abgesichert.
- **Speicher-Verbrauch wird serverseitig verifiziert.** Nach dem Upload
  trägt der Worker die tatsächliche Dateigröße des Originals nach. Vorher
  wurde die vom Browser gemeldete Größe übernommen — bei großen Uploads ließ
  sich damit die Speicher-/Kontingent-Abrechnung unterlaufen.

**🇬🇧 English**

Pull is enough — no `.env`, Compose or DB change required. Two security
fixes; after deploy `GET /health` reports the new version.

### Security
- **Prevented stored XSS via the branding font.** The configured font name
  is now strictly limited to font-name characters before it is applied in the
  customer view. Previously a crafted value could break out of the style block
  and execute code in gallery visitors' browsers. Existing brandings are also
  hardened at render time.
- **Storage usage is now verified server-side.** After upload the worker
  writes back the original file's actual size. Previously the size reported by
  the browser was trusted — with large uploads this allowed circumventing the
  storage/quota accounting.

## [0.43.3] - 2026-07-03

_Pull genügt — kein manueller Eingriff. · Pull is enough — no manual steps._

### Fixed
- **Datenexport schlug immer fehl.** Der Super-Admin-Notfall-Export und der Studio-„Datenexport" bauen pro Galerie ein ZIP der Originale samt `metadata.json` — dieser Job brach jedoch ausnahmslos ab (`relation "gallery_accesses" does not exist`), weil die Kunden-Auswahl-Abfrage die Zugriffs-Tabelle unter falschem Namen (Plural statt Singular) ansprach. Betroffen war ausschließlich der Datenexport-Pfad; der normale Kunden-ZIP-Download über den Galerie-Link nutzt einen anderen Task und war nie betroffen. Der Tabellenname ist korrigiert, Exporte laufen wieder durch. · *Data export always failed — the super-admin emergency export and the studio "data export" build a per-gallery ZIP of the originals plus `metadata.json`, but the job aborted every time (`relation "gallery_accesses" does not exist`) because the customer-selection query referenced the access table under the wrong name (plural instead of singular). Only the data-export path was affected; the regular customer ZIP download via the gallery link uses a different task and was never affected. The table name is fixed and exports complete again.*

## [0.43.2] - 2026-06-26

_Pull genügt — kein manueller Eingriff. · Pull is enough — no manual steps._

### Fixed
- **Wasserzeichen wurden nie erzeugt.** Die Generierung der `watermarked`-Rendition schlug für jedes Bild fehl (`composite: no known route from 'multiband' to 'srgb'`), sodass Galerien mit aktiviertem Wasserzeichen trotzdem das unbearbeitete Bild auslieferten. Der Farbraum des intern aufgebauten Pattern-/Tile-Bildes wird jetzt korrekt als sRGB deklariert; zusätzlich wurde ein latenter Fehler bei der Alpha-Reduktion behoben. Text- und Grafik-Wasserzeichen funktionieren wieder. · *Watermarks were never produced — generating the `watermarked` rendition failed for every image, so galleries with watermarking enabled still served the unmodified image. The internal pattern/tile colourspace is now correctly tagged as sRGB, and a latent alpha-reduction bug was fixed. Text and image watermarks work again.*

## [0.43.1] - 2026-06-14

**Pull genügt** — keine `.env`-, Compose- oder DB-Änderung nötig. Hinweis: Der AVV-Auftragsverarbeiter wurde umfirmiert und `DPA_VERSION` erhöht (1.1 → 1.2). Beim SaaS-Betrieb fordert das Studio dadurch eine erneute AVV-Bestätigung an; für reine Self-Hoster ohne fremde Studio-Kunden ohne praktische Folge.

### Changed
- AVV-Auftragsverarbeiter (`PROCESSOR` in `apps/api`) auf die neue Anbieterfirmierung **STRUEX UG (haftungsbeschränkt), vertreten durch die Geschäftsführerin Julia Thiel** umgestellt. `DPA_VERSION` von 1.1 auf 1.2 erhöht, da sich die Vertragspartei materiell ändert → Studios werden zur erneuten AVV-Bestätigung aufgefordert.

**🇬🇧 English**

**Pull is enough** — no `.env`, Compose or DB change required. Note: the DPA processor was renamed and `DPA_VERSION` was bumped (1.1 → 1.2). In SaaS operation each studio is therefore asked to re-confirm the DPA; for pure self-hosters without external studio customers there is no practical effect.

### Changed
- DPA processor (`PROCESSOR` in `apps/api`) updated to the new provider entity **STRUEX UG (haftungsbeschränkt), represented by managing director Julia Thiel**. Bumped `DPA_VERSION` from 1.1 to 1.2 because the contracting party materially changes → studios are prompted to re-confirm the DPA.

## [0.43.0] - 2026-06-06

**Pull genügt** — keine `.env`-, Compose- oder DB-Änderung nötig. Auf amd64 läuft alles unverändert weiter.

### Added
- **ARM64-Unterstützung (aarch64).** Lumio baut und läuft jetzt nativ auch auf ARM-Servern (z.B. Ampere / Hetzner CAX, AWS Graviton, Apple Silicon via Docker, Raspberry Pi 5). Beim `--build` wird die passende Variante automatisch gewählt — nichts umzustellen. Der ML-Worker zieht PyTorch auf ARM automatisch von PyPI (aarch64-Wheels) statt vom x86-only CPU-Index. Hinweis: GPU-Beschleunigung fürs Auto-Tagging bleibt NVIDIA/CUDA und damit amd64-only; auf ARM läuft das Tagging CPU-basiert (funktional identisch, langsamer pro Bild).
- Neue Doku [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md): Hardware-, Architektur- und Storage-Voraussetzungen inkl. Sizing-Tabelle. Aus README und SELFHOSTING verlinkt.
- Caddy routet `lumio-cloud.com` (internationale Portal-Einstiegsseite) intern.

### Changed
- EXIF-Aufnahmezeit wird jetzt über **exiftool** gelesen statt über pyexiv2. Funktional identisch (gleiche Date-Tags, gleiche Priorität), deckt aber mehr Container ab (u.a. CR3). Hintergrund: pyexiv2 lieferte nur ein x86_64-Wheel und blockierte ARM-Builds; exiftool ist Multi-Arch und war ohnehin im Worker-Image. Das Worker-Image wird dadurch minimal kleiner (libexiv2 entfällt).

**🇬🇧 English**

**Pull is enough** — no `.env`, Compose or DB change needed. On amd64 everything keeps running unchanged.

### Added
- **ARM64 support (aarch64).** Lumio now builds and runs natively on ARM servers too (e.g. Ampere / Hetzner CAX, AWS Graviton, Apple Silicon via Docker, Raspberry Pi 5). On `--build` the right variant is chosen automatically — nothing to switch. On ARM the ML worker pulls PyTorch automatically from PyPI (aarch64 wheels) instead of the x86-only CPU index. Note: GPU acceleration for auto-tagging stays NVIDIA/CUDA and thus amd64-only; on ARM the tagging runs CPU-based (functionally identical, slower per image).
- New docs [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md): hardware, architecture and storage requirements incl. a sizing table. Linked from README and SELFHOSTING.
- Caddy routes `lumio-cloud.com` (the international portal landing page) internally.

### Changed
- The EXIF capture time is now read via **exiftool** instead of pyexiv2. Functionally identical (same date tags, same priority), but covers more containers (incl. CR3). Background: pyexiv2 only shipped an x86_64 wheel and blocked ARM builds; exiftool is multi-arch and was already in the worker image. This makes the worker image minimally smaller (libexiv2 dropped).

## [0.42.0] - 2026-06-05

> Pull genügt für Self-Hoster (keine neue ENV, keine Migration). **Betrifft
> den Worker** — wer mit separaten Worker-Nodes deployt, muss diese ebenfalls
> aktualisieren (nach dem Hauptserver). Wiederherstellung gelöschter Originale
> setzt Bucket-Versioning voraus.

### Added
- Super-Admin → Backup: **Notfall-Wiederherstellung gelöschter Originale**.
  Hat ein Kunde Galerien/Bilder versehentlich gelöscht, rekonstruiert der
  neue Worker-Job aus den noncurrent S3-Versionen (Aufbewahrungsfenster, i.d.R.
  30 Tage) die verlorenen Quelldateien und stellt sie pro Galerie als ZIP zum
  Download bereit. Stellt die Galerien NICHT in der App wieder her — liefert
  ausschließlich die Quelldateien.

**🇬🇧 English**

> Pull is enough for self-hosters (no new ENV, no migration). **Affects the
> worker** — anyone deploying with separate worker nodes must update those too
> (after the main server). Recovering deleted originals requires bucket versioning.

### Added
- Super admin → Backup: **emergency recovery of deleted originals**.
  If a customer deleted galleries/images by accident, the new worker job
  reconstructs the lost source files from the noncurrent S3 versions (retention
  window, usually 30 days) and provides them per gallery as a ZIP download. It
  does NOT restore the galleries in the app — it delivers the source files only.

## [0.41.0] - 2026-06-05

> Pull genügt. Frontend- und API-only Änderung; keine neue ENV, keine
> Migration, keine Worker-Änderung.

### Added
- Super-Admin: neuer Bereich **Backup**. Bündelt das Backup-Monitoring
  (DB + Medien) und einen **Notfall-Export pro Tenant**: Originaldateien
  aller Galerien eines Studios als ZIP (ein Archiv pro Galerie, inkl.
  metadata.json), mit Download-Links direkt im Portal. Use-Case: ein Kunde
  hat versehentlich Inhalte gelöscht und braucht seine Quelldateien.
  Nutzt die bestehende Export-Engine; Download-Links sind 30 Tage gültig.

**🇬🇧 English**

> Pull is enough. A frontend- and API-only change; no new ENV, no migration,
> no worker change.

### Added
- Super admin: new **Backup** area. Bundles the backup monitoring
  (DB + media) and an **emergency export per tenant**: the original files of
  all of a studio's galleries as ZIPs (one archive per gallery, incl.
  metadata.json), with download links directly in the portal. Use case: a
  customer deleted content by accident and needs their source files.
  Uses the existing export engine; download links are valid for 30 days.

## [0.40.0] - 2026-06-05

> Pull genügt. Die neuen Backup-Funktionen sind optional und additiv — ohne
> gesetzte ENV bleibt das Verhalten unverändert. Self-Hoster, die das Monitoring
> nutzen wollen: siehe `docs/BACKUP.md` (ENV `BACKUP_STATUS_PATH` und optional
> `BACKUP_MEDIA_STATUS_PATH`).

### Added
- Produktionsreifes Backup-Runbook (`docs/BACKUP.md`) nach 3-2-1: Postgres via
  restic in zwei Repos (z. B. Hetzner Object Storage + Backblaze B2), Bilder/
  Videos per rclone cross-provider, Versioning/Object-Lock, Dead-Man's-Switch
  und Restore-Test. Inklusive fertiger Skripte `scripts/lumio-backup.sh` und
  `scripts/lumio-media-sync.sh` plus Konfig-Vorlage.
- Backup-Monitoring im Super-Admin (System) zeigt jetzt mehrere Backups statt
  nur die Datenbank: DB **und** Medien-Sync mit je eigener Status-Karte. Pro
  Typ passende Alters-Schwellen (DB täglich: gelb > 24 h, rot > 72 h; Medien
  wöchentlich: gelb > 8 Tage, rot > 10 Tage). Aktivierung über
  `BACKUP_MEDIA_STATUS_PATH`; der Media-Sync schreibt dafür eine eigene
  Status-Datei.

**🇬🇧 English**

> Pull is enough. The new backup functions are optional and additive — without
> a set ENV, behavior stays unchanged. Self-hosters who want to use the
> monitoring: see `docs/BACKUP.md` (ENV `BACKUP_STATUS_PATH` and optionally
> `BACKUP_MEDIA_STATUS_PATH`).

### Added
- A production-grade backup runbook (`docs/BACKUP.md`) following 3-2-1: Postgres
  via restic into two repos (e.g. Hetzner Object Storage + Backblaze B2),
  images/videos via rclone cross-provider, versioning/object lock, a dead man's
  switch and a restore test. Including ready-made scripts `scripts/lumio-backup.sh`
  and `scripts/lumio-media-sync.sh` plus a config template.
- Backup monitoring in the super admin (System) now shows multiple backups
  instead of just the database: DB **and** media sync, each with its own status
  card. Per type, appropriate age thresholds (DB daily: yellow > 24 h, red > 72 h;
  media weekly: yellow > 8 days, red > 10 days). Activated via
  `BACKUP_MEDIA_STATUS_PATH`; the media sync writes its own status file for this.

## [0.39.2] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Fixed
- **Feedback-Sprechblase überlappte das RAW/HEIC-Format-Badge** in der
  Kundengalerie (beide unten rechts). Die Sprechblase sitzt jetzt unten
  links, das Format-Badge bleibt unten rechts.

**🇬🇧 English**

Pull is enough — no manual intervention. Affects only the main server
(frontend).

### Fixed
- **The feedback speech bubble overlapped the RAW/HEIC format badge** in the
  customer gallery (both bottom right). The speech bubble now sits bottom
  left, the format badge stays bottom right.

## [0.39.1] - 2026-06-04

Pull genügt, ABER: diese Version ändert auch den Worker. Nach dem Deploy
des Hauptservers müssen die Worker-Nodes ebenfalls neu deployt werden
(siehe Worker-Deploy-Befehl). Keine Env-/DB-Änderung.

### Fixed
- **Video-Vorschau im Studio funktioniert wieder** (Auswahl- und
  Medien-Ansicht zeigten „Video-Vorschau nicht verfügbar / Keine Vorschau
  verfügbar"). Ursache: Das Studio spielt Videos über eine eigene
  MP4-Rendition (nicht über den HLS-Stream der Kundengalerie), und diese
  MP4 wurde bei bereits kompakten Quellvideos übersprungen. Jetzt:
  - Bestehende Videos spielen sofort (die API liefert ersatzweise das
    Original aus — greift bereits nach dem Hauptserver-Deploy).
  - Neue Uploads erhalten wieder zuverlässig eine web-optimierte
    MP4-Version (Worker-Änderung — daher Worker-Nodes neu deployen).

**🇬🇧 English**

Pull is enough, BUT: this version also changes the worker. After deploying
the main server, the worker nodes must be redeployed too (see the worker
deploy command). No env/DB change.

### Fixed
- **Video preview in the studio works again** (the selection and media views
  showed "video preview not available / no preview available"). Cause: the
  studio plays videos via its own MP4 rendition (not via the customer
  gallery's HLS stream), and this MP4 was skipped for already-compact source
  videos. Now:
  - Existing videos play immediately (the API serves the original as a
    fallback — takes effect right after the main-server deploy).
  - New uploads reliably get a web-optimized MP4 version again (a worker
    change — hence redeploy the worker nodes).

## [0.39.0] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend + API), kein Worker.

### Added
- **Feedback-Indikator in der Kundengalerie**: Auf Thumbnails, zu denen
  der Besucher eine Markierung oder einen Kommentar hinterlassen hat,
  erscheint jetzt eine dezente Sprechblase (unten rechts) — als
  Erinnerung, wo bereits etwas notiert wurde. Das Icon erscheint sofort
  nach dem Schließen der Lightbox (ohne Reload) und bleibt nach erneutem
  Laden erhalten. Es zeigt ausschließlich das eigene Feedback des
  Besuchers; Studio-Kommentare bleiben außen vor.

**🇬🇧 English**

Pull is enough — no manual intervention. Affects only the main server
(frontend + API), no worker.

### Added
- **Feedback indicator in the customer gallery**: on thumbnails where the
  visitor left a marking or a comment, a subtle speech bubble now appears
  (bottom right) — as a reminder of where something was already noted. The
  icon appears immediately after closing the lightbox (without a reload) and
  persists after reloading. It shows only the visitor's own feedback; studio
  comments stay out of it.

## [0.38.1] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Fixed
- **Marker-Beschriftung im Video überlappte den „Markieren"-Button**: Lag
  eine Markierung am aktuellen Zeitpunkt, lag deren Beschriftung
  (Zeit/Notiz) hinter dem „Markieren"-Button und war unlesbar. Die
  Beschriftung sitzt jetzt darunter.

**🇬🇧 English**

Pull is enough — no manual intervention. Affects only the main server
(frontend).

### Fixed
- **A marker label on a video overlapped the "Mark" button**: if a marking
  was at the current time, its label (time/note) sat behind the "Mark"
  button and was unreadable. The label now sits below it.

## [0.38.0] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Changed
- **Einheitliche Markieren-/Auswahl-Bedienung für Fotos und Videos**: Bei
  Fotos wird das Markieren jetzt — wie beim Video — über einen
  „Markieren"-Button **oben** am Bild gestartet (öffnet die
  Zeichen-Werkzeugleiste, „Fertig" beendet sie). Die Auswahl (Farben +
  Stern) liegt als Leiste **unten**. Der bisherige untere
  „Auswahl/Markieren"-Umschalter entfällt; Auswählen und Markieren sind
  jetzt gleichzeitig möglich.

**🇬🇧 English**

Pull is enough — no manual intervention. Affects only the main server
(frontend).

### Changed
- **Unified marking/selection controls for photos and videos**: for photos,
  marking is now started — like for video — via a "Mark" button **at the
  top** of the image (opens the drawing toolbar, "Done" closes it). The
  selection (colors + star) sits as a bar **at the bottom**. The previous
  bottom "selection/marking" toggle is gone; selecting and marking are now
  possible at the same time.

## [0.37.5] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Fixed
- **Play/Pause bei Videos mit Markierungen funktioniert wieder**: Lag eine
  Markierung am aktuellen Zeitpunkt (z.B. direkt nach dem Setzen), fing
  deren Anzeige-Overlay die Klicks ab und der Play-Button reagierte nicht.
  Das Anzeige-Overlay ist jetzt vollständig „durchklickbar"; die
  Video-Bedienelemente darunter sind wieder erreichbar. (Zeichnen ist
  unverändert.)

**🇬🇧 English**

Pull is enough — no manual intervention. Affects only the main server
(frontend).

### Fixed
- **Play/pause on videos with markings works again**: if a marking was at
  the current time (e.g. right after setting it), its display overlay caught
  the clicks and the play button didn't respond. The display overlay is now
  fully "click-through"; the video controls below it are reachable again.
  (Drawing is unchanged.)

## [0.37.4] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Fixed
- **Hochformat-Videos werden jetzt korrekt dargestellt**: Bisher wurde das
  Video auf volle Breite gezogen, wodurch ein Hochformat-Video zu groß
  wurde und unten abgeschnitten war — und die Play/Pause-Bedienelemente
  landeten außerhalb des sichtbaren Bereichs (Video ließ sich nicht
  abspielen). Das Video passt sich jetzt an Höhe und Breite an und behält
  sein Seitenverhältnis; Hoch- und Querformat passen vollständig ins Bild
  und die Bedienelemente sind wieder sichtbar. Die Vorschau-Leiste liegt
  passend unter dem Video.

**🇬🇧 English**

Pull is enough — no manual intervention. Affects only the main server
(frontend).

### Fixed
- **Portrait videos are now displayed correctly**: previously the video was
  stretched to full width, making a portrait video too large and cut off at
  the bottom — and the play/pause controls ended up outside the visible area
  (the video couldn't be played). The video now fits to height and width and
  keeps its aspect ratio; portrait and landscape fit fully into view and the
  controls are visible again. The preview bar sits appropriately below the
  video.

## [0.37.3] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Fixed
- **Video-Upload vom iPhone/iPad aus der Fotomediathek**: Beim Auswählen
  eines Videos im Foto-Picker und Tippen auf das Häkchen passierte nichts —
  das Picker-Fenster blieb offen und es wurde keine Datei übergeben (Fotos
  funktionierten). Ursache war ein iOS/WebKit-Verhalten beim Datei-Dialog
  ohne Typ-Vorgabe; der Studio-Upload gibt jetzt eine Typ-Vorgabe mit, womit
  iOS das Video korrekt übergibt. Drag&Drop und Desktop-Uploads bleiben
  unverändert (auch RAW/HEIC/PDF weiterhin wählbar).

**🇬🇧 English**

Pull is enough — no manual intervention. Affects only the main server
(frontend).

### Fixed
- **Video upload from the iPhone/iPad photo library**: when selecting a
  video in the photo picker and tapping the checkmark, nothing happened —
  the picker window stayed open and no file was passed (photos worked). The
  cause was an iOS/WebKit behavior in the file dialog without a type hint;
  the studio upload now passes a type hint, with which iOS hands over the
  video correctly. Drag & drop and desktop uploads stay unchanged (RAW/HEIC/
  PDF still selectable).

## [0.37.2] - 2026-06-04

Pull genügt — kein manueller Eingriff. **Worker-Änderung:** nach dem
Deploy auf dem Hauptserver auch alle Worker-Nodes neu deployen, sonst
greift die Änderung dort nicht.

### Fixed
- **Video-Scrubbing zeigt jetzt deutlich mehr Einzelbilder**: Bisher gab es
  nur 1 Vorschaubild alle 10 Sekunden (ein 40-Sekunden-Video hatte also nur
  rund 4 Bilder). Jetzt werden so viele Bilder erzeugt wie sinnvoll möglich
  (bis zu 100), höchstens eins alle 0,5 Sekunden — ein 40-Sekunden-Video hat
  damit etwa 80 Vorschaubilder. Gilt für neu hochgeladene/verarbeitete
  Videos; bereits verarbeitete behalten ihr bisheriges Vorschaubild-Set, bis
  sie neu verarbeitet werden.

**🇬🇧 English**

Pull is enough — no manual intervention. **Worker change:** after deploying
the main server, redeploy all worker nodes too, otherwise the change won't
take effect there.

### Fixed
- **Video scrubbing now shows significantly more frames**: previously there
  was only 1 preview image every 10 seconds (so a 40-second video had only
  about 4 images). Now as many images are generated as sensibly possible (up
  to 100), at most one every 0.5 seconds — a 40-second video thus has about
  80 preview images. Applies to newly uploaded/processed videos; already-
  processed ones keep their existing preview-image set until reprocessed.

## [0.37.1] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Fixed
- **Video im Studio-Medien-Tab abspielbar**: In der großen Ansicht des
  Medien-Tabs ließ sich ein Video bisher nicht abspielen (nur Standbild) —
  jetzt mit Player und Vorschau-Leiste.
- **Vorschau-Leiste beim Video-Scrubbing**: Die Einzelbilder in der Leiste
  wurden teils gar nicht angezeigt (nur ein Fallback). Sie laden jetzt
  zuverlässig.
- **Video-Markierungen nur noch zeitpunktgenau sichtbar**: Eine Markierung
  erscheint jetzt nur an ihrer Sekunde und nicht mehr über das ganze Video.
  Außerdem funktionieren Play/Pause wieder zuverlässig (das Markierungs-
  Overlay blockierte vorher die Bedienelemente).
- **Doppelte Werkzeugleiste in der Kundengalerie entfernt**: Bei Videos
  wurde zusätzlich die Foto-Zeichenleiste eingeblendet und überlappte die
  Scrub-Leiste. Für Videos ist jetzt nur noch die Video-Markierung aktiv.

**🇬🇧 English**

Pull is enough — no manual intervention. Affects only the main server
(frontend).

### Fixed
- **Video playable in the studio media tab**: in the large view of the media
  tab a video couldn't be played before (only a still) — now with a player
  and a preview bar.
- **Preview bar on video scrubbing**: the frames in the bar were sometimes
  not shown at all (only a fallback). They now load reliably.
- **Video markings now only visible at their exact time**: a marking now
  appears only at its second, no longer across the whole video. Play/pause
  also works reliably again (the marking overlay previously blocked the
  controls).
- **Duplicate toolbar removed in the customer gallery**: for videos the photo
  drawing bar was additionally shown and overlapped the scrub bar. For videos
  only the video marking is active now.

## [0.37.0] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend), kein API-/Worker-Deploy nötig.

### Added
- **Markierungen auf Videos**: An einer bestimmten Sekunde im Video lässt
  sich jetzt ein Pfeil oder eine Freihand-Markierung aufs Standbild setzen —
  genau wie bei Fotos, plus optionaler Notiz. Auf der Vorschau-Leiste
  erscheinen kleine Marker an den markierten Stellen; ein Klick springt
  dorthin und zeigt die Markierung. Funktioniert für Brautpaare/Kunden in
  der Galerie und fürs Studio im Proofing. (Bestehende Foto-Markierungen
  bleiben unverändert.)

**🇬🇧 English**

Pull is enough — no manual intervention. Affects only the main server
(frontend), no API/worker deploy needed.

### Added
- **Markings on videos**: at a specific second in the video you can now place
  an arrow or a freehand marking on the still — just like for photos, plus an
  optional note. On the preview bar small markers appear at the marked spots;
  a click jumps there and shows the marking. Works for couples/customers in
  the gallery and for the studio in proofing. (Existing photo markings stay
  unchanged.)

## [0.36.0] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend + API), kein Worker-Deploy nötig.

### Added
- **Video-Wiedergabe im Studio-Proofing**: Videos lassen sich in der
  Datei-Detailansicht jetzt direkt abspielen (vorher war nur das Standbild
  zu sehen). Mit der gleichen Vorschau-Leiste zum Vorspulen wie in der
  Kundengalerie.

### Fixed
- **Video-Scrubbing in der Kundengalerie**: Unter dem Video liegt jetzt eine
  immer sichtbare Vorschau-Leiste mit Einzelbildern statt einer unsichtbaren
  Hover-Zone — es ist sofort erkennbar, wo man zum Spulen hinfahren muss. Die
  Vorschaubilder werden vorgeladen und erscheinen ohne Verzögerung, und die
  Leiste lässt sich per Touch (Tablet) bedienen.

**🇬🇧 English**

Pull is enough — no manual intervention. Affects only the main server
(frontend + API), no worker deploy needed.

### Added
- **Video playback in studio proofing**: videos can now be played directly in
  the file detail view (previously only the still was shown). With the same
  preview bar for seeking as in the customer gallery.

### Fixed
- **Video scrubbing in the customer gallery**: below the video there is now
  an always-visible preview bar with frames instead of an invisible hover
  zone — it's immediately clear where to move to seek. The preview images are
  preloaded and appear without delay, and the bar can be operated by touch
  (tablet).

## [0.35.1] - 2026-06-04

Kleine Verbesserung. `git pull` + regulärer Deploy genügt, nur Frontend.

### Changed
- Studio-Banner werden jetzt **sofort beim Zurückkehren auf den Tab** neu
  geladen (zusätzlich zum 5-Minuten-Polling). Ein frisch angelegter Banner
  erscheint damit praktisch sofort, sobald jemand wieder ins Studio schaut —
  ohne Reload.

**🇬🇧 English**

A small improvement. `git pull` + a regular deploy is enough, frontend only.

### Changed
- Studio banners are now reloaded **immediately when returning to the tab**
  (in addition to the 5-minute polling). A freshly created banner thus
  appears practically immediately as soon as someone looks at the studio
  again — without a reload.

## [0.35.0] - 2026-06-04

Neues Feature (Super-Admin). `git pull` + regulärer Deploy genügt; additive
Migration läuft automatisch.

### Added
- **Studio-Banner an einzelne User oder Tenants** (Super-Admin → Users, Button
  „Banner" pro User). Erzeugt einen In-Studio-Banner, der wahlweise nur diesem
  User oder seinem ganzen Studio angezeigt wird — mit Titel, Text, Stufe
  (Info/Warnung/Kritisch), Wegklickbarkeit und optionalem Ablauf (7/30 Tage
  oder manuell). Globale Banner gibt es weiterhin über die bestehende
  Announcement-Verwaltung.

### Changed
- Ziel-Banner werden über einen neuen **authentifizierten** Endpoint
  (`/announcements/mine`) ausgeliefert; der öffentliche `/announcements/active`
  liefert nur noch globale Banner (damit zielgerichtete Banner nicht an
  Unbeteiligte ausgespielt werden). Das Studio nutzt automatisch den neuen
  Endpoint.

**🇬🇧 English**

New feature (super admin). `git pull` + a regular deploy is enough; an additive
migration runs automatically.

### Added
- **Studio banners targeted at individual users or tenants** (super admin →
  Users, "Banner" button per user). Creates an in-studio banner shown either
  only to that user or to their whole studio — with title, text, level
  (info/warning/critical), dismissibility and optional expiry (7/30 days or
  manual). Global banners are still available via the existing announcement
  management.

### Changed
- Targeted banners are delivered via a new **authenticated** endpoint
  (`/announcements/mine`); the public `/announcements/active` now only returns
  global banners (so targeted banners aren't shown to uninvolved users). The
  studio uses the new endpoint automatically.

## [0.34.0] - 2026-06-04

Neues Feature (Super-Admin). `git pull` + regulärer Deploy genügt, keine
Migration.

### Added
- **Direkt-E-Mail an einzelne User** (Super-Admin → Users, Button „E-Mail" pro
  User). Betreff + Markdown-Nachricht, wird als 1:1-Mail gesendet (ohne
  Abmelde-Footer, anders als Broadcasts) und im E-Mail-Log protokolliert.

**🇬🇧 English**

New feature (super admin). `git pull` + a regular deploy is enough, no
migration.

### Added
- **Direct email to individual users** (super admin → Users, "Email" button
  per user). Subject + Markdown message, sent as a 1:1 mail (without an
  unsubscribe footer, unlike broadcasts) and logged in the email log.

## [0.33.1] - 2026-06-04

Bugfix. `git pull` + regulärer Deploy genügt, nur Frontend.

### Fixed
- „Sofort löschen (Test)" reagierte auf manchen Geräten nicht (die
  Bestätigung lief über ein Browser-`prompt`, das mobil/in manchen Browsern
  blockiert wird). Läuft jetzt über denselben In-Page-Dialog wie der reguläre
  Hard-Delete (Slug-Eingabefeld) und funktioniert zuverlässig.

**🇬🇧 English**

Bugfix. `git pull` + a regular deploy is enough, frontend only.

### Fixed
- "Delete immediately (test)" didn't respond on some devices (the confirmation
  ran via a browser `prompt`, which is blocked on mobile/in some browsers). It
  now runs via the same in-page dialog as the regular hard delete (slug input
  field) and works reliably.

## [0.33.0] - 2026-06-04

Neues Feature (Super-Admin). `git pull` + regulärer Deploy genügt, keine
Migration.

### Added
- **Sofort-Löschen für Test-/Trial-Tenants** (Super-Admin → Tenant-Detail,
  „Sofort löschen (Test)"). Überspringt Archivierung + 30-Tage-Karenz, kündigt
  die Stripe-Subscription, **löscht den Stripe-Customer** und macht
  DB-Cascade + S3-Cleanup in einem Schritt. Schutzschranke: nur möglich, wenn
  der Tenant **nicht aktiv zahlend** ist (Subscription-Status nicht
  `active`/`past_due`) — laufende Kunden lassen sich so nicht versehentlich
  löschen, dafür bleibt der reguläre Weg (Archivieren → Karenz → Hard-Delete,
  der die Stripe-Daten behält). Slug-Eingabe zur Bestätigung Pflicht.

**🇬🇧 English**

New feature (super admin). `git pull` + a regular deploy is enough, no
migration.

### Added
- **Immediate delete for test/trial tenants** (super admin → tenant detail,
  "Delete immediately (test)"). Skips archiving + the 30-day grace period,
  cancels the Stripe subscription, **deletes the Stripe customer** and does a
  DB cascade + S3 cleanup in one step. Guardrail: only possible if the tenant
  is **not actively paying** (subscription status not `active`/`past_due`) — so
  running customers can't be deleted by accident; for those the regular path
  remains (archive → grace → hard delete, which keeps the Stripe data). A slug
  entry is required for confirmation.

## [0.32.1] - 2026-06-04

Bugfix. `git pull` + regulärer Deploy genügt, nur API.

### Fixed
- Nach der Stripe-Zahlung im Self-Service-Signup wird der frisch registrierte
  Owner jetzt auf seine **eigene Tenant-Subdomain** (`{slug}.<domain>`) geleitet
  statt auf einen festen Host. Dort macht `/welcome` das Auto-Login, sodass man
  direkt im richtigen Studio landet. Greift, wenn `LUMIO_DOMAIN_BASE` gesetzt ist
  (Wildcard-SaaS); ohne Wildcard-Domain bleibt es beim bisherigen Verhalten.

**🇬🇧 English**

Bugfix. `git pull` + a regular deploy is enough, API only.

### Fixed
- After the Stripe payment in self-service signup, the freshly registered owner
  is now directed to their **own tenant subdomain** (`{slug}.<domain>`) instead
  of a fixed host. There `/welcome` does the auto-login, so you land directly in
  the right studio. Takes effect when `LUMIO_DOMAIN_BASE` is set (wildcard SaaS);
  without a wildcard domain the previous behavior remains.

## [0.32.0] - 2026-06-04

Neues Feature (Super-Admin), read-only. `git pull` + regulärer Deploy genügt,
keine Migration.

### Added
- **Super-Admin → Compliance.** AVV-/DSGVO-Status pro Tenant: zeigt, ob der
  Auftragsverarbeitungsvertrag (DPA) unterschrieben ist, ob die zugestimmte
  Version veraltet ist (gegen die aktuelle DPA-Version), und den
  Lösch-/Archivierungs-Lifecycle (geplante Löschung, geplante Archivierung,
  bereits archiviert). Mit Übersichtszahlen und Filter „nur auffällige".

**🇬🇧 English**

New feature (super admin), read-only. `git pull` + a regular deploy is enough,
no migration.

### Added
- **Super admin → Compliance.** DPA/GDPR status per tenant: shows whether the
  data processing agreement (DPA) is signed, whether the accepted version is
  outdated (against the current DPA version), and the deletion/archiving
  lifecycle (scheduled deletion, scheduled archiving, already archived). With
  summary figures and a "flagged only" filter.

## [0.31.0] - 2026-06-04

Neues Feature (Super-Admin), read-only. `git pull` + regulärer Deploy genügt;
additive Migration (ein Index) läuft automatisch.

### Added
- **Super-Admin → Security.** Abuse-Signale aus dem Audit-Log:
  fehlgeschlagene Anmeldungen (inkl. 2FA, WebAuthn, Super-Admin) und
  fehlgeschlagene Galerie-Entsperrungen (Brute-Force-Indikator). Mit 24-h-/
  7-Tage-Zahlen, Top-IPs nach Fehl-Logins und einer Liste der letzten Vorfälle.
  Nutzt vorhandene Audit-Daten, keine zusätzliche Erfassung nötig. Neuer Index
  `events(action, createdAt)` für die Cross-Tenant-Auswertung.

**🇬🇧 English**

New feature (super admin), read-only. `git pull` + a regular deploy is enough;
an additive migration (one index) runs automatically.

### Added
- **Super admin → Security.** Abuse signals from the audit log: failed logins
  (incl. 2FA, WebAuthn, super admin) and failed gallery unlocks (a brute-force
  indicator). With 24h/7-day figures, top IPs by failed logins and a list of
  recent incidents. Uses existing audit data, no additional collection needed.
  New index `events(action, createdAt)` for the cross-tenant evaluation.

## [0.30.0] - 2026-06-04

Neues Feature (Super-Admin), read-only + Retry. `git pull` + regulärer Deploy
genügt, keine Migration.

### Added
- **Super-Admin → Job-Fehler.** Sammelt fehlgeschlagene und hängende
  Async-Jobs über alle Tenants: Datei-Verarbeitung (Thumbnails, Transcode,
  Auto-Tagging), ZIP-Builds und ausgehende Webhooks. Zählt sie, listet sie mit
  Fehlermeldung und erlaubt gezieltes Neu-Anstoßen von Datei-Jobs und Webhooks
  per Knopfdruck. „Hängend" = seit über 2 Stunden in Verarbeitung. ZIP-Builds
  read-only (Kunde fordert bei Bedarf einfach neu an).

**🇬🇧 English**

New feature (super admin), read-only + retry. `git pull` + a regular deploy is
enough, no migration.

### Added
- **Super admin → Job errors.** Collects failed and stuck async jobs across all
  tenants: file processing (thumbnails, transcode, auto-tagging), ZIP builds and
  outgoing webhooks. Counts them, lists them with the error message and allows
  targeted re-triggering of file jobs and webhooks at the push of a button.
  "Stuck" = in processing for over 2 hours. ZIP builds are read-only (the
  customer simply requests anew if needed).

## [0.29.0] - 2026-06-04

Neues Feature (Super-Admin). `git pull` + regulärer Deploy genügt; additive
Migration läuft automatisch.

### Added
- **Super-Admin → E-Mail-Log.** Jeder Mailversand wird protokolliert
  (gesendet / fehlgeschlagen / übersprungen). Die Ansicht zeigt 24-h- und
  7-Tage-Zahlen, die letzten 100 Mails mit Status und Fehlermeldung sowie einen
  Hinweis, falls offenbar kein SMTP konfiguriert ist. Besonders relevant nach
  dem Notification-Ausbau — man sieht jetzt, ob die Mails ankommen. Log wird
  nach 30 Tagen automatisch aufgeräumt.

**🇬🇧 English**

New feature (super admin). `git pull` + a regular deploy is enough; an additive
migration runs automatically.

### Added
- **Super admin → Email log.** Every mail send is logged (sent / failed /
  skipped). The view shows 24h and 7-day figures, the last 100 mails with status
  and error message, plus a hint if SMTP is apparently not configured.
  Especially relevant after the notification expansion — you can now see whether
  the mails arrive. The log is cleaned up automatically after 30 days.

## [0.28.0] - 2026-06-04

Neues Feature (Super-Admin), read-only. `git pull` + regulärer Deploy genügt,
keine Migration.

### Added
- **Super-Admin → Plan-Katalog.** Stellt die zentrale Plan-Definition im Code
  (Limits & Preise) der DB-Tabelle `billing_plans` gegenüber und markiert
  Abweichungen pro Feld (Name, Speicher, Preise, Watermark). Zeigt außerdem
  Stripe-Preis-IDs (vorhanden/fehlt), `isActive` und Pläne, die nur in der DB
  bzw. nur im Code existieren. Diagnose-Werkzeug — hätte den Storage-Drift
  (1000 statt 3000 GB) sofort sichtbar gemacht.

**🇬🇧 English**

New feature (super admin), read-only. `git pull` + a regular deploy is enough,
no migration.

### Added
- **Super admin → Plan catalog.** Compares the central plan definition in code
  (limits & prices) against the DB table `billing_plans` and flags deviations
  per field (name, storage, prices, watermark). Also shows Stripe price IDs
  (present/missing), `isActive` and plans that exist only in the DB or only in
  code. A diagnostic tool — it would have made the storage drift (1000 instead
  of 3000 GB) immediately visible.

## [0.27.1] - 2026-06-04

Kleiner UI-Fix. `git pull` + regulärer Deploy genügt, nur Frontend.

### Fixed
- Die Schalter unter Einstellungen → „E-Mail-Benachrichtigungen" waren leicht
  verrutscht; der Knopf sitzt jetzt sauber zentriert.

**🇬🇧 English**

A small UI fix. `git pull` + a regular deploy is enough, frontend only.

### Fixed
- The toggles under Settings → "Email notifications" were slightly misaligned;
  the switch now sits cleanly centered.

## [0.27.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt; additive Migration läuft
automatisch.

### Added
- Drei weitere **Studio-Benachrichtigungen** (alle unter Einstellungen →
  „E-Mail-Benachrichtigungen" abschaltbar, standardmäßig an):
  - **Uploads eingegangen**: Ein Kunde hat über einen Upload-Link Dateien
    hochgeladen. Gebündelt — ein Batch vieler Dateien löst nur eine Mail aus
    (Fenster ~15 min pro Link).
  - **Team-Mitglied beigetreten**: Ein eingeladenes Mitglied hat sein Konto
    eingerichtet → Mail an die übrigen Owner/Admins.
  - **Galerie läuft bald ab**: ab 7 Tagen vor dem Ablaufdatum (einmalig; wird
    zurückgesetzt, falls das Ablaufdatum verlängert/entfernt wird).

**🇬🇧 English**

New feature. `git pull` + a regular deploy is enough; an additive migration runs
automatically.

### Added
- Three more **studio notifications** (all switchable under Settings → "Email
  notifications", on by default):
  - **Uploads received**: a customer uploaded files via an upload link. Batched
    — a batch of many files triggers only one mail (window ~15 min per link).
  - **Team member joined**: an invited member set up their account → mail to the
    remaining owners/admins.
  - **Gallery expiring soon**: from 7 days before the expiry date (once; reset
    if the expiry date is extended/removed).

## [0.26.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt; additive Migration läuft
automatisch.

### Added
- **Super-Admin-Benachrichtigungen.** Bei jedem neuen Self-Service-Signup geht
  eine Mail an alle Super-Admins (Name, Slug, Plan, Owner). Zusätzlich ein
  **täglicher Report** an alle Super-Admins: neue Tenants der letzten 24 h,
  Plattform-Kennzahlen (aktive Tenants, User, Gesamtspeicher), Top-Speicher und
  Tenants nahe am Limit (≥90 %). Läuft über den Sweeper, idempotent (genau
  einmal pro Tag). Beides nur im SaaS-Mode (`BILLING_ENABLED`); ohne Billing
  bleibt alles still.

**🇬🇧 English**

New feature. `git pull` + a regular deploy is enough; an additive migration runs
automatically.

### Added
- **Super-admin notifications.** On every new self-service signup a mail goes to
  all super admins (name, slug, plan, owner). Plus a **daily report** to all
  super admins: new tenants in the last 24h, platform metrics (active tenants,
  users, total storage), top storage and tenants near the limit (≥90%). Runs via
  the sweeper, idempotent (exactly once per day). Both only in SaaS mode
  (`BILLING_ENABLED`); without billing everything stays quiet.

## [0.25.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt; additive Migration läuft
automatisch.

### Added
- **Studio-E-Mail-Benachrichtigungen steuerbar.** Unter Einstellungen →
  „E-Mail-Benachrichtigungen" kann das Studio pro Event an-/abschalten, was per
  Mail kommt: neuer Kommentar, abgeschlossene Auswahl, neue Print-Bestellung.
- Neue Benachrichtigung **„Speicher fast voll"**: ab 90 % Tarif-Auslastung
  bekommt der Owner eine Mail (mit Throttle, höchstens einmal pro Woche, Reset
  sobald wieder unter Schwelle). Läuft über den periodischen Sweeper.

### Changed
- Die bestehenden Studio-Mails (Kommentar, Auswahl, Print-Bestellung) sind jetzt
  über diese Einstellungen abschaltbar. Kunden-Mails (Galerie-Einladung,
  ZIP-Download-fertig) bleiben unberührt.

**🇬🇧 English**

New feature. `git pull` + a regular deploy is enough; an additive migration runs
automatically.

### Added
- **Studio email notifications now controllable.** Under Settings → "Email
  notifications" the studio can toggle per event what arrives by mail: new
  comment, completed selection, new print order.
- New notification **"Storage almost full"**: from 90% plan usage the owner gets
  a mail (throttled, at most once per week, reset once back below the threshold).
  Runs via the periodic sweeper.

### Changed
- The existing studio mails (comment, selection, print order) are now switchable
  via these settings. Customer mails (gallery invitation, ZIP download ready)
  remain untouched.

## [0.24.0] - 2026-06-04

Neues optionales Feature. `git pull` + regulärer Deploy genügt; ohne Konfiguration
ändert sich nichts.

### Added
- **CAPTCHA (Cloudflare Turnstile) auf dem Self-Service-Signup.** Schützt den
  öffentlichen Signup-Endpoint zusätzlich zum bestehenden Rate-Limit gegen
  Bots. Nur aktiv, wenn `TURNSTILE_SECRET_KEY` (API) gesetzt ist — sonst
  bleibt der Signup wie bisher, Self-Hoster/Single-Mode brauchen nichts. Auf
  der Marketing-Site (`lumio-cloud.de`) muss zusätzlich der passende
  `PUBLIC_TURNSTILE_SITE_KEY` als Build-Arg gesetzt sein, damit das Widget
  erscheint. Verifikation ist fail-closed (kann der Token nicht geprüft
  werden, wird der Signup abgelehnt). Keys gibt es im Cloudflare-Dashboard
  (kostenlos, keine Domain bei Cloudflare nötig).

**🇬🇧 English**

New optional feature. `git pull` + a regular deploy is enough; without
configuration nothing changes.

### Added
- **CAPTCHA (Cloudflare Turnstile) on self-service signup.** Protects the public
  signup endpoint against bots in addition to the existing rate limit. Only
  active when `TURNSTILE_SECRET_KEY` (API) is set — otherwise signup stays as
  before, self-hosters/single mode need nothing. On the marketing site
  (`lumio-cloud.de`) the matching `PUBLIC_TURNSTILE_SITE_KEY` must additionally
  be set as a build arg for the widget to appear. Verification is fail-closed (if
  the token can't be verified, the signup is rejected). Keys are available in the
  Cloudflare dashboard (free, no domain at Cloudflare needed).

## [0.23.0] - 2026-06-04

Neues Feature. **Wichtig:** nach dem Deploy Caddy einmal reloaden (siehe unten),
damit der neue CSP-Header aktiv wird.

### Added
- **CSP-Report-Sink + Auswertung.** Die Content-Security-Policy (weiterhin
  Report-Only) meldet Verstöße jetzt an `/api/v1/csp-report`. Aggregiert nach
  Directive + blockierter Quelle in der neuen Tabelle `csp_violations`
  (Upsert + Zähler, beschränkte Menge). Neue Super-Admin-Seite `/super/csp`
  zeigt die Verstöße nach Häufigkeit, mit „Leeren". Datenbasis, um die Policy
  vor dem Scharfschalten (enforced) gegen echten Traffic zu tunen — das
  Enforcen selbst folgt später separat.

**🇬🇧 English**

New feature. **Important:** after the deploy, reload Caddy once (see below) so
the new CSP header becomes active.

### Added
- **CSP report sink + evaluation.** The Content Security Policy (still
  Report-Only) now reports violations to `/api/v1/csp-report`. Aggregated by
  directive + blocked source in the new table `csp_violations` (upsert +
  counter, bounded volume). A new super-admin page `/super/csp` shows the
  violations by frequency, with "Clear". A data basis to tune the policy against
  real traffic before enforcing it — the enforcing itself follows separately
  later.

## [0.22.3] - 2026-06-04

Kleine Verbesserung. `git pull` + regulärer Deploy genügt.

### Changed
- Super-Admin User-Liste: Das Suchfeld findet User jetzt auch über ihren
  Tenant (Name, Anzeigename, Slug) — praktisch, wenn es viele Tenants gibt und
  das Dropdown lang wird. Der Tenant-Filter bleibt zusätzlich erhalten.

**🇬🇧 English**

A small improvement. `git pull` + a regular deploy is enough.

### Changed
- Super-admin user list: the search field now also finds users via their tenant
  (name, display name, slug) — handy when there are many tenants and the
  dropdown gets long. The tenant filter is additionally retained.

## [0.22.2] - 2026-06-04

Kleine UI-Ergänzung. `git pull` + regulärer Deploy genügt, nur Frontend.

### Added
- Super-Admin User-Liste: zusätzlicher Filter nach Tenant (neben Rolle und
  Status).

**🇬🇧 English**

A small UI addition. `git pull` + a regular deploy is enough, frontend only.

### Added
- Super-admin user list: an additional filter by tenant (alongside role and
  status).

## [0.22.1] - 2026-06-04

Kleine UI-Ergänzung. `git pull` + regulärer Deploy genügt, nur Frontend.

### Changed
- Übersicht: Im Signups-Balkendiagramm steht über jedem Balken mit Signups
  jetzt die Anzahl.

**🇬🇧 English**

A small UI addition. `git pull` + a regular deploy is enough, frontend only.

### Changed
- Overview: in the signups bar chart the count is now shown above each bar that
  has signups.

## [0.22.0] - 2026-06-04

Neues Feature + Fixes. `git pull` + regulärer Deploy genügt.

### Added
- Super-Admin: neue globale **User-Liste** (`/super/users`) über alle Tenants
  mit Suche (E-Mail/Name) und Filtern (Rolle, Status, Tenant). Jeder User zeigt
  seinen Tenant — gleiche E-Mail in mehreren Tenants ist damit eindeutig.
  Bearbeiten von Name/Rolle/Status (mit Last-Owner-Schutz), Passwort-Reset-Link
  und Anlegen neuer User pro Tenant (Einladung mit Setup-Mail). Kein Hard-Delete
  — zum Sperren „disabled" setzen.

### Fixed
- Update-Check (System): das hinterlegte Forgejo-Lesetoken
  (`LUMIO_UPDATE_REPO_TOKEN`) wurde nicht an den API-Container durchgereicht,
  daher weiterhin „nicht erreichbar (HTTP 404)". Die Update-Check-Variablen
  werden jetzt korrekt durchgereicht. Leeres `LUMIO_UPDATE_REPO_URL`
  überschreibt nicht mehr versehentlich die Standardquelle.
- Übersicht: Der Signups-Trend wurde als einzelnes verzerrtes Quadrat statt als
  Balkendiagramm dargestellt. Jetzt ein sauberes Balkendiagramm über 12 Wochen
  (leere Wochen als Grundlinie sichtbar).

**🇬🇧 English**

New feature + fixes. `git pull` + a regular deploy is enough.

### Added
- Super admin: a new global **user list** (`/super/users`) across all tenants
  with search (email/name) and filters (role, status, tenant). Each user shows
  their tenant — so the same email in multiple tenants is unambiguous. Editing
  name/role/status (with last-owner protection), a password-reset link and
  creating new users per tenant (invitation with a setup mail). No hard delete —
  set "disabled" to block.

### Fixed
- Update check (System): the configured Forgejo read token
  (`LUMIO_UPDATE_REPO_TOKEN`) wasn't passed through to the API container, hence
  still "not reachable (HTTP 404)". The update-check variables are now passed
  through correctly. An empty `LUMIO_UPDATE_REPO_URL` no longer accidentally
  overrides the default source.
- Overview: the signups trend was shown as a single distorted square instead of
  a bar chart. Now a clean bar chart over 12 weeks (empty weeks visible as a
  baseline).

## [0.21.0] - 2026-06-04

Neues Feature + Fixes. `git pull` + regulärer Deploy genügt. Optionaler
Schritt für den Update-Check siehe Hinweis unten.

### Added
- Super-Admin-Übersicht zeigt jetzt kostenlose (comped) Studios: eine eigene
  Kennzahl „Kostenlos (comped)" und pro Plan in der Plan-Verteilung ein
  „davon N kostenlos". So sind Partner-/Goodwill-Konten von zahlenden trennbar.

### Fixed
- Update-Check (Super-Admin → System): zeigte die aktuelle Version als
  „unknown" und fragte eine nicht existierende Quelle ab (HTTP-Fehler). Die
  Version kommt jetzt zuverlässig aus der gestempelten Versionsdatei, und der
  Check fragt standardmäßig das Lumio-Repo auf Forgejo ab.

> **Hinweis (optional):** Da das Forgejo-Repo privat ist, braucht der
> Update-Check ein Lesetoken. In der `.env` setzen:
> `LUMIO_UPDATE_REPO_TOKEN=<read-only-token>` (siehe `.env.example.full`).
> Ohne Token zeigt der Check „nicht erreichbar" — die aktuelle Version wird
> trotzdem korrekt angezeigt. Alternativ eigene Quelle via
> `LUMIO_UPDATE_REPO_URL` oder Abschalten mit `DISABLE_UPDATE_CHECK=1`.

**🇬🇧 English**

New feature + fixes. `git pull` + a regular deploy is enough. For the optional
update-check step see the note below.

### Added
- The super-admin overview now shows free (comped) studios: a dedicated metric
  "Free (comped)" and, per plan in the plan distribution, an "of which N free".
  This separates partner/goodwill accounts from paying ones.

### Fixed
- Update check (super admin → System): showed the current version as "unknown"
  and queried a non-existent source (HTTP error). The version now reliably comes
  from the stamped version file, and the check queries the Lumio repo on Forgejo
  by default.

> **Note (optional):** since the Forgejo repo is private, the update check needs
> a read token. Set in `.env`: `LUMIO_UPDATE_REPO_TOKEN=<read-only-token>` (see
> `.env.example.full`). Without a token the check shows "not reachable" — the
> current version is still shown correctly. Alternatively a custom source via
> `LUMIO_UPDATE_REPO_URL`, or disable with `DISABLE_UPDATE_CHECK=1`.

## [0.20.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt, nur Frontend.

### Added
- Studios mit kostenlosem (oder Trial-)Abo können denselben Plan jetzt direkt
  im Studio kostenpflichtig buchen — der aktuelle Plan zeigt dafür einen
  „Jetzt kostenpflichtig buchen"-Button statt nur „Aktueller Plan". Das macht
  das vorherige Entfernen des Gratis-Abos durch den Super-Admin überflüssig,
  wenn der Kunde beim selben Plan bleiben will. Echte (bereits zahlende)
  Stripe-Abos zeigen weiterhin „Aktueller Plan" ohne Button.

**🇬🇧 English**

New feature. `git pull` + a regular deploy is enough, frontend only.

### Added
- Studios with a free (or trial) subscription can now book the same plan as a
  paid one directly in the studio — the current plan shows a "Book paid now"
  button instead of just "Current plan". This removes the need for the super
  admin to first remove the free subscription if the customer wants to stay on
  the same plan. Real (already paying) Stripe subscriptions still show "Current
  plan" without a button.

## [0.19.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt.

### Added
- Super-Admin: Im Studio-Detail kann ein kostenloses Abo jetzt per Button
  „Abo entfernen" zurückgesetzt werden. Danach hat das Studio kein Abo mehr und
  der Owner kann im Studio ganz normal über Stripe einen Plan buchen — kein
  Eingriff in die Datenbank mehr nötig. Stripe-Abos sind davon ausgenommen
  (die werden weiter über Archivieren bzw. das Stripe-Dashboard gekündigt).

### Fixed
- Bucht ein Studio mit kostenlosem Abo später selbst einen Stripe-Plan, wird
  es jetzt korrekt als zahlend geführt (vorher blieb die interne „Gratis"-
  Markierung bestehen und das Studio fehlte in der Umsatz-Auswertung).

**🇬🇧 English**

New feature. `git pull` + a regular deploy is enough.

### Added
- Super admin: in the studio detail a free subscription can now be reset via a
  "Remove subscription" button. The studio then has no subscription and the
  owner can book a plan in the studio quite normally via Stripe — no database
  intervention needed anymore. Stripe subscriptions are exempt (those are still
  cancelled via archiving or the Stripe dashboard).

### Fixed
- If a studio with a free subscription later books a Stripe plan itself, it is
  now correctly counted as paying (previously the internal "free" marker
  persisted and the studio was missing from the revenue evaluation).

## [0.18.1] - 2026-06-04

Bugfix. `git pull` + regulärer Deploy genügt.

### Fixed
- Manuelle Plan-Zuweisung im Super-Admin ist jetzt immer ein kostenloses Abo.
  Der frühere „Gratis"-Schalter konnte abgewählt werden, ohne dass dadurch ein
  Bezahl-Vorgang ausgelöst wurde — das Studio bekam den Plan trotzdem gratis,
  wurde aber fälschlich als zahlend in der Umsatz-Auswertung (MRR) gezählt. Der
  Schalter ist entfernt; zahlende Kunden buchen weiterhin über den regulären
  Stripe-Ablauf im Studio.

**🇬🇧 English**

Bugfix. `git pull` + a regular deploy is enough.

### Fixed
- Manual plan assignment in the super admin is now always a free subscription.
  The previous "free" toggle could be unchecked without triggering a payment —
  the studio got the plan for free anyway, but was wrongly counted as paying in
  the revenue evaluation (MRR). The toggle is removed; paying customers still
  book via the regular Stripe flow in the studio.

## [0.18.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt, nur Frontend.

### Added
- Super-Admin: Im Studio-Detail gibt es jetzt einen Button „Plan zuweisen /
  ändern". Damit lässt sich einem Studio direkt ein Plan geben — wahlweise als
  kostenloses Abo (für Partner), inkl. optionalem Zusatz-Speicher. Studios ohne
  Abo zeigen den Button ebenfalls, sodass sie freigeschaltet werden können.
  Bei Stripe-Studios ist der manuelle Wechsel ausgeblendet (gehört ins
  Stripe-Dashboard). Kostenlose Abos sind im Detail klar als „Gratis (comped)"
  markiert.

**🇬🇧 English**

New feature. `git pull` + a regular deploy is enough, frontend only.

### Added
- Super admin: the studio detail now has a "Assign / change plan" button. It
  lets you give a studio a plan directly — optionally as a free subscription
  (for partners), incl. optional extra storage. Studios without a subscription
  show the button too, so they can be enabled. For Stripe studios the manual
  switch is hidden (belongs in the Stripe dashboard). Free subscriptions are
  clearly marked as "Free (comped)" in the detail.

## [0.17.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt; die DB-Migration läuft
beim Start automatisch (`prisma migrate deploy`), kein manueller Eingriff.

### Added
- Super-Admin kann einem Studio jetzt manuell einen Plan zuweisen — auch als
  kostenloses Abo (z.B. für Partner oder Goodwill), ohne Stripe und ohne
  hinterlegte Karte. Solche Abos laufen dauerhaft (kein Trial-Ablauf) und
  werden nicht automatisch wegen fehlender Zahlung archiviert. Beim Anlegen
  eines neuen Studios kann der Plan direkt mitgegeben werden, sodass ein
  Partner ohne den normalen Bezahl-Ablauf sofort startklar ist.
- Optionaler Zusatz-Speicher (GiB) lässt sich beim Zuweisen direkt mitgeben.

### Changed
- Manuell zugewiesene Gratis-Abos werden aus der Umsatz-Auswertung (MRR)
  ausgeschlossen, damit Partner-/Goodwill-Konten den Umsatz nicht verfälschen.
- Schutz: Hat ein Studio bereits ein über Stripe laufendes Abo, lehnt der
  manuelle Plan-Wechsel ab — solche Änderungen gehören weiterhin ins
  Stripe-Dashboard, damit Datenbank und Stripe nicht auseinanderlaufen.

**🇬🇧 English**

New feature. `git pull` + a regular deploy is enough; the DB migration runs
automatically at start (`prisma migrate deploy`), no manual intervention.

### Added
- The super admin can now assign a plan to a studio manually — also as a free
  subscription (e.g. for partners or goodwill), without Stripe and without a
  card on file. Such subscriptions run permanently (no trial expiry) and are not
  automatically archived for missing payment. When creating a new studio the
  plan can be assigned directly, so a partner is ready to go immediately without
  the normal payment flow.
- Optional extra storage (GiB) can be assigned directly at assignment time.

### Changed
- Manually assigned free subscriptions are excluded from the revenue evaluation
  (MRR) so partner/goodwill accounts don't distort revenue.
- Protection: if a studio already has a subscription running via Stripe, the
  manual plan switch is refused — such changes still belong in the Stripe
  dashboard so the database and Stripe don't diverge.

## [0.16.2] - 2026-06-04

Bugfix. `git pull` + regulärer Deploy genügt; die Korrektur greift beim
nächsten API-Start automatisch, keine manuelle Aktion nötig.

### Fixed
- Plan-Limits (z.B. Speicher) wurden in der Super-Admin-Ansicht teils mit
  veralteten Werten angezeigt, weil die Plan-Tabelle in der Datenbank nur
  beim allerersten Start befüllt und danach nie wieder aktualisiert wurde.
  Spätere Änderungen an Limits oder Preisen kamen so nie in der DB an. Die
  Pläne werden jetzt bei jedem Start mit der zentralen Plan-Definition
  abgeglichen. Stripe-Preis-IDs und Sonderkonditionen bleiben dabei
  unangetastet.

**🇬🇧 English**

Bugfix. `git pull` + a regular deploy is enough; the fix takes effect at the
next API start automatically, no manual action needed.

### Fixed
- Plan limits (e.g. storage) were sometimes shown with stale values in the
  super-admin view, because the plan table in the database was only filled at
  the very first start and never updated afterwards. Later changes to limits or
  prices thus never reached the DB. The plans are now reconciled with the
  central plan definition at every start. Stripe price IDs and special
  conditions remain untouched.

## [0.16.1] - 2026-06-04

Bugfix. `git pull` + regulärer Deploy genügt. Nur Frontend.

### Fixed
- Kunden-Galerie: Das „Herunterladen"-Dropdown war halbtransparent und ließ
  die darunterliegenden Tag-Filter-Chips durchscheinen — es wirkte, als läge
  das Menü hinter den Tags. Schwebende Menüs nutzen jetzt einen deckenden
  Hintergrund.

**🇬🇧 English**

Bugfix. `git pull` + a regular deploy is enough. Frontend only.

### Fixed
- Customer gallery: the "Download" dropdown was semi-transparent and let the
  tag-filter chips below show through — it looked as if the menu was behind the
  tags. Floating menus now use an opaque background.

## [0.16.0] - 2026-06-04

Nur SaaS. `git pull` + regulärer Deploy genügt, keine `.env`- oder
Compose-Änderung. **Hinweis:** Der Deploy hebt die AVV-Version an — alle
Studios müssen die Auftragsverarbeitung beim nächsten Login erneut bestätigen.
Vor dem Deploy den §9-Wortlaut mit dem/der Datenschutzbeauftragten abstimmen.

### Changed
- Auftragsverarbeitungsvertrag (AVV) §9 „Löschung und Rückgabe nach
  Beendigung" an den Archiv-Lifecycle (v0.15.0) angepasst: Nach Vertragsende
  Nur-Lese-Modus zum Export, danach inaktives Archiv, endgültige Löschung
  spätestens zwölf Monate nach Vertragsende; Reaktivierung bei erneutem Abo.
  Technisch-organisatorische Maßnahmen (Löschkonzept) entsprechend aktualisiert.
  AVV-Version `1.0` → `1.1` (erneute Zustimmung erforderlich).

**🇬🇧 English**

SaaS only. `git pull` + a regular deploy is enough, no `.env` or Compose change.
**Note:** the deploy bumps the DPA version — all studios must re-accept the data
processing agreement at the next login. Before the deploy, coordinate the §9
wording with the data protection officer.

### Changed
- Data processing agreement (DPA) §9 "Deletion and return after termination"
  aligned with the archive lifecycle (v0.15.0): after contract end read-only
  mode for export, then an inactive archive, final deletion at the latest twelve
  months after contract end; reactivation on a new subscription. The technical/
  organizational measures (deletion concept) updated accordingly. DPA version
  `1.0` → `1.1` (re-acceptance required).

## [0.15.0] - 2026-06-04

Neues Feature (nur SaaS / `BILLING_ENABLED`). `git pull` + regulärer Deploy
genügt — die Migration ist additiv, die neuen Umgebungsvariablen sind optional
mit Defaults. Nur API. Self-Hoster ohne Billing sind nicht betroffen.

### Added
- **Archiv-Lifecycle für gekündigte SaaS-Studios.** Statt unbegrenztem
  Read-only nach Abo-Ende durchläuft ein Studio jetzt einen begrenzten
  Lebenszyklus: Read-only (Kunden-Galerien zunächst weiter erreichbar) → nach
  30 Tagen Archiv (Galerien offline, Vorschauen aus dem Speicher entfernt,
  Original-Dateien bleiben) → endgültige Löschung 12 Monate nach Abo-Ende. Die
  Owner werden bei der Archivierung und erneut ~30 Tage vor der Löschung per
  Mail informiert. Schließt der Owner vorher wieder ein Abo ab, wird das Studio
  reaktiviert und die Vorschauen werden automatisch neu erzeugt.
- Zwei neue optionale Umgebungsvariablen: `BILLING_ARCHIVE_AFTER_DAYS`
  (Default `30`) und `BILLING_PURGE_AFTER_MONTHS` (Default `12`).

### Changed
- Öffentliche Kunden-Galerien eines archivierten Studios antworten jetzt mit
  „vorübergehend nicht verfügbar", bis wieder ein aktives Abo besteht.

**🇬🇧 English**

New feature (SaaS only / `BILLING_ENABLED`). `git pull` + a regular deploy is
enough — the migration is additive, the new environment variables are optional
with defaults. API only. Self-hosters without billing are not affected.

### Added
- **Archive lifecycle for cancelled SaaS studios.** Instead of unlimited
  read-only after subscription end, a studio now goes through a bounded
  lifecycle: read-only (customer galleries initially still reachable) → after 30
  days an archive (galleries offline, previews removed from storage, original
  files kept) → final deletion 12 months after subscription end. The owners are
  informed by mail at archiving and again ~30 days before deletion. If the owner
  takes out a subscription again before then, the studio is reactivated and the
  previews are regenerated automatically.
- Two new optional environment variables: `BILLING_ARCHIVE_AFTER_DAYS` (default
  `30`) and `BILLING_PURGE_AFTER_MONTHS` (default `12`).

### Changed
- Public customer galleries of an archived studio now respond with "temporarily
  unavailable" until an active subscription exists again.

## [0.14.7] - 2026-06-02

Bugfix-Release. `git pull` + regulärer Deploy genügt. Nur API.

### Fixed
- Stripe-Rücksprung loggte aus: Wer das Kunden-Portal oder den Checkout über
  seine eigene Studio-Adresse (z.B. `name.deine-domain.de`) öffnete und bei
  Stripe auf „Zurück" klickte, landete ausgeloggt mit „authentication
  required". Grund: Stripe leitete fest auf den zentralen Studio-Host zurück,
  nicht auf die Adresse, über die der Nutzer eingeloggt war — dort fehlte das
  Sitzungs-Cookie. Stripe kehrt jetzt immer auf genau den Host zurück, von dem
  der Nutzer kam (Subdomain wie Custom-Domain). Betrifft nur SaaS-/Multi-Mode
  mit aktiviertem Billing; Single-Mode ohne Stripe ist unberührt.

**🇬🇧 English**

Bugfix release. `git pull` + a regular deploy is enough. API only.

### Fixed
- The Stripe return logged you out: anyone opening the customer portal or
  checkout via their own studio address (e.g. `name.your-domain.com`) and
  clicking "Back" in Stripe landed logged out with "authentication required".
  Reason: Stripe redirected to the central studio host fixedly, not to the
  address the user was logged in on — where the session cookie was missing.
  Stripe now always returns to exactly the host the user came from (subdomain as
  well as custom domain). Affects only SaaS/multi mode with billing enabled;
  single mode without Stripe is untouched.

## [0.14.6] - 2026-06-02

Bugfix-Release. `git pull` + regulärer Deploy genügt. Reines Frontend.

### Fixed
- Modals und einige Eingabefelder waren teilweise durchsichtig — der Inhalt
  dahinter schimmerte durch und war schwer lesbar (z.B. das „Mitglied
  bearbeiten"-Dialog im Team-Bereich). Ursache war ein nicht definiertes
  Design-Token (`surface-base`), das an vielen Stellen für den Hintergrund
  genutzt wurde, aber gar keine Farbe erzeugte. Das Token ist jetzt zentral
  definiert; alle betroffenen Flächen sind in hellem wie dunklem Modus wieder
  blickdicht.

**🇬🇧 English**

Bugfix release. `git pull` + a regular deploy is enough. Pure frontend.

### Fixed
- Modals and some input fields were partly transparent — the content behind
  shimmered through and was hard to read (e.g. the "Edit member" dialog in the
  team area). The cause was an undefined design token (`surface-base`) used in
  many places for the background but producing no color at all. The token is now
  defined centrally; all affected surfaces are opaque again in both light and
  dark mode.

## [0.14.5] - 2026-06-02

Bugfix-Release. `git pull` + regulärer Deploy genügt. Reines Frontend.

### Fixed
- Slideshow: Der „Fade"-Effekt animierte gar nicht — das neue Bild erschien
  hart, statt einzublenden. Ursache: Fade nutzte eine CSS-Transition, die
  auf dem bei jedem Bildwechsel neu eingehängten Layer nicht auslöst.
  Umgestellt auf eine echte Keyframe-Animation (wie Slide/Ken Burns), jetzt
  blendet das Bild sauber über. (Erst sichtbar geworden, seit das Aufblitzen
  in 0.14.4 behoben war.)

**🇬🇧 English**

Bugfix release. `git pull` + a regular deploy is enough. Pure frontend.

### Fixed
- Slideshow: the "fade" effect didn't animate at all — the new image appeared
  hard instead of fading in. Cause: fade used a CSS transition that doesn't fire
  on the layer remounted on each image change. Switched to a real keyframe
  animation (like slide/Ken Burns), now the image cross-fades cleanly. (Only
  became visible once the flash in 0.14.4 was fixed.)

## [0.14.4] - 2026-06-02

Bugfix-Release. `git pull` + regulärer Deploy genügt. Reines Frontend.

### Fixed
- Slideshow: Beim Bildwechsel blitzte es kurz auf, weil das nächste
  (hochauflösende) Bild erst im Moment des Übergangs zu laden begann — der
  eingestellte Effekt (Fade/Slide/Ken Burns) lief dadurch gegen ein leeres
  Bild. Die kommenden Bilder werden jetzt vorausgeladen und dekodiert, der
  Übergang ist sauber.

**🇬🇧 English**

Bugfix release. `git pull` + a regular deploy is enough. Pure frontend.

### Fixed
- Slideshow: on image change there was a brief flash, because the next
  (high-resolution) image only started loading at the moment of the transition —
  so the configured effect (fade/slide/Ken Burns) ran against an empty image.
  The upcoming images are now preloaded and decoded, the transition is clean.

## [0.14.3] - 2026-06-02

Bugfix-Release. `git pull` + regulärer Deploy genügt. Reines Frontend.

### Fixed
- Kundengalerie: Die Ansicht sprang beim Scrollen während des Nachladens
  von selbst nach oben. Ursache war eine fehlende „auto"-Größenmerkung der
  Bildkacheln (content-visibility) — die Kacheln kollabierten beim
  Auslagern auf einen festen Schätzwert und verschoben das Layout. Behoben.
- Kundengalerie: In Brave (und teils anderen Chromium-Browsern) blieben
  beim schnellen Scrollen einzelne Thumbnails als „?" hängen, weil der
  Bild-Load abgebrochen wurde. Thumbnails versuchen sich jetzt bis zu 2×
  selbst neu zu laden und zeigen im Fehlerfall einen neutralen Platzhalter
  statt des Broken-Image-Symbols.

**🇬🇧 English**

Bugfix release. `git pull` + a regular deploy is enough. Pure frontend.

### Fixed
- Customer gallery: the view jumped to the top by itself while scrolling during
  lazy loading. The cause was a missing "auto" size memory of the image tiles
  (content-visibility) — the tiles collapsed to a fixed estimate when offloaded
  and shifted the layout. Fixed.
- Customer gallery: in Brave (and partly other Chromium browsers) individual
  thumbnails got stuck as "?" on fast scrolling, because the image load was
  aborted. Thumbnails now try to reload themselves up to 2× and, on failure,
  show a neutral placeholder instead of the broken-image symbol.

## [0.14.2] - 2026-06-02

Tuning-Release. `git pull` + regulärer Deploy genügt. Reines Frontend.

### Changed
- Logo-Größe „groß" weiter angehoben: jetzt 160/256 px (mobil/Desktop).

**🇬🇧 English**

Tuning release. `git pull` + a regular deploy is enough. Pure frontend.

### Changed
- Logo size "large" raised further: now 160/256 px (mobile/desktop).

## [0.14.1] - 2026-06-02

Bugfix-/Tuning-Release. Für Self-Hoster genügt `git pull` + regulärer
Deploy — keine `.env`-, Compose- oder DB-Änderungen nötig. Reines Frontend.

### Changed
- Logo-Anzeigegrößen im Kunden-Hero nach oben korrigiert — „groß" war in
  großen Heros noch zu klein. Neue Höhen: klein 56/80 px, mittel 80/128 px,
  groß 128/224 px (mobil/Desktop).

**🇬🇧 English**

Bugfix/tuning release. For self-hosters `git pull` + a regular deploy is enough
— no `.env`, Compose or DB changes needed. Pure frontend.

### Changed
- Logo display sizes in the customer hero corrected upward — "large" was still
  too small in large heros. New heights: small 56/80 px, medium 80/128 px, large
  128/224 px (mobile/desktop).

## [0.14.0] - 2026-06-02

Feature-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy.
Die DB-Migration (neue Spalte mit Default) läuft beim API-Start
automatisch durch — kein manueller Schritt, kein Breaking Change.

### Added
- Galerie-Logo: Im Galerie-Header lässt sich jetzt die Anzeigegröße des
  Logos wählen — klein / mittel / groß (Auswahl direkt neben dem
  Logo-Upload, die Vorschau spiegelt die Größe). Hintergrund: Logos
  werden per Höhe skaliert, daher wirkten Quer- und Hochformate
  unterschiedlich groß; die Einstellung gibt dem Studio jetzt Kontrolle.
  Bestehende Galerien stehen auf „mittel".

**🇬🇧 English**

Feature release. For self-hosters `git pull` + a regular deploy is enough. The
DB migration (a new column with a default) runs automatically at API start — no
manual step, no breaking change.

### Added
- Gallery logo: in the gallery header you can now choose the display size of the
  logo — small / medium / large (selection right next to the logo upload, the
  preview reflects the size). Background: logos are scaled by height, so
  landscape and portrait formats appeared different in size; the setting now
  gives the studio control. Existing galleries are set to "medium".

## [0.13.0] - 2026-06-02

Feature-/UI-Release. Für Self-Hoster genügt `git pull` + regulärer
Deploy — keine `.env`-, Compose- oder DB-Änderungen nötig. Reines Frontend.

### Changed
- Kundengalerie-Leiste entrümpelt: Die bis zu vier Download-Buttons
  (Alle / Auswahl × Original / Web-Version) sind jetzt in einem
  aufklappbaren „Herunterladen"-Menü gebündelt — die Aktionen selbst sind
  unverändert. Das Sortier-Auswahlfeld sitzt jetzt links bei den Filtern
  (statt zwischen den Aktions-Buttons), weil beides die Ansicht steuert.

**🇬🇧 English**

Feature/UI release. For self-hosters `git pull` + a regular deploy is enough —
no `.env`, Compose or DB changes needed. Pure frontend.

### Changed
- Customer-gallery bar decluttered: the up to four download buttons
  (All / Selection × Original / Web version) are now bundled in a collapsible
  "Download" menu — the actions themselves are unchanged. The sort selector now
  sits on the left with the filters (instead of between the action buttons),
  because both control the view.

## [0.12.2] - 2026-06-02

Bugfix-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig. Reines Frontend.

### Fixed
- Die in 0.12.0 eingeführte Kundengalerie-Sortierung (Name/Aufnahmedatum)
  hat zwar die Slideshow- und Lightbox-Reihenfolge beeinflusst, aber NICHT
  das sichtbare Bilderraster — das Auswahlfeld wirkte dadurch wirkungslos.
  Das Raster (inkl. Section-Ansicht) berücksichtigt die gewählte
  Sortierung jetzt korrekt.

**🇬🇧 English**

Bugfix release. For self-hosters `git pull` + a regular deploy is enough — no
`.env`, Compose or DB changes needed. Pure frontend.

### Fixed
- The customer-gallery sorting introduced in 0.12.0 (name/capture date) affected
  the slideshow and lightbox order, but NOT the visible image grid — so the
  selector seemed to have no effect. The grid (incl. section view) now respects
  the chosen sorting correctly.

## [0.12.1] - 2026-06-02

Bugfix-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig.

### Fixed
- Der Aufnahmedatum-Backfill (`tasks.backfill_taken_at`) war in 0.12.0
  nicht beim Worker registriert — der Aufruf lief ins Leere (Task-ID
  kam zurück, aber kein Worker führte ihn aus, keine Log-Ausgabe, kein
  `takenAt` geschrieben). Task ist jetzt registriert und läuft. Wer auf
  0.12.0 schon vergeblich gestartet hat: nach dem Update einfach erneut
  aufrufen. (Automatische Extraktion bei NEUEN Uploads war nie betroffen.)

**🇬🇧 English**

Bugfix release. For self-hosters `git pull` + a regular deploy is enough — no
`.env`, Compose or DB changes needed.

### Fixed
- The capture-date backfill (`tasks.backfill_taken_at`) was not registered with
  the worker in 0.12.0 — the call ran into nothing (a task ID came back, but no
  worker executed it, no log output, no `takenAt` written). The task is now
  registered and runs. Anyone who already started it in vain on 0.12.0: just call
  it again after the update. (Automatic extraction on NEW uploads was never
  affected.)

## [0.12.0] - 2026-06-02

Feature-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig. Für korrektes Sortieren
nach Aufnahmedatum bei BESTEHENDEN Dateien ist einmalig ein optionaler
Backfill nötig (siehe unten) — neue Uploads bekommen das Datum automatisch.

### Added
- Kundengalerie: Besucher können die Anzeige jetzt nach Name oder
  Aufnahmedatum sortieren (kleines Auswahlfeld in der Galerie-Leiste).
  Die Sortierung ist rein optisch und temporär — die manuell im Studio
  festgelegte Reihenfolge bleibt der Standard und wird nicht verändert;
  beim Neuladen ist wieder die Galerie-Reihenfolge aktiv. Dateien ohne
  Aufnahmedatum landen beim Datums-Sortieren am Ende.
- Worker liest beim Verarbeiten von Bildern und RAWs nun den
  Aufnahmezeitpunkt aus den EXIF-Daten aus und speichert ihn (`takenAt`).
  Grundlage für die Datums-Sortierung oben.

### ⚠️ Hinweis (kein Breaking Change)
- Bestehende Bilder/RAWs haben noch kein Aufnahmedatum und würden beim
  Sortieren nach Aufnahmedatum ans Ende rutschen. Einmaliger Backfill,
  galerieübergreifend in Batches (Default 500):

  ```
  docker compose exec worker celery -A app call \
      tasks.backfill_taken_at.run_global
  ```

  Mehrfach startbar; verarbeitet bei jedem Aufruf den nächsten Batch.
  Optional — die Galerie funktioniert auch ohne.

**🇬🇧 English**

Feature release. For self-hosters `git pull` + a regular deploy is enough — no
`.env`, Compose or DB changes needed. For correct sorting by capture date on
EXISTING files, a one-time optional backfill is needed (see below) — new uploads
get the date automatically.

### Added
- Customer gallery: visitors can now sort the display by name or capture date (a
  small selector in the gallery bar). The sorting is purely visual and temporary
  — the order set manually in the studio stays the default and is not changed; on
  reload the gallery order is active again. Files without a capture date land at
  the end when sorting by date.
- The worker now reads the capture time from the EXIF data when processing images
  and RAWs and stores it (`takenAt`). The basis for the date sorting above.

### ⚠️ Note (no breaking change)
- Existing images/RAWs have no capture date yet and would slide to the end when
  sorting by capture date. A one-time backfill, across galleries in batches
  (default 500):

  ```
  docker compose exec worker celery -A app call \
      tasks.backfill_taken_at.run_global
  ```

  Can be started multiple times; processes the next batch on each call. Optional
  — the gallery works without it too.

## [0.11.1] - 2026-06-02

Bugfix-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig.

### Fixed
- Upload: Eine einzelne zu große Datei (z.B. ein ProRes-Master aus Final
  Cut) hat bisher den kompletten Upload-Batch blockiert — auch die
  gültigen Dateien daneben blieben in „werden vorbereitet…" hängen, ohne
  Rückmeldung. Zu große Dateien werden jetzt schon im Browser erkannt
  und übersprungen, die übrigen laden normal weiter. Statt stillem
  Hänger erscheint ein Hinweis, welche Datei das Pro-File-Limit
  überschreitet (mit Größe und Limit) und der Tipp, Videos als
  H.264/HEVC statt ProRes zu exportieren.

**🇬🇧 English**

Bugfix release. For self-hosters `git pull` + a regular deploy is enough — no
`.env`, Compose or DB changes needed.

### Fixed
- Upload: a single oversized file (e.g. a ProRes master from Final Cut)
  previously blocked the entire upload batch — even the valid files next to it
  got stuck in "preparing…" with no feedback. Oversized files are now detected in
  the browser already and skipped, the rest continue uploading normally. Instead
  of a silent stall, a hint appears showing which file exceeds the per-file limit
  (with size and limit) and the tip to export videos as H.264/HEVC instead of
  ProRes.

## [0.11.0] - 2026-06-02

Kleines Feature-Release. Für Self-Hoster genügt `git pull` + regulärer
Deploy — keine `.env`-, Compose- oder DB-Änderungen nötig.

### Added
- Galerie-Studio: Video-Dateien tragen im Vorschau-Grid jetzt einen
  dezenten Play-Indikator (kleiner Punkt unten links), damit Videos auf
  einen Blick von Fotos zu unterscheiden sind. Rein optisch, keine
  Funktionsänderung.

**🇬🇧 English**

Small feature release. For self-hosters `git pull` + a regular deploy is enough
— no `.env`, Compose or DB changes needed.

### Added
- Gallery studio: video files now carry a subtle play indicator in the preview
  grid (a small dot bottom left), so videos can be told apart from photos at a
  glance. Purely visual, no functional change.

## [0.10.3] - 2026-06-02

Bugfix-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig. Wer Videos auf einem
Server ohne GPU verarbeitet, sollte nach dem Update den Worker neu
deployen, damit das Encoding wieder durchläuft.

### Fixed
- Video-Verarbeitung schlug auf Servern ohne GPU dauerhaft fehl
  („Video processing failed"). Die automatische Encoder-Wahl (`auto`,
  Standard) hat NVENC bzw. QSV schon dann gewählt, wenn ffmpeg den
  Encoder im Build hat — das ist bei den Standard-ffmpeg-Paketen IMMER
  der Fall, auch ganz ohne Grafikkarte. ffmpeg ist dann zur Laufzeit am
  fehlenden GPU-Gerät gescheitert. `auto` prüft jetzt zusätzlich, ob ein
  passendes Gerät wirklich vorhanden ist, und fällt sonst sauber auf
  Software-Encoding (libx264) zurück. Gleiches gilt, wenn `nvenc`/`qsv`
  explizit über `LUMIO_HW_ENCODER` gesetzt, das Gerät aber nicht
  durchgereicht ist: statt hartem Fehler nun Fallback auf Software.

**🇬🇧 English**

Bugfix release. For self-hosters `git pull` + a regular deploy is enough — no
`.env`, Compose or DB changes needed. Anyone processing videos on a server
without a GPU should redeploy the worker after the update so encoding runs
through again.

### Fixed
- Video processing failed permanently on servers without a GPU ("Video
  processing failed"). The automatic encoder choice (`auto`, default) chose
  NVENC or QSV as soon as ffmpeg had the encoder in the build — which is ALWAYS
  the case with the standard ffmpeg packages, even with no graphics card at all.
  ffmpeg then failed at runtime on the missing GPU device. `auto` now
  additionally checks whether a matching device really exists, and otherwise
  falls back cleanly to software encoding (libx264). The same applies if
  `nvenc`/`qsv` is set explicitly via `LUMIO_HW_ENCODER` but the device isn't
  passed through: instead of a hard error, now a fallback to software.

## [0.10.2] - 2026-06-02

Bugfix-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig.

### Fixed
- Stripe-Customer-Portal: Nach „Zurück" landete man immer auf
  `/studio/settings` statt dort, wo man das Portal geöffnet hat. Der
  Rückkehr-Pfad richtet sich jetzt nach der Ausgangsseite (z.B. zurück
  auf `/studio/billing`); validiert gegen Open-Redirect, Fallback bleibt
  `/studio/billing`.

**🇬🇧 English**

Bugfix release. For self-hosters `git pull` + a regular deploy is enough — no
`.env`, Compose or DB changes needed.

### Fixed
- Stripe customer portal: after "Back" you always landed on `/studio/settings`
  instead of where you opened the portal. The return path now follows the origin
  page (e.g. back to `/studio/billing`); validated against open redirects, the
  fallback stays `/studio/billing`.

## [0.10.1] - 2026-06-02

Bugfix-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig.

### Fixed
- Stripe-Checkout aus dem Studio (`/studio/billing`): Nach erfolgreicher
  Zahlung bzw. bei Abbruch landete man auf einer 404-Seite, weil die
  Weiterleitung auf `/billing/success` bzw. `/billing` zeigte — diese
  Routen existieren nicht. Geht jetzt korrekt zurück auf `/studio/billing`.
  Die Subscription selbst war nie betroffen (wird über den Webhook
  angelegt), nur die Landeseite nach dem Checkout.

**🇬🇧 English**

Bugfix release. For self-hosters `git pull` + a regular deploy is enough — no
`.env`, Compose or DB changes needed.

### Fixed
- Stripe checkout from the studio (`/studio/billing`): after a successful
  payment or on cancellation you landed on a 404 page, because the redirect
  pointed to `/billing/success` or `/billing` — those routes don't exist. It now
  correctly goes back to `/studio/billing`. The subscription itself was never
  affected (it's created via the webhook), only the landing page after checkout.

## [0.10.0] - 2026-06-01

Abwärtskompatibles Feature-Release. Für Self-Hoster genügt `git pull` +
regulärer Deploy — keine `.env`-, Compose- oder DB-Änderungen nötig.

### Added
- Kunden-Galerie: Einzelbild-Download auf iOS sichert über das native
  Teilen-Sheet direkt in die Foto-App ("In Fotos sichern") statt in die
  "Dateien"-App. Gleiche Download-Buttons, Desktop/Android unverändert.
  Dafür neuer Stream-Endpoint `GET /g/:slug/files/:fileId/blob`.

### Changed
- Doku: `docs/OPERATIONS.md` um den Abschnitt „Secrets & Passwörter
  rotieren" ergänzt.

**🇬🇧 English**

Backward-compatible feature release. For self-hosters `git pull` + a regular
deploy is enough — no `.env`, Compose or DB changes needed.

### Added
- Customer gallery: single-image download on iOS saves directly into the Photos
  app via the native share sheet ("Save to Photos") instead of into the "Files"
  app. Same download buttons, desktop/Android unchanged. For this a new stream
  endpoint `GET /g/:slug/files/:fileId/blob`.

### Changed
- Docs: `docs/OPERATIONS.md` extended with the section "Rotating secrets &
  passwords".

## [0.9.0] - 2026-06-01

Erste offiziell versionierte Veröffentlichung. Lumio läuft zu diesem Zeitpunkt
bereits produktiv (SaaS auf lumio-cloud.de sowie Self-Hosting in Single- und
Multi-Mode); diese Version macht den Stand offiziell nachvollziehbar.

### Added
- Einheitliche Produkt-Versionierung über alle Komponenten (API, Frontend, Worker).
- Single Source of Truth in `/VERSION`, gehalten durch `scripts/bump-version.sh`.
- Version wird im öffentlichen `/meta`-Endpoint ausgeliefert und im Studio-Footer
  angezeigt (`Lumio vX.Y.Z`).
- `/health` liefert die echte Version statt eines hartkodierten Werts.
- Worker loggt die Version beim Start (`lumio.worker.boot`).

### Notes
- Frühere Stände waren nicht getaggt. `0.9.0` ist der erste Git-Tag (`v0.9.0`).

**🇬🇧 English**

First officially versioned release. At this point Lumio is already running in
production (SaaS on lumio-cloud.de as well as self-hosting in single and multi
mode); this version makes the state officially traceable.

### Added
- Unified product versioning across all components (API, frontend, worker).
- A single source of truth in `/VERSION`, kept by `scripts/bump-version.sh`.
- The version is served on the public `/meta` endpoint and shown in the studio
  footer (`Lumio vX.Y.Z`).
- `/health` returns the real version instead of a hardcoded value.
- The worker logs the version at start (`lumio.worker.boot`).

### Notes
- Earlier states were not tagged. `0.9.0` is the first Git tag (`v0.9.0`).

[Unreleased]: https://forgejo.thiel.tools/thiel/lumio/compare/v0.9.0...HEAD
[0.9.0]: https://forgejo.thiel.tools/thiel/lumio/releases/tag/v0.9.0
