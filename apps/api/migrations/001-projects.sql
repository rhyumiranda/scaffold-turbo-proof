CREATE TABLE projects (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL CHECK (char_length(owner_id) BETWEEN 1 AND 200),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100 AND name = btrim(name)),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_owner_order ON projects(owner_id, created_at DESC, id DESC);
