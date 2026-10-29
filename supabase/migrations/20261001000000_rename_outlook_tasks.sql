alter table outlook_tasks rename to email_tasks;
alter index outlook_tasks_pkey rename to email_tasks_pkey;
alter index outlook_tasks_connected_account_id_task_key_key rename to email_tasks_connected_account_id_task_key_key;
alter index outlook_tasks_work_idx rename to email_tasks_work_idx;
alter index outlook_tasks_slack_idx rename to email_tasks_slack_idx;

alter table email_tasks add column provider text not null default 'outlook' check (provider in ('outlook', 'gmail'));
