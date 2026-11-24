CREATE TABLE studio_covers (
  slot TEXT PRIMARY KEY CHECK (slot IN ('member', 'recharge', 'invite', 'role', 'generate', 'novel', 'girlfriend', 'scenario')),
  image_key TEXT NOT NULL CHECK (length(image_key) BETWEEN 8 AND 80),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
