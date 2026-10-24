CREATE TABLE creator_games (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 120 AND instr(id, char(0)) = 0),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120 AND length(trim(title)) > 0 AND instr(title, char(0)) = 0),
  synopsis TEXT NOT NULL CHECK (length(synopsis) <= 4000 AND instr(synopsis, char(0)) = 0),
  source TEXT NOT NULL CHECK (length(CAST(source AS BLOB)) <= 262144 AND instr(source, char(0)) = 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX creator_games_updated ON creator_games(user_id, updated_at DESC, id);
