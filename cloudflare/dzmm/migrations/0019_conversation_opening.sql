-- Keep each conversation's chosen opening independent from later character revisions.
ALTER TABLE conversations ADD COLUMN opening_json TEXT;
