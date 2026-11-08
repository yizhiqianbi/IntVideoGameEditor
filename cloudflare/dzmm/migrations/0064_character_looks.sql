CREATE TABLE character_looks (
  publication_id TEXT PRIMARY KEY REFERENCES character_publications(id) ON DELETE CASCADE,
  look TEXT NOT NULL CHECK (look IN ('anime', 'photo'))
);
