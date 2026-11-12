-- Lot 3 : nuanciers de fils importés (CSV) par chaque utilisateur, avec source obligatoire.
CREATE TABLE thread_charts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand       text NOT NULL CHECK (length(brand) BETWEEN 1 AND 120),
  product     text NOT NULL CHECK (length(product) BETWEEN 1 AND 160),
  status      text NOT NULL CHECK (status IN ('officiel', 'approximatif', 'utilisateur')),
  source      text NOT NULL CHECK (length(source) BETWEEN 3 AND 500),
  source_url  text,
  entries     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX thread_charts_owner_idx ON thread_charts (owner_id, created_at DESC);
