-- Manuell zugewiesenes Gratis-Abo (Partner/Goodwill) auf billing_subscriptions.
-- Rein additiv mit Default false — läuft ohne Datenverlust durch.
ALTER TABLE "billing_subscriptions"
  ADD COLUMN "comped" BOOLEAN NOT NULL DEFAULT false;
