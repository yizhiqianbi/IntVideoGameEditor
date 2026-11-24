CREATE TABLE novels (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 120 AND instr(id, char(0)) = 0),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120 AND length(trim(title)) > 0 AND instr(title, char(0)) = 0),
  synopsis TEXT NOT NULL CHECK (length(synopsis) <= 4000 AND instr(synopsis, char(0)) = 0),
  type TEXT NOT NULL CHECK (type IN ('novel', 'story')),
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array' AND json_array_length(tags_json) <= 20),
  notes TEXT NOT NULL CHECK (length(notes) <= 8000 AND instr(notes, char(0)) = 0),
  outline TEXT NOT NULL CHECK (length(outline) <= 20000 AND instr(outline, char(0)) = 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  mutation_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX novels_updated ON novels(user_id, updated_at DESC, id);

CREATE TABLE novel_chapters (
  user_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 120 AND instr(id, char(0)) = 0),
  title TEXT NOT NULL CHECK (length(title) <= 120 AND instr(title, char(0)) = 0),
  content TEXT NOT NULL CHECK (length(content) <= 50000 AND instr(content, char(0)) = 0),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 99),
  word_count INTEGER NOT NULL CHECK (word_count >= 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, work_id, id),
  FOREIGN KEY (user_id, work_id) REFERENCES novels(user_id, id) ON DELETE CASCADE
);
CREATE INDEX novel_chapters_position ON novel_chapters(user_id, work_id, position, id);
