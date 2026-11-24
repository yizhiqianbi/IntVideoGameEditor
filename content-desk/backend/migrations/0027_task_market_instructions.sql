-- Optional authoring metadata. Existing tasks keep their original prose and
-- request fingerprints; no stage state or automatic reward logic is added.
ALTER TABLE task_market_tasks ADD COLUMN instructions_json TEXT NOT NULL
  DEFAULT '{"goal":"","constraints":[],"rules":[]}'
  CHECK(json_valid(instructions_json)
    AND json_type(instructions_json)='object'
    AND coalesce(json_type(instructions_json,'$.goal'),'')='text'
    AND coalesce(json_type(instructions_json,'$.constraints'),'')='array'
    AND coalesce(json_type(instructions_json,'$.rules'),'')='array'
    AND length(json_extract(instructions_json,'$.goal'))<=4000
    AND json_array_length(instructions_json,'$.constraints')<=10
    AND json_array_length(instructions_json,'$.rules')<=20
    AND length(instructions_json)<=64000);
