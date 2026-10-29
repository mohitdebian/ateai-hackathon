# Conventions

## What "simple" means here

This is the project's first principle. Do the minimum needed for the task and
nothing more.

- **Minimum viable code.** Solve the problem in front of you, not the ones you
  imagine. No speculative abstraction, no "we might need it later" hooks.
- **Non-redundant.** One way to do a thing. Reuse existing utilities and the
  `@ate/shared` contracts before writing new ones. If you copy-paste, stop and
  extract instead.
- **Simple logic.** Prefer the straightforward implementation over the clever
  one. Flat over nested. Fewer moving parts over more.
- **Efficient.** Don't do redundant work (repeat fetches, re-parse, re-render).
  But don't micro-optimize what isn't hot — clarity first, then measured speed.
- **No new dependencies without lead sign-off.** Reach for the standard library
  and what's already installed. A new package is a maintenance and security cost;
  justify it.

When two approaches both work, the smaller one wins.

## Naming

- Files/dirs: `kebab-case`. React components: `PascalCase.tsx`.
- Types/interfaces: `PascalCase`. Variables/functions: `camelCase`.
- Database columns and envelope fields: `snake_case` (matches Supabase/spec).
- No abbreviations that aren't already in the spec (`org_id`, `employee_id` are fine).

## Error handling

- Fail loud, not silent. Never swallow an error to keep a happy path green.
- Throw or return a typed error; let it surface to a boundary that logs it.
- Guardrail denials and worker failures are **logged as events**, never hidden
  (see the spec's guardrail principle — nothing silently swallowed).

## Writing

Applies to comments, docs, issues, and PR bodies.

- **Comments say why, not what.** Code already says what it does. A comment
  earns its line by adding what the code can't show — a constraint, a footgun, a
  reason the obvious approach fails.

  ```ts
  // Bad:  Increment the retry counter
  // Good: Composio 429s are transient — retry rather than fail the turn
  retries++
  ```

- **Docs are the source; comments point at it.** If `docs/architecture.md`
  explains a seam, the comment gives one line of local context and stops.
  Restating the doc creates a second copy that goes stale and contradicts the
  first.
- **The ratchet.** A change that removes functionality must not add comment
  lines. Deleted code takes its comments with it.
- **Issues and PRs: say it straight.** State the problem, its impact, and how to
  reproduce or verify. No preamble, no restating the title, no narrating your
  reasoning, no summary of what you just said. Cut every sentence that doesn't
  tell the reader something they need. Length follows the problem — a complex bug
  gets more words, a one-line fix gets three sentences.

  ```text
  Bad:  In order to ensure that we're able to properly handle the situation
        where a user's connection hasn't yet completed, it may be worth
        considering whether we should perhaps add a check...
  Good: Register the Composio connection only after OAuth completes. Today a
        half-finished connection shows as active and the next turn fails.
  ```

- **Clear beats short.** Concision is the goal; clarity is the requirement. If
  cutting a word costs the reader understanding, keep it. Prefer normal language
  over compressed jargon — "the worker retries" beats "retry semantics are
  enforced at the worker boundary".

## File organization

- Colocate by feature, not by type, inside an app.
- Shared cross-app types and seams live in `packages/shared` only.
- `packages/design` contains shared tokens and base components.

## Contracts

The interfaces in `packages/shared` (`Envelope`, `IdentityFile`, `MemoryClient`,
`KnowledgeRetriever`, `EventLogger`, and the connector registry) are the seams
the team builds behind. **Changing a contract requires lead sign-off** — a change
ripples into every consumer.

## Pull requests

- **Small PRs, vertical slices.** One reviewable change that does one thing end
  to end. Split large work.
- **Feature branches only.** Branch from `dev` as `feature/<issue#>-<short-desc>`
  and open a PR **against `dev`** whose body includes `Fixes #N`; merge only
  after review (squash preferred, delete the branch). `main` is production and
  receives `dev` through a release PR — never push to either directly.
- **Green before merge.** Lint, typecheck, build, and the Vercel preview deploy
  must pass in CI.
- **No new dependencies without lead sign-off** (repeated here because it's the
  rule most often broken).
