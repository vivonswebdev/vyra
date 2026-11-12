-- VYRA Studio : projets, historique des versions, exports.

CREATE TABLE projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  design        jsonb,
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision      int NOT NULL DEFAULT 0,
  -- Miniature calculée par le serveur à partir du document (jamais fournie par le client).
  thumbnail_svg text,
  thumbnail_revision int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX projects_owner_idx ON projects (owner_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX projects_trash_idx ON projects (owner_id, deleted_at) WHERE deleted_at IS NOT NULL;

-- Points de l'historique : instantanés complets du document (restaurables).
CREATE TABLE project_versions (
  id          bigserial PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision    int NOT NULL,
  label       text,
  name        text NOT NULL,
  design      jsonb,
  settings    jsonb NOT NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_versions_idx ON project_versions (project_id, id DESC);

CREATE TABLE project_exports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES files(id),
  format      text NOT NULL CHECK (format IN ('pes','pes6','dst')),
  revision    int NOT NULL,
  machine_id  text,
  hoop_id     text,
  stats       jsonb NOT NULL,
  qc          jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_exports_idx ON project_exports (project_id, created_at DESC);

CREATE TABLE project_files (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('source')),
  PRIMARY KEY (project_id, file_id)
);
