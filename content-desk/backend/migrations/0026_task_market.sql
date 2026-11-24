PRAGMA foreign_keys = ON;

-- Platform-approved community rewards, deliberately independent from Credit.
CREATE TABLE task_market_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 4000),
  requirements TEXT NOT NULL CHECK(length(requirements) BETWEEN 1 AND 2000),
  category TEXT NOT NULL CHECK(category IN ('roleplay','writing','feedback')),
  character_id TEXT,
  character_kind TEXT CHECK(character_kind IN ('static','published')),
  character_name TEXT,
  reward_points INTEGER NOT NULL CHECK(reward_points IN (5,10,20)),
  slots INTEGER NOT NULL CHECK(slots BETWEEN 1 AND 20),
  deadline_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','open','cancelled','rejected')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  mutation_token TEXT NOT NULL,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at INTEGER,
  review_reason TEXT NOT NULL DEFAULT '' CHECK(length(review_reason)<=2000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id,request_id),
  CHECK(deadline_at>created_at),
  CHECK((character_id IS NULL AND character_kind IS NULL AND character_name IS NULL)
    OR (character_id IS NOT NULL AND character_kind IS NOT NULL AND character_name IS NOT NULL)),
  CHECK(status NOT IN ('open','rejected') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX task_market_list ON task_market_tasks(status,created_at DESC,id);
CREATE INDEX task_market_owner ON task_market_tasks(user_id,created_at DESC,id);

CREATE TABLE task_market_assignments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task_market_tasks(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('claimed','submitted','returned','approved','withdrawn')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  mutation_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  submitted_at INTEGER,
  reviewed_at INTEGER,
  review_reason TEXT NOT NULL DEFAULT '' CHECK(length(review_reason)<=2000),
  reward_points INTEGER NOT NULL CHECK(reward_points IN (5,10,20)),
  UNIQUE(task_id,user_id),
  CHECK(status NOT IN ('submitted','returned','approved') OR (submitted_at IS NOT NULL AND revision>=1))
);
CREATE INDEX task_market_slots ON task_market_assignments(task_id,status);
CREATE INDEX task_market_participant ON task_market_assignments(user_id,updated_at DESC);

CREATE TABLE task_market_submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES task_market_assignments(id),
  revision INTEGER NOT NULL CHECK(revision>=1),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 12000 AND instr(body,char(0))=0),
  created_at INTEGER NOT NULL,
  UNIQUE(assignment_id,revision)
);

CREATE TABLE task_market_reviews (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task_market_tasks(id),
  assignment_id TEXT REFERENCES task_market_assignments(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('platform','submission','cancel')),
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected','returned','cancelled')),
  reason TEXT NOT NULL CHECK(length(reason)<=2000),
  created_at INTEGER NOT NULL
);
CREATE INDEX task_market_reviews_task ON task_market_reviews(task_id,created_at,id);

CREATE TABLE task_market_rewards (
  assignment_id TEXT PRIMARY KEY REFERENCES task_market_assignments(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL REFERENCES task_market_tasks(id),
  points INTEGER NOT NULL CHECK(points IN (5,10,20)),
  claimed_at INTEGER NOT NULL,
  expires_at INTEGER CHECK(expires_at IS NULL)
);
CREATE INDEX task_market_rewards_owner ON task_market_rewards(user_id,claimed_at DESC);

CREATE TABLE task_market_hidden (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES task_market_tasks(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,task_id)
);
