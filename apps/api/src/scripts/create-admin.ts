/**
 * Lumio API — CLI: create-admin
 *
 * Legt einen Admin-User an. Im single-Mode wird der Default-Tenant verwendet,
 * im multi-Mode muss --tenant=<slug> mit angegeben werden.
 *
 * Beispiel:
 *   npm run create-admin -- --email=du@example.com --password=geheim --name="Dein Studio"
 */
import { argv, exit } from "node:process";

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

async function main() {
  const args = parseArgs();
  if (!args.email || !args.password) {
    console.error(
      "Usage: npm run create-admin -- --email=<email> --password=<password> [--name=<name>] [--tenant=<slug>]"
    );
    exit(1);
  }

  // TODO: vollständige Implementierung
  //   import { PrismaClient } from "@prisma/client";
  //   import argon2 from "argon2";
  //   import { config } from "../config.js";
  //
  //   const db = new PrismaClient();
  //
  //   // Im single-Mode: Default-Tenant holen oder anlegen
  //   let tenant = await db.tenant.findFirst();
  //   if (!tenant) {
  //     tenant = await db.tenant.create({
  //       data: { slug: "default", name: args.name ?? "My Studio" }
  //     });
  //   }
  //   if (config.DEPLOYMENT_MODE === "multi" && args.tenant) {
  //     tenant = await db.tenant.findUnique({ where: { slug: args.tenant } });
  //     if (!tenant) throw new Error(`Tenant ${args.tenant} not found`);
  //   }
  //
  //   const hash = await argon2.hash(args.password, { type: argon2.argon2id });
  //   const user = await db.user.create({
  //     data: {
  //       tenantId: tenant.id,
  //       email: args.email,
  //       passwordHash: hash,
  //       name: args.name,
  //       role: "owner",
  //       status: "active",
  //     },
  //   });
  //   console.log(`Created admin user ${user.email} in tenant ${tenant.slug}`);
  //   await db.$disconnect();

  console.log(
    `[create-admin] Stub — TODO: not implemented yet. Args: ${JSON.stringify(args)}`
  );
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
