-- 0008: recurring tasks and daily responsibilities were the same thing (#47).
-- Fold any recurring_tasks values onto daily_responsibilities, then drop the key.
--
-- Both arms are type-guarded because employees.identity defaults to '{}'::jsonb
-- (0001_tier1_schema.sql) — a row can carry the key with a non-array value, and
-- `||` on a non-array silently produces garbage rather than erroring.
update employees
set identity = (identity - 'recurring_tasks') || jsonb_build_object(
  'daily_responsibilities',
  case when jsonb_typeof(identity->'daily_responsibilities') = 'array'
       then identity->'daily_responsibilities' else '[]'::jsonb end
  ||
  case when jsonb_typeof(identity->'recurring_tasks') = 'array'
       then identity->'recurring_tasks' else '[]'::jsonb end
)
where identity ? 'recurring_tasks';
