/**
 * Tag-Hierarchie beim Filtern (#73): Ein Filter auf einen Eltern-Tag findet
 * auch Galerien, die nur einen seiner Unter-Tags tragen. Vorher galt nur der
 * exakte Tag, die Hierarchie war beim Filtern wirkungslos.
 */
import { prisma } from "../db.js";
import { descendantIds } from "./folder-tree.js";

/** Für jede angefragte Tag-ID: die ID selbst plus alle Nachfahren. */
export function expandTagIdsFrom(
  tags: readonly { id: string; parentId: string | null }[],
  ids: readonly string[]
): Map<string, string[]> {
  const nodes = tags.map((t) => ({ id: t.id, parentId: t.parentId, name: "" }));
  const out = new Map<string, string[]>();
  for (const id of ids) out.set(id, [id, ...descendantIds(nodes, id)]);
  return out;
}

export async function expandTagIds(
  tenantId: string,
  ids: readonly string[]
): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const tags = await prisma.tag.findMany({
    where: { tenantId },
    select: { id: true, parentId: true },
  });
  return expandTagIdsFrom(tags, ids);
}
