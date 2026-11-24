-- SillyTavern-style swipes: one assistant turn can carry several variant replies.
-- Nullable so existing rows and older clients keep working.
ALTER TABLE messages ADD COLUMN swipes_json TEXT;
ALTER TABLE messages ADD COLUMN swipe_index INTEGER;
