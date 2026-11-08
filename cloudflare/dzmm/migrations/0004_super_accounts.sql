-- Public registration still omits this column and can only create ordinary users.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'super'));
