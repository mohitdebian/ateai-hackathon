-- Allow 'web' as a first-class channel in the events table for direct in-dashboard web chat.
alter table events drop constraint if exists events_channel_check;
alter table events add constraint events_channel_check check (channel in ('email', 'slack', 'voice', 'heartbeat', 'web'));
