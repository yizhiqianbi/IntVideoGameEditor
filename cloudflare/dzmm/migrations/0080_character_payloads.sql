-- Large private cards stay addressable when one D1 row cannot hold the extension JSON.
CREATE TABLE character_payloads (
  user_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  part INTEGER NOT NULL CHECK(part >= 0 AND part < 16),
  body TEXT NOT NULL CHECK(length(body) > 0),
  PRIMARY KEY (user_id, character_id, part),
  FOREIGN KEY (user_id, character_id) REFERENCES characters(user_id, id) ON DELETE CASCADE
);
