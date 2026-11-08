ALTER TABLE character_publications ADD COLUMN display_heat INTEGER NOT NULL DEFAULT 0 CHECK (display_heat BETWEEN 0 AND 100000000);
ALTER TABLE character_publications ADD COLUMN display_likes INTEGER NOT NULL DEFAULT 0 CHECK (display_likes BETWEEN 0 AND 100000000);
