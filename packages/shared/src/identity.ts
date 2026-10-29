/**
 * The identity (soul) file — a single per-employee document used verbatim as the
 * agent's system prompt every turn. Stored in `employees.identity` (jsonb).
 * Fields are those described in docs/product.md "Vision" (the soul file).
 */

export interface ManagerRef {
  /** The human platform user who hired and manages this employee. */
  id: string;
}

export interface IdentityFile {
  name: string;
  /** Appearance / avatar description or URL. */
  avatar: string;
  /** Job title, auto-drafted from the JD (issue #38). */
  role: string;
  persona: string;

  scope_of_work: string;
  daily_responsibilities: string[];

  /** Every employee has exactly one manager (enforced at hire; docs/product.md "Vision"). */
  manager: ManagerRef;

  operating_rules: string[];

  email_address: string;
  slack_handle: string;
  /** Optional: only employees given a number have one (#252). */
  phone_number?: string;
  /** Whether this employee is currently paused by their manager. */
  paused?: boolean;
  /** Timestamp when the employee was paused, if currently paused. */
  paused_at?: string | null;
}
