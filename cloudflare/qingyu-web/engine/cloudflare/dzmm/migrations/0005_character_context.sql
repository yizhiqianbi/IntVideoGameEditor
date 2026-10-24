-- Preserve existing private cards while adding declared author context and display metadata.
ALTER TABLE characters ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}'
  CHECK(json_valid(context_json) AND json_type(context_json) = 'object');
