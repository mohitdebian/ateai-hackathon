-- AI managers are no longer supported (#201). Existing rows that pointed at an
-- AI manager cannot be reassigned safely, so leave them unassigned rather than
-- retaining a polymorphic id that the application would treat as a user id.
update employees set manager_id = null where manager_type = 'ai';

update employees
set identity = jsonb_set(
  identity,
  '{manager}',
  jsonb_build_object('id', coalesce(manager_id::text, '')),
  true
);

alter table employees drop column if exists manager_type;
