# Agent instructions

Follow [`CONVENTIONS.md`](./CONVENTIONS.md) and existing repository patterns.
For code changes, read and follow [`skills/ponytail/SKILL.md`](./skills/ponytail/SKILL.md).

## Code Review Rules

- Read [`skills/code-review/SKILL.md`](./skills/code-review/SKILL.md) and the
  Ponytail skill before reviewing.
- Review security, performance, correctness, and maintainability. Report only
  consequential, actionable findings; leave formatting and lint to CI.
- Prefer the smallest root-cause fix. Never suggest speculative abstraction,
  boilerplate, or dependencies without an evidenced need.
- Do not simplify away validation, error handling, security, accessibility, or
  explicit requirements.
