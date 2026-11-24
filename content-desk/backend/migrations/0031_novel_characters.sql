ALTER TABLE novels ADD COLUMN characters_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(characters_json) AND json_type(characters_json) = 'array' AND json_array_length(characters_json) <= 30);
