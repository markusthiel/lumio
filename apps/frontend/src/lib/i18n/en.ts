import type { Dict } from "./dict";

export const en: Dict = {
  common: {
    signIn: "Sign in",
    signingIn: "Signing in…",
    signOut: "Sign out",
    verify: "Verify",
    verifying: "Verifying…",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    delete: "Delete",
    create: "Create",
    creating: "Creating…",
    settings: "Settings",
    loading: "Loading…",
    back: "Back",
  },

  nav: {
    studio: "Studio",
    galleries: "Galleries",
    branding: "Branding",
    settings: "Settings",
    logout: "Logout",
  },

  login: {
    title: "Studio sign-in",
    email: "Email",
    password: "Password",
    cliHint: "Account created via CLI:",
    error: {
      generic: "Sign-in failed. Please try again.",
      invalidCredentials: "Email or password is incorrect.",
      invalidTotp: "The code is not correct.",
      challengeExpired: "Please sign in again.",
    },
    totp: {
      title: "Two-step verification",
      description:
        "Enter the 6-digit code from your authenticator app.",
      code: "Code",
      backupHint:
        "Lost access to your device? Enter a backup code (XXXX-YYYYYY).",
    },
  },

  studio: {
    newGallery: "New gallery",
    noGalleries: "No galleries yet.",
    firstGallery: "Create first gallery →",
    files: "Files",
    liked: "liked",
  },

  gallery: {
    locked: "This gallery is password-protected.",
    open: "Open gallery",
    password: "Password",
    passwordRequired: "Password required.",
    passwordIncorrect: "Password is incorrect.",
    downloadAll: "Download all",
    downloadSelection: "Download selection ({count})",
    finalize: "Finish selection",
    finalizing: "Finishing…",
    finalized: "Selection submitted",
    notAvailable: "Not available",
    notAvailableDesc: "This gallery doesn't exist or is no longer available.",
    expired: "This gallery has expired.",
  },

  proofing: {
    title: "Selection overview",
    files: "Files",
    withLike: "With like",
    withRating: "With rating",
    colorTags: "Color tags total",
    colorTagsHeader: "Color tags",
    perAccess: "Per share link",
    label: "Label",
    picks: "Picks/Likes",
    likes: "Likes",
    comments: "Comments",
    exports: "Exports",
    exportsHint:
      "CSV for spreadsheets, XMP sidecars for Lightroom Classic or Capture One. Place the XMPs next to your original RAWs, then in Lightroom: Metadata → Read from file.",
    csv: "Download CSV",
    xmp: "XMP sidecars (ZIP)",
    lightroomHint:
      "Lightroom matches color labels against the active label set. Set Lightroom under Metadata → Color Label Set to Lightroom Default (English). Lumio writes Red/Yellow/Green. With a localized set, ratings work but colors won't match.",
  },

  settings: {
    title: "Settings",
    branding: "Branding",
    brandingDesc: "Logo, colors, font and texts for your client galleries.",
    manage: "Manage profiles →",
    customDomain: "Custom Domain",
    customDomainDesc:
      "Your own domain for galleries — e.g. {example}. Point a CNAME or A record at this Lumio instance and enter the domain here.",
    customDomainNote:
      "DNS changes can take up to 48 hours to propagate. Make sure a TLS certificate is available for this domain.",
    watermarkText: "Watermark — Text",
    watermarkTextDesc:
      "Used as a diagonal repeating pattern when a gallery has watermarkEnabled and no image watermark is uploaded. Empty = studio name is used.",
    watermarkImage: "Watermark — Image",
    watermarkImageDesc:
      "PNG or JPEG, transparent background recommended. Composed at 35% opacity centered on the preview — used instead of the text pattern when set.",
    twoFactor: "Two-step verification",
    twoFactorOff: "Two-step verification is currently off.",
    twoFactorOn:
      "Two-step verification is enabled. Backup codes remaining: {count}.",
    twoFactorEnable: "Enable 2FA",
    twoFactorDisable: "Disable 2FA",
    twoFactorSetup: "Set up two-step verification",
    twoFactorScan:
      "Scan this QR code with your authenticator app (Google Authenticator, 1Password, Authy …) and then enter the 6-digit code below to confirm.",
    twoFactorBackup:
      "Save these backup codes in a safe place. Each can be used once if you lose access to your device.",
    twoFactorBackupSaved: "I've saved the codes",
    twoFactorConfirmDisable: "Confirm with a current code to disable 2FA:",
  },
};
