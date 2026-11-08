-- Optional model-authored story state augments conversations without changing their messages.
ALTER TABLE conversations ADD COLUMN story_memory_json TEXT
  CHECK(story_memory_json IS NULL OR (json_valid(story_memory_json) AND json_type(story_memory_json) = 'object'));
