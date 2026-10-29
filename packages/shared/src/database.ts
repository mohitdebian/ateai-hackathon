/**
 * Typed database shape for supabase-js (`SupabaseClient<Database>`), mirroring
 * the Demo MVP schema in supabase/migrations. Hand-written (rather than generated)
 * so it lives with the other shared contracts and needs no codegen step; keep it
 * in sync with the migrations. Row/Insert/Update follow the supabase-js generic.
 */
import type { IdentityFile } from "./identity.js";
import type { Channel } from "./envelope.js";
import type { ConnectorStatus } from "./connectors.js";

export type MembershipRole = "admin" | "manager" | "viewer";
export type EventKind = "message" | "tool" | "subagent";

type WithDefaults<Row, Optional extends keyof Row> = Omit<Row, Optional> &
  Partial<Pick<Row, Optional>>;

export type OrganizationRow = {
  id: string;
  name: string;
  plan: string;
  created_at: string;
}

export type UserRow = {
  id: string;
  org_id: string;
  name: string | null;
  email: string | null;
  created_at: string;
}

export type MembershipRow = {
  id: string;
  user_id: string;
  org_id: string;
  role: MembershipRole;
  created_at: string;
}

export type EmployeeRow = {
  id: string;
  org_id: string;
  name: string;
  avatar_url: string | null;
  hired_at: string | null;
  manager_id: string | null;
  identity: IdentityFile;
  created_at: string;
  updated_at: string;
}

export type KnowledgeDocRow = {
  id: string;
  org_id: string;
  employee_id: string;
  title: string;
  content: string;
  chunk_index: number;
  embedding: string | null;
  created_at: string;
}

/**
 * Both JSON columns are flat string maps; the per-provider shapes and the
 * reader are in connectors.ts.
 */
export type ConnectorCredential = Record<string, string>;
export type ConnectorConfig = Record<string, string>;

/**
 * What a client has set up. Service-role only — an org credential can reach a
 * customer's whole workspace, so no tenant request may read this table
 * (docs/data-model.md "Tenancy / RLS").
 */
export type OrgConnectorRow = {
  id: string;
  org_id: string;
  provider: string;
  /** null when the connector runs on our own vendor account. */
  credential: ConnectorCredential | null;
  config: ConnectorConfig;
  status: ConnectorStatus;
  created_at: string;
}

/** What one employee has. Readable by its org, so the profile can show it. */
export type EmployeeConnectorRow = {
  id: string;
  org_id: string;
  employee_id: string;
  provider: string;
  /** How the outside world reaches this employee here; the inbound routing key. */
  address: string | null;
  credential: ConnectorCredential | null;
  config: ConnectorConfig;
  status: ConnectorStatus;
  created_at: string;
}

export type EventRow = {
  id: string;
  org_id: string;
  employee_id: string | null;
  channel: Channel;
  kind: EventKind;
  payload: Record<string, unknown>;
  created_at: string;
}

export type WebhookEventRow = {
  provider: "slack" | "agentmail" | "vapi";
  event_key: string;
  created_at: string;
}

export type RateLimitRow = {
  bucket: string;
  window_start: string;
  count: number;
}

export type EmailTaskRow = {
  provider: "outlook" | "gmail";
  id: string;
  org_id: string;
  employee_id: string;
  connected_account_id: string;
  task_key: string;
  message_id: string | null;
  status: "pending" | "processing" | "acting" | "ignored" | "waiting" | "done" | "failed";
  summary: string | null;
  slack_channel: string | null;
  slack_ts: string | null;
  attempts: number;
  error: string | null;
  updated_at: string;
  created_at: string;
}

type Table<Row, InsertOptional extends keyof Row> = {
  Row: Row;
  Insert: WithDefaults<Row, InsertOptional>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      organizations: Table<OrganizationRow, "id" | "plan" | "created_at">;
      users: Table<UserRow, "name" | "email" | "created_at">;
      memberships: Table<MembershipRow, "id" | "role" | "created_at">;
      employees: Table<
        EmployeeRow,
        "id" | "avatar_url" | "hired_at" | "manager_id" | "identity" | "created_at" | "updated_at"
      >;
      knowledge_docs: Table<
        KnowledgeDocRow,
        "id" | "chunk_index" | "embedding" | "created_at"
      >;
      org_connectors: Table<
        OrgConnectorRow,
        "id" | "credential" | "config" | "status" | "created_at"
      >;
      employee_connectors: Table<
        EmployeeConnectorRow,
        "id" | "address" | "credential" | "config" | "status" | "created_at"
      >;
      events: Table<EventRow, "id" | "employee_id" | "payload" | "created_at">;
      webhook_events: Table<WebhookEventRow, "created_at">;
      email_tasks: Table<
        EmailTaskRow,
        "id" | "message_id" | "status" | "summary" | "slack_channel" | "slack_ts" | "attempts" | "error" | "updated_at" | "created_at"
      >;
      rate_limits: Table<RateLimitRow, "window_start" | "count">;
    };
    Views: Record<string, never>;
    Functions: {
      match_knowledge: {
        Args: {
          p_org: string;
          p_employee: string;
          query_embedding: string;
          match_count?: number;
          p_min_score?: number;
        };
        Returns: { doc_id: string; title: string; content: string; score: number }[];
      };
      check_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
