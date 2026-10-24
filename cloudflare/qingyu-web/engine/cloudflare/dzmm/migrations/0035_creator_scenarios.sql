CREATE TABLE creator_scenarios (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  synopsis TEXT NOT NULL,
  draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,id)
);
CREATE INDEX creator_scenarios_updated ON creator_scenarios(user_id,updated_at DESC);
CREATE TABLE scenario_rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','active','ended')),
  stage_index INTEGER NOT NULL DEFAULT 0 CHECK(stage_index >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  mutation_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX scenario_rooms_host ON scenario_rooms(host_id,updated_at DESC);
CREATE TABLE scenario_members (
  room_id TEXT NOT NULL REFERENCES scenario_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  role_id TEXT,
  is_host INTEGER NOT NULL CHECK(is_host IN (0,1)),
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  PRIMARY KEY(room_id,user_id)
);
CREATE UNIQUE INDEX scenario_members_role ON scenario_members(room_id,role_id) WHERE left_at IS NULL AND role_id IS NOT NULL;
CREATE INDEX scenario_members_user ON scenario_members(user_id,left_at);
CREATE TABLE scenario_events (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES scenario_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  role_id TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('speech','action','narration','stage','system')),
  content TEXT NOT NULL,
  stage_index INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(room_id,user_id,client_id),
  UNIQUE(room_id,seq)
);
CREATE INDEX scenario_events_room ON scenario_events(room_id,seq DESC);
