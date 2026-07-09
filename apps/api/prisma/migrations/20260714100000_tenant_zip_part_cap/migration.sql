-- Pro-Tenant-Obergrenze für die Größe eines Download-Pakets (Teil-ZIP)
-- in MiB. NULL = globaler ENV-Default (ZIP_PART_MAX_MIB). Additiv und
-- rückwärtskompatibel — bestehende Tenants behalten NULL und nutzen
-- damit weiterhin den Default (8 GiB).

ALTER TABLE "tenants" ADD COLUMN "zipPartMaxMib" INTEGER;
