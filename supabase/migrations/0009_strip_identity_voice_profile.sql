-- 0009: drop `voice_profile` from the soul file (#94). It was never read — neither
-- prompt builder nor the Vapi channel consumed it, and the wizard only ever sent a
-- hardcoded default. Persona already covers how an employee sounds.
-- Removed from IdentityFile; this strips it from rows written before that change.
update employees set identity = identity - 'voice_profile' where identity ? 'voice_profile';
