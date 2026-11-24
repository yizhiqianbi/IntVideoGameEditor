-- Operator console: recharge catalogue, scene prices, tags, official cards,
-- recharge display numbers, and product events. Historical payment rows stay
-- on their existing package checks. New bonus packages that do not fit those
-- checks are saved here and refused at checkout until a ledger migration.

ALTER TABLE home_banners ADD COLUMN desktop_image TEXT CHECK (desktop_image IS NULL OR length(desktop_image) BETWEEN 1 AND 500);
ALTER TABLE home_banners ADD COLUMN mobile_image TEXT CHECK (mobile_image IS NULL OR length(mobile_image) BETWEEN 1 AND 500);
ALTER TABLE home_banners ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));
ALTER TABLE home_banners ADD COLUMN orientation_id TEXT;
CREATE UNIQUE INDEX home_banners_live_position ON home_banners(position) WHERE deleted_at IS NULL;

CREATE TABLE recharge_packages (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 40 AND instr(id, char(0)) = 0),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 100 AND 200000 AND amount_minor % 100 = 0),
  credits INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 100000000),
  bonus_credits INTEGER NOT NULL DEFAULT 0 CHECK (bonus_credits BETWEEN 0 AND 100000000),
  bonus_ratio TEXT NOT NULL DEFAULT '' CHECK (length(bonus_ratio) <= 16),
  weight INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 9999),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);
CREATE INDEX recharge_packages_live ON recharge_packages(weight ASC, created_at DESC, id) WHERE deleted_at IS NULL;

INSERT INTO recharge_packages(id, amount_minor, credits, bonus_credits, bonus_ratio, weight, enabled, created_at, updated_at) VALUES
  ('cny_28', 2800, 2800, 0, '', 1, 1, 0, 0),
  ('cny_88', 8800, 10000, 1200, '13.64', 2, 1, 1, 1),
  ('cny_188', 18800, 30000, 11200, '59.57', 3, 1, 2, 2);

CREATE TABLE recharge_order_labels (
  order_id TEXT PRIMARY KEY CHECK (length(order_id) BETWEEN 8 AND 80),
  public_no TEXT NOT NULL UNIQUE CHECK (length(public_no) = 12 AND public_no NOT GLOB '*[^A-Za-z0-9]*'),
  package_id TEXT CHECK (package_id IS NULL OR length(package_id) BETWEEN 1 AND 40),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

CREATE TABLE credit_scene_prices (
  scene TEXT PRIMARY KEY CHECK (scene IN ('suggestion', 'image', 'video', 'character', 'voice')),
  unit TEXT NOT NULL CHECK (unit IN ('per_k_token', 'per_call')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 0 AND 10000000000),
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 1000000),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
);
INSERT INTO credit_scene_prices(scene, unit, amount_cents, revision, updated_at) VALUES
  ('suggestion', 'per_k_token', 0, 1, 0),
  ('image', 'per_call', 1000, 1, 0),
  ('video', 'per_call', 5000, 1, 0),
  ('character', 'per_call', 0, 1, 0),
  ('voice', 'per_call', 0, 1, 0);

CREATE TABLE credit_model_prices (
  model TEXT PRIMARY KEY CHECK (length(model) BETWEEN 1 AND 120 AND instr(model, char(0)) = 0),
  intro TEXT NOT NULL DEFAULT '' CHECK (length(intro) <= 200),
  price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 0 AND 10000000000),
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 1000000),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
);

CREATE TABLE content_orientations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 20),
  explanation TEXT NOT NULL CHECK (length(trim(explanation)) BETWEEN 1 AND 200),
  icon TEXT NOT NULL DEFAULT '' CHECK (length(icon) <= 500),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX content_orientations_live ON content_orientations(updated_at DESC, id) WHERE deleted_at IS NULL;

INSERT INTO content_orientations(id, name, explanation, icon, created_at, updated_at) VALUES
  ('ori_male', '男性向', '面向男性读者的角色与故事', '', 1, 1),
  ('ori_female', '女性向', '面向女性读者的角色与故事', '', 2, 2),
  ('ori_general', '一般向', '不限读者性向', '', 3, 3);

CREATE TABLE content_subtags (
  id TEXT PRIMARY KEY,
  card_type TEXT NOT NULL CHECK (card_type IN ('tavern', 'companion')),
  orientation_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 16),
  home_filter INTEGER NOT NULL DEFAULT 0 CHECK (home_filter IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX content_subtags_live ON content_subtags(card_type, updated_at DESC, id) WHERE deleted_at IS NULL;

CREATE TABLE content_voices (
  id TEXT PRIMARY KEY,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  intro TEXT NOT NULL DEFAULT '' CHECK (length(intro) <= 200),
  preview_url TEXT NOT NULL DEFAULT '' CHECK (length(preview_url) <= 500),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE TABLE official_characters (
  id TEXT PRIMARY KEY CHECK (id GLOB 'official_*' AND length(id) BETWEEN 10 AND 80),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  card_type TEXT NOT NULL CHECK (card_type IN ('tavern', 'companion')),
  orientation_id TEXT,
  subtags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(subtags_json)),
  status TEXT NOT NULL CHECK (status IN ('listed', 'unlisted', 'deleted')),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  listed_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX official_characters_status ON official_characters(status, created_at DESC, id);

CREATE TABLE review_reject_reasons (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 40),
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
INSERT INTO review_reject_reasons(id, label, created_at) VALUES
  ('reject_incomplete', '内容不完整', 1),
  ('reject_cover', '封面不符合要求', 2),
  ('reject_section', '与所在分区不符', 3),
  ('reject_other', '其他', 4);

CREATE TABLE product_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (name IN (
    'landing', 'chat_open', 'chat_send', 'character_detail', 'character_chat',
    'suggestion_shown', 'suggestion_accepted', 'share_click', 'ttft'
  )),
  user_id TEXT,
  character_id TEXT,
  card_type TEXT CHECK (card_type IS NULL OR card_type IN ('tavern', 'companion')),
  day_key TEXT NOT NULL CHECK (day_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at INTEGER NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json))
);
CREATE INDEX product_events_day ON product_events(day_key, name);

CREATE TABLE ops_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 40),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 80),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL
);
CREATE INDEX ops_audit_time ON ops_audit(created_at DESC, id);
