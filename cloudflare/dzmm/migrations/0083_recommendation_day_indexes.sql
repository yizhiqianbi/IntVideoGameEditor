-- Recommendation reads filter by Shanghai day. The primary key starts with
-- character_id, so a day window used to scan the whole aggregate.
CREATE INDEX recommendation_item_daily_day ON recommendation_item_daily(day_key, character_id);
CREATE INDEX character_chat_rounds_day ON character_chat_rounds(day_key, character_id);
