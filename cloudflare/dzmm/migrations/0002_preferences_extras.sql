-- Existing preference rows retain the original five fields and get no optional extras.
ALTER TABLE preferences ADD COLUMN extra_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object');
