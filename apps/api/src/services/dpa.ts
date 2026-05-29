/**
 * Lumio API — AVV (Auftragsverarbeitungsvertrag, Art. 28 DSGVO)
 *
 * Generiert den AVV als in sich geschlossenes HTML-Dokument mit
 * Print-CSS. Der Studio-Kunde (Verantwortlicher) ruft es im Studio ab,
 * druckt es bei Bedarf als PDF (Browser-Druck) und schliesst es per
 * Klick elektronisch ab — Art. 28 Abs. 9 DSGVO erlaubt das
 * elektronische Format ausdruecklich.
 *
 * Nur die Stammdaten des Verantwortlichen und das Abschlussdatum sind
 * variabel; Auftragsverarbeiter, TOM und Subprozessoren sind fix.
 *
 * WICHTIG: Aendert sich der Vertragstext rechtlich relevant, muss
 * DPA_VERSION erhoeht werden — dann fordert das Studio eine erneute
 * Bestaetigung an.
 */

/** Aktuelle Vertragsversion. Bei materiellen Aenderungen erhoehen. */
export const DPA_VERSION = "1.0";

/** Angaben zum Auftragsverarbeiter (Lumio). Bei Bedarf hier pflegen. */
export const PROCESSOR = {
  name: "Markus Thiel — Lumio",
  // TODO: vollständige Firmierung/Anschrift im Impressum-Stand ergänzen
  address: "[Anschrift gemäß Impressum]",
  platform: "lumio-cloud.de",
};

export interface DpaTenantData {
  legalName: string | null;
  legalStreet: string | null;
  legalPostalCode: string | null;
  legalCity: string | null;
  legalCountry: string | null;
  vatId: string | null;
}

export interface DpaAcceptanceData {
  version: string;
  acceptedAt: Date;
  acceptedByName: string | null;
}

/** Stammdaten ausreichend für einen vollständigen AVV? */
export function dpaCompanyComplete(t: DpaTenantData): boolean {
  return Boolean(
    t.legalName && t.legalStreet && t.legalPostalCode && t.legalCity
  );
}

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Rot hervorgehobener Platzhalter, falls ein Pflichtfeld fehlt. */
function ph(label: string): string {
  return `<span class="ph">[${esc(label)}]</span>`;
}

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export function renderDpaHtml(
  tenant: DpaTenantData,
  acceptance?: DpaAcceptanceData | null
): string {
  const controller = esc(tenant.legalName) || ph("Firmierung / Name");
  const addressParts = [
    esc(tenant.legalStreet) || ph("Straße, Hausnummer"),
    `${esc(tenant.legalPostalCode) || ph("PLZ")} ${esc(tenant.legalCity) || ph("Ort")}`,
    esc(tenant.legalCountry) || "Deutschland",
  ];
  const address = addressParts.join(", ");
  const vat = tenant.vatId ? `, USt-IdNr. ${esc(tenant.vatId)}` : "";

  const acceptanceNote = acceptance
    ? `<p class="accept">Dieser Vertrag wurde am <strong>${fmtDate(
        acceptance.acceptedAt
      )}</strong> elektronisch abgeschlossen${
        acceptance.acceptedByName
          ? ` durch ${esc(acceptance.acceptedByName)}`
          : ""
      } (Version ${esc(acceptance.version)}). Gemäß Art. 28 Abs. 9 DSGVO
      ist der Abschluss in elektronischem Format zulässig.</p>`
    : `<p class="accept pending">Noch nicht elektronisch abgeschlossen.
       Schließe den Vertrag im Studio per Klick ab.</p>`;

  // Hilfsfunktion für nummerierte Absätze (1) (2) …
  const cl = (n: string, t: string) =>
    `<p class="clause"><span class="n">(${n})</span> ${t}</p>`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>Auftragsverarbeitungsvertrag (Art. 28 DSGVO) — Lumio</title>
<style>
  :root { --accent: #1f6f5c; }
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #1a1a1a; line-height: 1.55; font-size: 11pt;
    max-width: 800px; margin: 2rem auto; padding: 0 1.25rem;
  }
  h1 { color: var(--accent); font-size: 22pt; text-align: center; margin: 0 0 .2rem; }
  .sub { text-align: center; font-size: 12pt; color: #333; margin: 0 0 1.5rem; }
  h2 { font-size: 13pt; margin: 1.4rem 0 .5rem; }
  h3 { font-size: 11.5pt; margin: 1rem 0 .3rem; }
  p { margin: 0 0 .5rem; }
  .clause { padding-left: 2.1rem; text-indent: -2.1rem; }
  .clause .n { font-weight: bold; display: inline-block; min-width: 2.1rem; text-indent: 0; }
  .box { border: 2px solid var(--accent); background: #f5faf8;
         padding: .8rem 1rem; border-radius: 6px; margin: 0 0 1.5rem; font-size: 10pt; }
  .box strong { display: block; margin-bottom: .25rem; }
  .ph { color: #c00000; font-weight: bold; }
  .accept { border-left: 3px solid var(--accent); padding: .5rem .8rem;
            background: #f5faf8; font-size: 10pt; margin: 1rem 0; }
  .accept.pending { border-left-color: #c08000; background: #fff8ec; }
  table { border-collapse: collapse; width: 100%; margin: .5rem 0 1rem; font-size: 10pt; }
  th, td { border: 1px solid #bbb; padding: .35rem .5rem; text-align: left; vertical-align: top; }
  th { background: #eaf2ef; }
  .muted { color: #666; font-size: 9.5pt; }
  .sig { display: flex; gap: 2rem; margin-top: 2.5rem; }
  .sig > div { flex: 1; border-top: 1px solid #333; padding-top: .3rem; font-size: 9.5pt; color: #555; }
  .pagebreak { page-break-before: always; }
  @media print {
    body { margin: 0; max-width: none; font-size: 10.5pt; }
    .noprint { display: none; }
    a { color: inherit; text-decoration: none; }
  }
  .toolbar { text-align: center; margin-bottom: 1.5rem; }
  .toolbar button { background: var(--accent); color: #fff; border: 0;
    padding: .6rem 1.2rem; border-radius: 6px; font-size: 11pt; cursor: pointer; }
</style>
</head>
<body>
  <div class="toolbar noprint">
    <button onclick="window.print()">Als PDF herunterladen / drucken</button>
  </div>

  <h1>Vertrag zur Auftragsverarbeitung</h1>
  <p class="sub">gemäß Art. 28 der Datenschutz-Grundverordnung (DSGVO)</p>

  ${acceptanceNote}

  <p><strong>Zwischen</strong></p>
  <p>${controller}, ${address}${vat} &nbsp;<em>(nachfolgend „Verantwortlicher")</em><br>
  <span class="muted">— der Studio-Kunde, der Lumio nutzt —</span></p>
  <p><strong>und</strong></p>
  <p>${esc(PROCESSOR.name)}, ${esc(PROCESSOR.address)}, Betreiber der Plattform
  <strong>${esc(PROCESSOR.platform)}</strong> &nbsp;<em>(nachfolgend „Auftragsverarbeiter")</em><br>
  <span class="muted">— der Anbieter der Lumio-Cloud-Plattform —</span></p>
  <p class="muted">— Verantwortlicher und Auftragsverarbeiter nachfolgend einzeln auch „Partei" und gemeinsam „Parteien" —</p>
  <p>Dieser Vertrag konkretisiert die datenschutzrechtlichen Pflichten der Parteien aus dem zugrunde liegenden Nutzungsvertrag über die Lumio-Cloud-Plattform (nachfolgend „Hauptvertrag"). Er gilt für alle Tätigkeiten, bei denen der Auftragsverarbeiter im Auftrag des Verantwortlichen personenbezogene Daten verarbeitet.</p>

  <h2>§ 1 Gegenstand, Art und Zweck der Verarbeitung</h2>
  ${cl("1", "Gegenstand des Auftrags ist die Bereitstellung der Lumio-Cloud-Plattform zur Speicherung, Verwaltung, Aufbereitung und geteilten Bereitstellung von Foto- und Videodateien sowie zugehöriger Funktionen (u.\u00a0a. Galerie-Freigabe, Proofing, Annotation, Video-Streaming, Druckbestellung) als Software-as-a-Service.")}
  ${cl("2", "Art, Umfang und Zweck der Verarbeitung, die Art der personenbezogenen Daten sowie die Kategorien betroffener Personen ergeben sich abschließend aus Anlage\u00a01.")}
  ${cl("3", "Der Auftragsverarbeiter verarbeitet personenbezogene Daten ausschließlich im Auftrag und nach dokumentierter Weisung des Verantwortlichen sowie zu den in diesem Vertrag und im Hauptvertrag festgelegten Zwecken. Eine Verarbeitung zu eigenen Zwecken findet nicht statt.")}

  <h2>§ 2 Dauer</h2>
  ${cl("1", "Die Laufzeit dieses Vertrags entspricht der Laufzeit des Hauptvertrags. Er endet automatisch mit dessen Beendigung, ohne dass es einer gesonderten Kündigung bedarf.")}
  ${cl("2", "Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt unberührt.")}

  <h2>§ 3 Weisungsrecht des Verantwortlichen</h2>
  ${cl("1", "Der Verantwortliche ist für die Rechtmäßigkeit der Verarbeitung sowie für die Wahrung der Rechte der betroffenen Personen allein verantwortlich (Art.\u00a04 Nr.\u00a07 DSGVO).")}
  ${cl("2", "Der Auftragsverarbeiter verarbeitet die Daten ausschließlich im Rahmen der getroffenen Vereinbarungen und nach Weisung des Verantwortlichen, es sei denn, er ist gesetzlich zur Verarbeitung verpflichtet.")}
  ${cl("3", "Weisungen werden grundsätzlich in Textform erteilt; die Konfigurationsmöglichkeiten innerhalb der Plattform (z.\u00a0B. Lösch-, Ablauf- und Freigabeeinstellungen) gelten als zulässige Weisungen.")}
  ${cl("4", "Hält der Auftragsverarbeiter eine Weisung für rechtswidrig, teilt er dies dem Verantwortlichen unverzüglich mit und kann ihre Durchführung bis zur Bestätigung aussetzen.")}

  <h2>§ 4 Pflichten des Auftragsverarbeiters</h2>
  <p>Der Auftragsverarbeiter gewährleistet die Einhaltung der Pflichten nach Art.\u00a028 Abs.\u00a03 DSGVO:</p>
  ${cl("a", "Verarbeitung ausschließlich auf dokumentierte Weisung des Verantwortlichen, auch hinsichtlich einer Übermittlung in ein Drittland, sofern keine gesetzliche Verpflichtung besteht.")}
  ${cl("b", "Vertraulichkeit: Einsatz nur von Personen, die auf Vertraulichkeit verpflichtet wurden oder einer gesetzlichen Verschwiegenheitspflicht unterliegen — auch über das Vertragsende hinaus.")}
  ${cl("c", "Sicherheit der Verarbeitung nach Art.\u00a032 DSGVO; die getroffenen technischen und organisatorischen Maßnahmen sind in Anlage\u00a02 beschrieben.")}
  ${cl("d", "Hinzuziehung von Unterauftragsverarbeitern nur unter den Voraussetzungen des §\u00a05.")}
  ${cl("e", "Unterstützung des Verantwortlichen bei der Erfüllung von Betroffenenrechten (Art.\u00a012–23 DSGVO).")}
  ${cl("f", "Unterstützung bei den Pflichten aus Art.\u00a032–36 DSGVO (Sicherheit, Meldung von Verletzungen, Datenschutz-Folgenabschätzung).")}
  ${cl("g", "Löschung oder Rückgabe aller personenbezogenen Daten nach Abschluss der Erbringung gemäß §\u00a09, sofern keine gesetzliche Aufbewahrungspflicht besteht.")}
  ${cl("h", "Nachweis der Einhaltung der Pflichten aus Art.\u00a028 DSGVO und Ermöglichung von Überprüfungen gemäß §\u00a06.")}

  <h2>§ 5 Unterauftragsverhältnisse</h2>
  ${cl("1", "Der Verantwortliche erteilt die allgemeine Genehmigung zur Hinzuziehung weiterer Auftragsverarbeiter. Die zum Vertragsschluss eingesetzten Unterauftragsverarbeiter sind in Anlage\u00a03 aufgeführt und gelten als genehmigt.")}
  ${cl("2", "Der Auftragsverarbeiter informiert über beabsichtigte Änderungen; der Verantwortliche kann binnen 14 Tagen aus wichtigem datenschutzrechtlichem Grund widersprechen.")}
  ${cl("3", "Jeder Unterauftragsverarbeiter wird zu denselben Datenschutzpflichten verpflichtet (Art.\u00a028 Abs.\u00a04 DSGVO); der Auftragsverarbeiter bleibt verantwortlich.")}

  <h2>§ 6 Kontrollrechte des Verantwortlichen</h2>
  ${cl("1", "Der Auftragsverarbeiter weist die Einhaltung vorrangig durch geeignete Nachweise nach (Beschreibung der Maßnahmen, Zertifikate/Berichte unabhängiger Stellen, z.\u00a0B. des Rechenzentrumsbetreibers).")}
  ${cl("2", "Reichen diese nicht aus, ermöglicht er nach rechtzeitiger Vorankündigung Überprüfungen zu üblichen Geschäftszeiten, ohne den Betrieb unverhältnismäßig zu stören.")}
  ${cl("3", "Da die Plattform mandantenübergreifend betrieben wird, beschränken sich Prüfungen auf die den Verantwortlichen betreffenden Verarbeitungen; die Daten anderer Verantwortlicher bleiben vertraulich.")}

  <h2>§ 7 Meldung von Datenschutzverletzungen</h2>
  ${cl("1", "Der Auftragsverarbeiter meldet eine ihn betreffende Verletzung des Schutzes personenbezogener Daten unverzüglich, in der Regel innerhalb von 48 Stunden nach Kenntnis.")}
  ${cl("2", "Die Meldung enthält die nach Art.\u00a033 Abs.\u00a03 DSGVO erforderlichen Angaben, soweit verfügbar.")}
  ${cl("3", "Meldungen an Aufsichtsbehörde und betroffene Personen (Art.\u00a033, 34 DSGVO) obliegen dem Verantwortlichen; der Auftragsverarbeiter unterstützt ihn dabei.")}

  <h2>§ 8 Ort der Verarbeitung / Drittlandtransfer</h2>
  ${cl("1", "Die Verarbeitung findet ausschließlich innerhalb der EU/des EWR statt. Die Inhaltsdaten (Foto-/Videodateien und zugehörige Galerie-Daten) werden in Rechenzentren in Deutschland gespeichert.")}
  ${cl("2", "Eine Drittlandübermittlung erfolgt nur bei Erfüllung der Art.\u00a044\u00a0ff. DSGVO und nach vorheriger Information des Verantwortlichen.")}

  <h2>§ 9 Löschung und Rückgabe nach Beendigung</h2>
  ${cl("1", "Nach Vertragsende erhält der Verantwortliche eine Karenzzeit zum Export seiner Daten; danach werden die Daten gelöscht, soweit keine gesetzliche Aufbewahrungspflicht entgegensteht.")}
  ${cl("2", "Die Löschung umfasst auch abgeleitete Vorschau-Versionen sowie Sicherungskopien im Rahmen der üblichen Backup-Zyklen.")}
  ${cl("3", "Die Löschung wird auf Verlangen in Textform bestätigt.")}

  <h2>§ 10 Haftung</h2>
  ${cl("1", "Es gilt Art.\u00a082 DSGVO; ergänzend gelten die Haftungsregelungen des Hauptvertrags, soweit sie zwingendem Datenschutzrecht nicht widersprechen.")}
  ${cl("2", "Der Verantwortliche ist für die Zulässigkeit der Verarbeitung und die Wahrung der Betroffenenrechte verantwortlich.")}

  <h2>§ 11 Schlussbestimmungen</h2>
  ${cl("1", "Änderungen bedürfen der Textform; dies gilt auch für die Abbedingung des Formerfordernisses.")}
  ${cl("2", "Bei Widersprüchen gehen in datenschutzrechtlichen Fragen die Regelungen dieses Vertrags dem Hauptvertrag vor.")}
  ${cl("3", "Sollten einzelne Bestimmungen unwirksam sein, bleibt die Wirksamkeit der übrigen unberührt.")}
  ${cl("4", "Es gilt das Recht der Bundesrepublik Deutschland.")}

  <div class="sig">
    <div>Ort, Datum / Verantwortlicher</div>
    <div>Ort, Datum / Auftragsverarbeiter</div>
  </div>
  <p class="muted">Bei elektronischem Abschluss ersetzt die im Studio dokumentierte Zustimmung die händische Unterschrift (Art.\u00a028 Abs.\u00a09 DSGVO).</p>

  <h1 class="pagebreak" style="font-size:16pt;text-align:left;margin-top:1rem;">Anlage 1 — Einzelheiten der Verarbeitung</h1>
  <h3>Gegenstand und Zweck</h3>
  <p>Bereitstellung der Lumio-Cloud-Plattform als Software-as-a-Service zur Speicherung, Verwaltung, Freigabe und Aufbereitung von Foto- und Videoinhalten des Verantwortlichen sowie zur geteilten Bereitstellung an dessen Endkunden.</p>
  <h3>Art der Verarbeitung</h3>
  <p>Erheben, Erfassen, Speichern, Organisieren, Anpassen, Auslesen, Abfragen, Verwenden, Bereitstellen durch Übermittlung/Freigabe, Einschränken und Löschen — automatisiert mittels der Plattform.</p>
  <h3>Kategorien betroffener Personen</h3>
  <table>
    <tr><th>Kategorie</th><th>Beschreibung</th></tr>
    <tr><td>Endkunden des Verantwortlichen</td><td>Personen, denen Galerien bereitgestellt werden (z.\u00a0B. Auftraggeber, Brautpaare, Unternehmenskunden).</td></tr>
    <tr><td>Abgebildete Personen</td><td>Auf Foto-/Videoinhalten erkennbare Personen (z.\u00a0B. Gäste, Modelle).</td></tr>
    <tr><td>Nutzer im Studio-Account</td><td>Mitarbeitende/Teammitglieder des Verantwortlichen.</td></tr>
  </table>
  <h3>Arten personenbezogener Daten</h3>
  <table>
    <tr><th>Datenart</th><th>Beispiele</th></tr>
    <tr><td>Inhaltsdaten</td><td>Foto-/Videodateien inkl. Abbildungen identifizierbarer Personen und zugehörige Metadaten.</td></tr>
    <tr><td>Stamm-/Kontaktdaten</td><td>Namen, E-Mail-Adressen (Galerie-Einladung und -Zugang).</td></tr>
    <tr><td>Nutzungs-/Interaktionsdaten</td><td>Bildauswahl, Favoriten, Kommentare, Annotationen, Downloads.</td></tr>
    <tr><td>Zugriffs-/Protokolldaten</td><td>IP-Adressen, Zeitstempel, Geräte-/Browserangaben, Audit-Log.</td></tr>
  </table>
  <p class="muted">Foto-/Videoinhalte können im Einzelfall besondere Kategorien (Art.\u00a09 DSGVO) erkennen lassen; für deren Rechtmäßigkeit ist der Verantwortliche zuständig.</p>

  <h1 class="pagebreak" style="font-size:16pt;text-align:left;margin-top:1rem;">Anlage 2 — Technische und organisatorische Maßnahmen (Art. 32 DSGVO)</h1>
  <h3>Vertraulichkeit</h3>
  <ul>
    <li>Zutrittskontrolle: Betrieb in Rechenzentren mit kontrolliertem Zutritt (Hetzner Online GmbH, Deutschland; ISO\u00a027001-zertifiziert).</li>
    <li>Zugangskontrolle: sicher gehashte Passwörter (Argon2); signierte URLs mit begrenzter Gültigkeit; optionaler Passwortschutz je Galerie.</li>
    <li>Zugriffskontrolle: rollenbasierte Berechtigungen; strikte mandantenbezogene Datentrennung (Multi-Tenant-Isolation).</li>
  </ul>
  <h3>Integrität</h3>
  <ul>
    <li>Verschlüsselung bei Übertragung (TLS) und verschlüsselte Speicherung der Inhaltsdaten (at rest).</li>
    <li>Nachvollziehbarkeit von Vorgängen über ein Audit-Log.</li>
  </ul>
  <h3>Verfügbarkeit und Belastbarkeit</h3>
  <ul>
    <li>Regelmäßige Datensicherungen; Wiederherstellbarkeit nach Zwischenfällen.</li>
    <li>Infrastruktur-Schutz (u.\u00a0a. DDoS-Schutz, Firewalling auf Hoster-Ebene).</li>
  </ul>
  <h3>Überprüfung und Datenminimierung</h3>
  <ul>
    <li>Datenschutzfreundliche Voreinstellungen (Privacy by Design / by Default).</li>
    <li>Definiertes Löschkonzept inkl. Karenzzeit und vollständiger Löschung abgeleiteter Versionen.</li>
    <li>Verpflichtung der eingesetzten Personen auf Vertraulichkeit.</li>
  </ul>
  <p class="muted">Die Maßnahmen werden dem Stand der Technik angepasst; einzelne Maßnahmen können durch gleichwertige ersetzt werden.</p>

  <h1 class="pagebreak" style="font-size:16pt;text-align:left;margin-top:1rem;">Anlage 3 — Genehmigte Unterauftragsverarbeiter</h1>
  <table>
    <tr><th>Unterauftragsverarbeiter</th><th>Ort / Land</th><th>Leistung</th></tr>
    <tr><td>Hetzner Online GmbH</td><td>Deutschland (EU)</td><td>Hosting der Server und Object-Storage; Speicherung der Inhalts- und Anwendungsdaten.</td></tr>
    <tr><td>[E-Mail-Versanddienst — falls eingesetzt]</td><td>[EU]</td><td>Versand transaktionaler E-Mails (z.\u00a0B. Galerie-Einladungen).</td></tr>
  </table>
  <p class="muted">Zahlungsabwicklung (z.\u00a0B. Stripe) betrifft Vertrags-/Zahlungsdaten zwischen Auftragsverarbeiter und Verantwortlichem und ist nicht Gegenstand dieses AVV. Nutzt der Verantwortliche die Druckbestellung, übermittelt er Bilddaten an ein von ihm gewähltes Druck-Labor, das ihm gegenüber eigener Auftragsverarbeiter ist.</p>

  <p class="muted" style="margin-top:2rem;">AVV-Version ${esc(DPA_VERSION)} · erzeugt am ${fmtDate(new Date())}</p>
</body>
</html>`;
}
