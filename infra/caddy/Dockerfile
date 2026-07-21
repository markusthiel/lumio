# Custom Caddy-Build mit acme-dns-Plugin für DNS-01-Challenges via acme-dns.
# Wird vom docker-compose.yml caddy-Service als build-context referenziert.
FROM caddy:2-builder AS builder
RUN xcaddy build \
    --with github.com/caddy-dns/acmedns

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Entrypoint wählt die acmedns-Credentials: echte Datei aus secrets/ wenn
# vorhanden, sonst der Dummy-Fallback (nötig, damit Caddy auf frischen
# Clones ohne secrets/acmedns.json überhaupt startet — das Plugin liest
# die Datei schon beim Start). Details: infra/caddy/entrypoint.sh
COPY --chmod=755 infra/caddy/entrypoint.sh /usr/local/bin/lumio-entrypoint.sh
COPY infra/caddy/acmedns-fallback.json /etc/caddy/acmedns-fallback.json
ENTRYPOINT ["/usr/local/bin/lumio-entrypoint.sh"]
# ENTRYPOINT im Child-Image resettet das CMD des Base-Images → neu setzen.
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
