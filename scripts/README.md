# Scripts

Internal tools for setting customers up. Customers never see or run these — we
do, from a terminal at the repo root.

| Script | What it's for | You run it? |
|---|---|---|
| [`enable-connector.mjs`](#enable-connectormjs--turn-a-customers-features-on-and-off) | Turn a customer's features on and off | Yes |
| [`delete-org.mjs`](#delete-orgmjs--delete-an-organization-and-its-resources) | Delete an organization, its employees, and release AgentMail inboxes | Yes |
| [`invite-client.ts`](#invite-clientts--invite-a-customers-first-admin) | Invite a new customer's first admin | Yes |
| [`local-e2e.sh`](#local-e2esh--run-everything-on-your-machine) | Run the whole app on your machine | Yes, for testing |
| `check-env.mjs` | Blocks a merge when a required setting is missing | No — CI runs it |

> **Not merged yet.** `invite-client.ts` arrives with PR #268.

---

## First: dev or prod?

**No script chooses an environment.** Each one reads two settings from your
terminal and changes whichever database those settings belong to:

| Setting | What it is |
|---|---|
| `SUPABASE_URL` | Which database to talk to |
| `SUPABASE_SERVICE_ROLE_KEY` | The admin key that lets the script change it |

Give it dev's two values and it changes dev. Give it prod's and it changes prod.
Nothing else is involved.

| | Dev | Prod |
|---|---|---|
| Supabase project | `pgupirsljpafkuyueads` | `ikhxhyxgganjmjjqjdwa` |
| App URL | `https://dev-ateai.vercel.app` | `https://ateai.vercel.app` |

### Set it up once

Make one settings file per environment. Both names are already git-ignored, so
they can't be committed.

1. In Supabase, open the project → **Project Settings → API**.
2. Copy the **Project URL** and the **`service_role`** key.
3. Save them as `scripts/.env.dev` or `scripts/.env.prod`:

   ```
   SUPABASE_URL=https://pgupirsljpafkuyueads.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```

### Then pick the environment on every command

`--env-file` loads one file for that one command. The file name is your choice
of environment, written right there in the command:

```bash
node --env-file=scripts/.env.dev  scripts/enable-connector.mjs --list   # dev
node --env-file=scripts/.env.prod scripts/enable-connector.mjs --list   # prod
```

Prefer this over `export`. An exported key stays set in that terminal, so the
next command you run hits the same database whether you meant it to or not.

### Two rules

- **Run `--list` first.** The org names it prints tell you which database you
  are actually connected to, before you change anything.
- **The `service_role` key can read and change everything**, including every
  customer's credentials. Never commit it, paste it into chat, or share it.

---

## `enable-connector.mjs` — turn a customer's features on and off

A customer has a feature when there is a row for it in the `org_connectors`
table. This script adds and removes those rows. That is all it does — there is
no settings screen.

### Commands

```bash
# See what every customer has
node --env-file=scripts/.env.prod scripts/enable-connector.mjs --list

# Turn a feature on
node --env-file=scripts/.env.prod scripts/enable-connector.mjs "Acme" vapi_phone

# Turn a feature off
node --env-file=scripts/.env.prod scripts/enable-connector.mjs "Acme" vapi_phone --disable
```

The customer can be its name or its id. Use the id if two customers share a name
— the script stops and tells you when that happens.

### Feature names

| Name | Feature | New customers get it? |
|---|---|---|
| `agentmail` | Email | Yes |
| `vapi` | Voice calls | Yes |
| `composio:all` | All apps connected through Composio | Yes |
| `slack` | Slack | No — needs keys, see below |
| `vapi_phone` | Phone numbers | No — costs money every month |

These are the only names the script accepts. Anything else — `composio`
without `:all`, a typo — is refused with the list of valid names.

### What "off" means

Turning a feature off stops it being **offered**. It does not take anything away
from employees who already have it.

| Turn off | New employees | Employees who already have it |
|---|---|---|
| `vapi` | Hiring stops creating a voice assistant | Keep theirs |
| `slack` | Hiring stops creating a Slack app | Keep theirs |
| `vapi_phone` | No one can be given a new number | Keep their number |
| `composio:all` | No one can connect a new app | Keep using apps already connected |

To take something away from one employee, disconnect it from their profile or
fire them.

### Phone numbers

Turning `vapi_phone` on doesn't give anyone a number. It lets the customer have
numbers — each one is then bought per employee, from that employee's profile.

### Slack

Slack is the one feature that needs keys. Turning it on without them does
nothing: hiring quietly skips Slack, and nothing shows an error.

**Getting the keys**

1. Go to **api.slack.com/apps**, sign in to the Slack workspace the employee
   apps should be created in.
2. Under **Your App Configuration Tokens**, click **Generate Token** and choose
   that workspace.
3. Slack shows two tokens. You only need the **refresh token** (starts
   `xoxe-1-`).

**Turning it on**

```bash
node --env-file=scripts/.env.prod scripts/enable-connector.mjs "Acme" slack --refresh-token xoxe-1-...
```

You don't need the access token Slack showed you. The script sends the refresh
token to Slack, gets back a brand-new pair, and saves that. This proves the keys
work before anything is saved, and starts their 12-hour clock from now — the
app renews them after that on its own.

**⚠️ One pair per customer, per environment.** The moment the script runs, the
refresh token you pasted stops working. Paste the same one into a second
customer, or into both dev and prod, and whichever is used second breaks. Always
generate a fresh pair.

**Turning Slack off deletes its keys.** The script warns you when it does. To
turn it back on, generate a new pair.

> This per-customer key is temporary. #72 replaces it: the customer creates the
> Slack app in their own workspace, and no keys are needed at all.

---

## `invite-client.ts` — invite a customer's first admin

There is no public sign-up. A customer gets in only by invitation.

```bash
pnpm --dir apps/web exec tsx --env-file=../../scripts/.env.prod \
  ../../scripts/invite-client.ts jane@acme.com https://ateai.vercel.app
```

The `../../` is there because `pnpm --dir apps/web` runs the command from inside
`apps/web`.

What happens next:

1. Jane gets an email with a link.
2. The link takes her to a page where she names the organization, adds her own
   name, and picks a password.
3. Her organization is created with the default features (email, voice,
   Composio), and she lands on the dashboard.

**⚠️ The URL must match the settings file.** Prod settings with the dev URL sends
Jane to the dev site, where her account doesn't exist. Always:

| Settings file | URL |
|---|---|
| `scripts/.env.dev` | `https://dev-ateai.vercel.app` |
| `scripts/.env.prod` | `https://ateai.vercel.app` |

Only the first admin comes in this way. There is no way yet for an admin to
invite teammates from inside the app, and this script always creates a **new**
organization — so don't use it to add someone to an existing one.

---

## `local-e2e.sh` — run everything on your machine

Starts a local database, the worker and the web app, for testing without
touching dev or prod.

```bash
./scripts/local-e2e.sh          # start
./scripts/local-e2e.sh stop     # stop
```

Needs Docker running, the Supabase CLI, and both local settings files:
`apps/web/.env.local` and `apps/worker/.env` (copy each from its `.env.example`).

To point the other scripts at this local database, run
`supabase status -o env` and use its `API_URL` and `SERVICE_ROLE_KEY`.

---

## Setting up a new customer

Everything in order, for prod.

1. **Check you're on prod.**
   ```bash
   node --env-file=scripts/.env.prod scripts/enable-connector.mjs --list
   ```
2. **Invite their first admin.**
   ```bash
   pnpm --dir apps/web exec tsx --env-file=../../scripts/.env.prod \
     ../../scripts/invite-client.ts jane@acme.com https://ateai.vercel.app
   ```
3. **Wait for them to accept.** Their organization now exists with email, voice
   and Composio.
4. **Add what they need.**
   ```bash
   node --env-file=scripts/.env.prod scripts/enable-connector.mjs "Acme" slack --refresh-token xoxe-1-...
   node --env-file=scripts/.env.prod scripts/enable-connector.mjs "Acme" vapi_phone
   ```
5. **Remove what they don't.**
   ```bash
   node --env-file=scripts/.env.prod scripts/enable-connector.mjs "Acme" composio:all --disable
   ```
6. **Confirm.** Run `--list` again and check their row.

---

## When something goes wrong

| You see | Why | Fix |
|---|---|---|
| `set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first` | The settings file didn't load | Check the `--env-file` path and that the file has both lines |
| `no org matching "Acme"` | Wrong name, or wrong environment | Run `--list` and copy the name exactly |
| `"Acme" matches 2 orgs — pass an id instead` | Two customers share a name | Use the id from Supabase |
| `slack tooling.tokens.rotate failed: invalid_refresh_token` | That refresh token was already used or expired | Generate a new pair |
| `403 … permission denied` on a **local** database | Local databases don't grant the admin key access to older tables | Run `grant all on all tables in schema public to service_role;` in the local database. Dev and prod don't need this |
| `unknown provider "…"` | A misspelled feature name | Use a name from the feature table |
| Slack shows as "skipped" when hiring | Slack is on but has no keys | Turn it on again with `--refresh-token` |
| An employee still has a feature you turned off | Off stops it being offered, it doesn't remove it | Disconnect it from their profile |
