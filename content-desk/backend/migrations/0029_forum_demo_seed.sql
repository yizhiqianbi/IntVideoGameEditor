-- Official fictional authors are public content attribution, never login identities.
-- The sealed batch INSERT is one atomic SQLite statement, including expansion.
CREATE TABLE forum_demo_seed_chunks (
  batch_id TEXT NOT NULL CHECK(length(batch_id) BETWEEN 1 AND 80 AND batch_id NOT GLOB '*[^a-z0-9-]*'),
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 127),
  dataset_sha256 TEXT NOT NULL CHECK(length(dataset_sha256)=64 AND dataset_sha256 NOT GLOB '*[^a-f0-9]*'),
  chunk_sha256 TEXT NOT NULL CHECK(length(chunk_sha256)=64 AND chunk_sha256 NOT GLOB '*[^a-f0-9]*'),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 16384),
  PRIMARY KEY(batch_id,position)
);
CREATE TRIGGER forum_demo_chunk_conflict BEFORE INSERT ON forum_demo_seed_chunks
WHEN EXISTS(SELECT 1 FROM forum_demo_seed_chunks c WHERE c.batch_id=NEW.batch_id AND c.position=NEW.position
  AND (c.dataset_sha256<>NEW.dataset_sha256 OR c.chunk_sha256<>NEW.chunk_sha256 OR c.content<>NEW.content))
BEGIN SELECT RAISE(ABORT,'Demo chunk conflicts with sealed data'); END;
CREATE TRIGGER forum_demo_chunk_immutable BEFORE UPDATE ON forum_demo_seed_chunks
BEGIN SELECT RAISE(ABORT,'Demo seed chunks are immutable'); END;

CREATE TABLE forum_demo_batches (
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 80 AND id NOT GLOB '*[^a-z0-9-]*'),
  dataset_sha256 TEXT NOT NULL CHECK(length(dataset_sha256)=64 AND dataset_sha256 NOT GLOB '*[^a-f0-9]*'),
  source_batch_id TEXT NOT NULL CHECK(length(source_batch_id) BETWEEN 1 AND 80),
  manifest_json TEXT NOT NULL CHECK(COALESCE(json_valid(manifest_json) AND json_type(manifest_json)='object'
    AND json_extract(manifest_json,'$.schemaVersion')=1 AND json_extract(manifest_json,'$.isDemo')=1
    AND json_extract(manifest_json,'$.batchId')=id AND json_extract(manifest_json,'$.sourceBatchId')=source_batch_id
    AND json_extract(manifest_json,'$.provenance.kind')='fictional-demo'
    AND json_extract(manifest_json,'$.provenance.source')='original'
    AND json_extract(manifest_json,'$.provenance.batchId')=id
    AND json_array_length(manifest_json,'$.profiles')=100
    AND json_array_length(manifest_json,'$.posts')=140
    AND json_array_length(manifest_json,'$.replies')=180,0)=1),
  imported_at INTEGER NOT NULL CHECK(typeof(imported_at)='integer' AND imported_at>0)
);
CREATE TRIGGER forum_demo_batch_conflict BEFORE INSERT ON forum_demo_batches
WHEN EXISTS(SELECT 1 FROM forum_demo_batches b WHERE b.id=NEW.id
  AND (b.dataset_sha256<>NEW.dataset_sha256 OR b.source_batch_id<>NEW.source_batch_id OR b.manifest_json<>NEW.manifest_json))
BEGIN SELECT RAISE(ABORT,'Demo batch conflicts with sealed data'); END;
CREATE TRIGGER forum_demo_batch_immutable BEFORE UPDATE ON forum_demo_batches
BEGIN SELECT RAISE(ABORT,'Demo batches are immutable'); END;

ALTER TABLE users ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1));
ALTER TABLE users ADD COLUMN demo_batch_id TEXT REFERENCES forum_demo_batches(id);
ALTER TABLE forum_posts ADD COLUMN demo_batch_id TEXT REFERENCES forum_demo_batches(id);
ALTER TABLE forum_replies ADD COLUMN demo_batch_id TEXT REFERENCES forum_demo_batches(id);
CREATE INDEX users_demo_batch ON users(demo_batch_id) WHERE is_demo=1;
CREATE INDEX forum_posts_demo_batch ON forum_posts(demo_batch_id) WHERE demo_batch_id IS NOT NULL;
CREATE INDEX forum_replies_demo_batch ON forum_replies(demo_batch_id) WHERE demo_batch_id IS NOT NULL;
CREATE TABLE forum_demo_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL REFERENCES forum_demo_batches(id),
  bio TEXT NOT NULL CHECK(length(bio) BETWEEN 1 AND 1000 AND instr(bio,char(0))=0),
  genres_json TEXT NOT NULL CHECK(json_valid(genres_json) AND json_type(genres_json)='array')
);
CREATE TRIGGER forum_demo_user_shape BEFORE INSERT ON users
WHEN (NEW.is_demo=1 AND (NEW.demo_batch_id IS NULL OR NEW.email IS NOT NULL OR NEW.password_hash IS NOT NULL
  OR NEW.email_verified_at IS NOT NULL OR NEW.is_guest<>1 OR NEW.role<>'user' OR NEW.version<>0 OR NEW.mutation_token<>''))
  OR (NEW.is_demo=0 AND NEW.demo_batch_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot have account credentials'); END;
CREATE TRIGGER forum_demo_user_immutable BEFORE UPDATE ON users
WHEN OLD.is_demo=1 OR NEW.is_demo<>OLD.is_demo OR NEW.demo_batch_id IS NOT OLD.demo_batch_id
BEGIN SELECT RAISE(ABORT,'Demo authors cannot become login accounts'); END;
CREATE TRIGGER forum_demo_profile_owner BEFORE INSERT ON forum_demo_profiles
WHEN NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1 AND u.demo_batch_id=NEW.batch_id)
BEGIN SELECT RAISE(ABORT,'Demo profile must belong to its sealed batch'); END;
CREATE TRIGGER forum_demo_post_owner BEFORE INSERT ON forum_posts
WHEN (NEW.demo_batch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1 AND u.demo_batch_id=NEW.demo_batch_id))
  OR (NEW.demo_batch_id IS NULL AND EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1))
BEGIN SELECT RAISE(ABORT,'Demo post attribution must match its batch'); END;
CREATE TRIGGER forum_demo_reply_owner BEFORE INSERT ON forum_replies
WHEN (NEW.demo_batch_id IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1 AND u.demo_batch_id=NEW.demo_batch_id)
  OR NOT EXISTS(SELECT 1 FROM forum_posts p WHERE p.id=NEW.post_id AND p.demo_batch_id=NEW.demo_batch_id)))
  OR (NEW.demo_batch_id IS NULL AND EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1))
BEGIN SELECT RAISE(ABORT,'Demo reply attribution must match its batch'); END;

CREATE TRIGGER forum_demo_batch_expand AFTER INSERT ON forum_demo_batches
BEGIN
  INSERT INTO users(id,email,password_hash,nickname,is_guest,role,version,created_at,is_demo,demo_batch_id)
    SELECT json_extract(v.value,'$.id'),NULL,NULL,json_extract(v.value,'$.nickname'),1,'user',0,NEW.imported_at,1,NEW.id
    FROM json_each(NEW.manifest_json,'$.profiles') v;
  INSERT INTO forum_demo_profiles(user_id,batch_id,bio,genres_json)
    SELECT json_extract(v.value,'$.id'),NEW.id,json_extract(v.value,'$.bio'),json_extract(v.value,'$.genres')
    FROM json_each(NEW.manifest_json,'$.profiles') v;
  INSERT INTO forum_posts(id,user_id,title,body,category,created_at,updated_at,demo_batch_id)
    SELECT json_extract(v.value,'$.id'),json_extract(v.value,'$.authorId'),json_extract(v.value,'$.title'),json_extract(v.value,'$.body'),json_extract(v.value,'$.category'),NEW.imported_at,NEW.imported_at,NEW.id
    FROM json_each(NEW.manifest_json,'$.posts') v;
  INSERT INTO forum_post_tags(post_id,tag)
    SELECT json_extract(v.value,'$.id'),t.value FROM json_each(NEW.manifest_json,'$.posts') v,json_each(v.value,'$.tags') t;
  INSERT INTO forum_replies(id,post_id,user_id,body,created_at,demo_batch_id)
    SELECT json_extract(v.value,'$.id'),json_extract(v.value,'$.postId'),json_extract(v.value,'$.authorId'),json_extract(v.value,'$.body'),NEW.imported_at,NEW.id
    FROM json_each(NEW.manifest_json,'$.replies') v;
END;

-- Reversal is allowed only before real participation and while seed rows still
-- match the sealed original. Refuse rather than cascade-delete a real reply.
CREATE TRIGGER forum_demo_batch_remove BEFORE DELETE ON forum_demo_batches
BEGIN
  -- Keep the guard free of CASE ... END: the remote D1 query parser may
  -- mistake that END for the trigger terminator while splitting migrations.
  SELECT RAISE(ABORT,'Demo rollback refused: content changed or real participation exists') WHERE
    (SELECT COUNT(*) FROM users WHERE is_demo=1 AND demo_batch_id=OLD.id)<>100
    OR (SELECT COUNT(*) FROM forum_posts WHERE demo_batch_id=OLD.id)<>140
    OR (SELECT COUNT(*) FROM forum_replies WHERE demo_batch_id=OLD.id)<>180
    OR EXISTS(SELECT 1 FROM forum_posts p JOIN forum_replies r ON r.post_id=p.id WHERE p.demo_batch_id=OLD.id AND r.demo_batch_id IS NULL)
    OR EXISTS(SELECT 1 FROM forum_posts p JOIN forum_votes v ON v.post_id=p.id WHERE p.demo_batch_id=OLD.id)
    OR EXISTS(SELECT 1 FROM forum_posts p JOIN forum_reports r ON r.post_id=p.id WHERE p.demo_batch_id=OLD.id)
    OR EXISTS(SELECT 1 FROM json_each(OLD.manifest_json,'$.posts') v LEFT JOIN forum_posts p ON p.id=json_extract(v.value,'$.id')
      WHERE p.id IS NULL OR p.title<>json_extract(v.value,'$.title') OR p.body<>json_extract(v.value,'$.body') OR p.category<>json_extract(v.value,'$.category')
      OR p.user_id<>json_extract(v.value,'$.authorId') OR p.created_at<>OLD.imported_at OR p.updated_at<>OLD.imported_at
      OR (SELECT COUNT(*) FROM forum_post_tags t WHERE t.post_id=p.id)<>json_array_length(v.value,'$.tags')
      OR EXISTS(SELECT 1 FROM json_each(v.value,'$.tags') t WHERE NOT EXISTS(SELECT 1 FROM forum_post_tags x WHERE x.post_id=p.id AND x.tag=t.value)))
    OR EXISTS(SELECT 1 FROM json_each(OLD.manifest_json,'$.replies') v LEFT JOIN forum_replies r ON r.id=json_extract(v.value,'$.id')
      WHERE r.id IS NULL OR r.body<>json_extract(v.value,'$.body') OR r.user_id<>json_extract(v.value,'$.authorId')
      OR r.post_id<>json_extract(v.value,'$.postId') OR r.created_at<>OLD.imported_at)
  ;
  DELETE FROM forum_replies WHERE demo_batch_id=OLD.id;
  DELETE FROM forum_posts WHERE demo_batch_id=OLD.id;
  DELETE FROM users WHERE is_demo=1 AND demo_batch_id=OLD.id;
  DELETE FROM forum_demo_seed_chunks WHERE batch_id=OLD.id;
END;

CREATE TRIGGER forum_demo_deny_sessions_insert BEFORE INSERT ON sessions
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_sessions_update BEFORE UPDATE ON sessions
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_forum_votes_insert BEFORE INSERT ON forum_votes
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_forum_votes_update BEFORE UPDATE ON forum_votes
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_payment_orders_insert BEFORE INSERT ON payment_orders
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_payment_orders_update BEFORE UPDATE ON payment_orders
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_zpay_orders_insert BEFORE INSERT ON zpay_orders
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_zpay_orders_update BEFORE UPDATE ON zpay_orders
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_subscription_orders_insert BEFORE INSERT ON subscription_orders
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_subscription_orders_update BEFORE UPDATE ON subscription_orders
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_payment_credit_ledger_insert BEFORE INSERT ON payment_credit_ledger
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_payment_credit_ledger_update BEFORE UPDATE ON payment_credit_ledger
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_zpay_credit_ledger_insert BEFORE INSERT ON zpay_credit_ledger
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_zpay_credit_ledger_update BEFORE UPDATE ON zpay_credit_ledger
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_subscription_credit_ledger_insert BEFORE INSERT ON subscription_credit_ledger
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_subscription_credit_ledger_update BEFORE UPDATE ON subscription_credit_ledger
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_admin_credit_adjustments_insert BEFORE INSERT ON admin_credit_adjustments
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_admin_credit_adjustments_update BEFORE UPDATE ON admin_credit_adjustments
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_trusted_credit_grants_insert BEFORE INSERT ON trusted_credit_grants
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;

CREATE TRIGGER forum_demo_deny_trusted_credit_grants_update BEFORE UPDATE ON trusted_credit_grants
WHEN EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id AND u.is_demo=1)
BEGIN SELECT RAISE(ABORT,'Demo authors cannot authenticate, transact or vote'); END;
