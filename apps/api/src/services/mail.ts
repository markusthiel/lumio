/**
 * Lumio API — Mail Service
 *
 * SMTP-Versand via nodemailer. Wenn SMTP nicht konfiguriert ist
 * (z.B. lokales Dev oder Self-Hoster ohne Mail), läuft der Service im
 * No-Op-Modus und loggt die Mails — bricht aber nichts.
 *
 * Templates sind bewusst simpel: Text-Mails, keine HTML-Komplexität.
 * Wer schicker will, kann später ein React-Email-Setup darüberlegen.
 */
import nodemailer, { type Transporter } from "nodemailer";

import { config } from "../config.js";
import { logger } from "../logger.js";
import { prisma } from "../db.js";
import {
  common,
  instanceMailLocale,
  phrase,
  type MailLocale,
  type Phrase,
  localeTag,
} from "./mail-i18n.js";

let _transport: Transporter | null = null;
let _initAttempted = false;

function getTransport(): Transporter | null {
  if (_initAttempted) return _transport;
  _initAttempted = true;

  if (!config.SMTP_HOST) {
    logger.info("mail: SMTP_HOST not set, running in no-op mode");
    return null;
  }

  _transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth:
      config.SMTP_USER && config.SMTP_PASSWORD
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
  });
  return _transport;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML-Version. Wenn gesetzt, wird die Mail multipart
   *  (alternative) versendet: Klartext als Fallback fuer Clients die
   *  HTML nicht koennen/wollen, HTML als bevorzugte Darstellung. */
  html?: string;
  /** Optionale Antwortadresse fuer genau diese Mail. Ueberschreibt den
   *  globalen Default aus SMTP_REPLY_TO. Wenn beides fehlt, wird kein
   *  Reply-To-Header gesetzt. */
  replyTo?: string;
}

// ---------------------------------------------------------------------------
// Kontaktangaben in System-Mails
//
// Problem, das diese Helper loesen: Mail-Texte duerfen nicht blind
// "antworte einfach auf diese Mail" versprechen. Der Absender aus
// SMTP_FROM ist typischerweise eine noreply-Adresse ohne Postfach —
// Antworten landen im Nirvana und der Empfaenger merkt es nicht.
//
// Antworten funktioniert nur, wenn SMTP_REPLY_TO gesetzt UND das
// Postfach beim Provider auch wirklich existiert. Deshalb:
//   - SMTP_REPLY_TO gesetzt  → "antworten oder an <adresse> schreiben"
//   - nur SUPPORT_EMAIL      → "schreib an <adresse>"
//   - gar nichts konfiguriert→ kein Kontakt-Satz (statt einer fremden
//     Adresse; frueher stand ueberall fest support@lumio-cloud.de)
// ---------------------------------------------------------------------------

/** Zieht die nackte Mail-Adresse aus einem Header-Wert wie
 *  "Lumio Support <support@example.com>" oder "support@example.com". */
function bareAddress(value: string | undefined): string | null {
  if (!value) return null;
  const angle = value.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : value).trim();
  return addr.includes("@") ? addr : null;
}

/** Adresse, die in System-Mails als Support-Kontakt genannt wird.
 *  SUPPORT_EMAIL > SMTP_REPLY_TO > keine. */
export function supportAddress(): string | null {
  return bareAddress(config.SUPPORT_EMAIL) ?? bareAddress(config.SMTP_REPLY_TO);
}

/** Adresse fuer Produkt-Feedback. FEEDBACK_EMAIL > Support-Adresse. */
export function feedbackAddress(): string | null {
  return bareAddress(config.FEEDBACK_EMAIL) ?? supportAddress();
}

/** Kann der Empfaenger auf diese Mail antworten? Nur wenn ein
 *  Reply-To-Header gesetzt wird. */
function canReplyToMails(): boolean {
  return bareAddress(config.SMTP_REPLY_TO) !== null;
}

/**
 * Freundlicher Kontakt-Satz fuers Mail-Ende. Liefert null, wenn keine
 * Kontaktadresse konfiguriert ist — dann laesst der Aufrufer den Satz
 * einfach weg, statt eine tote Adresse zu nennen.
 */
export function supportHint(): string | null {
  const addr = supportAddress();
  if (!addr) return null;
  return canReplyToMails()
    ? `Fragen? Antworte einfach auf diese Mail oder schreib an ${addr}.`
    : `Fragen? Schreib uns an ${addr}.`;
}

/**
 * Dringlicher Kontakt-Satz fuer sicherheitsrelevante Hinweise
 * ("das warst du nicht?"). Ohne konfigurierte Adresse wird auf den
 * Betreiber der Instanz verwiesen — bei Self-Hostern ist das der
 * Admin, den der Empfaenger ohnehin kennt.
 */
export function urgentSupportHint(intro: string): string {
  const addr = supportAddress();
  if (!addr) {
    return `${intro} melde dich umgehend beim Betreiber dieser Lumio-Instanz.`;
  }
  return canReplyToMails()
    ? `${intro} antworte umgehend auf diese Mail oder schreib an ${addr}.`
    : `${intro} melde dich umgehend unter ${addr}.`;
}

/**
 * Feedback-Bitte fuer Lifecycle-Mails. Nennt nur dann einen Rueckkanal,
 * wenn es ihn wirklich gibt — sonst bleibt es bei der Frage ohne
 * Aufforderung, die ins Leere laufen wuerde.
 */
export function feedbackInvite(): string {
  const question =
    "Wir wären neugierig: War etwas unklar, hat etwas gefehlt oder war es einfach der falsche Zeitpunkt?";
  if (canReplyToMails()) {
    return `${question} Antworte gerne kurz auf diese Mail — wir lesen jede Antwort.`;
  }
  const addr = feedbackAddress();
  if (addr) {
    return `${question} Schreib uns gerne kurz an ${addr} — wir lesen jede Rückmeldung.`;
  }
  return question;
}

/**
 * Verschickt eine Mail. Wirft NIE — ein Mail-Problem darf keine
 * Business-Operation killen.
 *
 * Der Rueckgabewert sagt, ob es geklappt hat. Die meisten Aufrufer
 * ignorieren ihn (fire-and-forget ist dort richtig), aber wo eine
 * verlorene Mail den ganzen Vorgang sinnlos macht — Support-Anfragen
 * haben kein Auffangnetz in der DB — kann der Aufrufer damit einen
 * Fehler an den Nutzer zurueckgeben statt ein falsches "gesendet".
 *
 * No-Op (kein SMTP konfiguriert) zaehlt bewusst NICHT als Erfolg, sonst
 * sieht eine unkonfigurierte Instanz aus wie eine funktionierende.
 */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  const transport = getTransport();
  if (!transport) {
    logger.info(
      { to: msg.to, subject: msg.subject },
      "mail (no-op, SMTP not configured)"
    );
    void logMail(msg.to, msg.subject, "skipped");
    return false;
  }
  try {
    await transport.sendMail({
      from: config.SMTP_FROM ?? "Lumio <noreply@lumio.local>",
      // Reply-To: pro Mail > globaler Default > gar nicht. Damit koennen
      // Empfaenger auch bei einem noreply-Absender einfach antworten.
      replyTo: msg.replyTo ?? config.SMTP_REPLY_TO,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    logger.info({ to: msg.to, subject: msg.subject }, "mail sent");
    void logMail(msg.to, msg.subject, "sent");
    return true;
  } catch (err) {
    logger.warn({ err, to: msg.to, subject: msg.subject }, "mail send failed");
    void logMail(
      msg.to,
      msg.subject,
      "failed",
      err instanceof Error ? err.message : String(err)
    );
    // Wir werfen NICHT — Mail-Fehler sollten Business-Operationen nicht killen
    return false;
  }
}

// Schreibt einen Zustell-Log-Eintrag. Komplett fail-safe: ein Fehler hier
// darf den Mailversand niemals beeinflussen.
async function logMail(
  recipient: string,
  subject: string,
  status: "sent" | "failed" | "skipped",
  error?: string
): Promise<void> {
  try {
    await prisma.mailLog.create({
      data: {
        recipient: recipient.slice(0, 500),
        subject: subject.slice(0, 500),
        status,
        error: error ? error.slice(0, 1000) : null,
      },
    });
  } catch (e) {
    logger.warn({ e }, "mailLog write failed");
  }
}

// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Templates
//
// Jedes Template gibt zurueck: { subject, text, html }
//   - text: Klartext-Fallback (manche Mail-Clients ziehen den vor; Tools wie
//     mutt zeigen ohnehin nur text)
//   - html: Schicke HTML-Variante mit Layout-Wrapper aus mail-layout.ts
//
// Templates die an Endkund:innen gehen (tmplGalleryInvite) duerfen
// optional Studio-Branding (Logo + Akzentfarbe) bekommen — siehe
// notifier.ts wo das geladen wird. System-Mails an den Fotograf nutzen
// das default Lumio-Branding.
// -----------------------------------------------------------------------------
import {
  renderMailLayout,
  mailParagraph,
  mailParagraphInterpolated,
  mailHeading,
  mailButton,
  mailBullets,
  mailDivider,
  mailNoticeBox,
  mailQuoteBlock,
  type MailBranding,
} from "./mail-layout.js";

/**
 * Empfaenger: Studio-Team. Sprache kommt daher aus User.locale, siehe
 * mail-i18n.ts. `locale` ist optional, damit bestehende Aufrufer ohne
 * Anpassung weiterlaufen — ohne Angabe gilt DEFAULT_MAIL_LOCALE.
 */
const newCommentPhrases = {
  subject: {
    de: 'Neuer Kommentar in "{title}"',
    en: 'New comment in "{title}"',
    it: 'Nuovo commento in "{title}"',
    fi: "Uusi kommentti galleriassa ”{title}”",
  fr: "Nouveau commentaire dans \"{title}\"" },
  preheader: {
    de: '{author} hat in "{title}" kommentiert',
    en: '{author} commented in "{title}"',
    it: '{author} ha commentato in "{title}"',
    fi: "{author} kommentoi galleriaa ”{title}”",
  fr: "{author} commenté dans \"{title}\"" },
  heading: {
    de: "Neuer Kommentar in „{title}“",
    en: "New comment in “{title}”",
    it: "Nuovo commento in «{title}»",
    fi: "Uusi kommentti galleriassa ”{title}”",
  fr: "Nouveau commentaire dans « {title} »" },
  intro: {
    de: "{author} hat einen Kommentar hinterlassen:",
    en: "{author} left a comment:",
    it: "{author} ha lasciato un commento:",
    fi: "{author} jätti kommentin:",
  fr: "{author} a laissé un commentaire :" },
} satisfies Record<string, Phrase>;

export function tmplNewComment(opts: {
  galleryTitle: string;
  galleryUrl: string;
  authorLabel: string;
  body: string;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const vars = { title: opts.galleryTitle, author: opts.authorLabel };
  return {
    subject: phrase(newCommentPhrases.subject, l, vars),
    text:
      `${phrase(newCommentPhrases.intro, l, vars)}\n\n` +
      `"${opts.body}"\n\n` +
      `${phrase(common.viewGallery, l)}: ${opts.galleryUrl}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      branding: opts.branding,
      preheader: phrase(newCommentPhrases.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(newCommentPhrases.heading, l, vars)) +
        mailParagraph(phrase(newCommentPhrases.intro, l, vars)) +
        mailQuoteBlock(opts.body, opts.branding?.accentColor) +
        mailButton(
          opts.galleryUrl,
          phrase(common.openGallery, l),
          opts.branding?.accentColor
        ),
    }),
  };
}

const selectionFinishedPhrases = {
  subject: {
    de: 'Auswahl fertig: "{title}"',
    en: 'Selection finished: "{title}"',
    it: 'Selezione completata: "{title}"',
    fi: "Valinta valmis: ”{title}”",
  fr: "Sélection terminée : \"{title}\"" },
  preheader: {
    de: "{who} hat {files} ausgewählt",
    en: "{who} selected {files}",
    it: "{who} ha selezionato {files}",
    fi: "{who} valitsi {files}",
  fr: "{who} sélectionné {files}" },
  heading: {
    de: "Auswahl abgeschlossen",
    en: "Selection finished",
    it: "Selezione completata",
    fi: "Valinta valmis",
  fr: "Sélection terminée" },
  bodyText: {
    de: "{who} hat die Auswahl abgeschlossen ({files}).",
    en: "{who} finished their selection ({files}).",
    it: "{who} ha completato la selezione ({files}).",
    fi: "{who} sai valintansa valmiiksi ({files}).",
  fr: "{who} a terminé sa sélection ({files})." },
  bodyHtml: {
    de: "{who} hat die Auswahl in „{title}“ abgeschlossen — {files} markiert.",
    en: "{who} finished the selection in “{title}” — {files} marked.",
    it: "{who} ha completato la selezione in «{title}» — {files} contrassegnati.",
    fi: "{who} sai valinnan valmiiksi galleriassa ”{title}” — {files} merkitty.",
  fr: "{who} a terminé la sélection dans « {title} » — {files} marqué." },
  button: {
    de: "Auswahl ansehen",
    en: "View selection",
    it: "Visualizza selezione",
    fi: "Katso valinta",
  fr: "Voir la sélection" },
  fileOne: { de: "1 Datei", en: "1 file", it: "1 file", fi: "1 tiedosto" , fr: "1 fichier" },
  fileMany: { de: "{n} Dateien", en: "{n} files", it: "{n} file", fi: "{n} tiedostoa" , fr: "Fichiers {n}" },
} satisfies Record<string, Phrase>;

export function tmplSelectionFinished(opts: {
  galleryTitle: string;
  galleryUrl: string;
  accessLabel: string;
  count: number;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = selectionFinishedPhrases;
  const files =
    opts.count === 1
      ? phrase(P.fileOne, l)
      : phrase(P.fileMany, l, { n: opts.count });
  const vars = { title: opts.galleryTitle, who: opts.accessLabel, files };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(common.viewGallery, l)}: ${opts.galleryUrl}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      branding: opts.branding,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailButton(opts.galleryUrl, phrase(P.button, l), opts.branding?.accentColor),
    }),
  };
}

/**
 * Empfaenger: die KUNDEN des Studios (Adressen am GalleryAccess).
 * Sprache folgt daher dem Studio, siehe mail-i18n.ts.
 */
const zipReadyPhrases = {
  subject: {
    de: 'Download bereit: "{title}"',
    en: 'Download ready: "{title}"',
    it: 'Download pronto: "{title}"',
    fi: "Lataus valmis: ”{title}”",
  fr: "Téléchargement prêt : \"{title}\"" },
  preheader: {
    de: "Dein ZIP-Download ({files}) ist fertig",
    en: "Your ZIP download ({files}) is ready",
    it: "Il tuo download ZIP ({files}) è pronto",
    fi: "ZIP-latauksesi ({files}) on valmis",
  fr: "Votre téléchargement ZIP ({files}) est prêt" },
  heading: {
    de: "Download bereit",
    en: "Download ready",
    it: "Download pronto",
    fi: "Lataus valmis",
  fr: "Téléchargement prêt" },
  bodyText: {
    de: "Dein ZIP-Download mit {files} ist fertig:",
    en: "Your ZIP download with {files} is ready:",
    it: "Il tuo download ZIP con {files} è pronto:",
    fi: "ZIP-latauksesi, jossa on {files}, on valmis:",
  fr: "Votre téléchargement ZIP avec {files} est prêt :" },
  bodyHtml: {
    de: "Dein ZIP-Download mit {files} aus „{title}“ ist fertig.",
    en: "Your ZIP download with {files} from “{title}” is ready.",
    it: "Il tuo download ZIP con {files} da «{title}» è pronto.",
    fi: "ZIP-latauksesi, jossa on {files} galleriasta ”{title}”, on valmis.",
  fr: "Votre téléchargement ZIP avec {files} depuis « {title} » est prêt." },
  button: { de: "ZIP herunterladen", en: "Download ZIP", it: "Scarica ZIP", fi: "Lataa ZIP" , fr: "Télécharger ZIP" },
  validity: {
    de: "Der Link ist 7 Tage gültig.",
    en: "The link is valid for 7 days.",
    it: "Il link è valido per 7 giorni.",
    fi: "Linkki on voimassa 7 päivää.",
  fr: "Le lien est valable 7 jours." },
  fileOne: { de: "1 Datei", en: "1 file", it: "1 file", fi: "1 tiedosto" , fr: "1 fichier" },
  fileMany: { de: "{n} Dateien", en: "{n} files", it: "{n} file", fi: "{n} tiedostoa" , fr: "Fichiers {n}" },
} satisfies Record<string, Phrase>;

export function tmplZipReady(opts: {
  galleryTitle: string;
  downloadUrl: string;
  fileCount: number;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  // Singular/Plural als eigene Phrasen statt Wortanhang: das traegt auch
  // in Sprachen, die die Zahl anders behandeln als Deutsch/Englisch.
  const files =
    opts.fileCount === 1
      ? phrase(zipReadyPhrases.fileOne, l)
      : phrase(zipReadyPhrases.fileMany, l, { n: opts.fileCount });
  const vars = { title: opts.galleryTitle, files };
  return {
    subject: phrase(zipReadyPhrases.subject, l, vars),
    text:
      `${phrase(zipReadyPhrases.bodyText, l, vars)}\n\n` +
      `${opts.downloadUrl}\n\n` +
      `${phrase(zipReadyPhrases.validity, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      branding: opts.branding,
      preheader: phrase(zipReadyPhrases.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(zipReadyPhrases.heading, l)) +
        mailParagraph(phrase(zipReadyPhrases.bodyHtml, l, vars)) +
        mailButton(
          opts.downloadUrl,
          phrase(zipReadyPhrases.button, l),
          opts.branding?.accentColor
        ) +
        mailNoticeBox(phrase(zipReadyPhrases.validity, l)),
    }),
  };
}

const storageWarningPhrases = {
  subject: {
    de: "Speicher fast voll: {percent}% belegt",
    en: "Storage almost full: {percent}% used",
    it: "Spazio quasi esaurito: {percent}% utilizzato",
    fi: "Tallennustila lähes täynnä: {percent} % käytössä",
  fr: "Stockage presque plein : {percent}% utilisé" },
  preheader: {
    de: "Dein Speicher ist zu {percent}% belegt",
    en: "Your storage is {percent}% used",
    it: "Il tuo spazio è utilizzato al {percent}%",
    fi: "Tallennustilastasi on käytössä {percent} %",
  fr: "Votre espace de stockage est utilisé {percent} %" },
  heading: {
    de: "Speicher fast voll",
    en: "Storage almost full",
    it: "Spazio quasi esaurito",
    fi: "Tallennustila lähes täynnä",
  fr: "Stockage presque plein" },
  bodyText: {
    de: "Dein Lumio-Speicher ist zu {percent}% belegt ({used} von {limit} GB).",
    en: "Your Lumio storage is {percent}% used ({used} of {limit} GB).",
    it: "Il tuo spazio Lumio è utilizzato al {percent}% ({used} di {limit} GB).",
    fi: "Lumio-tallennustilastasi on käytössä {percent} % ({used} / {limit} Gt).",
  fr: "Votre stockage Lumio est utilisé avec {percent}% ({used} ou {limit} Go)." },
  bodyHtml: {
    de: "Dein belegter Speicher liegt bei {percent}% — {used} von {limit} GB.",
    en: "Your used storage is at {percent}% — {used} of {limit} GB.",
    it: "Il tuo spazio utilizzato è al {percent}% — {used} di {limit} GB.",
    fi: "Käytössä oleva tallennustilasi on {percent} % — {used} / {limit} Gt.",
  fr: "Votre stockage utilisé est à {percent}% — {used} ou {limit} Go." },
  consequence: {
    de: "Ist das Limit erreicht, sind keine neuen Uploads mehr möglich. Du kannst alte Galerien aufräumen oder deinen Speicher erweitern.",
    en: "Once the limit is reached, no new uploads are possible. You can clear out old galleries or increase your storage.",
    it: "Una volta raggiunto il limite, non sarà più possibile caricare nuovi file. Puoi eliminare vecchie gallerie o aumentare il tuo spazio.",
    fi: "Kun raja täyttyy, et voi enää lisätä uusia tiedostoja. Voit siivota vanhoja gallerioita tai laajentaa tallennustilaa.",
  fr: "Une fois la limite atteinte, aucun nouveau téléchargement n'est possible. Vous pouvez supprimer les anciennes galeries ou augmenter votre stockage." },
  button: { de: "Speicher & Tarif", en: "Storage & plan", it: "Spazio e piano", fi: "Tallennustila ja paketti" , fr: "Rangement & planification" },
} satisfies Record<string, Phrase>;

export function tmplStorageWarning(opts: {
  usedGib: number;
  limitGib: number;
  percent: number;
  billingUrl: string;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = storageWarningPhrases;
  const vars = {
    percent: opts.percent,
    used: opts.usedGib,
    limit: opts.limitGib,
  };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(P.consequence, l)}\n\n` +
      `${opts.billingUrl}\n\n${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      branding: opts.branding,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailParagraph(phrase(P.consequence, l)) +
        mailButton(opts.billingUrl, phrase(P.button, l), opts.branding?.accentColor),
    }),
  };
}

const ownerSetupPhrases = {
  subject: {
    de: 'Dein Lumio-Studio "{tenant}" ist bereit',
    en: 'Your Lumio studio "{tenant}" is ready',
    it: 'Il tuo studio Lumio "{tenant}" è pronto',
    fi: "Lumio-studiosi ”{tenant}” on valmis",
  fr: "Votre studio Lumio \"{tenant}\" est prêt" },
  preheader: {
    de: "Dein Studio „{tenant}“ wartet auf dich",
    en: "Your studio “{tenant}” is waiting for you",
    it: "Il tuo studio «{tenant}» ti aspetta",
    fi: "Studiosi ”{tenant}” odottaa sinua",
  fr: "Votre studio « {tenant} » vous attend" },
  greeting: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  bodyText: {
    de: "{by} hat ein Lumio-Studio für dich angelegt:\n  {tenant}\n\nKlick auf den folgenden Link, um dein Passwort zu setzen und direkt loszulegen:",
    en: "{by} created a Lumio studio for you:\n  {tenant}\n\nUse the link below to set your password and get started:",
    it: "{by} ha creato uno studio Lumio per te:\n  {tenant}\n\nClicca sul link seguente per impostare la password e iniziare subito:",
    fi: "{by} loi sinulle Lumio-studion:\n  {tenant}\n\nAseta salasanasi alla olevasta linkistä ja pääset heti alkuun:",
  fr: "{by} a créé un studio Lumio pour vous :\n  {tenant}\n\nUtilisez le lien ci-dessous pour définir votre mot de passe et commencer :" },
  bodyHtml: {
    de: "{by} hat ein Lumio-Studio für dich angelegt: „{tenant}“. Setze jetzt dein Passwort und leg los.",
    en: "{by} created a Lumio studio for you: “{tenant}”. Set your password now and get started.",
    it: "{by} ha creato uno studio Lumio per te: «{tenant}». Imposta subito la tua password e inizia.",
    fi: "{by} loi sinulle Lumio-studion: ”{tenant}”. Aseta salasanasi nyt ja pääset alkuun.",
  fr: "{by} a créé pour vous un studio Lumio : « {tenant} ». Définissez votre mot de passe maintenant et commencez." },
  button: { de: "Passwort setzen", en: "Set password", it: "Imposta password", fi: "Aseta salasana" , fr: "Définir le mot de passe" },
  validity: {
    de: "Der Link ist {hours} Stunden gültig. Falls die Frist abläuft, melde dich bei {by}.",
    en: "The link is valid for {hours} hours. If it expires, get in touch with {by}.",
    it: "Il link è valido per {hours} ore. Se scade, contatta {by}.",
    fi: "Linkki on voimassa {hours} tuntia. Jos se ehtii vanhentua, ota yhteyttä: {by}.",
  fr: "Le lien est valable pour les heures {hours}. S'il expire, contactez {by}." },
} satisfies Record<string, Phrase>;

export function tmplOwnerSetup(opts: {
  displayName: string;
  tenantName: string;
  setupUrl: string;
  invitedBy: string;
  validHours: number;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = ownerSetupPhrases;
  const vars = {
    name: opts.displayName,
    tenant: opts.tenantName,
    by: opts.invitedBy,
    hours: opts.validHours,
  };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.greeting, l, vars)}\n\n` +
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${opts.setupUrl}\n\n` +
      `${phrase(P.validity, l, vars)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.greeting, l, vars)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailButton(opts.setupUrl, phrase(P.button, l)) +
        mailNoticeBox(phrase(P.validity, l, vars)),
    }),
  };
}

const passwordResetPhrases = {
  subject: {
    de: "Passwort zurücksetzen für „{tenant}“",
    en: "Reset your password for “{tenant}”",
    it: "Reimposta la password per «{tenant}»",
    fi: "Palauta studion ”{tenant}” salasana",
  fr: "Réinitialisez votre mot de passe pour « {tenant} »" },
  preheader: {
    de: "Passwort-Reset für „{tenant}“",
    en: "Password reset for “{tenant}”",
    it: "Reimpostazione password per «{tenant}»",
    fi: "Studion ”{tenant}” salasanan palautus",
  fr: "Réinitialisation du mot de passe pour « {tenant} »" },
  greeting: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  body: {
    de: "Du (oder jemand mit deiner E-Mail-Adresse) hat ein neues Passwort für dein Lumio-Studio „{tenant}“ angefordert.",
    en: "You (or someone with your email address) requested a new password for your Lumio studio “{tenant}”.",
    it: "Tu (o qualcuno con il tuo indirizzo email) hai richiesto una nuova password per il tuo studio Lumio «{tenant}».",
    fi: "Sinä tai joku sähköpostiosoitettasi käyttävä on pyytänyt uutta salasanaa Lumio-studioosi ”{tenant}”.",
  fr: "Vous (ou quelqu'un disposant de votre adresse e-mail) avez demandé un nouveau mot de passe pour votre studio Lumio « {tenant} »." },
  instruction: {
    de: "Klick auf den folgenden Link, um ein neues Passwort zu setzen:",
    en: "Use the link below to set a new password:",
    it: "Clicca sul link seguente per impostare una nuova password:",
    fi: "Aseta uusi salasana klikkaamalla alla olevaa linkkiä:",
  fr: "Utilisez le lien ci-dessous pour définir un nouveau mot de passe :" },
  button: {
    de: "Neues Passwort setzen",
    en: "Set a new password",
    it: "Imposta una nuova password",
    fi: "Aseta uusi salasana",
  fr: "Définir un nouveau mot de passe" },
  validity: {
    de: "Der Link ist {hours} Stunden gültig.",
    en: "The link is valid for {hours} hours.",
    it: "Il link è valido per {hours} ore.",
    fi: "Linkki on voimassa {hours} tuntia.",
  fr: "Le lien est valable pour les heures {hours}." },
  requestedFromIp: {
    de: "Angefordert von IP-Adresse: {ip}",
    en: "Requested from IP address: {ip}",
    it: "Richiesto dall'indirizzo IP: {ip}",
    fi: "Pyyntö tuli IP-osoitteesta: {ip}",
  fr: "Demandé à partir de l'adresse IP : {ip}" },
  notYou: {
    de: "Falls du das NICHT angefordert hast, kannst du diese Mail ignorieren — dein aktuelles Passwort bleibt gültig. Bei verdächtiger Aktivität melde dich bitte beim Studio-Owner.",
    en: "If you did NOT request this, you can ignore this email — your current password stays valid. If anything looks suspicious, please contact the studio owner.",
    it: "Se NON hai richiesto tu questa modifica, puoi ignorare questa email — la tua password attuale resta valida. In caso di attività sospetta, contatta il titolare dello studio.",
    fi: "Jos ET pyytänyt tätä, voit jättää viestin huomiotta — nykyinen salasanasi pysyy voimassa. Jos toiminta vaikuttaa epäilyttävältä, ota yhteyttä studion omistajaan.",
  fr: "Si vous n'avez PAS demandé cela, vous pouvez ignorer cet e-mail : votre mot de passe actuel reste valide. Si quelque chose vous semble suspect, veuillez contacter le propriétaire du studio." },
  notYouShort: {
    de: "Falls du das NICHT angefordert hast, kannst du diese Mail ignorieren — dein aktuelles Passwort bleibt gültig.",
    en: "If you did NOT request this, you can ignore this email — your current password stays valid.",
    it: "Se NON hai richiesto tu questa modifica, puoi ignorare questa email — la tua password attuale resta valida.",
    fi: "Jos ET pyytänyt tätä, voit jättää viestin huomiotta — nykyinen salasanasi pysyy voimassa.",
  fr: "Si vous n'avez PAS demandé cela, vous pouvez ignorer cet e-mail : votre mot de passe actuel reste valide." },
} satisfies Record<string, Phrase>;

export function tmplPasswordReset(opts: {
  displayName: string;
  tenantName: string;
  resetUrl: string;
  validHours: number;
  ipAddress?: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = passwordResetPhrases;
  const vars = {
    name: opts.displayName,
    tenant: opts.tenantName,
    hours: opts.validHours,
  };
  const ipLine = opts.ipAddress
    ? `${phrase(P.requestedFromIp, l, { ip: opts.ipAddress })}\n\n`
    : "";
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.greeting, l, vars)}\n\n` +
      `${phrase(P.body, l, vars)}\n\n` +
      `${phrase(P.instruction, l)}\n\n` +
      `${opts.resetUrl}\n\n` +
      `${phrase(P.validity, l, vars)}\n\n` +
      ipLine +
      `${phrase(P.notYou, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.greeting, l, vars)) +
        mailParagraph(phrase(P.body, l, vars)) +
        mailButton(opts.resetUrl, phrase(P.button, l)) +
        mailNoticeBox(
          phrase(P.validity, l, vars) +
            (opts.ipAddress
              ? " " + phrase(P.requestedFromIp, l, { ip: opts.ipAddress })
              : "")
        ) +
        mailParagraph(phrase(P.notYouShort, l)),
    }),
  };
}

const emailChangeConfirmPhrases = {
  subject: {
    de: "Bestätige deine neue E-Mail-Adresse für „{tenant}“",
    en: "Confirm your new email address for “{tenant}”",
    it: "Conferma il tuo nuovo indirizzo email per «{tenant}»",
    fi: "Vahvista studion ”{tenant}” uusi sähköpostiosoite",
  fr: "Confirmez votre nouvelle adresse e-mail pour « {tenant} »" },
  preheader: {
    de: "Bestätige den Wechsel zu {newEmail}",
    en: "Confirm the change to {newEmail}",
    it: "Conferma il cambio verso {newEmail}",
    fi: "Vahvista vaihto osoitteeseen {newEmail}",
  fr: "Confirmez le changement en {newEmail}" },
  greeting: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  body: {
    de: "Du hast deine E-Mail-Adresse für dein Lumio-Studio „{tenant}“ geändert:",
    en: "You changed the email address for your Lumio studio “{tenant}”:",
    it: "Hai modificato l'indirizzo email per il tuo studio Lumio «{tenant}»:",
    fi: "Vaihdoit Lumio-studiosi ”{tenant}” sähköpostiosoitteen:",
  fr: "Vous avez modifié l'adresse e-mail de votre studio Lumio « {tenant} » :" },
  fromTo: {
    de: "  von: {old}\n  zu:  {new}",
    en: "  from: {old}\n  to:   {new}",
    it: "  da: {old}\n  a:  {new}",
    fi: "  vanha: {old}\n  uusi:  {new}",
  fr: "de : {old}\n  à : {new}" },
  instruction: {
    de: "Klick auf den folgenden Link, um die Änderung zu bestätigen:",
    en: "Use the link below to confirm the change:",
    it: "Clicca sul link seguente per confermare la modifica:",
    fi: "Vahvista muutos klikkaamalla alla olevaa linkkiä:",
  fr: "Utilisez le lien ci-dessous pour confirmer le changement :" },
  button: {
    de: "Wechsel bestätigen",
    en: "Confirm change",
    it: "Conferma modifica",
    fi: "Vahvista vaihto",
  fr: "Confirmer le changement" },
  validity: {
    de: "Der Link ist {hours} Stunden gültig. Bis du klickst, bleibt deine alte E-Mail-Adresse aktiv.",
    en: "The link is valid for {hours} hours. Until you click it, your old address stays active.",
    it: "Il link è valido per {hours} ore. Fino a quando non lo clicchi, il tuo vecchio indirizzo resta attivo.",
    fi: "Linkki on voimassa {hours} tuntia. Vanha osoitteesi pysyy käytössä, kunnes klikkaat linkkiä.",
  fr: "Le lien est valable pour les heures {hours}. Jusqu'à ce que vous cliquiez dessus, votre ancienne adresse reste active." },
  notYou: {
    de: "Bis du den Link klickst, bleibt deine alte E-Mail-Adresse aktiv. Falls du diesen Wechsel NICHT angefordert hast, ignoriere die Mail einfach.",
    en: "Until you click the link, your old address stays active. If you did NOT request this change, simply ignore this email.",
    it: "Fino a quando non clicchi il link, il tuo vecchio indirizzo resta attivo. Se NON hai richiesto tu questa modifica, ignora semplicemente questa email.",
    fi: "Vanha osoitteesi pysyy käytössä, kunnes klikkaat linkkiä. Jos ET pyytänyt tätä vaihtoa, voit jättää viestin huomiotta.",
  fr: "Jusqu'à ce que vous cliquiez sur le lien, votre ancienne adresse reste active. Si vous n'avez PAS demandé ce changement, ignorez simplement cet e-mail." },
} satisfies Record<string, Phrase>;

export function tmplEmailChangeConfirm(opts: {
  displayName: string;
  tenantName: string;
  oldEmail: string;
  newEmail: string;
  confirmUrl: string;
  validHours: number;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = emailChangeConfirmPhrases;
  const vars = {
    name: opts.displayName,
    tenant: opts.tenantName,
    hours: opts.validHours,
    newEmail: opts.newEmail,
  };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.greeting, l, vars)}\n\n` +
      `${phrase(P.body, l, vars)}\n\n` +
      `${phrase(P.fromTo, l, { old: opts.oldEmail, new: opts.newEmail })}\n\n` +
      `${phrase(P.instruction, l)}\n\n` +
      `${opts.confirmUrl}\n\n` +
      `${phrase(P.notYou, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.greeting, l, vars)) +
        mailParagraph(phrase(P.body, l, vars)) +
        mailParagraphInterpolated(`\${old} → \${new}`, {
          old: opts.oldEmail,
          new: opts.newEmail,
        }) +
        mailButton(opts.confirmUrl, phrase(P.button, l)) +
        mailNoticeBox(phrase(P.validity, l, vars)),
    }),
  };
}

const emailChangeNoticePhrases = {
  subject: {
    de: "E-Mail-Wechsel für „{tenant}“ angefordert",
    en: "Email change requested for “{tenant}”",
    it: "Richiesto cambio email per «{tenant}»",
    fi: "Studion ”{tenant}” sähköpostiosoitteen vaihtoa pyydetty",
  fr: "Modification de l'e-mail demandée pour « {tenant} »" },
  preheader: {
    de: "E-Mail-Wechsel auf {newEmail} angefordert",
    en: "Email change to {newEmail} requested",
    it: "Richiesto cambio email a {newEmail}",
    fi: "Sähköpostiosoitteen vaihtoa osoitteeseen {newEmail} pyydetty",
  fr: "Changement d'e-mail vers {newEmail} demandé" },
  greeting: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  bodyText: {
    de: "Es wurde ein Wechsel deiner E-Mail-Adresse für dein Lumio-Studio „{tenant}“ angefordert. Die neue Adresse lautet:\n\n  {newEmail}",
    en: "A change of your email address for your Lumio studio “{tenant}” was requested. The new address is:\n\n  {newEmail}",
    it: "È stata richiesta una modifica del tuo indirizzo email per il tuo studio Lumio «{tenant}». Il nuovo indirizzo è:\n\n  {newEmail}",
    fi: "Sähköpostiosoitteesi vaihtoa Lumio-studioosi ”{tenant}” on pyydetty. Uusi osoite on:\n\n  {newEmail}",
  fr: "Un changement de votre adresse e-mail pour votre studio Lumio « {tenant} » a été demandé. La nouvelle adresse est :\n\n  {newEmail}" },
  bodyHtml: {
    de: "Es wurde ein Wechsel deiner E-Mail-Adresse für dein Lumio-Studio „{tenant}“ angefordert. Neue Adresse: {newEmail}.",
    en: "A change of your email address for your Lumio studio “{tenant}” was requested. New address: {newEmail}.",
    it: "È stata richiesta una modifica del tuo indirizzo email per il tuo studio Lumio «{tenant}». Nuovo indirizzo: {newEmail}.",
    fi: "Sähköpostiosoitteesi vaihtoa Lumio-studioosi ”{tenant}” on pyydetty. Uusi osoite: {newEmail}.",
  fr: "Un changement de votre adresse e-mail pour votre studio Lumio « {tenant} » a été demandé. Nouvelle adresse : {newEmail}." },
  linkSent: {
    de: "An die neue Adresse haben wir einen Bestätigungslink geschickt. Erst nach Klick darauf ist der Wechsel vollzogen.",
    en: "We sent a confirmation link to the new address. The change only takes effect once it is clicked.",
    it: "Abbiamo inviato un link di conferma al nuovo indirizzo. La modifica avrà effetto solo dopo averlo cliccato.",
    fi: "Lähetimme uuteen osoitteeseen vahvistuslinkin. Vaihto astuu voimaan vasta, kun linkkiä on klikattu.",
  fr: "Nous avons envoyé un lien de confirmation à la nouvelle adresse. Le changement ne prend effet qu'une fois cliqué dessus." },
  ifNotYouText: {
    de: "Wenn du das selbst angefordert hast, brauchst du nichts weiter zu tun. Wenn NICHT, melde dich umgehend beim Studio-Owner und ändere dein Passwort — möglicherweise hat jemand Fremdes Zugriff auf deinen Account.",
    en: "If you requested this yourself, there is nothing more to do. If NOT, contact the studio owner immediately and change your password — someone else may have access to your account.",
    it: "Se sei stato tu a richiederlo, non devi fare nient'altro. Se NON sei stato tu, contatta immediatamente il titolare dello studio e cambia la tua password — qualcun altro potrebbe avere accesso al tuo account.",
    fi: "Jos pyysit tätä itse, sinun ei tarvitse tehdä muuta. Jos ET, ota heti yhteyttä studion omistajaan ja vaihda salasanasi — joku ulkopuolinen saattaa päästä tiliisi.",
  fr: "Si vous l'avez demandé vous-même, il n'y a plus rien à faire. Si ce n'est pas le cas, contactez immédiatement le propriétaire du studio et modifiez votre mot de passe : quelqu'un d'autre pourrait avoir accès à votre compte." },
  ifNotYouBox: {
    de: "Wenn du das selbst angefordert hast, ist alles in Ordnung. Wenn NICHT, melde dich beim Studio-Owner und ändere dein Passwort — möglicherweise hat jemand Fremdes Zugriff auf deinen Account.",
    en: "If you requested this yourself, all is well. If NOT, contact the studio owner and change your password — someone else may have access to your account.",
    it: "Se sei stato tu a richiederlo, va tutto bene. Se NON sei stato tu, contatta il titolare dello studio e cambia la tua password — qualcun altro potrebbe avere accesso al tuo account.",
    fi: "Jos pyysit tätä itse, kaikki on kunnossa. Jos ET, ota yhteyttä studion omistajaan ja vaihda salasanasi — joku ulkopuolinen saattaa päästä tiliisi.",
  fr: "Si vous l'avez demandé vous-même, tout va bien. Si ce n'est pas le cas, contactez le propriétaire du studio et modifiez votre mot de passe : quelqu'un d'autre pourrait avoir accès à votre compte." },
} satisfies Record<string, Phrase>;

export function tmplEmailChangeNotice(opts: {
  displayName: string;
  tenantName: string;
  newEmail: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = emailChangeNoticePhrases;
  const vars = {
    name: opts.displayName,
    tenant: opts.tenantName,
    newEmail: opts.newEmail,
  };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.greeting, l, vars)}\n\n` +
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(P.linkSent, l)}\n\n` +
      `${phrase(P.ifNotYouText, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.greeting, l, vars)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailParagraph(phrase(P.linkSent, l)) +
        mailNoticeBox(phrase(P.ifNotYouBox, l)),
    }),
  };
}

/**
 * Galerie-Einladung — die EINZIGE Mail die optional Studio-Branding
 * bekommt (Logo + Akzentfarbe vom Studio). Geht an Endkunden, deshalb
 * soll der Fotograf vorne stehen, nicht Lumio.
 */
/**
 * Empfaenger: die KUNDEN des Studios. Deren eigene Sprache kennen wir
 * nicht — sie haben kein Konto und waren evtl. noch nie da. Die Sprache
 * folgt deshalb dem Studio (Tenant.locale), siehe mail-i18n.ts.
 */
const galleryInvitePhrases = {
  subject: {
    de: "Deine Galerie „{title}“ von {studio}",
    en: "Your gallery “{title}” from {studio}",
    it: "La tua galleria «{title}» da {studio}",
    fi: "Galleriasi ”{title}” – {studio}",
  fr: "Votre galerie « {title} » de {studio}" },
  preheader: {
    de: "Deine Galerie „{title}“ ist bereit",
    en: "Your gallery “{title}” is ready",
    it: "La tua galleria «{title}» è pronta",
    fi: "Galleriasi ”{title}” on valmis",
  fr: "Votre galerie « {title} » est prête" },
  greetingFallback: { de: "Hallo", en: "Hello", it: "Ciao", fi: "Hei" , fr: "Bonjour" },
  introText: {
    de: "{name},\n\ndeine Galerie „{title}“ ist da. Über den folgenden Link kannst du:\n\n",
    en: "{name},\n\nyour gallery “{title}” is ready. Using the link below you can:\n\n",
    it: "{name},\n\nla tua galleria «{title}» è pronta. Tramite il link seguente puoi:\n\n",
    fi: "{name},\n\nGalleriasi ”{title}” on valmis. Alla olevan linkin kautta voit:\n\n",
  fr: "{name},\n\nvotre galerie « {title} » est prête. En utilisant le lien ci-dessous, vous pouvez :" },
  introHtml: {
    de: "{name}, deine Galerie „{title}“ ist da.",
    en: "{name}, your gallery “{title}” is ready.",
    it: "{name}, la tua galleria «{title}» è pronta.",
    fi: "{name}, galleriasi ”{title}” on valmis.",
  fr: "{name}, votre galerie « {title} » est prête." },
  whatYouCanDo: {
    de: "Was du in der Galerie tun kannst:",
    en: "What you can do in the gallery:",
    it: "Cosa puoi fare nella galleria:",
    fi: "Mitä voit tehdä galleriassa:",
  fr: "Ce que vous pouvez faire dans la galerie :" },
  capView: {
    de: "Bilder ansehen",
    en: "View the photos",
    it: "Visualizzare le foto",
    fi: "Katsella kuvia",
  fr: "Voir les photos" },
  capSelect: {
    de: "Lieblings-Bilder markieren",
    en: "Mark your favourites",
    it: "Contrassegnare le tue preferite",
    fi: "Merkitä suosikkikuvasi",
  fr: "Marquez vos favoris" },
  capDownload: {
    de: "Bilder herunterladen",
    en: "Download the photos",
    it: "Scaricare le foto",
    fi: "Ladata kuvia",
  fr: "Téléchargez les photos" },
  openGalleryLine: {
    de: "Galerie öffnen:",
    en: "Open the gallery:",
    it: "Apri la galleria:",
    fi: "Avaa galleria:",
  fr: "Ouvrez la galerie :" },
  expiry: {
    de: "Der Link ist gültig bis {date}.",
    en: "The link is valid until {date}.",
    it: "Il link è valido fino al {date}.",
    fi: "Linkki on voimassa {date} asti.",
  fr: "Le lien est valable jusqu'à {date}." },
  sentVia: {
    de: "(verschickt via Lumio)",
    en: "(sent via Lumio)",
    it: "(inviata tramite Lumio)",
    fi: "(lähetetty Lumion kautta)",
  fr: "(envoyé via Lumio)" },
  footerNote: {
    de: "Diese Mail wurde von {studio} über Lumio verschickt.",
    en: "This email was sent by {studio} via Lumio.",
    it: "Questa email è stata inviata da {studio} tramite Lumio.",
    fi: "Tämän viestin lähetti {studio} Lumion kautta.",
  fr: "Cet e-mail a été envoyé par {studio} via Lumio." },
} satisfies Record<string, Phrase>;

export function tmplGalleryInvite(opts: {
  galleryTitle: string;
  shareUrl: string;
  studioName: string;
  recipientLabel: string;
  personalMessage?: string;
  canSelect: boolean;
  canDownload: boolean;
  expiresAt?: Date | null;
  /** Optional: Studio-Branding fuer die HTML-Mail. */
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const greetingName =
    opts.recipientLabel || phrase(galleryInvitePhrases.greetingFallback, l);
  const vars = {
    title: opts.galleryTitle,
    studio: opts.studioName,
    name: greetingName,
  };

  // Datum in der Sprache des Empfaengers, nicht fest de-DE.
  const expiryText = opts.expiresAt
    ? phrase(galleryInvitePhrases.expiry, l, {
        date: opts.expiresAt.toLocaleDateString(localeTag(l), {
          day: "2-digit",
          month: "long",
          year: "numeric",
        }),
      })
    : "";
  const expiryLine = expiryText ? `\n${expiryText}\n` : "";

  const capabilities: string[] = [phrase(galleryInvitePhrases.capView, l)];
  if (opts.canSelect)
    capabilities.push(phrase(galleryInvitePhrases.capSelect, l));
  if (opts.canDownload)
    capabilities.push(phrase(galleryInvitePhrases.capDownload, l));
  const capLines = capabilities.map((c) => `  • ${c}`).join("\n");

  const intro = opts.personalMessage
    ? `${opts.personalMessage}\n\n`
    : phrase(galleryInvitePhrases.introText, l, vars);

  const accent = opts.branding?.accentColor ?? null;

  return {
    subject: phrase(galleryInvitePhrases.subject, l, vars),
    text:
      intro +
      (opts.personalMessage
        ? `${phrase(galleryInvitePhrases.whatYouCanDo, l)}\n`
        : "") +
      capLines +
      `\n\n` +
      `${phrase(galleryInvitePhrases.openGalleryLine, l)}\n${opts.shareUrl}\n` +
      expiryLine +
      `\n` +
      `— ${opts.studioName}\n` +
      `\n` +
      `${phrase(galleryInvitePhrases.sentVia, l)}`,
    html: renderMailLayout({
      locale: l,
      branding: {
        ...(opts.branding ?? {}),
        brandName: opts.studioName,
        footerNote: phrase(galleryInvitePhrases.footerNote, l, vars),
      },
      preheader: opts.personalMessage
        ? opts.personalMessage.slice(0, 100)
        : phrase(galleryInvitePhrases.preheader, l, vars),
      bodyHtml:
        (opts.personalMessage
          ? mailQuoteBlock(opts.personalMessage, accent)
          : mailParagraph(phrase(galleryInvitePhrases.introHtml, l, vars))) +
        mailParagraph(phrase(galleryInvitePhrases.whatYouCanDo, l)) +
        mailBullets(capabilities) +
        mailButton(opts.shareUrl, phrase(common.openGallery, l), accent) +
        (expiryText ? mailNoticeBox(expiryText) : ""),
    }),
  };
}

const welcomePhrases = {
  subject: {
    de: "Willkommen bei Lumio — dein Studio „{studio}“ ist startklar",
    en: "Welcome to Lumio — your studio “{studio}” is ready",
    it: "Benvenuto su Lumio — il tuo studio «{studio}» è pronto",
    fi: "Tervetuloa Lumioon — studiosi ”{studio}” on käyttövalmis",
  fr: "Bienvenue chez Lumio — votre studio « {studio} » est prêt" },
  preheader: {
    de: "Dein Studio „{studio}“ ist startklar",
    en: "Your studio “{studio}” is ready",
    it: "Il tuo studio «{studio}» è pronto",
    fi: "Studiosi ”{studio}” on käyttövalmis",
  fr: "Votre studio « {studio} » est prêt" },
  greetingNamed: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  greetingPlain: { de: "Hallo,", en: "Hello,", it: "Ciao,", fi: "Hei," , fr: "Bonjour," },
  heading: {
    de: "Willkommen bei Lumio",
    en: "Welcome to Lumio",
    it: "Benvenuto su Lumio",
    fi: "Tervetuloa Lumioon",
  fr: "Bienvenue à Lumio" },
  bodyText: {
    de: "dein Lumio-Studio „{studio}“ ist angelegt und einsatzbereit. Du bist im {plan}-Plan mit einem 14-tägigen Trial — kostenlos bis zum {date}, kein Risiko.",
    en: "your Lumio studio “{studio}” is set up and ready. You are on the {plan} plan with a 14-day trial — free until {date}, no risk.",
    it: "il tuo studio Lumio «{studio}» è stato creato ed è pronto all'uso. Sei nel piano {plan} con una prova gratuita di 14 giorni — gratis fino al {date}, senza rischi.",
    fi: "Lumio-studiosi ”{studio}” on luotu ja käyttövalmis. Olet {plan}-paketissa 14 päivän kokeilujaksolla — maksutta {date} asti, ilman riskiä.",
  fr: "votre studio Lumio « {studio} » est configuré et prêt. Vous bénéficiez du forfait {plan} avec un essai de 14 jours — gratuit jusqu'à {date}, sans risque." },
  bodyHtml: {
    de: "{prefix}dein Studio „{studio}“ ist angelegt und einsatzbereit. Du bist im {plan}-Plan mit einem 14-tägigen Trial — kostenlos bis zum {date}.",
    en: "{prefix}your studio “{studio}” is set up and ready. You are on the {plan} plan with a 14-day trial — free until {date}.",
    it: "{prefix}il tuo studio «{studio}» è stato creato ed è pronto all'uso. Sei nel piano {plan} con una prova gratuita di 14 giorni — gratis fino al {date}.",
    fi: "{prefix}studiosi ”{studio}” on luotu ja käyttövalmis. Olet {plan}-paketissa 14 päivän kokeilujaksolla — maksutta {date} asti.",
  fr: "{prefix}votre studio « {studio} » est configuré et prêt. Vous bénéficiez du forfait {plan} avec un essai de 14 jours — gratuit jusqu'à {date}." },
  loginAt: {
    de: "Einloggen kannst du dich jederzeit unter:",
    en: "You can sign in any time at:",
    it: "Puoi accedere in qualsiasi momento su:",
    fi: "Voit kirjautua sisään milloin tahansa osoitteessa:",
  fr: "Vous pouvez vous connecter à tout moment à :" },
  firstSteps: {
    de: "Erste Schritte für dein Studio:",
    en: "First steps for your studio:",
    it: "Primi passi per il tuo studio:",
    fi: "Ensimmäiset askeleet studiossasi:",
  fr: "Premiers pas pour votre studio :" },
  firstStepsHeading: {
    de: "Erste Schritte",
    en: "First steps",
    it: "Primi passi",
    fi: "Ensimmäiset askeleet",
  fr: "Premiers pas" },
  step1: {
    de: "Branding anpassen (Logo, Farben, eigene Domain)",
    en: "Set up your branding (logo, colours, custom domain)",
    it: "Personalizza il branding (logo, colori, dominio personalizzato)",
    fi: "Muokkaa ilmettäsi (logo, värit, oma verkkotunnus)",
  fr: "Configurez votre branding (logo, couleurs, domaine personnalisé)" },
  step2: {
    de: "Eine erste Galerie anlegen und ein paar Bilder hochladen",
    en: "Create a first gallery and upload a few photos",
    it: "Crea una prima galleria e carica alcune foto",
    fi: "Luo ensimmäinen galleria ja lisää siihen muutama kuva",
  fr: "Créez une première galerie et téléchargez quelques photos" },
  step3: {
    de: "Test-Share-Link an dich selbst schicken, um den Endkunden-Workflow zu durchlaufen",
    en: "Send yourself a test share link to walk through the customer flow",
    it: "Invia a te stesso un link di condivisione di prova per seguire il flusso del cliente",
    fi: "Lähetä itsellesi jakolinkki testiksi ja käy asiakkaan polku läpi",
  fr: "Envoyez-vous un lien de partage test pour parcourir le flux client" },
  button: { de: "Studio öffnen", en: "Open studio", it: "Apri studio", fi: "Avaa studio" , fr: "Atelier ouvert" },
  seeYouSoon: { de: "Bis bald", en: "See you soon", it: "A presto", fi: "Nähdään pian" , fr: "À bientôt" },
} satisfies Record<string, Phrase>;

export function tmplWelcome(opts: {
  displayName: string | null;
  studioName: string;
  studioUrl: string;
  trialEndsAt: Date;
  planName: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = welcomePhrases;
  const greeting = opts.displayName
    ? phrase(P.greetingNamed, l, { name: opts.displayName })
    : phrase(P.greetingPlain, l);
  const trialEnd = opts.trialEndsAt.toLocaleDateString(
    localeTag(l),
    { day: "2-digit", month: "long", year: "numeric" }
  );
  const vars = {
    studio: opts.studioName,
    plan: opts.planName,
    date: trialEnd,
    prefix: opts.displayName ? opts.displayName + ", " : "",
  };
  const steps = [phrase(P.step1, l), phrase(P.step2, l), phrase(P.step3, l)];
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${greeting}\n\n` +
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(P.loginAt, l)}\n  ${opts.studioUrl}\n\n` +
      `${phrase(P.firstSteps, l)}\n` +
      steps.map((x) => `  • ${x}`).join("\n") +
      `\n\n` +
      (supportHint() ? `${supportHint()}\n\n` : "") +
      `${phrase(P.seeYouSoon, l)}\n${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailButton(opts.studioUrl, phrase(P.button, l)) +
        mailDivider() +
        mailHeading(phrase(P.firstStepsHeading, l)) +
        mailBullets(steps) +
        (supportHint() ? mailNoticeBox(supportHint()!) : ""),
    }),
  };
}

// ---------------------------------------------------------------------------
// Self-Service Tenant-Loeschung (DSGVO Art. 17)
// ---------------------------------------------------------------------------

/**
 * DSGVO Art. 17. Der Text nennt konkrete Zusagen — 60 Tage Karenz, sofortige
 * Stripe-Kuendigung, Ruecknahme bis zum Stichtag. Die englische Fassung ist
 * bewusst woertlich gehalten: gleiche Fristen, gleiche Verbindlichkeit, keine
 * weicheren Formulierungen.
 */
const deletionRequestedPhrases = {
  subject: {
    de: "Löschung deines Studios „{studio}“ geplant",
    en: "Deletion of your studio “{studio}” is scheduled",
    it: "Cancellazione del tuo studio «{studio}» pianificata",
    fi: "Studiosi ”{studio}” poisto on ajastettu",
  fr: "La suppression de votre studio « {studio} » est programmée" },
  preheader: {
    de: "Endgültige Löschung am {date} — bis dahin rücknehmbar",
    en: "Permanent deletion on {date} — reversible until then",
    it: "Cancellazione definitiva il {date} — revocabile fino ad allora",
    fi: "Lopullinen poisto {date} — siihen asti peruttavissa",
  fr: "Suppression définitive sur {date} — réversible jusque-là" },
  greetingNamed: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  greetingPlain: { de: "Hallo,", en: "Hello,", it: "Ciao,", fi: "Hei," , fr: "Bonjour," },
  heading: {
    de: "Studio-Löschung geplant",
    en: "Studio deletion scheduled",
    it: "Cancellazione dello studio pianificata",
    fi: "Studion poisto ajastettu",
  fr: "Suppression du studio programmée" },
  intro: {
    de: "wir haben deine Anfrage zur Löschung deines Lumio-Studios „{studio}“ erhalten.",
    en: "we have received your request to delete your Lumio studio “{studio}”.",
    it: "abbiamo ricevuto la tua richiesta di cancellazione del tuo studio Lumio «{studio}».",
    fi: "Olemme vastaanottaneet pyyntösi poistaa Lumio-studiosi ”{studio}”.",
  fr: "nous avons reçu votre demande de suppression de votre studio Lumio « {studio} »." },
  introHtml: {
    de: "{greeting} — wir haben deine Anfrage zur Löschung von „{studio}“ erhalten.",
    en: "{greeting} — we have received your request to delete “{studio}”.",
    it: "{greeting} — abbiamo ricevuto la tua richiesta di cancellazione di «{studio}».",
    fi: "{greeting} — olemme vastaanottaneet pyyntösi poistaa ”{studio}”.",
  fr: "{greeting} — nous avons reçu votre demande de suppression de « {studio} »." },
  whatHappens: {
    de: "Was jetzt passiert",
    en: "What happens now",
    it: "Cosa succede ora",
    fi: "Mitä tapahtuu seuraavaksi",
  fr: "Que se passe-t-il maintenant" },
  whatHappensText: {
    de: "Was jetzt passiert:",
    en: "What happens now:",
    it: "Cosa succede ora:",
    fi: "Mitä tapahtuu seuraavaksi:",
  fr: "Que se passe-t-il maintenant :" },
  step1: {
    de: "Deine Stripe-Subscription wurde sofort gekündigt — keine weitere Abrechnung.",
    en: "Your Stripe subscription was cancelled immediately — no further billing.",
    it: "Il tuo abbonamento Stripe è stato annullato immediatamente — nessun ulteriore addebito.",
    fi: "Stripe-tilauksesi päättyi heti — laskutusta ei enää tule.",
  fr: "Votre abonnement Stripe a été annulé immédiatement – ​​aucune autre facturation." },
  step2Text: {
    de: "Alle Galerien, Freigabe- und Upload-Links sind ab sofort offline. Deine Kundinnen und Kunden haben keinen Zugriff mehr.",
    en: "All galleries, share links and upload links are offline as of now. Your customers no longer have access.",
    it: "Tutte le gallerie, i link di condivisione e di caricamento sono offline a partire da ora. I tuoi clienti non hanno più accesso.",
    fi: "Kaikki galleriat sekä jako- ja lähetyslinkit ovat nyt poissa käytöstä. Asiakkaasi eivät enää pääse niihin.",
  fr: "Toutes les galeries, liens de partage et liens de téléchargement sont désormais hors ligne. Vos clients n’y ont plus accès." },
  step2Html: {
    de: "Alle Galerien, Freigabe- und Upload-Links sind ab sofort offline — deine Kundinnen und Kunden haben keinen Zugriff mehr.",
    en: "All galleries, share links and upload links are offline as of now — your customers no longer have access.",
    it: "Tutte le gallerie, i link di condivisione e di caricamento sono offline a partire da ora — i tuoi clienti non hanno più accesso.",
    fi: "Kaikki galleriat sekä jako- ja lähetyslinkit ovat nyt poissa käytöstä — asiakkaasi eivät enää pääse niihin.",
  fr: "Toutes les galeries, liens de partage et liens de téléchargement sont désormais hors ligne – vos clients n’y ont plus accès." },
  step3Text: {
    de: "Das Studio bleibt für 60 Tage in der Karenzphase. Die Daten bleiben in dieser Zeit vollständig erhalten.",
    en: "The studio stays in a 60-day grace period. During that time all data is retained in full.",
    it: "Lo studio resta per 60 giorni in un periodo di tolleranza. Durante questo periodo tutti i dati vengono conservati integralmente.",
    fi: "Studio pysyy 60 päivää odotustilassa. Tiedot säilyvät tänä aikana täysin koskemattomina.",
  fr: "Le studio reste dans un délai de grâce de 60 jours. Pendant cette période, toutes les données sont conservées dans leur intégralité." },
  step3Html: {
    de: "Das Studio bleibt für 60 Tage in der Karenzphase. Die Daten bleiben in dieser Zeit vollständig erhalten; nimmst du die Löschung zurück, sind alle Galerien sofort wieder erreichbar.",
    en: "The studio stays in a 60-day grace period. During that time all data is retained in full; if you reverse the deletion, every gallery is reachable again immediately.",
    it: "Lo studio resta per 60 giorni in un periodo di tolleranza. Durante questo periodo tutti i dati vengono conservati integralmente; se annulli la cancellazione, tutte le gallerie tornano immediatamente accessibili.",
    fi: "Studio pysyy 60 päivää odotustilassa. Tiedot säilyvät tänä aikana täysin koskemattomina; jos peruut poiston, kaikki galleriat ovat heti taas käytettävissä.",
  fr: "Le studio reste dans un délai de grâce de 60 jours. Pendant cette période, toutes les données sont conservées dans leur intégralité ; si vous annulez la suppression, chaque galerie est à nouveau accessible immédiatement." },
  step4: {
    de: "Du kannst die Löschung bis zum {date} jederzeit zurücknehmen.",
    en: "You can reverse the deletion at any time until {date}.",
    it: "Puoi annullare la cancellazione in qualsiasi momento fino al {date}.",
    fi: "Voit perua poiston milloin tahansa {date} asti.",
  fr: "Vous pouvez annuler la suppression à tout moment jusqu'à {date}." },
  step5: {
    de: "Am {date} werden alle Daten endgültig gelöscht.",
    en: "On {date} all data will be permanently deleted.",
    it: "Il {date} tutti i dati verranno cancellati definitivamente.",
    fi: "Kaikki tiedot poistetaan lopullisesti {date}.",
  fr: "Sur {date}, toutes les données seront définitivement supprimées." },
  cancelLine: {
    de: "Löschung zurücknehmen:",
    en: "Reverse the deletion:",
    it: "Annulla la cancellazione:",
    fi: "Peru poisto:",
  fr: "Annulez la suppression :" },
  button: {
    de: "Löschung zurücknehmen",
    en: "Reverse deletion",
    it: "Annulla cancellazione",
    fi: "Peru poisto",
  fr: "Annuler la suppression" },
  notRequested: {
    de: "Wenn du die Löschung NICHT angefordert hast,",
    en: "If you did NOT request this deletion,",
    it: "Se NON hai richiesto tu questa cancellazione,",
    fi: "Jos ET ole pyytänyt poistoa,",
  fr: "Si vous n'avez PAS demandé cette suppression," },
  strangerAccess: {
    de: "Möglicherweise hat jemand Fremdes Zugriff auf deinen Account.",
    en: "Someone else may have access to your account.",
    it: "Qualcun altro potrebbe avere accesso al tuo account.",
    fi: "Joku ulkopuolinen on ehkä päässyt tilillesi.",
  fr: "Quelqu'un d'autre peut avoir accès à votre compte." },
} satisfies Record<string, Phrase>;

export function tmplDeletionRequested(opts: {
  displayName: string | null;
  studioName: string;
  scheduledFor: Date;
  cancelUrl: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = deletionRequestedPhrases;
  const greeting = opts.displayName
    ? phrase(P.greetingNamed, l, { name: opts.displayName })
    : phrase(P.greetingPlain, l);
  const dateStr = opts.scheduledFor.toLocaleDateString(
    localeTag(l),
    { day: "2-digit", month: "long", year: "numeric" }
  );
  const vars = { studio: opts.studioName, date: dateStr };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${greeting}\n\n` +
      `${phrase(P.intro, l, vars)}\n\n` +
      `${phrase(P.whatHappensText, l)}\n` +
      `  • ${phrase(P.step1, l)}\n` +
      `  • ${phrase(P.step2Text, l)}\n` +
      `  • ${phrase(P.step3Text, l)}\n` +
      `  • ${phrase(P.step4, l, vars)}\n` +
      `  • ${phrase(P.step5, l, vars)}\n\n` +
      `${phrase(P.cancelLine, l)}\n${opts.cancelUrl}\n\n` +
      `${urgentSupportHint(phrase(P.notRequested, l))}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(
          phrase(P.introHtml, l, {
            ...vars,
            greeting: greeting.replace(",", ""),
          })
        ) +
        mailHeading(phrase(P.whatHappens, l)) +
        mailBullets([
          phrase(P.step1, l),
          phrase(P.step2Html, l),
          phrase(P.step3Html, l),
          phrase(P.step4, l, vars),
          phrase(P.step5, l, vars),
        ]) +
        mailButton(opts.cancelUrl, phrase(P.button, l)) +
        mailNoticeBox(
          `${urgentSupportHint(phrase(P.notRequested, l))} ${phrase(P.strangerAccess, l)}`
        ),
    }),
  };
}

const deletionCancelledPhrases = {
  subject: {
    de: "Löschung deines Studios „{studio}“ zurückgenommen",
    en: "Deletion of your studio “{studio}” has been reversed",
    it: "Cancellazione del tuo studio «{studio}» annullata",
    fi: "Studiosi ”{studio}” poisto on peruttu",
  fr: "La suppression de votre studio « {studio} » a été annulée" },
  preheader: {
    de: "Dein Studio „{studio}“ ist wieder aktiv",
    en: "Your studio “{studio}” is active again",
    it: "Il tuo studio «{studio}» è di nuovo attivo",
    fi: "Studiosi ”{studio}” on taas aktiivinen",
  fr: "Votre studio « {studio} » est à nouveau actif" },
  greetingNamed: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  greetingPlain: { de: "Hallo,", en: "Hello,", it: "Ciao,", fi: "Hei," , fr: "Bonjour," },
  heading: {
    de: "Löschung zurückgenommen",
    en: "Deletion reversed",
    it: "Cancellazione annullata",
    fi: "Poisto peruttu",
  fr: "Suppression annulée" },
  bodyText: {
    de: "du hast die Löschung deines Studios „{studio}“ zurückgenommen. Dein Studio ist wieder aktiv und voll nutzbar.",
    en: "you reversed the deletion of your studio “{studio}”. Your studio is active and fully usable again.",
    it: "hai annullato la cancellazione del tuo studio «{studio}». Il tuo studio è di nuovo attivo e pienamente utilizzabile.",
    fi: "Olet perunut studiosi ”{studio}” poiston. Studiosi on taas aktiivinen ja täysin käytettävissä.",
  fr: "vous avez annulé la suppression de votre studio « {studio} ». Votre studio est à nouveau actif et entièrement utilisable." },
  bodyHtml: {
    de: "{greeting} — du hast die Löschung deines Studios „{studio}“ zurückgenommen. Dein Studio ist wieder aktiv und voll nutzbar.",
    en: "{greeting} — you reversed the deletion of your studio “{studio}”. Your studio is active and fully usable again.",
    it: "{greeting} — hai annullato la cancellazione del tuo studio «{studio}». Il tuo studio è di nuovo attivo e pienamente utilizzabile.",
    fi: "{greeting} — olet perunut studiosi ”{studio}” poiston. Studiosi on taas aktiivinen ja täysin käytettävissä.",
  fr: "{greeting} — vous avez annulé la suppression de votre studio « {studio} ». Votre studio est à nouveau actif et entièrement utilisable." },
  billingTitle: {
    de: "Wichtiger Hinweis zur Abrechnung:",
    en: "Important note about billing:",
    it: "Nota importante sulla fatturazione:",
    fi: "Tärkeää tietoa laskutuksesta:",
  fr: "Remarque importante concernant la facturation :" },
  billingText: {
    de: "Deine Stripe-Subscription wurde bei der Lösch-Anfrage gekündigt und wird NICHT automatisch reaktiviert. Wenn du Lumio weiter nutzen willst, musst du im Studio unter „Billing“ eine neue Subscription starten.",
    en: "Your Stripe subscription was cancelled when the deletion was requested and will NOT be reactivated automatically. If you want to keep using Lumio, you have to start a new subscription in the studio under “Billing”.",
    it: "Il tuo abbonamento Stripe è stato annullato al momento della richiesta di cancellazione e NON verrà riattivato automaticamente. Se vuoi continuare a usare Lumio, devi avviare un nuovo abbonamento nello studio sotto «Fatturazione».",
    fi: "Stripe-tilauksesi päättyi poistopyynnön yhteydessä, eikä se aktivoidu automaattisesti uudelleen. Jos haluat jatkaa Lumion käyttöä, sinun täytyy aloittaa uusi tilaus studiossa kohdassa ”Laskutus”.",
  fr: "Votre abonnement Stripe a été annulé lorsque la suppression a été demandée et ne sera PAS réactivé automatiquement. Si vous souhaitez continuer à utiliser Lumio, vous devez souscrire un nouvel abonnement dans le studio sous « Facturation »." },
  billingBox: {
    de: "Wichtig zur Abrechnung: Deine Stripe-Subscription wurde bei der Lösch-Anfrage gekündigt und wird NICHT automatisch reaktiviert. Wenn du Lumio weiter nutzen willst, starte im Studio unter „Billing“ eine neue Subscription.",
    en: "Important about billing: your Stripe subscription was cancelled when the deletion was requested and will NOT be reactivated automatically. If you want to keep using Lumio, start a new subscription in the studio under “Billing”.",
    it: "Importante sulla fatturazione: il tuo abbonamento Stripe è stato annullato al momento della richiesta di cancellazione e NON verrà riattivato automaticamente. Se vuoi continuare a usare Lumio, avvia un nuovo abbonamento nello studio sotto «Fatturazione».",
    fi: "Tärkeää laskutuksesta: Stripe-tilauksesi päättyi poistopyynnön yhteydessä, eikä se aktivoidu automaattisesti uudelleen. Jos haluat jatkaa Lumion käyttöä, aloita uusi tilaus studiossa kohdassa ”Laskutus”.",
  fr: "Important concernant la facturation : votre abonnement Stripe a été résilié lors de la demande de suppression et ne sera PAS réactivé automatiquement. Si vous souhaitez continuer à utiliser Lumio, souscrivez un nouvel abonnement dans le studio sous « Facturation »." },
} satisfies Record<string, Phrase>;

export function tmplDeletionCancelled(opts: {
  displayName: string | null;
  studioName: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = deletionCancelledPhrases;
  const greeting = opts.displayName
    ? phrase(P.greetingNamed, l, { name: opts.displayName })
    : phrase(P.greetingPlain, l);
  const vars = { studio: opts.studioName };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${greeting}\n\n` +
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(P.billingTitle, l)}\n` +
      `${phrase(P.billingText, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(
          phrase(P.bodyHtml, l, {
            ...vars,
            greeting: greeting.replace(",", ""),
          })
        ) +
        mailNoticeBox(phrase(P.billingBox, l)),
    }),
  };
}

/**
 * Loeschungs-Bestaetigung nach DSGVO Art. 17. Der Empfaenger soll sie
 * aufbewahren koennen — die Aufzaehlung, was geloescht wurde und was
 * bewusst bleibt, ist der inhaltliche Kern. Englisch deshalb woertlich,
 * inklusive des Hinweises auf das eigene Verarbeitungsverzeichnis.
 */
const deletionExecutedPhrases = {
  subject: {
    de: "Dein Lumio-Studio „{studio}“ wurde gelöscht",
    en: "Your Lumio studio “{studio}” has been deleted",
    it: "Il tuo studio Lumio «{studio}» è stato cancellato",
    fi: "Lumio-studiosi ”{studio}” on poistettu",
  fr: "Votre studio Lumio « {studio} » a été supprimé" },
  preheader: {
    de: "Bestätigung der endgültigen Löschung von „{studio}“",
    en: "Confirmation of the permanent deletion of “{studio}”",
    it: "Conferma della cancellazione definitiva di «{studio}»",
    fi: "Vahvistus studion ”{studio}” lopullisesta poistosta",
  fr: "Confirmation de la suppression définitive de « {studio} »" },
  greeting: { de: "Hallo,", en: "Hello,", it: "Ciao,", fi: "Hei," , fr: "Bonjour," },
  heading: { de: "Studio gelöscht", en: "Studio deleted", it: "Studio cancellato", fi: "Studio poistettu" , fr: "Studio supprimé" },
  introText: {
    de: "wie angekündigt haben wir dein Lumio-Studio „{studio}“ und alle zugehörigen Daten endgültig gelöscht.",
    en: "as announced, we have permanently deleted your Lumio studio “{studio}” and all associated data.",
    it: "come annunciato, abbiamo cancellato definitivamente il tuo studio Lumio «{studio}» e tutti i dati associati.",
    fi: "Kuten ilmoitimme, olemme poistaneet Lumio-studiosi ”{studio}” ja kaikki siihen liittyvät tiedot lopullisesti.",
  fr: "comme annoncé, nous avons définitivement supprimé votre studio Lumio « {studio} » et toutes les données associées." },
  introHtml: {
    de: "Wie angekündigt haben wir dein Lumio-Studio „{studio}“ und alle zugehörigen Daten endgültig gelöscht.",
    en: "As announced, we have permanently deleted your Lumio studio “{studio}” and all associated data.",
    it: "Come annunciato, abbiamo cancellato definitivamente il tuo studio Lumio «{studio}» e tutti i dati associati.",
    fi: "Kuten ilmoitimme, olemme poistaneet Lumio-studiosi ”{studio}” ja kaikki siihen liittyvät tiedot lopullisesti.",
  fr: "Comme annoncé, nous avons définitivement supprimé votre studio Lumio « {studio} » ainsi que toutes les données associées." },
  deletedHeading: {
    de: "Gelöscht wurden",
    en: "What was deleted",
    it: "Cosa è stato cancellato",
    fi: "Poistettiin",
  fr: "Ce qui a été supprimé" },
  deletedText: {
    de: "Gelöscht wurden:",
    en: "What was deleted:",
    it: "Cosa è stato cancellato:",
    fi: "Poistettiin:",
  fr: "Ce qui a été supprimé :" },
  del1: {
    de: "Alle Bilder und Videos in deinen Galerien",
    en: "All photos and videos in your galleries",
    it: "Tutte le foto e i video nelle tue gallerie",
    fi: "Kaikki kuvat ja videot gallerioissasi",
  fr: "Toutes les photos et vidéos dans vos galeries" },
  del2: {
    de: "Alle Galerien und ihre Konfiguration",
    en: "All galleries and their configuration",
    it: "Tutte le gallerie e la loro configurazione",
    fi: "Kaikki galleriat ja niiden asetukset",
  fr: "Toutes les galeries et leur configuration" },
  del3: {
    de: "Dein Account und alle Team-Accounts",
    en: "Your account and all team accounts",
    it: "Il tuo account e tutti gli account del team",
    fi: "Tilisi ja kaikki tiimin tilit",
  fr: "Votre compte et tous les comptes d'équipe" },
  del4: {
    de: "Branding, Watermarks, Templates",
    en: "Branding, watermarks, templates",
    it: "Branding, filigrane, template",
    fi: "Ilmeasetukset, vesileimat, mallipohjat",
  fr: "Image de marque, filigranes, modèles" },
  del5: {
    de: "Audit-Logs (nur die Tenant-spezifischen)",
    en: "Audit logs (the tenant-specific ones only)",
    it: "Log di controllo (solo quelli specifici del tenant)",
    fi: "Tapahtumalokit (vain tämän studion omat)",
  fr: "Journaux d'audit (ceux spécifiques au locataire uniquement)" },
  keptHeading: {
    de: "Behalten",
    en: "What was kept",
    it: "Cosa è stato conservato",
    fi: "Säilytettiin",
  fr: "Ce qui a été conservé" },
  keptText: {
    de: "Behalten:",
    en: "What was kept:",
    it: "Cosa è stato conservato:",
    fi: "Säilytettiin:",
  fr: "Ce qui a été conservé :" },
  keptItem: {
    de: "Stripe-Customer-Datensatz (für Rechnungs-Audit-Trail in Stripe).",
    en: "The Stripe customer record (for the invoicing audit trail in Stripe).",
    it: "Il record cliente Stripe (per la tracciabilità di fatturazione in Stripe).",
    fi: "Stripen asiakastietue (laskutuksen jäljitettävyyttä varten Stripessä).",
  fr: "La fiche client Stripe (pour la piste d'audit de facturation dans Stripe)." },
  keptContact: {
    de: "Wenn du den auch endgültig gelöscht haben möchtest, schreibe an {address}.",
    en: "If you want that deleted permanently as well, write to {address}.",
    it: "Se vuoi che venga cancellato definitivamente anche questo, scrivi a {address}.",
    fi: "Jos haluat, että myös se poistetaan lopullisesti, kirjoita osoitteeseen {address}.",
  fr: "Si vous souhaitez également que cela soit supprimé définitivement, écrivez à {address}." },
  keepThisMail: {
    de: "Diese Mail ist deine Löschungs-Bestätigung — bitte aufbewahren, falls du sie später für dein eigenes Verarbeitungsverzeichnis brauchst.",
    en: "This email is your deletion confirmation — please keep it in case you need it for your own record of processing activities.",
    it: "Questa email è la tua conferma di cancellazione — conservala nel caso ti serva in futuro per il tuo registro dei trattamenti.",
    fi: "Tämä viesti on poistovahvistuksesi — säilytä se, jos tarvitset sitä myöhemmin omaan selosteeseesi käsittelytoimista.",
  fr: "Cet e-mail constitue votre confirmation de suppression. Veuillez le conserver au cas où vous en auriez besoin pour votre propre enregistrement des activités de traitement." },
  sorryToSeeYouGo: {
    de: "Schade dass du gehst.",
    en: "Sorry to see you go.",
    it: "Ci dispiace vederti andare via.",
    fi: "Harmi, että lähdet.",
  fr: "Désolé de te voir partir." },
  feedbackInvite: {
    de: "Falls es technische Gründe waren oder ein Feature gefehlt hat: {address} — wir lesen das.",
    en: "If it was for technical reasons or a missing feature: {address} — we do read it.",
    it: "Se il motivo sono stati problemi tecnici o una funzione mancante: {address} — lo leggiamo davvero.",
    fi: "Jos syy oli tekninen tai jokin ominaisuus puuttui: {address} — luemme viestit.",
  fr: "Si c'était pour des raisons techniques ou une fonctionnalité manquante : {address} — nous le lisons." },
} satisfies Record<string, Phrase>;

export function tmplDeletionExecuted(opts: {
  studioName: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = deletionExecutedPhrases;
  const vars = { studio: opts.studioName };
  const support = supportAddress();
  const feedback = feedbackAddress();
  const keptSuffix = support
    ? " " + phrase(P.keptContact, l, { address: support })
    : "";
  const deleted = [
    phrase(P.del1, l),
    phrase(P.del2, l),
    phrase(P.del3, l),
    phrase(P.del4, l),
    phrase(P.del5, l),
  ];
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.greeting, l)}\n\n` +
      `${phrase(P.introText, l, vars)}\n\n` +
      `${phrase(P.deletedText, l)}\n` +
      deleted.map((x) => `  • ${x}`).join("\n") +
      `\n\n${phrase(P.keptText, l)}\n` +
      `  • ${phrase(P.keptItem, l)}${
        support ? `\n    ${phrase(P.keptContact, l, { address: support })}` : ""
      }\n\n` +
      `${phrase(P.keepThisMail, l)}\n\n` +
      (feedback
        ? `${phrase(P.sorryToSeeYouGo, l)} ${phrase(P.feedbackInvite, l, {
            address: feedback,
          })}\n\n`
        : "") +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(phrase(P.introHtml, l, vars)) +
        mailHeading(phrase(P.deletedHeading, l)) +
        mailBullets(deleted) +
        mailHeading(phrase(P.keptHeading, l)) +
        mailParagraph(`${phrase(P.keptItem, l)}${keptSuffix}`) +
        mailDivider() +
        mailNoticeBox(phrase(P.keepThisMail, l)) +
        mailParagraph(
          `${phrase(P.sorryToSeeYouGo, l)}${
            feedback
              ? " " + phrase(P.feedbackInvite, l, { address: feedback })
              : ""
          }`
        ),
    }),
  };
}

const deletionReminderPhrases = {
  subject: {
    de: "Erinnerung: dein Studio „{studio}“ wird in 7 Tagen gelöscht",
    en: "Reminder: your studio “{studio}” will be deleted in 7 days",
    it: "Promemoria: il tuo studio «{studio}» verrà cancellato tra 7 giorni",
    fi: "Muistutus: studiosi ”{studio}” poistetaan 7 päivän kuluttua",
  fr: "Rappel : votre studio « {studio} » sera supprimé dans 7 jours" },
  preheader: {
    de: "Letzte 7 Tage — endgültige Löschung am {date}",
    en: "Last 7 days — permanent deletion on {date}",
    it: "Ultimi 7 giorni — cancellazione definitiva il {date}",
    fi: "Viimeiset 7 päivää — lopullinen poisto {date}",
  fr: "7 derniers jours – suppression définitive sur {date}" },
  greetingNamed: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  greetingPlain: { de: "Hallo,", en: "Hello,", it: "Ciao,", fi: "Hei," , fr: "Bonjour," },
  heading: {
    de: "Letzte Erinnerung",
    en: "Final reminder",
    it: "Ultimo promemoria",
    fi: "Viimeinen muistutus",
  fr: "Dernier rappel" },
  bodyText: {
    de: "am {date} löschen wir dein Lumio-Studio „{studio}“ endgültig — wie von dir angefragt.",
    en: "on {date} we will permanently delete your Lumio studio “{studio}” — as you requested.",
    it: "il {date} cancelleremo definitivamente il tuo studio Lumio «{studio}» — come da te richiesto.",
    fi: "Poistamme Lumio-studiosi ”{studio}” lopullisesti {date} — kuten pyysit.",
  fr: "sur {date}, nous supprimerons définitivement votre studio Lumio « {studio} » — comme vous l'avez demandé." },
  bodyHtml: {
    de: "{greeting} — am {date} löschen wir dein Lumio-Studio „{studio}“ endgültig, wie von dir angefragt.",
    en: "{greeting} — on {date} we will permanently delete your Lumio studio “{studio}”, as you requested.",
    it: "{greeting} — il {date} cancelleremo definitivamente il tuo studio Lumio «{studio}», come da te richiesto.",
    fi: "{greeting} — poistamme Lumio-studiosi ”{studio}” lopullisesti {date}, kuten pyysit.",
  fr: "{greeting} — sur {date}, nous supprimerons définitivement votre studio Lumio « {studio} », comme vous l'avez demandé." },
  lastChanceText: {
    de: "Das ist deine letzte Erinnerung. Wenn du es dir anders überlegt hast, kannst du die Löschung jetzt noch zurücknehmen:",
    en: "This is your final reminder. If you have changed your mind, you can still reverse the deletion now:",
    it: "Questo è il tuo ultimo promemoria. Se hai cambiato idea, puoi ancora annullare la cancellazione ora:",
    fi: "Tämä on viimeinen muistutus. Jos muutit mielesi, voit vielä perua poiston:",
  fr: "Ceci est votre dernier rappel. Si vous avez changé d'avis, vous pouvez toujours annuler la suppression maintenant :" },
  lastChanceHtml: {
    de: "Wenn du es dir anders überlegt hast, kannst du die Löschung jetzt noch zurücknehmen:",
    en: "If you have changed your mind, you can still reverse the deletion now:",
    it: "Se hai cambiato idea, puoi ancora annullare la cancellazione ora:",
    fi: "Jos muutit mielesi, voit vielä perua poiston:",
  fr: "Si vous avez changé d'avis, vous pouvez toujours annuler la suppression maintenant :" },
  button: { de: "Löschung zurücknehmen", en: "Reverse deletion", it: "Annulla cancellazione", fi: "Peru poisto" , fr: "Annuler la suppression" },
  irreversible: {
    de: "Nach dem Stichtag sind die Daten unwiderruflich weg.",
    en: "After that date the data is irretrievably gone.",
    it: "Dopo tale data i dati saranno persi in modo irrevocabile.",
    fi: "Määräpäivän jälkeen tiedot ovat peruuttamattomasti poissa.",
  fr: "Passé cette date, les données disparaissent irrémédiablement." },
} satisfies Record<string, Phrase>;

export function tmplDeletionReminder(opts: {
  displayName: string | null;
  studioName: string;
  scheduledFor: Date;
  cancelUrl: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = deletionReminderPhrases;
  const greeting = opts.displayName
    ? phrase(P.greetingNamed, l, { name: opts.displayName })
    : phrase(P.greetingPlain, l);
  const dateStr = opts.scheduledFor.toLocaleDateString(
    localeTag(l),
    { day: "2-digit", month: "long", year: "numeric" }
  );
  const vars = { studio: opts.studioName, date: dateStr };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${greeting}\n\n` +
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(P.lastChanceText, l)}\n\n` +
      `${opts.cancelUrl}\n\n` +
      `${phrase(P.irreversible, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(
          phrase(P.bodyHtml, l, { ...vars, greeting: greeting.replace(",", "") })
        ) +
        mailParagraph(phrase(P.lastChanceHtml, l)) +
        mailButton(opts.cancelUrl, phrase(P.button, l)) +
        mailNoticeBox(phrase(P.irreversible, l)),
    }),
  };
}

// ---------------------------------------------------------------------------
// Billing-Archiv-Lifecycle
// ---------------------------------------------------------------------------

/** Mail beim Übergang Read-only → Archiv: Galerien sind jetzt offline,
 * Vorschauen werden entfernt, Originale bleiben. Reaktivierung jederzeit
 * möglich bis zum Lösch-Stichtag. */
/**
 * Archivierung nach laengerem Abo-Ausfall. Nennt eine harte Frist bis zur
 * endgueltigen Loeschung — englisch woertlich uebersetzt, damit die Frist
 * exakt gleich streng klingt.
 */
const billingArchivedPhrases = {
  subject: {
    de: "Dein Studio „{studio}“ wurde archiviert",
    en: "Your studio “{studio}” has been archived",
    it: "Il tuo studio «{studio}» è stato archiviato",
    fi: "Studiosi ”{studio}” on arkistoitu",
  fr: "Votre studio « {studio} » a été archivé" },
  preheader: {
    de: "Galerien offline — endgültige Löschung am {date}, bis dahin reaktivierbar",
    en: "Galleries offline — permanent deletion on {date}, reactivatable until then",
    it: "Gallerie offline — cancellazione definitiva il {date}, riattivabile fino ad allora",
    fi: "Galleriat poissa käytöstä — lopullinen poisto {date}, siihen asti aktivoitavissa uudelleen",
  fr: "Galeries hors ligne — suppression définitive sur {date}, réactivable d'ici là" },
  greetingNamed: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  greetingPlain: { de: "Hallo,", en: "Hello,", it: "Ciao,", fi: "Hei," , fr: "Bonjour," },
  heading: {
    de: "Studio archiviert",
    en: "Studio archived",
    it: "Studio archiviato",
    fi: "Studio arkistoitu",
  fr: "Atelier archivé" },
  introText: {
    de: "dein Lumio-Studio „{studio}“ war länger ohne aktives Abo und wurde jetzt archiviert.",
    en: "your Lumio studio “{studio}” has been without an active subscription for a while and has now been archived.",
    it: "il tuo studio Lumio «{studio}» era senza abbonamento attivo da tempo ed è stato ora archiviato.",
    fi: "Lumio-studiosi ”{studio}” on ollut pidempään ilman voimassa olevaa tilausta, ja se on nyt arkistoitu.",
  fr: "votre studio Lumio « {studio} » est sans abonnement actif depuis un certain temps et est désormais archivé." },
  introHtml: {
    de: "{greeting} — dein Studio „{studio}“ war länger ohne aktives Abo und wurde jetzt archiviert.",
    en: "{greeting} — your studio “{studio}” has been without an active subscription for a while and has now been archived.",
    it: "{greeting} — il tuo studio «{studio}» era senza abbonamento attivo da tempo ed è stato ora archiviato.",
    fi: "{greeting} — studiosi ”{studio}” on ollut pidempään ilman voimassa olevaa tilausta, ja se on nyt arkistoitu.",
  fr: "{greeting} — votre studio « {studio} » est sans abonnement actif depuis un certain temps et a maintenant été archivé." },
  meansText: { de: "Was das bedeutet:", en: "What that means:", it: "Cosa significa:", fi: "Mitä tämä tarkoittaa:" , fr: "Qu'est-ce que cela signifie :" },
  point1: {
    de: "Deine Kunden-Galerien sind vorübergehend offline.",
    en: "Your customer galleries are temporarily offline.",
    it: "Le tue gallerie clienti sono temporaneamente offline.",
    fi: "Asiakasgalleriasi ovat väliaikaisesti poissa käytöstä.",
  fr: "Vos galeries clients sont temporairement hors ligne." },
  point2: {
    de: "Die Original-Dateien bleiben gespeichert — nur die Vorschauen werden entfernt und bei Reaktivierung neu erzeugt.",
    en: "The original files stay stored — only the previews are removed and regenerated on reactivation.",
    it: "I file originali restano archiviati — vengono rimosse solo le anteprime, che verranno rigenerate alla riattivazione.",
    fi: "Alkuperäiset tiedostot säilyvät tallessa — vain esikatselut poistetaan, ja ne luodaan uudelleen aktivoinnin yhteydessä.",
  fr: "Les fichiers originaux restent stockés — seuls les aperçus sont supprimés et régénérés lors de la réactivation." },
  point3: {
    de: "Mit einem neuen Abo ist alles wieder da.",
    en: "With a new subscription everything is back.",
    it: "Con un nuovo abbonamento tutto torna disponibile.",
    fi: "Uudella tilauksella kaikki on taas paikallaan.",
  fr: "Avec un nouvel abonnement, tout est de retour." },
  deadlineText: {
    de: "Wichtig: Wenn du bis zum {date} kein Abo abschließt, werden alle Daten an diesem Tag endgültig gelöscht.",
    en: "Important: if you do not take out a subscription by {date}, all data will be permanently deleted on that day.",
    it: "Importante: se non attivi un abbonamento entro il {date}, tutti i dati verranno cancellati definitivamente in quella data.",
    fi: "Tärkeää: jos et tee tilausta {date} mennessä, kaikki tiedot poistetaan sinä päivänä lopullisesti.",
  fr: "Important : si vous ne souscrivez pas d'abonnement auprès de {date}, toutes les données seront définitivement supprimées ce jour-là." },
  deadlineBox: {
    de: "Ohne neues Abo werden am {date} alle Daten endgültig gelöscht.",
    en: "Without a new subscription all data will be permanently deleted on {date}.",
    it: "Senza un nuovo abbonamento, tutti i dati verranno cancellati definitivamente il {date}.",
    fi: "Ilman uutta tilausta kaikki tiedot poistetaan lopullisesti {date}.",
  fr: "Sans nouvel abonnement, toutes les données seront définitivement supprimées sur {date}." },
  reactivateLine: {
    de: "Studio reaktivieren:",
    en: "Reactivate studio:",
    it: "Riattiva studio:",
    fi: "Aktivoi studio uudelleen:",
  fr: "Réactiver le studio :" },
  button: { de: "Studio reaktivieren", en: "Reactivate studio", it: "Riattiva studio", fi: "Aktivoi studio uudelleen" , fr: "Réactiver le studio" },
} satisfies Record<string, Phrase>;

export function tmplBillingArchived(opts: {
  displayName: string | null;
  studioName: string;
  purgeDate: Date;
  reactivateUrl: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = billingArchivedPhrases;
  const greeting = opts.displayName
    ? phrase(P.greetingNamed, l, { name: opts.displayName })
    : phrase(P.greetingPlain, l);
  const dateStr = opts.purgeDate.toLocaleDateString(
    localeTag(l),
    { day: "2-digit", month: "long", year: "numeric" }
  );
  const vars = { studio: opts.studioName, date: dateStr };
  const points = [phrase(P.point1, l), phrase(P.point2, l), phrase(P.point3, l)];
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${greeting}\n\n` +
      `${phrase(P.introText, l, vars)}\n\n` +
      `${phrase(P.meansText, l)}\n` +
      points.map((x) => `  • ${x}`).join("\n") +
      `\n\n${phrase(P.deadlineText, l, vars)}\n\n` +
      `${phrase(P.reactivateLine, l)}\n${opts.reactivateUrl}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(
          phrase(P.introHtml, l, { ...vars, greeting: greeting.replace(",", "") })
        ) +
        mailBullets(points) +
        mailButton(opts.reactivateUrl, phrase(P.button, l)) +
        mailNoticeBox(phrase(P.deadlineBox, l, vars)),
    }),
  };
}

/** Reminder ~30 Tage vor der endgültigen Löschung eines archivierten Studios. */
const billingPurgeReminderPhrases = {
  subject: {
    de: "Letzte Erinnerung: „{studio}“ wird am {date} gelöscht",
    en: "Final reminder: “{studio}” will be deleted on {date}",
    it: "Ultimo promemoria: «{studio}» verrà cancellato il {date}",
    fi: "Viimeinen muistutus: ”{studio}” poistetaan {date}",
  fr: "Dernier rappel : « {studio} » sera supprimé sur {date}" },
  preheader: {
    de: "Endgültige Löschung am {date} — jetzt noch reaktivierbar",
    en: "Permanent deletion on {date} — still reactivatable now",
    it: "Cancellazione definitiva il {date} — ancora riattivabile ora",
    fi: "Lopullinen poisto {date} — voit vielä aktivoida uudelleen",
  fr: "Suppression définitive sur {date} — toujours réactivable maintenant" },
  greetingNamed: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  greetingPlain: { de: "Hallo,", en: "Hello,", it: "Ciao,", fi: "Hei," , fr: "Bonjour," },
  heading: {
    de: "Letzte Erinnerung",
    en: "Final reminder",
    it: "Ultimo promemoria",
    fi: "Viimeinen muistutus",
  fr: "Dernier rappel" },
  bodyText: {
    de: "dein archiviertes Lumio-Studio „{studio}“ wird am {date} endgültig gelöscht — inklusive aller Original-Dateien und Galerien.",
    en: "your archived Lumio studio “{studio}” will be permanently deleted on {date} — including all original files and galleries.",
    it: "il tuo studio Lumio archiviato «{studio}» verrà cancellato definitivamente il {date} — inclusi tutti i file originali e le gallerie.",
    fi: "Arkistoitu Lumio-studiosi ”{studio}” poistetaan lopullisesti {date} — mukaan lukien kaikki alkuperäiset tiedostot ja galleriat.",
  fr: "votre studio Lumio archivé « {studio} » sera définitivement supprimé sur {date}, y compris tous les fichiers et galeries originaux." },
  bodyHtml: {
    de: "{greeting} — dein archiviertes Studio „{studio}“ wird am {date} endgültig gelöscht, inklusive aller Original-Dateien und Galerien.",
    en: "{greeting} — your archived studio “{studio}” will be permanently deleted on {date}, including all original files and galleries.",
    it: "{greeting} — il tuo studio archiviato «{studio}» verrà cancellato definitivamente il {date}, inclusi tutti i file originali e le gallerie.",
    fi: "{greeting} — arkistoitu studiosi ”{studio}” poistetaan lopullisesti {date}, mukaan lukien kaikki alkuperäiset tiedostot ja galleriat.",
  fr: "{greeting} — votre studio archivé « {studio} » sera définitivement supprimé sur {date}, y compris tous les fichiers et galeries originaux." },
  keepData: {
    de: "Wenn du deine Daten behalten möchtest, schließe bis dahin ein Abo ab — dann wird alles wiederhergestellt:",
    en: "If you want to keep your data, take out a subscription before then — everything will be restored:",
    it: "Se vuoi mantenere i tuoi dati, attiva un abbonamento entro quella data — tutto verrà ripristinato:",
    fi: "Jos haluat säilyttää tietosi, tee tilaus siihen mennessä — silloin kaikki palautetaan:",
  fr: "Si vous souhaitez conserver vos données, souscrivez un abonnement avant cette date, tout sera restauré :" },
  button: { de: "Studio reaktivieren", en: "Reactivate studio", it: "Riattiva studio", fi: "Aktivoi studio uudelleen" , fr: "Réactiver le studio" },
  noRestoreText: {
    de: "Nach dem Stichtag ist eine Wiederherstellung nicht mehr möglich.",
    en: "After that date restoration is no longer possible.",
    it: "Dopo tale data il ripristino non sarà più possibile.",
    fi: "Määräpäivän jälkeen palauttaminen ei ole enää mahdollista.",
  fr: "Après cette date, la restauration n'est plus possible." },
  noRestoreBox: {
    de: "Nach dem Stichtag ist keine Wiederherstellung mehr möglich.",
    en: "After that date no restoration is possible.",
    it: "Dopo tale data non sarà più possibile alcun ripristino.",
    fi: "Määräpäivän jälkeen mitään ei voi enää palauttaa.",
  fr: "Après cette date, aucune restauration n'est possible." },
} satisfies Record<string, Phrase>;

export function tmplBillingPurgeReminder(opts: {
  displayName: string | null;
  studioName: string;
  purgeDate: Date;
  reactivateUrl: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = billingPurgeReminderPhrases;
  const greeting = opts.displayName
    ? phrase(P.greetingNamed, l, { name: opts.displayName })
    : phrase(P.greetingPlain, l);
  const dateStr = opts.purgeDate.toLocaleDateString(
    localeTag(l),
    { day: "2-digit", month: "long", year: "numeric" }
  );
  const vars = { studio: opts.studioName, date: dateStr };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${greeting}\n\n` +
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(P.keepData, l)}\n\n` +
      `${opts.reactivateUrl}\n\n` +
      `${phrase(P.noRestoreText, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(
          phrase(P.bodyHtml, l, { ...vars, greeting: greeting.replace(",", "") })
        ) +
        mailParagraph(phrase(P.keepData, l)) +
        mailButton(opts.reactivateUrl, phrase(P.button, l)) +
        mailNoticeBox(phrase(P.noRestoreBox, l)),
    }),
  };
}

// =============================================================================
// Super-Admin / Plattform-Benachrichtigungen (ohne Tenant-Branding)
// =============================================================================

/** Empfaenger: Super-Admins -> Sprache der Instanz. */
const superNewTenantPhrases = {
  subject: {
    de: "Neuer Tenant: {name} ({plan})",
    en: "New tenant: {name} ({plan})",
    it: "Nuovo tenant: {name} ({plan})",
    fi: "Uusi tenant: {name} ({plan})",
  fr: "Nouveau locataire : {name} ({plan})" },
  preheader: {
    de: "Neuer Tenant: {name}",
    en: "New tenant: {name}",
    it: "Nuovo tenant: {name}",
    fi: "Uusi tenant: {name}",
  fr: "Nouveau locataire : {name}" },
  heading: {
    de: "Neuer Tenant registriert",
    en: "New tenant registered",
    it: "Nuovo tenant registrato",
    fi: "Uusi tenant rekisteröityi",
  fr: "Nouveau locataire enregistré" },
  intro: {
    de: "Neuer Tenant registriert:",
    en: "New tenant registered:",
    it: "Nuovo tenant registrato:",
    fi: "Uusi tenant rekisteröityi:",
  fr: "Nouveau locataire enregistré :" },
  fieldName: { de: "Name", en: "Name", it: "Nome", fi: "Nimi" , fr: "Nom" },
  fieldSlug: { de: "Slug", en: "Slug", it: "Slug", fi: "Slug" , fr: "Limace" },
  fieldPlan: { de: "Plan", en: "Plan", it: "Piano", fi: "Paketti" , fr: "Plan" },
  fieldOwner: { de: "Owner", en: "Owner", it: "Titolare", fi: "Omistaja" , fr: "Propriétaire" },
  superAdmin: { de: "Super-Admin", en: "Super admin", it: "Super admin", fi: "Pääylläpito" , fr: "Super administrateur" },
  button: {
    de: "Im Super-Admin öffnen",
    en: "Open in super admin",
    it: "Apri nel super admin",
    fi: "Avaa pääylläpidossa",
  fr: "Ouvrir dans le super administrateur" },
} satisfies Record<string, Phrase>;

export function tmplSuperNewTenant(opts: {
  tenantName: string;
  slug: string;
  plan: string;
  ownerEmail: string;
  superUrl: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = superNewTenantPhrases;
  const vars = { name: opts.tenantName, plan: opts.plan };
  const rows = [
    `${phrase(P.fieldName, l)}: ${opts.tenantName}`,
    `${phrase(P.fieldSlug, l)}: ${opts.slug}`,
    `${phrase(P.fieldPlan, l)}: ${opts.plan}`,
    `${phrase(P.fieldOwner, l)}: ${opts.ownerEmail}`,
  ];
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.intro, l)}\n\n` +
      rows.join("\n") +
      `\n\n${phrase(P.superAdmin, l)}: ${opts.superUrl}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailBullets(rows) +
        mailButton(opts.superUrl, phrase(P.button, l)),
    }),
  };
}

/** Empfaenger: Super-Admins -> Sprache der Instanz. */
const superDigestPhrases = {
  subject: {
    de: "Lumio Report {date} — {n} neue Tenant(s)",
    en: "Lumio report {date} — {n} new tenant(s)",
    it: "Report Lumio {date} — {n} nuovi tenant",
    fi: "Lumio-raportti {date} — {n} uutta tenanttia",
  fr: "Rapport Lumio {date} — Nouveau(x) locataire(s) {n}" },
  preheader: {
    de: "{n} neue Tenants · {gib} GB gesamt",
    en: "{n} new tenants · {gib} GB total",
    it: "{n} nuovi tenant · {gib} GB totali",
    fi: "{n} uutta tenanttia · {gib} Gt yhteensä",
  fr: "{n} nouveaux locataires · {gib} Go total" },
  titleText: {
    de: "Lumio Täglicher Report — {date}",
    en: "Lumio daily report — {date}",
    it: "Report giornaliero Lumio — {date}",
    fi: "Lumion päivittäinen raportti — {date}",
  fr: "Rapport quotidien Lumio — {date}" },
  heading: {
    de: "Täglicher Report — {date}",
    en: "Daily report — {date}",
    it: "Report giornaliero — {date}",
    fi: "Päivittäinen raportti — {date}",
  fr: "Rapport quotidien — {date}" },
  newTenants: {
    de: "Neue Tenants (24h): {n}",
    en: "New tenants (24h): {n}",
    it: "Nuovi tenant (24h): {n}",
    fi: "Uudet tenantit (24 h): {n}",
  fr: "Nouveaux locataires (24h) : {n}" },
  noNewTenants: {
    de: "Keine neuen Tenants in den letzten 24 Stunden.",
    en: "No new tenants in the last 24 hours.",
    it: "Nessun nuovo tenant nelle ultime 24 ore.",
    fi: "Ei uusia tenantteja viimeisen 24 tunnin aikana.",
  fr: "Aucun nouveau locataire ces dernières 24 heures." },
  activeTenants: {
    de: "Aktive Tenants: {n}",
    en: "Active tenants: {n}",
    it: "Tenant attivi: {n}",
    fi: "Aktiiviset tenantit: {n}",
  fr: "Locataires actifs : {n}" },
  totalUsers: {
    de: "User gesamt: {n}",
    en: "Users total: {n}",
    it: "Utenti totali: {n}",
    fi: "Käyttäjiä yhteensä: {n}",
  fr: "Nombre total d'utilisateurs : {n}" },
  totalStorage: {
    de: "Speicher gesamt: {n} GB",
    en: "Storage total: {n} GB",
    it: "Spazio totale: {n} GB",
    fi: "Tallennustila yhteensä: {n} Gt",
  fr: "Stockage total : {n} Go" },
  topStorage: { de: "Top-Speicher:", en: "Top storage:", it: "Spazio maggiore:", fi: "Eniten tallennustilaa:" , fr: "Rangement supérieur :" },
  nearLimit: {
    de: "Nahe am Limit (>=90%): {n}",
    en: "Near the limit (>=90%): {n}",
    it: "Vicino al limite (>=90%): {n}",
    fi: "Lähellä rajaa (>=90 %): {n}",
  fr: "Près de la limite (>=90%) : {n}" },
  superAdmin: { de: "Super-Admin", en: "Super admin", it: "Super admin", fi: "Pääylläpito" , fr: "Super administrateur" },
  button: {
    de: "Super-Admin öffnen",
    en: "Open super admin",
    it: "Apri super admin",
    fi: "Avaa pääylläpito",
  fr: "Ouvrir le super administrateur" },
} satisfies Record<string, Phrase>;

export function tmplSuperDigest(opts: {
  dateLabel: string;
  newTenants: Array<{ name: string; plan: string }>;
  activeTenants: number;
  totalUsers: number;
  totalStorageGib: number;
  topStorage: Array<{ name: string; usedGib: number; percent: number }>;
  nearLimit: Array<{ name: string; percent: number }>;
  superUrl: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = superDigestPhrases;
  const newCount = opts.newTenants.length;
  const newLines = opts.newTenants.map((t) => `${t.name} (${t.plan})`);
  const topLines = opts.topStorage.map(
    (t) => `${t.name}: ${t.usedGib} GB (${t.percent}%)`
  );
  const nearLines = opts.nearLimit.map((t) => `${t.name}: ${t.percent}%`);
  const stats = [
    phrase(P.activeTenants, l, { n: opts.activeTenants }),
    phrase(P.totalUsers, l, { n: opts.totalUsers }),
    phrase(P.totalStorage, l, { n: opts.totalStorageGib }),
  ];

  const textParts = [
    phrase(P.titleText, l, { date: opts.dateLabel }),
    ``,
    phrase(P.newTenants, l, { n: newCount }),
    ...newLines.map((x) => `  - ${x}`),
    ``,
    ...stats,
    ``,
    phrase(P.topStorage, l),
    ...topLines.map((x) => `  - ${x}`),
    ``,
    phrase(P.nearLimit, l, { n: opts.nearLimit.length }),
    ...nearLines.map((x) => `  - ${x}`),
    ``,
    `${phrase(P.superAdmin, l)}: ${opts.superUrl}`,
    phrase(common.signature, l),
  ];

  let body =
    mailHeading(phrase(P.heading, l, { date: opts.dateLabel })) +
    mailHeading2sub(phrase(P.newTenants, l, { n: newCount }));
  body +=
    newCount > 0 ? mailBullets(newLines) : mailParagraph(phrase(P.noNewTenants, l));
  body += mailDivider();
  body += mailBullets(stats);
  if (opts.topStorage.length > 0) {
    body += mailParagraph(phrase(P.topStorage, l)) + mailBullets(topLines);
  }
  body += mailParagraph(phrase(P.nearLimit, l, { n: opts.nearLimit.length }));
  if (opts.nearLimit.length > 0) body += mailBullets(nearLines);
  body += mailButton(opts.superUrl, phrase(P.button, l));

  return {
    subject: phrase(P.subject, l, { date: opts.dateLabel, n: newCount }),
    text: textParts.join("\n"),
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, {
        n: newCount,
        gib: opts.totalStorageGib,
      }),
      bodyHtml: body,
    }),
  };
}

// Kleiner Zwischen-Titel (mailHeading ist groß; hier eine dezentere Variante).
function mailHeading2sub(text: string): string {
  return mailParagraph(text);
}

// =============================================================================
// Weitere Studio-Benachrichtigungen (Phase 3)
// =============================================================================

const teamMemberJoinedPhrases = {
  subject: {
    de: "Neues Team-Mitglied: {who}",
    en: "New team member: {who}",
    it: "Nuovo membro del team: {who}",
    fi: "Uusi tiimin jäsen: {who}",
  fr: "Nouveau membre de l'équipe : {who}" },
  preheader: {
    de: "{who} ist deinem Team beigetreten",
    en: "{who} joined your team",
    it: "{who} si è unito al tuo team",
    fi: "{who} liittyi tiimiisi",
  fr: "{who} a rejoint votre équipe" },
  heading: {
    de: "Neues Team-Mitglied",
    en: "New team member",
    it: "Nuovo membro del team",
    fi: "Uusi tiimin jäsen",
  fr: "Nouveau membre de l'équipe" },
  bodyText: {
    de: "{who} ({email}, Rolle: {role}) hat das Konto eingerichtet und ist deinem Team beigetreten.",
    en: "{who} ({email}, role: {role}) set up their account and joined your team.",
    it: "{who} ({email}, ruolo: {role}) ha creato il proprio account ed è entrato a far parte del tuo team.",
    fi: "{who} ({email}, rooli: {role}) on ottanut tilin käyttöön ja liittynyt tiimiisi.",
  fr: "{who} ({email}, rôle : {role}) a créé son compte et a rejoint votre équipe." },
  bodyHtml: {
    de: "{who} ({email}) hat das Konto eingerichtet und ist deinem Team als „{role}“ beigetreten.",
    en: "{who} ({email}) set up their account and joined your team as “{role}”.",
    it: "{who} ({email}) ha creato il proprio account ed è entrato a far parte del tuo team come «{role}».",
    fi: "{who} ({email}) on ottanut tilin käyttöön ja liittynyt tiimiisi roolilla ”{role}”.",
  fr: "{who} ({email}) a créé son compte et a rejoint votre équipe sous le nom de « {role} »." },
  button: { de: "Team verwalten", en: "Manage team", it: "Gestisci team", fi: "Hallitse tiimiä" , fr: "Gérer l'équipe" },
} satisfies Record<string, Phrase>;

export function tmplTeamMemberJoined(opts: {
  memberName: string;
  memberEmail: string;
  role: string;
  teamUrl: string;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = teamMemberJoinedPhrases;
  const who = opts.memberName || opts.memberEmail;
  const vars = { who, email: opts.memberEmail, role: opts.role };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(P.button, l)}: ${opts.teamUrl}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      branding: opts.branding,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailButton(opts.teamUrl, phrase(P.button, l), opts.branding?.accentColor),
    }),
  };
}

const galleryExpiringPhrases = {
  subject: {
    de: "Galerie läuft ab: „{title}“ (in {days})",
    en: "Gallery expiring: “{title}” (in {days})",
    it: "Galleria in scadenza: «{title}» (tra {days})",
    fi: "Galleria vanhenee: ”{title}” ({days} kuluttua)",
  fr: "Galerie expirant : « {title} » (dans {days})" },
  preheader: {
    de: "„{title}“ läuft in {days} ab",
    en: "“{title}” expires in {days}",
    it: "«{title}» scade tra {days}",
    fi: "”{title}” vanhenee {days} kuluttua",
  fr: "« {title} » expire dans {days}" },
  heading: {
    de: "Galerie läuft bald ab",
    en: "Gallery expiring soon",
    it: "Galleria in scadenza a breve",
    fi: "Galleria vanhenee pian",
  fr: "Galerie qui expire bientôt" },
  body: {
    de: "Die Galerie „{title}“ läuft am {date} ab (in {days}). Danach ist sie für Kunden nicht mehr erreichbar.",
    en: "The gallery “{title}” expires on {date} (in {days}). After that your customers can no longer reach it.",
    it: "La galleria «{title}» scade il {date} (tra {days}). Dopo tale data non sarà più raggiungibile dai clienti.",
    fi: "Galleria ”{title}” vanhenee {date} ({days} kuluttua). Sen jälkeen asiakkaasi eivät enää pääse siihen.",
  fr: "La galerie « {title} » expire le {date} (dans {days}). Après cela, vos clients ne peuvent plus y accéder." },
  hint: {
    de: "Falls du sie länger online halten möchtest, kannst du das Ablaufdatum in den Galerie-Einstellungen anpassen.",
    en: "If you want to keep it online for longer, you can change the expiry date in the gallery settings.",
    it: "Se vuoi mantenerla online più a lungo, puoi modificare la data di scadenza nelle impostazioni della galleria.",
    fi: "Jos haluat pitää sen esillä pidempään, voit muuttaa vanhenemispäivää gallerian asetuksista.",
  fr: "Si vous souhaitez le conserver en ligne plus longtemps, vous pouvez modifier la date d'expiration dans les paramètres de la galerie." },
  dayOne: { de: "1 Tag", en: "1 day", it: "1 giorno", fi: "1 päivän" , fr: "1 jour" },
  dayMany: { de: "{n} Tagen", en: "{n} days", it: "{n} giorni", fi: "{n} päivän" , fr: "Jours {n}" },
} satisfies Record<string, Phrase>;

export function tmplGalleryExpiring(opts: {
  galleryTitle: string;
  daysLeft: number;
  expiresAtLabel: string;
  galleryUrl: string;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = galleryExpiringPhrases;
  const days =
    opts.daysLeft === 1
      ? phrase(P.dayOne, l)
      : phrase(P.dayMany, l, { n: opts.daysLeft });
  const vars = { title: opts.galleryTitle, days, date: opts.expiresAtLabel };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.body, l, vars)}\n\n` +
      `${phrase(common.openGallery, l)}: ${opts.galleryUrl}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      branding: opts.branding,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(phrase(P.body, l, vars)) +
        mailParagraph(phrase(P.hint, l)) +
        mailButton(
          opts.galleryUrl,
          phrase(common.openGallery, l),
          opts.branding?.accentColor
        ),
    }),
  };
}

const uploadReceivedPhrases = {
  subject: {
    de: "Neue Uploads: „{title}“",
    en: "New uploads: “{title}”",
    it: "Nuovi caricamenti: «{title}»",
    fi: "Uusia tiedostoja: ”{title}”",
  fr: "Nouveaux téléchargements : « {title} »" },
  preheader: {
    de: "Neue Uploads in „{title}“",
    en: "New uploads in “{title}”",
    it: "Nuovi caricamenti in «{title}»",
    fi: "Uusia tiedostoja galleriaan ”{title}”",
  fr: "Nouveaux téléchargements dans « {title} »" },
  heading: {
    de: "Neue Uploads eingegangen",
    en: "New uploads received",
    it: "Nuovi caricamenti ricevuti",
    fi: "Uusia tiedostoja saapunut",
  fr: "Nouveaux téléchargements reçus" },
  bodyText: {
    de: "Es sind neue Uploads über den Link „{link}“ in der Galerie „{title}“ eingegangen.",
    en: "New uploads arrived through the link “{link}” in the gallery “{title}”.",
    it: "Sono arrivati nuovi caricamenti tramite il link «{link}» nella galleria «{title}».",
    fi: "Linkin ”{link}” kautta on saapunut uusia tiedostoja galleriaan ”{title}”.",
  fr: "Les nouveaux téléchargements sont arrivés via le lien « {link} » dans la galerie « {title} »." },
  bodyHtml: {
    de: "Über den Upload-Link „{link}“ sind neue Dateien in „{title}“ eingegangen.",
    en: "New files arrived in “{title}” through the upload link “{link}”.",
    it: "Tramite il link di caricamento «{link}» sono arrivati nuovi file in «{title}».",
    fi: "Lähetyslinkin ”{link}” kautta on saapunut uusia tiedostoja galleriaan ”{title}”.",
  fr: "De nouveaux fichiers sont arrivés dans « {title} » via le lien de téléchargement « {link} »." },
} satisfies Record<string, Phrase>;

export function tmplUploadReceived(opts: {
  galleryTitle: string;
  linkLabel: string;
  galleryUrl: string;
  branding?: MailBranding;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = uploadReceivedPhrases;
  const vars = { title: opts.galleryTitle, link: opts.linkLabel };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(common.openGallery, l)}: ${opts.galleryUrl}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      branding: opts.branding,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailButton(
          opts.galleryUrl,
          phrase(common.openGallery, l),
          opts.branding?.accentColor
        ),
    }),
  };
}

// =============================================================================
// Marketing / Lifecycle-Templates
// =============================================================================

/**
 * Trial-Reminder — 3 Tage vor Ablauf.
 * Ton: hilfreich, kein Druck. Zeigt kurz was noch drin steckt, CTA Studio.
 */
const trialReminderPhrases = {
  subject: {
    de: "Dein Lumio-Trial endet {when}",
    en: "Your Lumio trial ends {when}",
    it: "La tua prova Lumio termina {when}",
    fi: "Lumio-kokeilujaksosi päättyy {when}",
  fr: "Votre essai Lumio se termine {when}" },
  preheader: {
    de: "Dein Trial endet am {date} — hier ein kurzer Überblick.",
    en: "Your trial ends on {date} — here is a quick overview.",
    it: "La tua prova termina il {date} — ecco una breve panoramica.",
    fi: "Kokeilujaksosi päättyy {date} — tässä lyhyt yhteenveto.",
  fr: "Votre essai se termine le {date} — voici un bref aperçu." },
  greetingNamed: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  greetingPlain: { de: "Hallo,", en: "Hello,", it: "Ciao,", fi: "Hei," , fr: "Bonjour," },
  tomorrow: { de: "morgen", en: "tomorrow", it: "domani", fi: "huomenna" , fr: "demain" },
  inDays: { de: "in {n} Tagen", en: "in {n} days", it: "tra {n} giorni", fi: "{n} päivän kuluttua" , fr: "en jours {n}" },
  bodyText: {
    de: "Dein kostenloser Trial im {plan}-Plan läuft am {date} ab.",
    en: "Your free trial on the {plan} plan ends on {date}.",
    it: "La tua prova gratuita nel piano {plan} termina il {date}.",
    fi: "Ilmainen kokeilujaksosi {plan}-paketissa päättyy {date}.",
  fr: "Votre essai gratuit sur le forfait {plan} se termine le {date}." },
  bodyHtml: {
    de: "Dein kostenloser Trial im <strong>{plan}</strong>-Plan läuft am <strong>{date}</strong> ab.",
    en: "Your free trial on the <strong>{plan}</strong> plan ends on <strong>{date}</strong>.",
    it: "La tua prova gratuita nel piano <strong>{plan}</strong> termina il <strong>{date}</strong>.",
    fi: "Ilmainen kokeilujaksosi <strong>{plan}</strong>-paketissa päättyy <strong>{date}</strong>.",
  fr: "Votre essai gratuit sur le forfait <strong>{plan}</strong> se termine le <strong>{date}</strong>." },
  tryText: {
    de: "Falls du noch nicht alles ausprobiert hast — hier ein paar Dinge, die sich lohnen:",
    en: "If you have not tried everything yet, these are worth a look:",
    it: "Se non hai ancora provato tutto, ecco alcune cose che vale la pena esplorare:",
    fi: "Jos et ole vielä ehtinyt kokeilla kaikkea — nämä kannattaa katsoa:",
  fr: "Si vous n'avez pas encore tout essayé, ceux-ci valent le détour :" },
  tryHtml: {
    de: "Falls du noch nicht alles ausprobiert hast, lohnen sich besonders:",
    en: "If you have not tried everything yet, these are especially worth it:",
    it: "Se non hai ancora provato tutto, vale particolarmente la pena:",
    fi: "Jos et ole vielä ehtinyt kokeilla kaikkea, näistä on eniten hyötyä:",
  fr: "Si vous n'avez pas encore tout essayé, ceux-ci valent particulièrement le détour :" },
  tip1: {
    de: "Galerie erstellen und mit einem Kunden teilen",
    en: "Create a gallery and share it with a customer",
    it: "Creare una galleria e condividerla con un cliente",
    fi: "Luo galleria ja jaa se asiakkaalle",
  fr: "Créez une galerie et partagez-la avec un client" },
  tip2: {
    de: "Kundenauswahl aktivieren (dein Kunde markiert Favoriten)",
    en: "Enable customer selection (your customer marks favourites)",
    it: "Attivare la selezione cliente (il tuo cliente contrassegna le preferite)",
    fi: "Ota asiakkaan valinta käyttöön (asiakas merkitsee suosikkinsa)",
  fr: "Activer la sélection des clients (votre client marque ses favoris)" },
  tip3: {
    de: "Branding anpassen (Logo, Farben, eigene Domain)",
    en: "Set up your branding (logo, colours, custom domain)",
    it: "Personalizzare il branding (logo, colori, dominio personalizzato)",
    fi: "Muokkaa ilmettäsi (logo, värit, oma verkkotunnus)",
  fr: "Configurez votre branding (logo, couleurs, domaine personnalisé)" },
  continues: {
    de: "Wenn du danach weiter bei Lumio bleibst, läuft dein Abo einfach weiter — ohne Unterbrechung, keine Daten gehen verloren.",
    en: "If you stay with Lumio afterwards, your subscription simply continues — no interruption, no data lost.",
    it: "Se dopo continui a restare su Lumio, il tuo abbonamento prosegue semplicemente — senza interruzioni, nessun dato viene perso.",
    fi: "Jos jäät Lumion käyttäjäksi, tilauksesi jatkuu automaattisesti — ei katkoja, mitään ei katoa.",
  fr: "Si vous restez ensuite avec Lumio, votre abonnement continue simplement : pas d'interruption, pas de perte de données." },
  continuesHtml: {
    de: "Wenn du nach dem Trial weiter bei Lumio bleibst, läuft dein Abo einfach weiter — ohne Unterbrechung, keine Daten gehen verloren.",
    en: "If you stay with Lumio after the trial, your subscription simply continues — no interruption, no data lost.",
    it: "Se dopo la prova continui a restare su Lumio, il tuo abbonamento prosegue semplicemente — senza interruzioni, nessun dato viene perso.",
    fi: "Jos jäät kokeilujakson jälkeen Lumion käyttäjäksi, tilauksesi jatkuu automaattisesti — ei katkoja, mitään ei katoa.",
  fr: "Si vous restez avec Lumio après l'essai, votre abonnement continue simplement : pas d'interruption, pas de perte de données." },
  openStudio: { de: "Studio öffnen", en: "Open studio", it: "Apri studio", fi: "Avaa studio" , fr: "Atelier ouvert" },
  unsubText: {
    de: "Diese Mail abbestellen:",
    en: "Unsubscribe from this email:",
    it: "Annulla iscrizione a questa email:",
    fi: "Peruuta näiden viestien tilaus:",
  fr: "Se désabonner de cet e-mail :" },
  unsubHtml: {
    de: "Keine weiteren Produkt-Mails erhalten",
    en: "Stop receiving product emails",
    it: "Non ricevere più email di prodotto",
    fi: "Älä lähetä minulle enää tuoteviestejä",
  fr: "Ne plus recevoir d'e-mails sur les produits" },
} satisfies Record<string, Phrase>;

export function tmplTrialReminder(opts: {
  displayName: string | null;
  studioName: string;
  studioUrl: string;
  planName: string;
  trialEndsAt: Date;
  unsubscribeUrl: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = trialReminderPhrases;
  const greeting = opts.displayName
    ? phrase(P.greetingNamed, l, { name: opts.displayName })
    : phrase(P.greetingPlain, l);
  const trialEnd = opts.trialEndsAt.toLocaleDateString(
    localeTag(l),
    { day: "2-digit", month: "long", year: "numeric" }
  );
  const daysLeft = Math.max(
    1,
    Math.ceil((opts.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  );
  const when =
    daysLeft === 1
      ? phrase(P.tomorrow, l)
      : phrase(P.inDays, l, { n: daysLeft });
  const vars = { when, date: trialEnd, plan: opts.planName };
  const tips = [phrase(P.tip1, l), phrase(P.tip2, l), phrase(P.tip3, l)];
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${greeting}\n\n` +
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${phrase(P.tryText, l)}\n\n` +
      tips.map((t) => `  • ${t}`).join("\n") +
      `\n\n${phrase(P.continues, l)}\n\n` +
      `${phrase(P.openStudio, l)}: ${opts.studioUrl}\n\n` +
      (supportHint() ? `${supportHint()}\n\n` : "") +
      `${phrase(common.signature, l)}\n\n` +
      `---\n${phrase(P.unsubText, l)} ${opts.unsubscribeUrl}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(greeting) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailParagraph(phrase(P.tryHtml, l)) +
        `<ul style="margin:0 0 16px 0;padding-left:20px;color:#374151;font-size:15px;line-height:1.6;">` +
        tips.map((t) => `<li>${t}</li>`).join("") +
        `</ul>` +
        mailParagraph(phrase(P.continuesHtml, l)) +
        mailButton(opts.studioUrl, phrase(P.openStudio, l)) +
        (supportHint() ? mailParagraph(supportHint()!) : "") +
        `<p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">` +
        `<a href="${opts.unsubscribeUrl}" style="color:#9ca3af;">${phrase(P.unsubHtml, l)}</a>` +
        `</p>`,
    }),
  };
}

/**
 * Trial läuft noch, Subscription aber schon gecancelt.
 * Ton: neugierig, kein Vorwurf. Einmal, kein Follow-up.
 */
const trialCancelledPhrases = {
  subject: {
    de: "Du hast abgebrochen — dein Studio ist noch bis {date} offen",
    en: "You cancelled — your studio stays open until {date}",
    it: "Hai annullato — il tuo studio resta aperto fino al {date}",
    fi: "Peruit tilauksen — studiosi on käytössä vielä {date} asti",
  fr: "Vous avez annulé — votre studio reste ouvert jusqu'à {date}" },
  preheader: {
    de: "Dein Studio ist noch bis {date} zugänglich.",
    en: "Your studio stays accessible until {date}.",
    it: "Il tuo studio resta accessibile fino al {date}.",
    fi: "Studiosi on käytössä vielä {date} asti.",
  fr: "Votre studio reste accessible jusqu'à {date}." },
  greetingNamed: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  greetingPlain: { de: "Hallo,", en: "Hello,", it: "Ciao,", fi: "Hei," , fr: "Bonjour," },
  bodyText: {
    de: "Du hast dein Lumio-Abo während des Trials storniert. Dein Studio bleibt noch bis zum {date} voll zugänglich.",
    en: "You cancelled your Lumio subscription during the trial. Your studio stays fully accessible until {date}.",
    it: "Hai annullato il tuo abbonamento Lumio durante la prova. Il tuo studio resta pienamente accessibile fino al {date}.",
    fi: "Peruit Lumio-tilauksesi kokeilujakson aikana. Studiosi on täysin käytössäsi vielä {date} asti.",
  fr: "Vous avez annulé votre abonnement Lumio pendant la période d'essai. Votre studio reste entièrement accessible jusqu'au {date}." },
  bodyHtml: {
    de: "Du hast dein Lumio-Abo während des Trials storniert. Dein Studio bleibt noch bis zum <strong>{date}</strong> voll zugänglich.",
    en: "You cancelled your Lumio subscription during the trial. Your studio stays fully accessible until <strong>{date}</strong>.",
    it: "Hai annullato il tuo abbonamento Lumio durante la prova. Il tuo studio resta pienamente accessibile fino al <strong>{date}</strong>.",
    fi: "Peruit Lumio-tilauksesi kokeilujakson aikana. Studiosi on täysin käytössäsi vielä <strong>{date}</strong> asti.",
  fr: "Vous avez annulé votre abonnement Lumio pendant la période d'essai. Votre studio reste entièrement accessible jusqu'au <strong>{date}</strong>." },
  reactivateText: {
    de: "Falls du es dir anders überlegt hast, kannst du dein Abo jederzeit im Studio reaktivieren:",
    en: "If you change your mind, you can reactivate your subscription in the studio at any time:",
    it: "Se cambi idea, puoi riattivare il tuo abbonamento nello studio in qualsiasi momento:",
    fi: "Jos muutat mielesi, voit aktivoida tilauksesi uudelleen studiossa milloin tahansa:",
  fr: "Si vous changez d'avis, vous pouvez réactiver votre abonnement en studio à tout moment :" },
  reactivateHtml: {
    de: "Falls du es dir anders überlegt hast, kannst du dein Abo jederzeit reaktivieren.",
    en: "If you change your mind, you can reactivate your subscription at any time.",
    it: "Se cambi idea, puoi riattivare il tuo abbonamento in qualsiasi momento.",
    fi: "Jos muutat mielesi, voit aktivoida tilauksesi uudelleen milloin tahansa.",
  fr: "Si vous changez d'avis, vous pouvez réactiver votre abonnement à tout moment." },
  button: {
    de: "Abo reaktivieren",
    en: "Reactivate subscription",
    it: "Riattiva abbonamento",
    fi: "Aktivoi tilaus uudelleen",
  fr: "Réactiver l'abonnement" },
  unsubText: {
    de: "Diese Mail abbestellen:",
    en: "Unsubscribe from this email:",
    it: "Annulla iscrizione a questa email:",
    fi: "Peruuta näiden viestien tilaus:",
  fr: "Se désabonner de cet e-mail :" },
  unsubHtml: {
    de: "Keine weiteren Mails von uns — versprochen.",
    en: "No further emails from us — promised.",
    it: "Nessuna altra email da parte nostra — promesso.",
    fi: "Et saa meiltä enää viestejä — lupaamme.",
  fr: "Plus aucun e-mail de notre part — promis." },
} satisfies Record<string, Phrase>;

export function tmplTrialCancelled(opts: {
  displayName: string | null;
  studioName: string;
  studioUrl: string;
  trialEndsAt: Date;
  unsubscribeUrl: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = trialCancelledPhrases;
  const greeting = opts.displayName
    ? phrase(P.greetingNamed, l, { name: opts.displayName })
    : phrase(P.greetingPlain, l);
  const trialEnd = opts.trialEndsAt.toLocaleDateString(
    localeTag(l),
    { day: "2-digit", month: "long", year: "numeric" }
  );
  const vars = { date: trialEnd };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${greeting}\n\n` +
      `${phrase(P.bodyText, l, vars)}\n\n` +
      `${feedbackInvite()}\n\n` +
      `${phrase(P.reactivateText, l)}\n` +
      `${opts.studioUrl}/billing\n\n` +
      `${phrase(common.signature, l)}\n\n` +
      `---\n${phrase(P.unsubText, l)} ${opts.unsubscribeUrl}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(greeting) +
        mailParagraph(phrase(P.bodyHtml, l, vars)) +
        mailParagraph(feedbackInvite()) +
        mailParagraph(phrase(P.reactivateHtml, l)) +
        mailButton(`${opts.studioUrl}/billing`, phrase(P.button, l)) +
        `<p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">` +
        `<a href="${opts.unsubscribeUrl}" style="color:#9ca3af;">${phrase(P.unsubHtml, l)}</a>` +
        `</p>`,
    }),
  };
}

/**
 * Winback — Trial abgelaufen ohne Upgrade ODER zahlender Kunde hat gekündigt.
 * Ton: 1 Mail, nie wieder. Kein Druck, aber ehrliches Angebot.
 */
const winbackPhrases = {
  subjectChurn: {
    de: "Schade, dass du gehst — Lumio wartet noch auf dich",
    en: "Sorry to see you go — Lumio is still here",
    it: "Ci dispiace vederti andare via — Lumio ti aspetta ancora",
    fi: "Harmi, että lähdet — Lumio odottaa sinua yhä",
  fr: "Désolé de vous voir partir — Lumio est toujours là" },
  subjectExpired: {
    de: "Lumio wartet noch auf dich",
    en: "Lumio is still here for you",
    it: "Lumio ti aspetta ancora",
    fi: "Lumio odottaa sinua yhä",
  fr: "Lumio est toujours là pour vous" },
  greetingNamed: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  greetingPlain: { de: "Hallo,", en: "Hello,", it: "Ciao,", fi: "Hei," , fr: "Bonjour," },
  introChurn: {
    de: "Dein Lumio-Abo für „{studio}“ ist ausgelaufen. Schade, dass du gegangen bist.",
    en: "Your Lumio subscription for “{studio}” has ended. Sorry to see you go.",
    it: "Il tuo abbonamento Lumio per «{studio}» è terminato. Ci dispiace vederti andare via.",
    fi: "Studion ”{studio}” Lumio-tilaus on päättynyt. Harmi, että lähdit.",
  fr: "Votre abonnement Lumio pour « {studio} » est terminé. Désolé de te voir partir." },
  introExpired: {
    de: "Dein Lumio-Trial für „{studio}“ ist abgelaufen, ohne dass du ein Abo gestartet hast.",
    en: "Your Lumio trial for “{studio}” expired without a subscription being started.",
    it: "La tua prova Lumio per «{studio}» è scaduta senza che tu abbia attivato un abbonamento.",
    fi: "Studion ”{studio}” Lumio-kokeilujakso päättyi, etkä aloittanut tilausta.",
  fr: "Votre essai Lumio pour « {studio} » a expiré sans qu'un abonnement ait été souscrit." },
  preheaderChurn: {
    de: "Deine Daten sind noch da — falls du doch zurückkommst.",
    en: "Your data is still here — in case you come back.",
    it: "I tuoi dati sono ancora qui — nel caso tu voglia tornare.",
    fi: "Tietosi ovat yhä tallessa — siltä varalta, että palaat.",
  fr: "Vos données sont toujours là, au cas où vous reviendrez." },
  preheaderExpired: {
    de: "Dein Trial ist abgelaufen — du kannst jederzeit zurück.",
    en: "Your trial has expired — you can come back any time.",
    it: "La tua prova è scaduta — puoi tornare in qualsiasi momento.",
    fi: "Kokeilujaksosi on päättynyt — voit palata milloin tahansa.",
  fr: "Votre essai a expiré ; vous pouvez revenir à tout moment." },
  bodyText: {
    de: "Wenn der Zeitpunkt gerade einfach nicht gepasst hat — kein Problem. Du kannst jederzeit wieder einsteigen; deine Daten sind noch da.",
    en: "If the timing simply was not right — no problem. You can come back any time; your data is still here.",
    it: "Se semplicemente il momento non era quello giusto — nessun problema. Puoi tornare quando vuoi; i tuoi dati sono ancora qui.",
    fi: "Jos ajankohta ei vain nyt sopinut — ei hätää. Voit palata milloin tahansa; tietosi ovat yhä tallessa.",
  fr: "Si le moment n’était tout simplement pas le bon, pas de problème. Vous pouvez revenir à tout moment ; vos données sont toujours là." },
  bodyHtml: {
    de: "Wenn der Zeitpunkt gerade einfach nicht gepasst hat — kein Problem. Du kannst jederzeit wieder einsteigen, deine Daten sind noch da.",
    en: "If the timing simply was not right — no problem. You can come back any time, your data is still here.",
    it: "Se semplicemente il momento non era quello giusto — nessun problema. Puoi tornare quando vuoi, i tuoi dati sono ancora qui.",
    fi: "Jos ajankohta ei vain nyt sopinut — ei hätää. Voit palata milloin tahansa, tietosi ovat yhä tallessa.",
  fr: "Si le moment n’était tout simplement pas le bon, pas de problème. Vous pouvez revenir à tout moment, vos données sont toujours là." },
  openStudio: { de: "Studio öffnen", en: "Open studio", it: "Apri studio", fi: "Avaa studio" , fr: "Atelier ouvert" },
  button: { de: "Jetzt einsteigen", en: "Come back now", it: "Torna ora", fi: "Palaa mukaan" , fr: "Reviens maintenant" },
  onlyOnce: {
    de: "Das ist die einzige Mail dieser Art, die du von uns bekommst.",
    en: "This is the only email of its kind you will get from us.",
    it: "Questa è l'unica email di questo tipo che riceverai da noi.",
    fi: "Tämä on ainoa tämänkaltainen viesti, jonka saat meiltä.",
  fr: "C'est le seul e-mail de ce type que vous recevrez de notre part." },
  unsubText: {
    de: "Diese Mail abbestellen:",
    en: "Unsubscribe from this email:",
    it: "Annulla iscrizione a questa email:",
    fi: "Peruuta näiden viestien tilaus:",
  fr: "Se désabonner de cet e-mail :" },
  unsubHtml: {
    de: "Keine weiteren Mails erhalten",
    en: "Stop receiving emails",
    it: "Non ricevere più email",
    fi: "Älä lähetä minulle enää viestejä",
  fr: "Ne plus recevoir d'e-mails" },
} satisfies Record<string, Phrase>;

export function tmplWinback(opts: {
  displayName: string | null;
  studioName: string;
  studioUrl: string;
  reason: "trial_expired" | "cancelled";
  unsubscribeUrl: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = winbackPhrases;
  const greeting = opts.displayName
    ? phrase(P.greetingNamed, l, { name: opts.displayName })
    : phrase(P.greetingPlain, l);
  const isChurn = opts.reason === "cancelled";
  const vars = { studio: opts.studioName };
  const subject = isChurn
    ? phrase(P.subjectChurn, l)
    : phrase(P.subjectExpired, l);
  const intro = isChurn
    ? phrase(P.introChurn, l, vars)
    : phrase(P.introExpired, l, vars);
  return {
    subject,
    text:
      `${greeting}\n\n` +
      `${intro}\n\n` +
      `${phrase(P.bodyText, l)}\n\n` +
      `${phrase(P.openStudio, l)}: ${opts.studioUrl}/billing\n\n` +
      `${phrase(P.onlyOnce, l)}\n\n` +
      `${phrase(common.signature, l)}\n\n` +
      `---\n${phrase(P.unsubText, l)} ${opts.unsubscribeUrl}`,
    html: renderMailLayout({
      locale: l,
      preheader: isChurn
        ? phrase(P.preheaderChurn, l)
        : phrase(P.preheaderExpired, l),
      bodyHtml:
        mailHeading(greeting) +
        mailParagraph(intro) +
        mailParagraph(phrase(P.bodyHtml, l)) +
        mailButton(`${opts.studioUrl}/billing`, phrase(P.button, l)) +
        mailNoticeBox(phrase(P.onlyOnce, l)) +
        `<p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">` +
        `<a href="${opts.unsubscribeUrl}" style="color:#9ca3af;">${phrase(P.unsubHtml, l)}</a>` +
        `</p>`,
    }),
  };
}

// ---------------------------------------------------------------------------
// Support-Anfragen aus dem Studio
//
// Die Admin-Mail traegt bewusst viel Kontext: Tenant, Plan, Rolle, Version,
// Ursprungsseite. Das sind genau die Rueckfragen, die man sonst stellen
// muss, bevor man ueberhaupt anfangen kann zu helfen — und der Nutzer weiss
// die Antworten meist nicht ("welchen Plan hast du?").
// ---------------------------------------------------------------------------

export interface SupportRequestContext {
  message: string;
  userEmail: string;
  /** Abweichende Rueckrufadresse, falls angegeben. */
  replyEmail: string | null;
  userName: string | null;
  userRole: string;
  isImpersonated: boolean;
  tenantName: string | null;
  tenantSlug: string | null;
  tenantId: string;
  tenantStatus: string | null;
  planName: string | null;
  planSlug: string | null;
  planStatus: string | null;
  trialEndsAt: Date | null;
  fromPath: string | null;
  version: string;
}

export function tmplSupportRequest(
  ctx: SupportRequestContext
): { subject: string; text: string; html: string } {
  const who = ctx.userName ? `${ctx.userName} <${ctx.userEmail}>` : ctx.userEmail;
  const studio = ctx.tenantName ?? ctx.tenantSlug ?? ctx.tenantId;

  const facts: string[] = [
    `Von: ${who} (${ctx.userRole})`,
    `Studio: ${studio}${ctx.tenantSlug ? ` (${ctx.tenantSlug})` : ""}`,
  ];
  if (ctx.replyEmail && ctx.replyEmail !== ctx.userEmail) {
    facts.push(`Rückrufadresse: ${ctx.replyEmail}`);
  }
  if (ctx.planName) {
    const st = ctx.planStatus ? ` — ${ctx.planStatus}` : "";
    facts.push(`Plan: ${ctx.planName}${st}`);
  } else {
    facts.push(`Plan: keine Subscription`);
  }
  if (ctx.trialEndsAt) {
    facts.push(`Trial endet: ${ctx.trialEndsAt.toISOString().slice(0, 10)}`);
  }
  if (ctx.tenantStatus && ctx.tenantStatus !== "active") {
    facts.push(`⚠️ Tenant-Status: ${ctx.tenantStatus}`);
  }
  if (ctx.isImpersonated) {
    facts.push(`⚠️ Support-Session (Super-Admin eingeloggt als dieser User)`);
  }
  if (ctx.fromPath) facts.push(`Geschrieben von: ${ctx.fromPath}`);
  facts.push(`Version: ${ctx.version}`);
  facts.push(`Tenant-ID: ${ctx.tenantId}`);

  return {
    subject: `Support: ${studio}${ctx.planSlug ? ` [${ctx.planSlug}]` : ""}`,
    text:
      `Support-Anfrage aus dem Studio:\n\n` +
      facts.map((f) => `  ${f}`).join("\n") +
      `\n\nNachricht:\n${ctx.message}\n`,
    html: renderMailLayout({
      // Interne Mail ans Lumio-Support-Team, kein Recipient mit eigener
      // Sprachwahl — der Body oben ist durchgehend Deutsch und nicht Teil
      // des Phrase-Systems. locale spiegelt das ehrlich statt eine
      // Instance-Locale zu behaupten, die der Text nicht einloest.
      locale: "de",
      preheader: `${who} — ${ctx.message.slice(0, 80)}`,
      bodyHtml:
        mailHeading(`Support-Anfrage`) +
        mailBullets(facts) +
        mailHeading(`Nachricht`) +
        mailParagraph(ctx.message.replace(/\n/g, "<br>")) +
        mailNoticeBox(
          `Reply-To steht auf ${ctx.replyEmail ?? ctx.userEmail} — direkt antworten geht.`
        ),
    }),
  };
}

const supportConfirmPhrases = {
  subject: {
    de: "Deine Support-Anfrage ist angekommen",
    en: "We received your support request",
    it: "La tua richiesta di supporto è arrivata",
    fi: "Tukipyyntösi on saapunut",
  fr: "Nous avons reçu votre demande d'assistance" },
  preheader: {
    de: "Wir haben deine Anfrage erhalten und melden uns innerhalb eines Werktags.",
    en: "We received your request and will reply within one working day.",
    it: "Abbiamo ricevuto la tua richiesta e ti risponderemo entro un giorno lavorativo.",
    fi: "Olemme saaneet pyyntösi ja vastaamme yhden arkipäivän kuluessa.",
  fr: "Nous avons reçu votre demande et vous répondrons dans un délai d'un jour ouvrable." },
  greetingNamed: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  greetingPlain: { de: "Hallo,", en: "Hello,", it: "Ciao,", fi: "Hei," , fr: "Bonjour," },
  heading: {
    de: "Anfrage angekommen",
    en: "Request received",
    it: "Richiesta ricevuta",
    fi: "Pyyntö vastaanotettu",
  fr: "Demande reçue" },
  body: {
    de: "danke für deine Nachricht. Wir haben sie erhalten und melden uns innerhalb eines Werktags bei dir.",
    en: "thank you for your message. We received it and will get back to you within one working day.",
    it: "grazie per il tuo messaggio. Lo abbiamo ricevuto e ti risponderemo entro un giorno lavorativo.",
    fi: "Kiitos viestistäsi. Olemme saaneet sen ja palaamme asiaan yhden arkipäivän kuluessa.",
  fr: "merci pour votre message. Nous l'avons reçu et vous répondrons dans un délai d'un jour ouvrable." },
  recap: {
    de: "Zur Sicherheit hier noch einmal, was du uns geschickt hast:",
    en: "For your records, here is what you sent us:",
    it: "Per tua sicurezza, ecco di nuovo ciò che ci hai inviato:",
    fi: "Varmuuden vuoksi tässä vielä se, mitä lähetit meille:",
  fr: "Pour mémoire, voici ce que vous nous avez envoyé :" },
  yourMessage: { de: "Deine Nachricht", en: "Your message", it: "Il tuo messaggio", fi: "Viestisi" , fr: "Votre message" },
  team: { de: "— Dein Lumio-Team", en: "— Your Lumio team", it: "— Il tuo team Lumio", fi: "— Lumio-tiimisi" , fr: "— Votre équipe Lumio" },
} satisfies Record<string, Phrase>;

/**
 * Transparenz-Mail bei Support-Zugriff (Impersonation).
 *
 * Vorher inline in routes/auth.ts gebaut und deshalb in JEDER Sprache
 * deutsch — ausgerechnet bei einer Mitteilung, die dem Nutzer sagt, dass
 * jemand in seinem Studio war. Hat ausserdem als einzige Mail keine
 * HTML-Fassung gehabt; die gibt es jetzt auch.
 */
const impersonationNoticePhrases = {
  subject: {
    de: 'Support-Zugriff auf dein Studio "{studio}"',
    en: 'Support access to your studio "{studio}"',
    it: 'Accesso di supporto al tuo studio "{studio}"',
    fi: "Tuen pääsy studioosi ”{studio}”",
  fr: "Prise en charge de l'accès à votre studio \"{studio}\"" },
  preheader: {
    de: "Ein Support-Mitglied hat auf „{studio}“ zugegriffen",
    en: "A support member accessed “{studio}”",
    it: "Un membro del supporto ha effettuato l'accesso a «{studio}»",
    fi: "Tukitiimin jäsen käytti studiota ”{studio}”",
  fr: "Un membre du support a accédé à « {studio} »" },
  greetingNamed: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  greetingPlain: { de: "Hallo,", en: "Hello,", it: "Ciao,", fi: "Hei," , fr: "Bonjour," },
  heading: {
    de: "Support-Zugriff auf dein Studio",
    en: "Support access to your studio",
    it: "Accesso di supporto al tuo studio",
    fi: "Tuen pääsy studioosi",
  fr: "Prise en charge de l'accès à votre studio" },
  body: {
    de: 'ein Mitglied des Lumio-Supports ({admin}) hat sich gerade in dein Studio "{studio}" eingeloggt, um ein Problem zu untersuchen. Der Zugriff ist auf maximal 60 Minuten begrenzt und wird vollständig im Audit-Log dokumentiert.',
    en: 'a member of Lumio support ({admin}) has just signed in to your studio "{studio}" to investigate an issue. The access is limited to 60 minutes at most and is fully recorded in the audit log.',
    it: 'un membro del supporto Lumio ({admin}) ha appena effettuato l\'accesso al tuo studio "{studio}" per verificare un problema. L\'accesso è limitato a un massimo di 60 minuti ed è documentato integralmente nel log di controllo.',
    fi: "Lumion tuen jäsen ({admin}) kirjautui juuri studioosi ”{studio}” tutkiakseen ongelmaa. Pääsy on rajattu enintään 60 minuuttiin ja kirjautuu kokonaisuudessaan valvontalokiin.",
  fr: "un membre du support Lumio ({admin}) vient de se connecter à votre studio « {studio} » pour enquêter sur un problème. L'accès est limité à 60 minutes maximum et est intégralement enregistré dans le journal d'audit." },
  reason: { de: "Grund: {reason}", en: "Reason: {reason}", it: "Motivo: {reason}", fi: "Syy: {reason}" , fr: "Motif : {reason}" },
  notRequested: {
    de: "Falls du KEINEN Support-Zugriff angefragt hast und das ungewöhnlich findest, antworte auf diese Mail.",
    en: "If you did NOT request support access and this seems unusual, reply to this email.",
    it: "Se NON hai richiesto tu l'accesso di supporto e questo ti sembra insolito, rispondi a questa email.",
    fi: "Jos ET pyytänyt tuen apua ja tämä vaikuttaa oudolta, vastaa tähän viestiin.",
  fr: "Si vous n'avez PAS demandé d'accès à l'assistance et que cela semble inhabituel, répondez à cet e-mail." },
} satisfies Record<string, Phrase>;

export function tmplImpersonationNotice(opts: {
  displayName: string | null;
  studioName: string;
  superAdminEmail: string;
  reason: string | null;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = impersonationNoticePhrases;
  const greeting = opts.displayName
    ? phrase(P.greetingNamed, l, { name: opts.displayName })
    : phrase(P.greetingPlain, l);
  const vars = { studio: opts.studioName, admin: opts.superAdminEmail };
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${greeting}\n\n` +
      `${phrase(P.body, l, vars)}\n\n` +
      (opts.reason
        ? `${phrase(P.reason, l, { reason: opts.reason })}\n\n`
        : "") +
      `${phrase(P.notRequested, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(`${greeting} ${phrase(P.body, l, vars)}`) +
        (opts.reason
          ? mailParagraph(phrase(P.reason, l, { reason: opts.reason }))
          : "") +
        mailNoticeBox(phrase(P.notRequested, l)),
    }),
  };
}

/**
 * Vorab-Warnung und Erinnerung vor der Archivierung eines Tenants.
 *
 * Beide waren inline in routes/super-tenants.ts bzw. services/sweeper.ts
 * gebaut und siezten als einzige Mails im System. Beim Templatisieren auf
 * "du" vereinheitlicht, wie in jeder anderen Vorlage.
 */
const preArchivePhrases = {
  noticeSubject: {
    de: "Wichtig: Dein Lumio-Konto „{studio}“ wird am {date} archiviert",
    en: "Important: your Lumio account “{studio}” will be archived on {date}",
    it: "Importante: il tuo account Lumio «{studio}» verrà archiviato il {date}",
    fi: "Tärkeää: Lumio-tilisi ”{studio}” arkistoidaan {date}",
  fr: "Important : votre compte Lumio « {studio} » sera archivé sur {date}" },
  reminderSubject: {
    de: "Erinnerung: Dein Lumio-Konto „{studio}“ wird in {days} Tagen archiviert",
    en: "Reminder: your Lumio account “{studio}” will be archived in {days} days",
    it: "Promemoria: il tuo account Lumio «{studio}» verrà archiviato tra {days} giorni",
    fi: "Muistutus: Lumio-tilisi ”{studio}” arkistoidaan {days} päivän kuluttua",
  fr: "Rappel : votre compte Lumio « {studio} » sera archivé dans les jours {days}" },
  noticePreheader: {
    de: "Archivierung am {date} — bitte Daten vorher exportieren",
    en: "Archiving on {date} — please export your data beforehand",
    it: "Archiviazione il {date} — esporta prima i tuoi dati",
    fi: "Arkistointi {date} — vie tietosi talteen ennen sitä",
  fr: "Archivage sur {date} — veuillez exporter vos données au préalable" },
  reminderPreheader: {
    de: "Noch {days} Tage bis zur Archivierung",
    en: "{days} days until archiving",
    it: "Ancora {days} giorni all'archiviazione",
    fi: "Enää {days} päivää arkistointiin",
  fr: "{days} jours avant l'archivage" },
  greeting: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  noticeHeading: {
    de: "Archivierung angekündigt",
    en: "Archiving announced",
    it: "Archiviazione annunciata",
    fi: "Arkistoinnista ilmoitettu",
  fr: "Archivage annoncé" },
  reminderHeading: {
    de: "Erinnerung: Archivierung",
    en: "Reminder: archiving",
    it: "Promemoria: archiviazione",
    fi: "Muistutus: arkistointi",
  fr: "Rappel : archivage" },
  noticeBody: {
    de: "wir möchten dich informieren, dass dein Lumio-Konto „{studio}“ am {date} archiviert wird.",
    en: "we would like to inform you that your Lumio account “{studio}” will be archived on {date}.",
    it: "vogliamo informarti che il tuo account Lumio «{studio}» verrà archiviato il {date}.",
    fi: "Haluamme kertoa, että Lumio-tilisi ”{studio}” arkistoidaan {date}.",
  fr: "nous tenons à vous informer que votre compte Lumio « {studio} » sera archivé sur {date}." },
  reminderBody: {
    de: "dies ist eine Erinnerung: Dein Lumio-Konto „{studio}“ wird am {date} archiviert (in {days} Tagen).",
    en: "this is a reminder: your Lumio account “{studio}” will be archived on {date} (in {days} days).",
    it: "questo è un promemoria: il tuo account Lumio «{studio}» verrà archiviato il {date} (tra {days} giorni).",
    fi: "Tämä on muistutus: Lumio-tilisi ”{studio}” arkistoidaan {date} ({days} päivän kuluttua).",
  fr: "ceci est un rappel : votre compte Lumio « {studio} » sera archivé sur {date} (en jours {days})." },
  meansHeading: {
    de: "Was bedeutet das?",
    en: "What does that mean?",
    it: "Cosa significa?",
    fi: "Mitä se tarkoittaa?",
  fr: "Qu'est-ce que cela signifie?" },
  means1: {
    de: "Ab diesem Datum kannst du dich nicht mehr einloggen",
    en: "From that date on you can no longer sign in",
    it: "Da questa data non potrai più accedere",
    fi: "Tuosta päivästä alkaen et voi enää kirjautua sisään",
  fr: "A partir de cette date, vous ne pourrez plus vous connecter" },
  means2: {
    de: "Deine Daten bleiben 30 Tage in Karenz erhalten",
    en: "Your data is retained for a 30-day grace period",
    it: "I tuoi dati vengono conservati per un periodo di tolleranza di 30 giorni",
    fi: "Tietosi säilyvät vielä 30 päivän ajan",
  fr: "Vos données sont conservées pendant un délai de grâce de 30 jours" },
  means3: {
    de: "Danach werden alle Daten endgültig gelöscht",
    en: "After that all data is permanently deleted",
    it: "Successivamente tutti i dati verranno cancellati definitivamente",
    fi: "Sen jälkeen kaikki tiedot poistetaan lopullisesti",
  fr: "Après cela, toutes les données sont définitivement supprimées" },
  todoHeading: {
    de: "Was solltest du jetzt tun?",
    en: "What should you do now?",
    it: "Cosa dovresti fare ora?",
    fi: "Mitä sinun kannattaa tehdä nyt?",
  fr: "Que devez-vous faire maintenant ?" },
  todoBody: {
    de: "Logg dich ein und exportiere deine Daten über die Sidebar → „Datenexport“. Pro Galerie wird ein ZIP-Archiv mit Originaldateien und Metadaten erstellt.",
    en: "Sign in and export your data via the sidebar → “Data export”. One ZIP archive with original files and metadata is created per gallery.",
    it: "Accedi ed esporta i tuoi dati tramite la barra laterale → «Esportazione dati». Per ogni galleria viene creato un archivio ZIP con i file originali e i metadati.",
    fi: "Kirjaudu sisään ja vie tietosi sivupalkista → ”Tietojen vienti”. Jokaisesta galleriasta luodaan ZIP-arkisto, jossa on alkuperäiset tiedostot ja metatiedot.",
  fr: "Connectez-vous et exportez vos données via la barre latérale → « Exportation de données ». Une archive ZIP avec les fichiers originaux et les métadonnées est créée par galerie." },
  reminderTodo: {
    de: "Falls du deine Daten noch herunterladen möchtest, logg dich bitte zeitnah ein und nutze die Sidebar → „Datenexport“. Pro Galerie wird ein ZIP-Archiv mit Originalen und Metadaten erstellt.",
    en: "If you still want to download your data, please sign in soon and use the sidebar → “Data export”. One ZIP archive with originals and metadata is created per gallery.",
    it: "Se vuoi ancora scaricare i tuoi dati, accedi al più presto e usa la barra laterale → «Esportazione dati». Per ogni galleria viene creato un archivio ZIP con gli originali e i metadati.",
    fi: "Jos haluat vielä ladata tietosi, kirjaudu sisään pian ja käytä sivupalkin kohtaa → ”Tietojen vienti”. Jokaisesta galleriasta luodaan ZIP-arkisto, jossa on alkuperäiset tiedostot ja metatiedot.",
  fr: "Si vous souhaitez toujours télécharger vos données, veuillez vous connecter bientôt et utiliser la barre latérale → « Exportation de données ». Une archive ZIP avec les originaux et les métadonnées est créée par galerie." },
  afterArchive: {
    de: "Nach der Archivierung kannst du dich nicht mehr einloggen. Ein direkter Download-Link wird dir dann automatisch per Mail zugeschickt (30 Tage gültig), aber der Self-Service-Export im Studio ist ab dann nicht mehr verfügbar.",
    en: "After archiving you can no longer sign in. A direct download link is then emailed to you automatically (valid for 30 days), but the self-service export in the studio is no longer available from that point.",
    it: "Dopo l'archiviazione non potrai più accedere. Un link di download diretto ti verrà inviato automaticamente via email (valido 30 giorni), ma l'esportazione self-service nello studio non sarà più disponibile da quel momento.",
    fi: "Arkistoinnin jälkeen et voi enää kirjautua sisään. Saat silloin automaattisesti suoran latauslinkin sähköpostiisi (voimassa 30 päivää), mutta studion oma vientitoiminto ei ole enää käytettävissä.",
  fr: "Après l'archivage, vous ne pouvez plus vous connecter. Un lien de téléchargement direct vous est alors automatiquement envoyé par email (valable 30 jours), mais l'export en libre-service dans le studio n'est plus disponible à partir de ce moment-là." },
  questions: {
    de: "Falls du das Archivierungsdatum für ein Missverständnis hältst oder Fragen hast, antworte bitte zeitnah auf diese Mail.",
    en: "If you believe the archiving date is a misunderstanding, or you have questions, please reply to this email promptly.",
    it: "Se ritieni che la data di archiviazione sia un errore o hai domande, rispondi tempestivamente a questa email.",
    fi: "Jos arkistointipäivä on mielestäsi väärinkäsitys tai sinulla on kysyttävää, vastaa tähän viestiin pian.",
  fr: "Si vous pensez que la date d'archivage est un malentendu ou si vous avez des questions, veuillez répondre rapidement à cet e-mail." },
  reminderQuestions: {
    de: "Falls die Archivierung nicht wie geplant erfolgen soll, antworte bitte zeitnah auf diese Mail.",
    en: "If the archiving should not go ahead as planned, please reply to this email promptly.",
    it: "Se l'archiviazione non deve procedere come previsto, rispondi tempestivamente a questa email.",
    fi: "Jos arkistointia ei pitäisi tehdä suunnitellusti, vastaa tähän viestiin pian.",
  fr: "Si l'archivage ne devait pas se dérouler comme prévu, veuillez répondre rapidement à cet e-mail." },
  reminderAnnounce: {
    de: "Wir senden dir 7 Tage vor dem Stichtag noch eine Erinnerung.",
    en: "We will send you another reminder 7 days before the date.",
    it: "Ti invieremo un altro promemoria 7 giorni prima della data.",
    fi: "Lähetämme sinulle vielä muistutuksen 7 päivää ennen määräpäivää.",
  fr: "Nous vous enverrons un autre rappel 7 jours avant la date." },
} satisfies Record<string, Phrase>;

export function tmplPreArchiveNotice(opts: {
  displayName: string | null;
  recipientEmail: string;
  studioName: string;
  scheduledFor: Date;
  /** Ohne Wert die Erst-Ankuendigung, mit Wert die 7-Tage-Erinnerung. */
  daysLeft?: number;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = preArchivePhrases;
  const isReminder = opts.daysLeft !== undefined;
  const dateStr = opts.scheduledFor.toLocaleDateString(
    localeTag(l),
    { year: "numeric", month: "long", day: "numeric" }
  );
  const vars = {
    studio: opts.studioName,
    date: dateStr,
    days: opts.daysLeft ?? 0,
  };
  const greeting = phrase(P.greeting, l, {
    name: opts.displayName ?? opts.recipientEmail,
  });
  const means = [phrase(P.means1, l), phrase(P.means2, l), phrase(P.means3, l)];

  if (isReminder) {
    return {
      subject: phrase(P.reminderSubject, l, vars),
      text:
        `${greeting}\n\n` +
        `${phrase(P.reminderBody, l, vars)}\n\n` +
        `${phrase(P.reminderTodo, l)}\n\n` +
        `${phrase(P.afterArchive, l)}\n\n` +
        `${phrase(P.reminderQuestions, l)}\n\n` +
        `${phrase(common.signature, l)}`,
      html: renderMailLayout({
        locale: l,
        preheader: phrase(P.reminderPreheader, l, vars),
        bodyHtml:
          mailHeading(phrase(P.reminderHeading, l)) +
          mailParagraph(`${greeting} ${phrase(P.reminderBody, l, vars)}`) +
          mailParagraph(phrase(P.reminderTodo, l)) +
          mailNoticeBox(phrase(P.afterArchive, l)) +
          mailParagraph(phrase(P.reminderQuestions, l)),
      }),
    };
  }

  return {
    subject: phrase(P.noticeSubject, l, vars),
    text:
      `${greeting}\n\n` +
      `${phrase(P.noticeBody, l, vars)}\n\n` +
      `${phrase(P.meansHeading, l)}\n` +
      means.map((x) => `  • ${x}`).join("\n") +
      `\n\n${phrase(P.todoHeading, l)}\n${phrase(P.todoBody, l)}\n\n` +
      `${phrase(P.questions, l)}\n\n` +
      `${phrase(P.reminderAnnounce, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.noticePreheader, l, vars),
      bodyHtml:
        mailHeading(phrase(P.noticeHeading, l)) +
        mailParagraph(`${greeting} ${phrase(P.noticeBody, l, vars)}`) +
        mailHeading(phrase(P.meansHeading, l)) +
        mailBullets(means) +
        mailHeading(phrase(P.todoHeading, l)) +
        mailParagraph(phrase(P.todoBody, l)) +
        mailParagraph(phrase(P.questions, l)) +
        mailNoticeBox(phrase(P.reminderAnnounce, l)),
    }),
  };
}

/**
 * Datenexport-Link fuer bereits archivierte Tenants.
 */
const exportReadyPhrases = {
  subject: {
    de: "Dein Datenexport von Lumio ist bereit – {studio}",
    en: "Your Lumio data export is ready – {studio}",
    it: "La tua esportazione dati di Lumio è pronta – {studio}",
    fi: "Lumio-tietojesi vienti on valmis – {studio}",
  fr: "Votre exportation de données Lumio est prête – {studio}" },
  preheader: {
    de: "Download-Link 30 Tage gültig",
    en: "Download link valid for 30 days",
    it: "Link di download valido 30 giorni",
    fi: "Latauslinkki voimassa 30 päivää",
  fr: "Lien de téléchargement valable 30 jours" },
  greeting: { de: "Hallo {name},", en: "Hello {name},", it: "Ciao {name},", fi: "Hei {name}," , fr: "Bonjour {name}," },
  heading: {
    de: "Datenexport bereit",
    en: "Data export ready",
    it: "Esportazione dati pronta",
    fi: "Tietojen vienti valmis",
  fr: "Prêt pour l'exportation de données" },
  body: {
    de: "Dein Lumio-Konto „{studio}“ wurde archiviert und deine Daten werden in Kürze endgültig gelöscht. Du kannst deine Galerien (Originaldateien + Metadaten) als ZIP-Archiv unter folgendem Link herunterladen — der Link ist 30 Tage gültig:",
    en: "Your Lumio account “{studio}” has been archived and your data will be permanently deleted shortly. You can download your galleries (original files + metadata) as ZIP archives from the link below — the link is valid for 30 days:",
    it: "Il tuo account Lumio «{studio}» è stato archiviato e i tuoi dati verranno cancellati definitivamente a breve. Puoi scaricare le tue gallerie (file originali + metadati) come archivi ZIP dal link seguente — il link è valido 30 giorni:",
    fi: "Lumio-tilisi ”{studio}” on arkistoitu ja tietosi poistetaan pian lopullisesti. Voit ladata galleriasi (alkuperäiset tiedostot + metatiedot) ZIP-arkistoina alla olevasta linkistä — linkki on voimassa 30 päivää:",
  fr: "Votre compte Lumio « {studio} » a été archivé et vos données seront définitivement supprimées sous peu. Vous pouvez télécharger vos galeries (fichiers originaux + métadonnées) sous forme d'archives ZIP à partir du lien ci-dessous — le lien est valable 30 jours :" },
  inProgress: {
    de: "Der Export wird gerade erstellt. Pro Galerie dauert das je nach Größe einige Sekunden bis Minuten. Auf der Download-Seite siehst du den jeweiligen Status und kannst fertige Galerien direkt herunterladen.",
    en: "The export is being generated right now. Depending on size it takes seconds to minutes per gallery. The download page shows the status of each and lets you download finished galleries straight away.",
    it: "L'esportazione è in corso di creazione. A seconda delle dimensioni, richiede da alcuni secondi a qualche minuto per galleria. Nella pagina di download vedrai lo stato di ciascuna e potrai scaricare subito le gallerie pronte.",
    fi: "Vientiä luodaan parhaillaan. Galleriaa kohden se kestää koosta riippuen sekunneista minuutteihin. Lataussivulla näet kunkin gallerian tilan ja voit ladata valmiit galleriat heti.",
  fr: "L'exportation est en cours de génération. Selon la taille, cela prend de quelques secondes à quelques minutes par galerie. La page de téléchargement affiche l'état de chacun et vous permet de télécharger immédiatement les galeries terminées." },
  questions: {
    de: "Falls du weitere Fragen hast, antworte auf diese Mail.",
    en: "If you have further questions, reply to this email.",
    it: "Se hai altre domande, rispondi a questa email.",
    fi: "Jos sinulla on lisää kysyttävää, vastaa tähän viestiin.",
  fr: "Si vous avez d'autres questions, répondez à cet e-mail." },
  button: { de: "Export herunterladen", en: "Download export", it: "Scarica esportazione", fi: "Lataa vienti" , fr: "Télécharger l'exportation" },
} satisfies Record<string, Phrase>;

export function tmplExportReady(opts: {
  displayName: string | null;
  recipientEmail: string;
  studioName: string;
  downloadUrl: string;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = exportReadyPhrases;
  const vars = { studio: opts.studioName };
  const greeting = phrase(P.greeting, l, {
    name: opts.displayName ?? opts.recipientEmail,
  });
  return {
    subject: phrase(P.subject, l, vars),
    text:
      `${greeting}\n\n` +
      `${phrase(P.body, l, vars)}\n\n` +
      `${opts.downloadUrl}\n\n` +
      `${phrase(P.inProgress, l)}\n\n` +
      `${phrase(P.questions, l)}\n\n` +
      `${phrase(common.signature, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(`${greeting} ${phrase(P.body, l, vars)}`) +
        mailButton(opts.downloadUrl, phrase(P.button, l)) +
        mailParagraph(phrase(P.inProgress, l)) +
        mailParagraph(phrase(P.questions, l)),
    }),
  };
}

export function tmplSupportRequestConfirmation(opts: {
  message: string;
  name: string | null;
  locale?: MailLocale;
}): { subject: string; text: string; html: string } {
  const l = opts.locale ?? instanceMailLocale();
  const P = supportConfirmPhrases;
  const greeting = opts.name
    ? phrase(P.greetingNamed, l, { name: opts.name })
    : phrase(P.greetingPlain, l);
  return {
    subject: phrase(P.subject, l),
    text:
      `${greeting}\n\n` +
      `${phrase(P.body, l)}\n\n` +
      `${phrase(P.recap, l)}\n\n` +
      `${opts.message}\n\n` +
      `${phrase(P.team, l)}`,
    html: renderMailLayout({
      locale: l,
      preheader: phrase(P.preheader, l),
      bodyHtml:
        mailHeading(phrase(P.heading, l)) +
        mailParagraph(`${greeting} ${phrase(P.body, l)}`) +
        mailHeading(phrase(P.yourMessage, l)) +
        mailParagraph(opts.message.replace(/\n/g, "<br>")),
    }),
  };
}
