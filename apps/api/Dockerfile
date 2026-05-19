# =============================================================================
# Lumio API — Dockerfile (Multi-stage)
# =============================================================================

# Stage 1: Dependencies installieren
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && \
    cp -r node_modules /tmp/prod_modules && \
    npm install

# Stage 2: Build (TypeScript → JS, Prisma Client generieren)
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# Stage 3: Runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache tini

# Nur Production-Dependencies + Build-Output + Prisma Client
COPY --from=deps /tmp/prod_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
