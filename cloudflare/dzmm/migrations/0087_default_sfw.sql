-- The shelf starts clean. Flipping back to nsfw is one call to /v1/admin/rating.
UPDATE site_settings SET value = 'sfw', updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'content_rating' AND value = 'nsfw';
