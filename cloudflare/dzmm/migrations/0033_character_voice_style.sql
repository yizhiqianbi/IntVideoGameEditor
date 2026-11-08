-- Existing assets and their fingerprints keep the original Chinese reading voice.
ALTER TABLE character_voice_assets ADD COLUMN voice_id TEXT NOT NULL DEFAULT 'melotts';
