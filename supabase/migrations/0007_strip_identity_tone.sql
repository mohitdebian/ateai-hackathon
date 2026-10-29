-- 0007: drop `tone` from the soul file (#38 follow-up). Persona already covers how an
-- employee communicates, so an LLM-generated tone was duplicative context on every turn.
-- Removed from IdentityFile; this strips it from rows written before that change.
update employees set identity = identity - 'tone' where identity ? 'tone';
