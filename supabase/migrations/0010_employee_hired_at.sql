-- 0010: `status` collapsed real hire state into a value that could get stuck
-- forever (#92) — a failed hire left the row in `provisioning` with no way
-- back, and old `draft` rows migrated straight into the same bucket (0006).
-- Replace it with a plain timestamp: null means unhired, set means hired.
alter table employees add column hired_at timestamptz;

-- Backfill from created_at, not updated_at: the touch trigger (0001) stamps
-- updated_at on every edit, so it drifts to "last edited", while created_at is
-- at worst a few minutes before the hire (the wizard is one continuous run).
-- The true hire time was never recorded, so this is the closest stable bound.
update employees set hired_at = created_at where status = 'active';

alter table employees drop constraint if exists employees_status_check;

alter table employees drop column status;
