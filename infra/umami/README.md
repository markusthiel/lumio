# Umami — Web-Analytics für die Marketing-Sites

Cookieloses, self-hosted Analytics für `lumio-cloud.de` und `lumio-app.de`.
Läuft als eigener Stack, vom App-Caddy unter `stats.lumio-cloud.de`
ausgeliefert.

## Warum cookielos / ohne Consent-Banner

Umami setzt keine Cookies, keinen `localStorage` und keinen persistenten
Identifier. Es bildet pro Tag einen rotierenden, nicht rückführbaren Hash
und speichert keine IP. Damit greift es nicht auf das Endgerät zu
(§ 25 TDDDG nicht einschlägig); die kurze IP-Verarbeitung lässt sich auf
berechtigtes Interesse (Art. 6 Abs. 1 lit. f DSGVO) stützen. Self-hosted in
Deutschland (Hetzner) → keine Drittlandübermittlung.

Trotzdem nötig: Nennung in der Datenschutzerklärung (ist auf beiden Sites
hinterlegt). Keine Rechtsberatung — finale Freigabe gehört ins anwaltliche
Review.

`DISABLE_TELEMETRY=1` ist gesetzt, damit Umami selbst keine anonyme
Nutzungsstatistik nach außen sendet.

## Erst-Setup

1. **A-Record** `stats.lumio-cloud.de` → Server-IP setzen.
2. In der App-Stack-`.env` `LUMIO_UMAMI_HOST=stats.lumio-cloud.de` setzen
   und den App-Stack neu deployen (Caddy lädt den stats-Block und holt das
   Cert; ohne diese Variable bleibt der Block inaktiv).
3. Secrets anlegen und Stack starten:
   ```
   cd /opt/docker/lumio/lumio/infra/umami
   cp .env.example .env
   # UMAMI_DB_PASSWORD + UMAMI_APP_SECRET eintragen (openssl rand ...)
   docker compose up -d
   ```
4. `https://stats.lumio-cloud.de` öffnen, mit dem Default-Login
   (`admin` / `umami`) anmelden und **das Passwort sofort ändern**.
5. Unter *Settings → Websites* zwei Websites anlegen:
   - Domain `lumio-cloud.de`
   - Domain `lumio-app.de`
   Jede liefert eine **Website-ID** (UUID).
6. Die IDs in die `.env` der jeweiligen Marketing-Site eintragen
   (`PUBLIC_UMAMI_WEBSITE_ID`, `PUBLIC_UMAMI_SRC`) und die Site neu bauen
   (`docker compose up -d --build`). Erst dann lädt das Tracking-Snippet.

## Updates

```
cd /opt/docker/lumio/lumio/infra/umami
docker compose pull && docker compose up -d
```

Die Daten liegen im Volume `umami_db_data` und überleben Updates.
