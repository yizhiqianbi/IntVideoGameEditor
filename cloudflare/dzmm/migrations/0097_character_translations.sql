-- Automatic multilingual translations generated for published character submissions.
-- Keyed by (publication_id, revision, locale) so each submitted/approved revision
-- keeps immutable, idempotent localized metadata for the SPA and Edge SEO pages.
CREATE TABLE IF NOT EXISTS character_translations (
  publication_id TEXT NOT NULL REFERENCES character_publications(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  locale TEXT NOT NULL CHECK (locale IN ('en', 'zh-Hans', 'zh-Hant', 'ja', 'ko')),
  name TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array'),
  description TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  scenario TEXT NOT NULL DEFAULT '',
  first_message TEXT NOT NULL DEFAULT '',
  source_hash TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (publication_id, revision, locale)
);

CREATE INDEX IF NOT EXISTS character_translations_pub_rev
  ON character_translations(publication_id, revision);
