# =============================================================================
# Lumio API — Dockerfile (Multi-stage)
# =============================================================================
# Notiz zu OpenSSL: Prisma's Engine ist ein natives Binary, das gegen
# libssl/libcrypto linkt. node:20-alpine bringt das nicht von Haus aus mit,
# weshalb `apk add openssl3` in jeder Stage steht, in der Prisma läuft
# (Builder generiert den Client, Runner führt Migrations + Server aus).
# Plus binaryTargets in schema.prisma — sonst lädt prisma generate die
# falsche Engine-Variante runter.

# Stage 1: Dependencies installieren
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && \
    cp -r node_modules /tmp/prod_modules && \
    npm ci --no-audit --no-fund

# Stage 2: Build (TypeScript → JS, Prisma Client generieren)
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl3
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Bewusst ./node_modules/.bin statt npx: npx lädt bei fehlender lokaler
# Installation still die NEUESTE Prisma-CLI aus dem Netz (Major-Sprünge
# brechen dann das Schema, siehe GitHub-Issue #1). Der direkte Pfad
# schlägt stattdessen hart und klar fehl.
RUN ./node_modules/.bin/prisma generate && npm run build

# Stage 3: Runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache tini openssl3

# Nur Production-Dependencies + Build-Output + Prisma Client
COPY --from=deps /tmp/prod_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/server.js"]
