/**
 * Lumio API — CLI: create-admin
 *
 * Legt einen Admin-User an. Im single-Mode wird der Default-Tenant verwendet,
 * im multi-Mode kann --tenant=<slug> angegeben werden (oder es wird, falls
 * noch kein Tenant existiert, einer angelegt mit --tenant-name=...).
 *
 * Beispiel:
 *   npm run create-admin -- --email=du@example.com --password=geheim --name="Studio Müller"
 *
 * Im multi-Mode:
 *   npm run create-admin -- --email=du@example.com --password=geheim \
 *     --tenant=studio-mueller --tenant-name="Studio Müller"
 */
import { argv, exit } from "node:process";

import { prisma } from "../db.js";
import { config } from "../config.js";
import { hashPassword } from "../services/auth.js";
import { bootstrap } from "../bootstrap.js";

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function fail(msg: string): never {
  console.error(`[create-admin] ${msg}`);
  exit(1);
}

async function main() {
  const args = parseArgs();

  if (!args.email || !args.password) {
    fail(
      "Usage: create-admin --email=<email> --password=<password> [--name=<name>] " +
        "[--tenant=<slug>] [--tenant-name=<name>]"
    );
  }

  if (args.password.length < 8) {
    fail("Password must be at least 8 characters");
  }

  await bootstrap();

  // Tenant ermitteln
  let tenant;
  if (config.DEPLOYMENT_MODE === "single") {
    tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
    if (!tenant) fail("No default tenant — bootstrap failed?");
  } else {
    if (args.tenant) {
      tenant = await prisma.tenant.findUnique({ where: { slug: args.tenant } });
      if (!tenant) {
        // Anlegen, wenn --tenant-name geliefert wurde
        if (!args["tenant-name"]) {
          fail(
            `Tenant '${args.tenant}' not found. Pass --tenant-name=... to create it.`
          );
        }
        tenant = await prisma.tenant.create({
          data: {
            slug: args.tenant,
            name: args["tenant-name"],
            status: "active",
          },
        });
        console.log(`[create-admin] Created tenant '${tenant.slug}'`);
      }
    } else {
      // Im multi-Mode ohne --tenant: nimm den ersten oder lege "default" an
      tenant = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
      if (!tenant) {
        tenant = await prisma.tenant.create({
          data: { slug: "default", name: "Default", status: "active" },
        });
        console.log(`[create-admin] Created tenant 'default'`);
      }
    }
  }

  // User-Konflikt prüfen
  const existing = await prisma.user.findUnique({
    where: {
      tenantId_email: { tenantId: tenant!.id, email: args.email.toLowerCase() },
    },
  });
  if (existing) {
    fail(`User '${args.email}' already exists in tenant '${tenant!.slug}'`);
  }

  const passwordHash = await hashPassword(args.password);
  const user = await prisma.user.create({
    data: {
      tenantId: tenant!.id,
      email: args.email.toLowerCase(),
      passwordHash,
      name: args.name ?? null,
      role: "owner",
      status: "active",
    },
  });

  console.log(
    `[create-admin] ✓ Created user '${user.email}' (role=owner) in tenant '${tenant!.slug}'`
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[create-admin] ERROR:", err.message ?? err);
  await prisma.$disconnect().catch(() => {});
  exit(1);
});
