-- In-app episode starts. Paid unlocks stay in video_episode_unlocks.
-- Direct downloads of the public media host are not in this table.
CREATE TABLE video_plays (
  id TEXT PRIMARY KEY CHECK(length(id)=36),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL CHECK(length(episode_id) BETWEEN 8 AND 24),
  drama_id TEXT NOT NULL CHECK(length(drama_id) BETWEEN 7 AND 16),
  episode_number INTEGER NOT NULL CHECK(episode_number BETWEEN 1 AND 999),
  access TEXT NOT NULL CHECK(access IN ('free','vip','paid')),
  created_at INTEGER NOT NULL CHECK(created_at>=0)
);
CREATE INDEX video_plays_recent ON video_plays(created_at DESC);
CREATE INDEX video_plays_user ON video_plays(user_id, created_at DESC);
CREATE INDEX video_plays_episode ON video_plays(user_id, episode_id, created_at DESC);
