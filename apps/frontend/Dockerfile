# =============================================================================
# Lumio Frontend — Dockerfile (Multi-stage, Next.js standalone)
# =============================================================================

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* werden von Next.js zur BUILD-ZEIT ins Bundle eingebacken
# (Client- wie Server-Komponenten). Sie müssen daher hier als ARG
# ankommen und als ENV gesetzt sein, BEVOR next build läuft — ein reines
# Laufzeit-environment im Compose greift für diese Variablen nicht.
ARG NEXT_PUBLIC_API_URL=""
ARG NEXT_PUBLIC_DEPLOYMENT_MODE="single"
ARG NEXT_PUBLIC_DOMAIN_BASE=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_DEPLOYMENT_MODE=$NEXT_PUBLIC_DEPLOYMENT_MODE \
    NEXT_PUBLIC_DOMAIN_BASE=$NEXT_PUBLIC_DOMAIN_BASE
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache tini && addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
