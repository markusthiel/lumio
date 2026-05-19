import type { Dict } from "./dict";

export const de: Dict = {
  common: {
    signIn: "Anmelden",
    signingIn: "Anmelden…",
    signOut: "Abmelden",
    verify: "Bestätigen",
    verifying: "Wird geprüft…",
    save: "Speichern",
    saving: "Speichert…",
    cancel: "Abbrechen",
    delete: "Löschen",
    create: "Erstellen",
    creating: "Wird erstellt…",
    settings: "Einstellungen",
    loading: "Lädt…",
    back: "Zurück",
  },

  nav: {
    studio: "Studio",
    galleries: "Galerien",
    branding: "Branding",
    settings: "Einstellungen",
    logout: "Abmelden",
  },

  login: {
    title: "Studio-Anmeldung",
    email: "E-Mail",
    password: "Passwort",
    cliHint: "Konto angelegt via CLI:",
    error: {
      generic: "Anmeldung fehlgeschlagen. Bitte erneut versuchen.",
      invalidCredentials: "E-Mail oder Passwort sind nicht korrekt.",
      invalidTotp: "Der Code ist nicht korrekt.",
      challengeExpired: "Bitte erneut anmelden.",
    },
    totp: {
      title: "Zwei-Faktor-Bestätigung",
      description:
        "Gib den 6-stelligen Code aus deiner Authenticator-App ein.",
      code: "Code",
      backupHint:
        "Kein Zugriff aufs Gerät? Gib einen Backup-Code ein (XXXX-YYYYYY).",
    },
  },

  studio: {
    newGallery: "Neue Galerie",
    noGalleries: "Noch keine Galerien angelegt.",
    firstGallery: "Erste Galerie erstellen →",
    files: "Dateien",
    liked: "geliked",

    // Gallery detail page
    proofingLink: "Auswahl-Übersicht →",
    setDraft: "Auf Draft setzen",
    setLive: "Live schalten",
    settingsHeading: "Einstellungen",
    settingDownload: "Download für Kunden erlauben",
    settingWatermark: "Wasserzeichen auf Vorschaubildern",
    settingWatermarkDesc:
      "Wird automatisch generiert. Studio-Watermark-Text in den Tenant-Settings festlegen.",
    settingComments: "Kommentare aktivieren",

    noFiles: "Noch keine Dateien hochgeladen.",
    selectFiles: "Auswählen",
    selectedSuffix: "ausgewählt",
    selectAll: "Alle",
    selectNone: "Keine",
    hide: "Verstecken",
    show: "Anzeigen",
    deleteAction: "Löschen",
    confirmDeleteOne: "1 Datei löschen?",
    confirmDeleteMany: "{count} Dateien löschen?",

    branding: "Branding:",
    brandingTenantDefault: "Tenant-Default",
    brandingNoneYet: "Noch keine Branding-Profile —",
    brandingCreateNow: "jetzt anlegen",

    notFound: "Galerie nicht gefunden.",
  },

  gallery: {
    locked: "Diese Galerie ist passwortgeschützt.",
    open: "Galerie öffnen",
    password: "Passwort",
    passwordPlaceholder: "Passwort eingeben",
    passwordRequired: "Passwort erforderlich.",
    passwordIncorrect: "Passwort ist nicht korrekt.",
    unlockHint: "Klicke unten, um die Galerie zu öffnen.",
    unlockChecking: "Wird geprüft…",
    requestFailed: "Anfrage fehlgeschlagen",
    downloadAll: "Alle herunterladen",
    downloadSelection: "Auswahl herunterladen ({count})",
    downloadDisabled: "Download ist für diese Galerie deaktiviert.",
    downloadEmpty: "Keine Auswahl getroffen.",
    downloadRetry: "Bitte erneut versuchen",
    finalize: "Auswahl abschließen",
    finalizing: "Wird abgeschlossen…",
    finalized: "Auswahl abgeschlossen",
    notAvailable: "Nicht verfügbar",
    notAvailableDesc:
      "Diese Galerie existiert nicht oder ist nicht mehr verfügbar.",
    loadFailed: "Galerie konnte nicht geladen werden.",
    loadError: "Fehler beim Laden",
    expired: "Diese Galerie ist abgelaufen.",
    // Grid + Filter
    files: "Files",
    liked: "liked",
    filterAll: "Alle ({count})",
    noFiles: "Noch keine Dateien.",
    noFilesForFilter: "Keine Dateien mit diesem Filter.",
    // Lightbox
    close: "Schließen",
    previous: "Vorheriges Bild",
    next: "Nächstes Bild",
    comments: "Kommentare",
    commentsLoading: "Lädt…",
    commentsEmpty: "Noch keine Kommentare.",
    commentPlaceholder: "Kommentar schreiben…",
    commentSend: "Senden",
    commentSending: "Sende…",
    commentStudioBadge: "Studio",
    download: "Download",
    zipBuilding: "ZIP wird erstellt…",
    zipDownload: "ZIP herunterladen",
    zipRetry: "Erneut versuchen",
    previewMissing: "Vorschau noch nicht verfügbar.",
    // Proofing-Buttons
    markRed: "Rot markieren",
    markRedTitle: "Rot (Taste 1)",
    markYellow: "Gelb markieren",
    markYellowTitle: "Gelb (Taste 2)",
    markGreen: "Grün markieren",
    markGreenTitle: "Grün (Taste 3)",
    like: "Like",
    likeTitle: "Like (Leertaste)",
    poweredBy: "Powered by Lumio",
  },

  proofing: {
    title: "Auswahl-Übersicht",
    files: "Dateien",
    withLike: "Mit Like",
    withRating: "Mit Rating",
    colorTags: "Farb-Tags gesamt",
    colorTagsHeader: "Farb-Tags",
    perAccess: "Beteiligung pro Share-Link",
    label: "Bezeichnung",
    picks: "Picks/Likes",
    likes: "Likes",
    comments: "Kommentare",
    exports: "Exporte",
    exportsHint:
      "CSV für Tabellenkalkulation, XMP-Sidecars für Lightroom Classic oder Capture One. Lege die XMPs neben deine Original-RAWs, dann in Lightroom: Metadaten → Aus Datei lesen.",
    csv: "CSV herunterladen",
    xmp: "XMP-Sidecars (ZIP)",
    lightroomHint:
      "Lightroom erkennt Farb-Labels anhand des aktiven Label-Sets. Stelle Lightroom unter Metadaten → Farbbeschriftungs-Sets auf „Lightroom-Standard“ (englisch). Lumio schreibt „Red“/„Yellow“/„Green“. Bei deutschem Label-Set werden Sterne erkannt, Farben nicht.",
  },

  settings: {
    title: "Einstellungen",
    branding: "Branding",
    brandingDesc:
      "Logo, Farben, Schrift und Texte für deine Kunden-Galerien.",
    templates: "Galerie-Templates",
    templatesDesc:
      "Wiederverwendbare Einstellungen für wiederkehrende Galerie-Typen (Hochzeit, Newborn, Portrait …).",
    manage: "Profile verwalten →",
    customDomain: "Custom Domain",
    customDomainDesc:
      "Eigene Domain für deine Galerien — z.B. {example}. Richte einen CNAME oder A-Record auf diese Lumio-Instanz, dann trage die Domain hier ein.",
    customDomainNote:
      "DNS-Änderungen können bis zu 48h dauern. Stelle sicher, dass ein TLS-Zertifikat für diese Domain bereitsteht.",
    watermarkText: "Wasserzeichen — Text",
    watermarkTextDesc:
      "Wird als wiederholtes diagonales Muster über Vorschaubilder gelegt, wenn eine Galerie auf watermarkEnabled steht und kein Bild-Wasserzeichen hochgeladen ist. Leer = Studio-Name wird verwendet.",
    watermarkImage: "Wasserzeichen — Bild",
    watermarkImageDesc:
      "PNG oder JPEG, transparenter Hintergrund empfohlen. Wird mit 35 % Opazität mittig über die Vorschau gelegt — bei aktiviertem Wasserzeichen statt des Text-Musters.",
    twoFactor: "Zwei-Faktor-Bestätigung",
    twoFactorOff: "Zwei-Faktor-Bestätigung ist aktuell aus.",
    twoFactorOn:
      "Zwei-Faktor-Bestätigung ist aktiviert. Verbleibende Backup-Codes: {count}.",
    twoFactorEnable: "2FA aktivieren",
    twoFactorDisable: "2FA deaktivieren",
    twoFactorSetup: "Zwei-Faktor-Bestätigung einrichten",
    twoFactorScan:
      "Scanne diesen QR-Code mit deiner Authenticator-App (Google Authenticator, 1Password, Authy …) und gib darunter den 6-stelligen Code zur Bestätigung ein.",
    twoFactorBackup:
      "Speichere diese Backup-Codes an einem sicheren Ort. Jeder lässt sich einmalig nutzen, falls du keinen Zugriff mehr aufs Gerät hast.",
    twoFactorBackupSaved: "Ich habe die Codes gespeichert",
    twoFactorConfirmDisable:
      "Bestätige mit einem aktuellen Code, um 2FA zu deaktivieren:",
  },
};
