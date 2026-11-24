-- SillyTavern-style group chat: a conversation can reference multiple characters,
-- and each assistant turn records which member spoke. Both columns are nullable
-- so pre-group rows and older clients keep working unchanged.
ALTER TABLE conversations ADD COLUMN members_json TEXT;
ALTER TABLE messages ADD COLUMN speaker TEXT;
