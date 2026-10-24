-- Creation receipts outlive deleted topics. A lost response can be replayed
-- without creating another public post, and deleted posts cannot be revived.
CREATE TABLE forum_create_requests (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL CHECK(length(request_id)=36),
  request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64),
  post_id TEXT UNIQUE REFERENCES forum_posts(id) ON DELETE SET NULL,
  claim_token TEXT NOT NULL CHECK(length(claim_token)=36),
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  PRIMARY KEY(user_id,request_id)
);
