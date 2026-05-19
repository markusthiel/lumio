/**
 * Lumio API — Proofing Export Service
 *
 * Erzeugt Export-Formate aus den Auswahl-Daten einer Galerie:
 *   - CSV: flache Liste, eine Zeile pro File × Access-Token
 *   - XMP: ein Sidecar pro File mit xmp:Rating und xmp:Label
 *
 * XMP-Hinweise:
 *   - xmp:Rating ist ein Standard (0–5).
 *   - xmp:Label ist app-spezifisch. Lightroom matcht den Label-Text gegen
 *     das aktive Color-Label-Set; bei deutschem Lightroom heißt "Red"
 *     "Rot". Wir schreiben die englischen Begriffe und dokumentieren das.
 *
 * Wir aggregieren je File über ALLE Access-Tokens (Studio-Sicht).
 * Bei Konflikt (zwei Teams vergeben unterschiedliche Color-Labels):
 *   - Rating: das Maximum (großzügige Interpretation)
 *   - Label: das des "wichtigsten" Tokens (alphabetisch erstes Label) —
 *     bewusst simpel; ein nuancierter Studio-Workflow filtert eh per
 *     Token in der UI.
 */
import { prisma } from "../db.js";

export interface FileExportRow {
  fileId: string;
  filename: string;
  takenAt: Date | null;
  /** Aggregiertes Rating (Maximum aller Tokens) */
  rating: number | null;
  /** Aggregiertes Color-Label, kapitalisiert (z.B. "Green") */
  label: string | null;
  /** Wurde von mind. einem Token geliked */
  liked: boolean;
  /** Pro Access-Token die Details — für CSV-Spalten */
  perAccess: Array<{
    accessLabel: string;
    color: string | null;
    rating: number | null;
    liked: boolean;
    status: string | null;
  }>;
}

/**
 * Lädt alle Files einer Galerie und aggregiert die Selections.
 * Owner-Check muss der Caller machen.
 */
export async function loadProofingExport(
  galleryId: string
): Promise<FileExportRow[]> {
  const files = await prisma.file.findMany({
    where: { galleryId, status: "ready" },
    orderBy: { sortIndex: "asc" },
    select: {
      id: true,
      originalFilename: true,
      takenAt: true,
      selections: {
        select: {
          color: true,
          rating: true,
          liked: true,
          status: true,
          access: { select: { label: true } },
        },
      },
    },
  });

  return files.map((f) => {
    const sels = f.selections;
    const ratings = sels.map((s) => s.rating).filter((r): r is number => r !== null);
    const colors = sels.map((s) => s.color).filter((c): c is string => c !== null);

    const aggRating = ratings.length > 0 ? Math.max(...ratings) : null;
    // Color-Conflict: alphabetisch erstes Label (deterministisch)
    const aggColor = colors.length > 0 ? [...colors].sort()[0] : null;
    const liked = sels.some((s) => s.liked);

    return {
      fileId: f.id,
      filename: f.originalFilename,
      takenAt: f.takenAt,
      rating: aggRating,
      label: aggColor ? capitalize(aggColor) : null,
      liked,
      perAccess: sels.map((s) => ({
        accessLabel: s.access.label,
        color: s.color,
        rating: s.rating,
        liked: s.liked,
        status: s.status,
      })),
    };
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
const CSV_BOM = "\uFEFF"; // damit Excel UTF-8 erkennt

export function buildCsv(rows: FileExportRow[]): string {
  // Spalten: Filename | Aufgenommen | Rating | Label | Liked | (pro Token: 3 Spalten)
  // Wir bauen das Token-Set dynamisch über alle Rows.
  const tokenLabels = new Set<string>();
  for (const r of rows) {
    for (const a of r.perAccess) {
      tokenLabels.add(a.accessLabel);
    }
  }
  const sortedTokens = [...tokenLabels].sort();

  const header = [
    "Filename",
    "TakenAt",
    "Rating",
    "Label",
    "Liked",
    ...sortedTokens.flatMap((t) => [
      `${t} — Color`,
      `${t} — Rating`,
      `${t} — Status`,
    ]),
  ];

  const lines: string[] = [header.map(csvCell).join(",")];

  for (const r of rows) {
    const accByLabel = new Map(r.perAccess.map((a) => [a.accessLabel, a]));
    const cells: string[] = [
      r.filename,
      r.takenAt ? r.takenAt.toISOString() : "",
      r.rating?.toString() ?? "",
      r.label ?? "",
      r.liked ? "yes" : "",
    ];
    for (const t of sortedTokens) {
      const a = accByLabel.get(t);
      cells.push(
        a?.color ? capitalize(a.color) : "",
        a?.rating?.toString() ?? "",
        a?.status ?? (a?.liked ? "liked" : "")
      );
    }
    lines.push(cells.map(csvCell).join(","));
  }

  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

function csvCell(value: string): string {
  // Quoting: jedes Feld in Anführungszeichen, eingebettete " verdoppeln.
  // Konsistent (auch für leere Zellen) → robust für Excel/Numbers/LibreOffice.
  return `"${value.replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// XMP-Sidecar
// ---------------------------------------------------------------------------
/**
 * Erzeugt einen XMP-Sidecar-String für ein einzelnes File.
 * Enthält xmp:Rating + xmp:Label, falls vorhanden.
 *
 * Format ist das, das Adobe-Tools auch schreiben (basic XMP/RDF).
 * Lightroom akzeptiert sowohl <xmp:Rating>3</xmp:Rating> als auch
 * rdf:Description-Attribute — wir gehen mit Attributen, ist kompakter.
 */
export function buildXmp(row: FileExportRow): string | null {
  // Wenn weder Rating noch Label noch Liked: keine Sidecar nötig
  if (row.rating === null && row.label === null && !row.liked) {
    return null;
  }

  const rating = row.rating ?? (row.liked ? 5 : null);
  const label = row.label;

  const attrs: string[] = [
    'xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    'xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"',
  ];
  const elems: string[] = [];
  if (rating !== null) {
    elems.push(`      <xmp:Rating>${rating}</xmp:Rating>`);
  }
  if (label) {
    elems.push(`      <xmp:Label>${escapeXml(label)}</xmp:Label>`);
  }

  return (
    `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Lumio">\n` +
    ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `  <rdf:Description rdf:about=""\n` +
    `    ${attrs.join("\n    ")}>\n` +
    elems.join("\n") +
    `\n  </rdf:Description>\n` +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>\n`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Berechnet den Dateinamen einer XMP-Sidecar passend zum Original.
 *   IMG_1234.NEF → IMG_1234.xmp
 *   IMG_1234     → IMG_1234.xmp
 *
 * Lightroom akzeptiert auch IMG_1234.NEF.xmp; die kürzere Variante ist
 * Standard und wird auch von Camera Raw geschrieben.
 */
export function xmpSidecarName(originalFilename: string): string {
  const dot = originalFilename.lastIndexOf(".");
  if (dot <= 0) return `${originalFilename}.xmp`;
  return `${originalFilename.slice(0, dot)}.xmp`;
}
