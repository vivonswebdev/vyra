-- Lot 3.1 : anti-énumération, limitation de débit partagée, quarantaine antivirus, e-mails sans doublon.

-- Échecs de connexion par adresse (empreinte), que le compte existe ou non : le verrouillage
-- se comporte de la même façon pour une adresse inconnue et ne révèle donc rien.
CREATE TABLE auth_throttle (
  key          bytea PRIMARY KEY,
  failures     int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);

-- Compteurs de limitation de débit partagés par toutes les instances de l'API.
CREATE UNLOGGED TABLE rate_limits (
  key      text PRIMARY KEY,
  count    int NOT NULL,
  reset_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_reset_idx ON rate_limits (reset_at);

-- Quarantaine : un fichier déposé n'est servi qu'une fois analysé et déclaré sain.
ALTER TABLE files ADD COLUMN scan_status text NOT NULL DEFAULT 'pending'
  CHECK (scan_status IN ('pending', 'clean', 'infected', 'error', 'not_required', 'unscanned'));
ALTER TABLE files ADD COLUMN scan_detail text;
ALTER TABLE files ADD COLUMN scan_engine text;
ALTER TABLE files ADD COLUMN scanned_at timestamptz;
-- Fichiers antérieurs au lot 3.1 : exports produits par le serveur, sources jamais analysées.
UPDATE files SET scan_status = CASE WHEN kind = 'export' THEN 'not_required' ELSE 'unscanned' END;

-- File d'e-mails : réservation exclusive (plusieurs instances) et clé anti-doublon.
ALTER TABLE email_outbox ADD COLUMN claimed_until timestamptz;
ALTER TABLE email_outbox ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX email_outbox_dedupe_key ON email_outbox (dedupe_key) WHERE dedupe_key IS NOT NULL;
