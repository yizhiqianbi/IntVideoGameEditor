-- Optional checkpoints preserve original messages and leave existing conversations untouched.
ALTER TABLE conversations ADD COLUMN world_state_json TEXT;
ALTER TABLE conversations ADD COLUMN world_clock_mode TEXT
  CHECK (world_clock_mode IS NULL OR world_clock_mode IN ('story', 'realtime'));
