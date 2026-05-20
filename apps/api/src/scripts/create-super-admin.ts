/**
 * Lumio API — CLI: create-super-admin
 *
 * Legt einen Plattform-Operator an (super_admins-Tabelle). Diese
 * Identität ist NICHT an einen Tenant gebunden — sie verwaltet ALLE
 * Tenants über /super.
 *
 * Beispiel:
 *   npm run create-super-admin -- --email=ops@example.com \\
 *     --password=geheim --name="Ops Team"
 *
 * Idempotent: falls die E-Mail schon existiert, wird nur das Passwort
 * aktualisiert (mit Warnung). Verhindert versehentliche Lockouts.
 */
import { argv, exit } from "node:process";

import { prisma } from "../db.js";
import { hashPassword } from "../services/auth.js";

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function fail(msg: string): never {
  console.error(`[create-super-admin] ${msg}`);
  exit(1);
}

async function main() {
  const args = parseArgs();

  if (!args.email || !args.password) {
    fail(
      "Usage: create-super-admin --email=<email> --password=<password> [--name=<displayName>]"
    );
  }
  if (args.password.length < 12) {
    fail("Super-admin password must be at least 12 characters");
  }

  const email = args.email.trim().toLowerCase();
  const displayName = args.name?.trim() || email.split("@")[0];
  const passwordHash = await hashPassword(args.password);

  const existing = await prisma.superAdmin.findUnique({ where: { email } });
  if (existing) {
    await prisma.superAdmin.update({
      where: { id: existing.id },
      data: { passwordHash, displayName },
    });
    console.warn(
      `[create-super-admin] ⚠ Super-admin '${email}' already existed — password and display name updated.`
    );
  } else {
    const created = await prisma.superAdmin.create({
      data: { email, passwordHash, displayName },
    });
    console.log(
      `[create-super-admin] ✓ Created super-admin '${created.email}' (id=${created.id})`
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[create-super-admin] Failed:", err);
  exit(1);
});
