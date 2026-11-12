-- VYRA — socle commun : comptes, sessions, jetons, e-mails sortants, fichiers, journal d'audit.
-- Conventions : identifiants uuid, horodatages timestamptz, suppression logique (deleted_at)
-- pour les données utilisateur, montants en centimes (bigint).

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL,
  password_hash     text NOT NULL,
  display_name      text NOT NULL,
  email_verified_at timestamptz,
  locale            text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr','nl','en','ar')),
  theme             text NOT NULL DEFAULT 'auto' CHECK (theme IN ('auto','light','dark')),
  preferences       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  failed_logins     int NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('seller','moderator','admin')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES users(id),
  PRIMARY KEY (user_id, role)
);

-- Le jeton de session n'est jamais stocké : seulement son empreinte SHA-256.
CREATE TABLE sessions (
  token_hash   bytea PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE auth_tokens (
  token_hash bytea PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, purpose);

-- File d'envoi des e-mails : écrite dans la même transaction que l'action qui la déclenche.
CREATE TABLE email_outbox (
  id          bigserial PRIMARY KEY,
  to_email    text NOT NULL,
  template    text NOT NULL,
  subject     text NOT NULL,
  body_text   text NOT NULL,
  body_html   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  attempts    int NOT NULL DEFAULT 0,
  last_error  text
);
CREATE INDEX email_outbox_pending_idx ON email_outbox (created_at) WHERE sent_at IS NULL;

-- Fichiers : le contenu vit dans le stockage objet (jamais public) ; ceci en est l'index.
CREATE TABLE files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('source_image','export','thumbnail','product_file','product_preview','product_image')),
  storage_key text NOT NULL UNIQUE,
  filename    text NOT NULL,
  mime        text NOT NULL,
  size_bytes  bigint NOT NULL CHECK (size_bytes >= 0),
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX files_owner_idx ON files (owner_id, kind) WHERE deleted_at IS NULL;

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  subject    text,
  ip         text,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, at DESC);
CREATE INDEX audit_log_subject_idx ON audit_log (subject, at DESC);
