-- 0006: hiring is now one continuous flow, no draft employees (#38).
-- Guarded with if exists/conditional checks since prior renumbering (#69)
-- left some environments with stale constraint-name stamps.
update employees set status = 'provisioning' where status = 'draft';

alter table employees alter column status drop default;

alter table employees drop constraint if exists employees_status_check;

alter table employees
  add constraint employees_status_check
  check (status in ('provisioning', 'active', 'paused'));

alter table employees alter column status set default 'provisioning';
