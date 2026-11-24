-- Pictures and videos generated with a character. Rows do not reference
-- messages, so deleting a conversation leaves the album in place.
CREATE TABLE relationship_album (
  id TEXT PRIMARY KEY CHECK(length(id)=36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL CHECK(length(character_id) BETWEEN 1 AND 120 AND instr(character_id, char(0))=0),
  kind TEXT NOT NULL CHECK(kind IN ('image','video')),
  object_key TEXT NOT NULL CHECK(length(object_key) BETWEEN 1 AND 512),
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','image/gif','video/mp4')),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  source_asset_id TEXT,
  UNIQUE(user_id, source_asset_id),
  UNIQUE(user_id, object_key)
);
CREATE INDEX relationship_album_owner ON relationship_album(user_id, character_id, created_at DESC, id DESC);

INSERT OR IGNORE INTO relationship_album (id, user_id, character_id, kind, object_key, mime_type, created_at, source_asset_id)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6))),
  a.user_id, c.character_id, 'image', a.object_key, a.mime_type, a.created_at, a.id
FROM chat_media_assets a
JOIN conversations c ON c.user_id = a.user_id AND c.id = a.conversation_id
WHERE a.status = 'ready' AND a.kind = 'image'
  AND a.mime_type IN ('image/jpeg','image/png','image/webp')
  AND length(c.character_id) BETWEEN 1 AND 120
  AND instr(c.character_id, char(0)) = 0
  AND length(a.object_key) BETWEEN 1 AND 512;
