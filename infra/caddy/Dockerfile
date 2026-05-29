# Custom Caddy-Build mit acme-dns-Plugin für DNS-01-Challenges via acme-dns.
# Wird vom docker-compose.yml caddy-Service als build-context referenziert.
FROM caddy:2-builder AS builder
RUN xcaddy build \
    --with github.com/caddy-dns/acmedns

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
