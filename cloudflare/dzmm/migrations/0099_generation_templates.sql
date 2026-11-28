CREATE TABLE custom_generation_templates (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 4 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  english_label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  group_label TEXT NOT NULL DEFAULT '自定义精选',
  tags_json TEXT NOT NULL DEFAULT '[]',
  aspect_ratio TEXT NOT NULL DEFAULT '3:4',
  prompt_pattern TEXT NOT NULL CHECK (length(prompt_pattern) BETWEEN 1 AND 4000),
  poster_key TEXT,
  poster_content_type TEXT,
  video_key TEXT,
  video_content_type TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX idx_custom_generation_templates_list
  ON custom_generation_templates(enabled, sort_order, updated_at DESC);
