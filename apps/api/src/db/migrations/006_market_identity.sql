-- Market LOT 1 : profils professionnels, statuts de vérification et leur historique.
-- Migration additive : aucune donnée existante n'est modifiée ni supprimée.

-- Un compte peut ouvrir un profil professionnel (vendeur, brodeur, atelier, designer…).
CREATE TABLE seller_profiles (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 80),
  kind          text NOT NULL CHECK (kind IN ('independent_embroiderer','workshop','pattern_designer','digitizer',
                                              'file_creator','influencer','brand','textile_company')),
  is_business   boolean NOT NULL,
  country       char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  languages     text[] NOT NULL DEFAULT '{}',
  bio           text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 4000),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','verified','rejected','suspended')),
  status_reason text,
  reviewed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  submitted_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX seller_profiles_slug_key ON seller_profiles (slug);
CREATE INDEX seller_profiles_review_idx ON seller_profiles (submitted_at) WHERE status = 'pending_review';

-- Historique complet des changements de statut (qui, quand, pourquoi) : motivation des décisions de modération.
CREATE TABLE seller_status_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES seller_profiles(user_id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  reason      text NOT NULL DEFAULT '',
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seller_status_events_user_idx ON seller_status_events (user_id, id);

-- Correction : supprimer le compte d'un administrateur qui a attribué des rôles échouait (clé étrangère sans
-- règle). La trace de l'attribution reste dans le journal d'audit.
ALTER TABLE user_roles DROP CONSTRAINT user_roles_granted_by_fkey;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL;
