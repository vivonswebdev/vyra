-- Lot 3 : sessions révocables une à une, double authentification (TOTP), codes de secours,
-- défis de connexion en deux étapes.

ALTER TABLE sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX sessions_id_key ON sessions (id);

-- Le secret TOTP est chiffré (AES-256-GCM, clé SECRET_KEY du serveur) ; jamais stocké en clair.
ALTER TABLE users ADD COLUMN totp_secret_enc text;
ALTER TABLE users ADD COLUMN totp_pending_enc text;
ALTER TABLE users ADD COLUMN totp_enabled_at timestamptz;
-- Dernier pas de temps accepté : un code déjà utilisé ne peut pas être rejoué.
ALTER TABLE users ADD COLUMN totp_last_step bigint;

CREATE TABLE user_recovery_codes (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  bytea NOT NULL,
  used_at    timestamptz
);
CREATE INDEX user_recovery_codes_user_idx ON user_recovery_codes (user_id);

CREATE TABLE mfa_challenges (
  token_hash bytea PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0
);
