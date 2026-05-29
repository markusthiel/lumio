-- =============================================================================
-- Lumio — acme-dns Database Setup
-- =============================================================================
-- Legt User + DB für den acme-dns-Service an. acme-dns verwaltet ACME-DNS-01-
-- Challenge-Records für Let's-Encrypt-Wildcard-Zertifikate.
--
-- Wird beim ERSTEN Postgres-Start automatisch ausgeführt. Bei bestehenden
-- Setups (Volume existiert schon) muss das manuell nachgezogen werden:
--
--   docker compose exec postgres psql -U lumio -d postgres \
--     -f /docker-entrypoint-initdb.d/02-acme-dns.sql
--
-- Tabellen-Schema legt acme-dns selbst an beim ersten Start.

CREATE USER acme_dns WITH PASSWORD 'acme_dns_local_pw';
CREATE DATABASE acme_dns OWNER acme_dns;
GRANT ALL PRIVILEGES ON DATABASE acme_dns TO acme_dns;
