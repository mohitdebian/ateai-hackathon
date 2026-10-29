# Future

Three lists: things we might build, things already slightly wrong, and things
we have ruled out.

**How this relates to issues.** GitHub issues hold work we intend to do now;
this file holds everything else. 

## Potential Deletions / Simplifications
- Delete on platform voice calls
- Delete daily responsibilities, Persona, Operating rules, Scope. #126
- Delete training, have it done outside of the platform entirely.

## Future features

### Connectors

Each is one entry in the connector registry plus a handler. Handlers are written
once and reused by every customer afterwards, so the first customer to ask pays
for it and everyone after gets it free.

- **Tools described in configuration rather than code.** A customer's own system
  — an internal API, a warehouse, whatever they already run — becomes something
  an employee can use, without us writing anything. We store the base web
  address, a credential, and a list of actions with the shape of the information
  each one needs. The employee sees them exactly like any other capability, and
  a call goes out over plain HTTP. Any system reachable that way works, so this
  is the largest single win in this section: after it exists, connecting a
  customer's own software costs a database row instead of a release.

- **Apps that allow only one integration per company.** GitHub, Notion, Jira,
  Confluence and most finance software let a company connect one integration,
  not one per person. One install is shared by every employee, and each piece of
  work is labelled with the employee that did it — in a structured field where
  the app has one, like a commit trailer or a custom field on an issue, so it
  can be searched later rather than buried in prose. Check the Composio catalog
  first: most of these are already in it, which makes them configuration rather
  than code.

- **More places employees can be messaged.** Telegram, Discord, Microsoft Teams,
  and WhatsApp business numbers. (chat) Each is an inbound route, a credential per
  employee, and a way to send a reply. Telegram and Discord are the cheapest —
  one bot token each, no approval flow — and demonstrate well. Teams matters
  most for larger companies. WhatsApp allows business numbers only, and gives
  one identity for the whole company rather than one per employee.

- **Speaking in Discord voice channels.** Blocked on the same voice problem as
  meetings — see Known gaps.

- **Sitting in on meetings.** Recall.ai runs a bot that joins a Zoom, Meet or
  Teams call with the employee's name and avatar and returns a transcript. Given
  a link — sent to the employee over a channel it already has, the way a person
  would be asked — it joins as a guest; when the meeting ends the transcript
  runs one turn, the same shape as the end-of-call handling for voice, so it
  lands in the action log without a row per utterance. The value is the
  follow-up afterwards, not the attendance. Two obvious asks are harder than
  they look: speaking in the meeting hits the voice problem in Known gaps, and
  joining unprompted needs a calendar, which needs the item below. (#254)

- **A phone number the customer already owns.** Rather than us provisioning one,
  their existing phone system points a number or an extension at us. Works with
  Twilio, RingCentral, Genesys and anything similar. The employee's side is
  identical to a number we provision; only where the call arrives from changes.

- **Connection-aware onboarding and event-driven work across connectors.** Outlook
  is the first slice: after a connection is verified, the employee asks its
  manager what work that connection should enable; supported incoming events
  then wake the employee. Extend this to other connectors when their events are
  useful, and ask or notify the manager through any configured conversation
  channel, not only Slack. Do not enable every available trigger by default.

- **Letting a customer's own engineers publish capabilities to us.** The natural
  successor to configuration-described tools, for a large customer with an
  engineering team who would rather build than describe their systems to us.
  They run a small service that advertises what it can do; we connect to it. It
  requires them to build something, which early customers will not.

- **Creating employees as real users in a customer's directory.** With their
  Google Workspace or Microsoft admin connected, each employee is created at
  hire as a genuine user in their company — an address, a mailbox, a calendar, a
  seat — and one approval from their administrator covers every employee they
  ever hire. It makes meetings substantially better: the bot joins signed in as
  the employee rather than as an anonymous guest, and the employee can be
  invited to a call like a person instead of being handed a link. A customer on
  this stops needing email on their own domain through AgentMail, though both
  paths have to keep working, since most customers will never connect an admin.
  The largest item here, and worth nothing without a customer whose
  administrator will actually grant the access — several of these APIs sit
  behind the vendor's higher plans, and "manage users in our directory" is a
  large ask some IT departments will refuse. (#255)

- **A calendar for an employee on an account we control.** Gives it a calendar
  and a way to sign in to things, without an address on the customer's domain.
  A fallback for customers who will not connect their own directory to us;
  unnecessary for any customer who does. A temporary solution could be provisioning managed calendars. 

### Product

- **Add Role Templates & Stripe Checkout**: Ready the platform for paying commercial users (1-click employee presets for SDR, Support, Bookkeeper, plus Stripe subscription checkout and customer portal).
- **Unblock Hiring & Add Web Chat**: Make channel provisioning optional so hiring never fails, and add a direct web chat drawer on the employee profile.
- **Replace Mem0 with Supabase pgvector**: Cut out the external memory dependency completely, eliminate 3rd-party SaaS fees, cut turn latency, and keep customer memories private inside our own Postgres database.
- A catalog of ready-made employees and teams.
- Approval gates: a queue of actions waiting for a human, at the top of the
  action log.
- Employees that write code: a throwaway workspace per task — copy the
  repository, make the change, open a pull request, tear it down. Maybe use some coding agent for this?
- searching across employees.
- working hours for employees
- Employees that are naturally inquisitive — ask when something is unclear, seek
  out what they do not know, and decline to guess.
- **Employees that can request a hire**, behind an approval and the versioning
  above. If an employee can change the shape of the org, someone has to see what
  it did and be able to reverse it.
- Tracking how well an employee is doing its job.
- Account management: delete a workspace, choosing replacements for the
  employees it manages and a successor admin; change email and password; sign in
  with Google or Microsoft; a hint at which method was used last.
- SSO
- Data processing agreement (DPA) - required for SOC2
- Export of action log (for compliance and security requirements)
- Look into Okta's cross-app access, Descope, Microsoft's agent identity work and others for best practices and future plans.
- Track token usage and cost for every employee turn, and a monthly token cap with 80% warning and hard stop. We may have to keep this out, or leave this as an internal only feature as this dehumanizes the AI. (#26, #27, #95, #97)
- Train step: option to schedule a meeting with the employee (#41)
- An employee's identity is frozen at hire. If a manager spends a call changing what it owns or adding a rule, nothing happens — the next Slack or email reply behaves exactly as before. AI itself can rewrite parts of hits scope like daily responsibilities guardrails scope etc? Based on its events and if manager tells it to do something different etc. #144

### Development setup
- separate vendor accounts per env with spend limits #176
- a separate GCP project for prod ?? #176
- deployment protection with OAuth bypass tokens #176
- a staging tier #176
- proper secret management system #75

## Known gaps

Not features. Things already slightly wrong that get worse as we add channels.

- **Knowing who is talking.** An employee works out whether it is speaking to
  its manager or to an outsider. That falls apart on the phone, where there is
  nothing to look up, so everyone is treated as an outsider; email has the same
  weakness. A contact list keyed on the address — number, email, handle — would
  fix both.
- **Spoofed Caller ID.** A spoofed call from a listed number gets manager access.
  Caller ID can be faked, so we accept this risk for now until stronger identity
  verification for voice calls is added.
- **One voice.** Voice shows up on calls, on the phone, in meetings and possibly
  in chat. They have to sound like the same employee, and today they would not.
  Anything that adds a new place where the employee speaks has to answer this
  first.
- **Slack scopes are frozen at install**, so any scope added later is silently missing from every employee already hired until someone reinstalls their app (#278, PR #277).
- Agent to agent communication. We dont have that. We are just prioritizing employee relationship directly with manager.
- counterparty resolution collapses on phone. must default to external. We can have a contacts book almost? This will solve for emails always defaulting to external as well. The Counterparty model would need fixing as we add channels.
- Email always defaults to external. I think we may have an issue for this. 
- Guardrails are soft only. #28
- The worker runs a hand-rolled Anthropic SDK tool loop capped at 8 tool round-trips (apps/worker/src/turn.ts), not the Claude Agent SDK the original spec named as the agent engine — so no skills or subagents exist. #52
- No forgot password flow. #55. Overall sign up experience feels very poor. Improve sign in options as well. Builds off of (#243)
- Account menu needs revisiting and improvements. Currently we have single person orgs so the current flow doesnt pair well with that. #56
- Admin and Manager roles are not fully implemented. Pairs well with #56. Check #57.
- Incoming Slack, email, and voice messages can be lost during a worker outage or handled twice when a provider retries. (#224)
- AIs sound too AI and dont sound human enough. Careful prompt engineering needed
- Execution history still parses bold from text the worker already stripped #189
- Agents reveal too much abour our backend architecture. its only a soft guardrail. Can be stiffer. Should test and check. #116
- per-turn token cost is high. Can be cut: prompt caching, and stop storing duplicate voice transcripts
 #162
- Heartbeat frequency is not visible in codebase#152
- header overlaps other sections. Need to redesign a fix. #262
- employee card improvements - should feel like a person is being assembled #262
- An employee's Slack app silently lacks scopes added after it was installed
 #276

## Decided against for now

Kept so they are not proposed again.

- **Creating accounts by driving a browser.** Unreliable, and the only approach
  considered that risks breaking an app's terms of service. Every app worth
  supporting has a proper mechanism. We looked into notte, and using magic links.
- **iMessage.** No supported route for software to use it for now. 
- **Separate infrastructure or a subdomain per customer.** Every row already
  records which company it belongs to and the database enforces the separation.
  Revisit only if a signed contract demands it, and charge for it.

## Research topics: 
- Identity file is like soul md on openclaw. How does openclaw do soul.md? What are things we can learn from it to improve our implementation? #151
- Thoroughly research other "sentient AI" startups and how they implement their heartbeats. openclaw, paperclip, https://madebythomas.ai/, etc. Compare with how we have implemented our heartbeat and see if or how we can improve. #148
- We have tons of free credits so see how we can leverage them #62.
