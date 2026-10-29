# Product

ate.ai is a digital workforce platform. A company writes a job description and
an AI employee is created, trained, given access to the company's systems, and
hired into the org chart. From then on it works like anyone else on the team:
its own email address, its own presence in the company's chat, its own voice on
calls. There is no app for interacting with the employee — you email it, message
it, call it. The platform (web only) is the management surface: hire, onboard,
observe.

Access is by invitation. Every customer is set up by us, with the channels and
tools their work actually needs, including ones built for them. Which channels
and tools exist changes constantly; that each customer gets the ones they need
does not.

**Status:** tracked in GitHub issues — closed issues are what shipped, open
issues are what remains (`gh issue list` / `gh issue list --state closed`).
Ideas that are not committed to live in [`future.md`](./future.md).

## Design thesis

Hiring an AI employee should feel identical to hiring a real person. Someone
who has hired and onboarded people before should be able to use this platform
without learning anything new — first use should feel like they've been using
it the whole time.

The end state is no UI: digital employees indistinguishable from remote human
employees. The platform is an MVP until then, so everything stays minimal.

- **Human, not technical.** No agent jargon, model settings, or prompts
  surfaced to the user — job descriptions, onboarding, training, org charts.
  Humanize the AI; make it something people feel good using.
- **Simplicity.** One central page. Every screen must survive the question:
  would removing this make the product harder to use?

## Vision (one employee = one loop)

Each employee is one configured agent loop run by a stateless worker. An
employee is defined by three things, kept deliberately simple:

- **Identity (the soul file).** One document per employee, used as the system
  prompt every turn: name, avatar, role, persona, scope of work, daily
  responsibilities, manager and direct reports, guardrails, email address,
  Slack handle.
- **Memory.** Identity = who I am. Recall (Mem0) = what I have learned,
  auto-written after turns, searched before turns. Actions log (the `events`
  table) = what I did, which also powers the dashboard.
- **Manager rule.** Every AI employee has exactly one manager — a human
  (platform user). Human managers must be on the
  platform; default is the creator. Enforced at hire.

An employee is hired in one continuous flow (below), then works through
whichever channels its company uses — all sharing one brain and one memory —
plus a heartbeat that wakes idle employees to act proactively.

## The flow, end to end

**Invitation.** There is no sign-up. We create a company's workspace and invite
its first admin by email; everyone after that is invited by an admin from inside
it (see Members). A user can belong to several workspaces; they are fully
separate.

**Dashboard.** The one central page. The org chart in the middle — humans and
AI employees in real reporting lines, visible to every role. An action log
panel on the right streams what employees are doing. A clear indicator to
hire a new employee. Nothing sits deeper than one level from this page.

**Employee profile.** Click any AI employee in the chart. One page showing:
action log with the current action (if any) highlighted, name, role and scope,
persona, daily responsibilities, manager, every way to reach it, what it has
access to, a place to start a voice call with it, its memories, and a back
button to the dashboard.

**Hiring flow.** Entered from the dashboard, completed in one continuous run,
ends back at the dashboard with the employee live in the chart. No drafts.

1. **Job description.** Paste the JD.
2. **Manager.** Select the employee's manager (can be yourself).
3. **Identity.** Name, persona, and role (SWE, designer, marketer, etc.)
   auto-drafted from the JD, all editable — plus an interview: a voice
   conversation where the employee, having read the JD, discusses its
   capabilities with the hiring manager. This is the moment that humanizes
   the flow; design it like an interview, not a preview.
4. **Train.** The user teaches the employee about the company: what the
   company does, what the team does, what the employee will own, policies,
   culture, security rules. Upload documents or type material directly. This
   step may confuse new users fastest; keep it explicit and guided.
5. **Onboard.** Generated from the JD and the training material, all
   editable: scope of work, daily responsibilities, guardrails.
6. **Give access.** What the employee can reach in the company's systems. Which
   options appear depends on what that company has connected.
7. **Hire.** One button. The employee is provisioned and appears in the chart.

**Account menu.** A single icon in a top corner opening a compact menu: the
workspace switcher, Settings, log out. Settings contains exactly one area:
Members.

**Members.** The list of human members. Admins invite by email, remove
members, and change roles — the only way anyone joins an org.

**Roles.** Two. Admins can do everything. Managers can do everything except:
they hire and fire only within their own hierarchy (themselves and anyone
below them), and they cannot invite or remove members or change roles.

**Working.** After hire, the employee works through whichever channels its
company uses. The platform is for observing and managing, not operating.

Billing happens outside the product entirely — invoiced directly, with nothing
about it in the platform.
