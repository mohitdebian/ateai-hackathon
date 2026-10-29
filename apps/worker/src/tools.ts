import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Composio, type ToolRouterSession } from "@composio/core";
import { AnthropicProvider } from "@composio/anthropic";
import type { Database } from "@ate/shared";
import { connectorSpec } from "@ate/shared";
import { listDocuments, readDocument, resolveTitle } from "./knowledge.js";
import { loadOutboundContext, sendMessage } from "./outbound.js";
import { anthropic } from "./anthropic.js";
import { MODELS } from "@ate/shared";

/**
 * Composio tool access for a turn.
 * Scoping (docs/architecture.md, the scoping implementation note): the
 * Composio user is the EMPLOYEE id, so a session only
 * ever sees the OAuth grants made for that employee on the grant-access UI —
 * cross-employee (and cross-org) access is impossible by construction.
 *
 * We use Composio's Anthropic provider (tools in Messages-API format) rather
 * than the MCP connector: Composio's hosted MCP endpoint needs custom auth
 * headers the connector can't send.
 *
 * Tool execution goes through the router session's `execute()` method
 * (#115) instead of the provider's `handleToolCalls` helper, which called
 * Composio's sessionless endpoint and returned empty results for session-only
 * tools (workbench sandbox, cross-toolkit search).
 */

/**
 * `composio.create()` is typed as returning `Session`, whose `execute`/`tools`
 * signatures predate the `requestOptions` argument the timeouts below pass —
 * the runtime accepts it, the declaration does not. Casting to the session
 * class itself restores the real signatures; drop it when the SDK types catch up.
 */
type ComposioSession = ToolRouterSession<unknown, unknown, AnthropicProvider>;

let composio: Composio<AnthropicProvider> | null = null;

export function composioClient(): Composio<AnthropicProvider> | null {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) return null;
  if (!composio) composio = new Composio({ apiKey, provider: new AnthropicProvider() });
  return composio;
}

/** Outcome of one tool call, for the execution log (#120). */
export interface ToolCallOutcome {
  tool: string;
  input: unknown;
  successful: boolean;
  completionUnknown: boolean;
  error: string | null;
  duration_ms: number;
}

const ERROR_MAX = 500;

function truncateError(error: string | null): string | null {
  if (error === null) return null;
  return error.length > ERROR_MAX ? `${error.slice(0, ERROR_MAX)}…` : error;
}

function batchFailed(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(batchFailed);
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (item.successful === false || item.success === false ||
      (typeof item.error === "string" && item.error.length > 0)) return true;
  return Object.values(item).some(batchFailed);
}

export interface ToolRuntime {
  tools: Anthropic.Messages.ToolUnion[];
  /** Execute every tool_use block in the response; returns the result messages and each call's outcome. */
  execute(response: Anthropic.Message): Promise<{
    messages: Anthropic.Messages.MessageParam[];
    outcomes: ToolCallOutcome[];
  }>;
}

/** A denial is returned to the model without executing the requested tool. */
export type ToolAuthorization = (block: Anthropic.Messages.ToolUseBlock) => Promise<string | null>;

/**
 * Direct sending actions in connected personal mailboxes (Gmail, Outlook).
 * When an employee has native AgentMail active, outbound sending must flow through
 * `send_message` with the employee's provisioned email identity, rather than
 * impersonating the manager through their personal OAuth credentials.
 * Drafting actions (e.g. `GMAIL_CREATE_EMAIL_DRAFT`) remain permitted.
 */
export const DISARMED_PERSONAL_MAIL_ACTIONS = new Set([
  "GMAIL_SEND_EMAIL",
  "GMAIL_REPLY_TO_THREAD",
  "OUTLOOK_SEND_MAIL",
  "OUTLOOK_SEND_EMAIL",
  "OUTLOOK_REPLY",
  "OUTLOOK_REPLY_ALL",
  "OUTLOOK_FORWARD_MAIL",
]);

const READ_DOCUMENT_TOOL: Anthropic.Messages.Tool = {
  name: "read_document",
  description:
    "Read the full text of one of your uploaded documents by its exact title, as listed in " +
    "your document inventory. Use this before answering any question about what a specific " +
    "document contains.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Exact document title from your document list." },
    },
    required: ["title"],
  },
};

export const SEARCH_WEB_TOOL: Anthropic.Messages.Tool = {
  name: "search_web",
  description:
    "Search the live web for real-time information, products, documentation, answers, and news. " +
    "Use this whenever you need to find up-to-date facts, research products, or look up information beyond your pre-loaded knowledge.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query to look up on the web." },
    },
    required: ["query"],
  },
};

const SEND_MESSAGE_TOOL: Anthropic.Messages.Tool = {
  name: "send_message",
  description:
    "Send a new email to any address, or a Slack message — either to a channel such as #dispatch " +
    "that you have been invited to, or as a DM to your manager. Omit the to field to reach your " +
    "manager. A Slack DM falls back to email when your manager's Slack identity is unavailable; " +
    "a channel post does not.",
  input_schema: {
    type: "object",
    properties: {
      channel: { type: "string", enum: ["email", "slack"] },
      to: {
        type: "string",
        description: "Recipient email address, or a Slack channel such as #dispatch.",
      },
      subject: {
        type: "string",
        description: "Email subject. Optional only when messaging your manager.",
      },
      text: { type: "string", description: "Plain text message body." },
      escalation: {
        type: "boolean",
        description:
          "True only when you are asking your manager something on behalf of someone who is " +
          "waiting for the answer. Leave it out for anything else.",
      },
    },
    required: ["channel", "text"],
  },
};

const UPDATE_MANUAL_TOOL: Anthropic.Messages.Tool = {
  name: "update_manual",
  description:
    "Update your core manual (scope of work, operating rules, and daily responsibilities). " +
    "Use this ONLY when your manager gives you a permanent new rule or a long-term responsibility. " +
    "Provide the exact new instruction in the 'instruction' field. " +
    "DO NOT use this for conversational memory, temporary facts, or full training documents.",
  input_schema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "The permanent rule or responsibility to add.",
      },
    },
    required: ["instruction"],
  },
};

async function runReadDocument(
  admin: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const requested = typeof input.title === "string" ? input.title : "";
  const available = await listDocuments(admin, orgId, employeeId);
  const titles = available.map((d) => d.title);
  const resolved = resolveTitle(requested, titles);
  if (!resolved) {
    return titles.length
      ? `No document titled "${requested}". Your documents: ${titles.join(", ")}.`
      : "No documents have been uploaded to you.";
  }
  const content = await readDocument(admin, orgId, employeeId, resolved);
  return content ?? `No document titled "${requested}".`;
}

interface SearchResultItem {
  title?: string;
  url?: string;
  href?: string;
  content?: string;
  body?: string;
  snippet?: string;
}

interface GenericSearchResponse {
  answer?: string;
  results?: SearchResultItem[];
}

export async function runSearchWeb(
  input: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) {
    return { ok: false, message: "Search query is required." };
  }

  const customEngineUrl = process.env.SEARCH_ENGINE_URL;
  const tavilyApiKey = process.env.TAVILY_API_KEY;

  if (!customEngineUrl && !tavilyApiKey) {
    return {
      ok: false,
      message:
        "Web search is not configured on this server. Please set SEARCH_ENGINE_URL or TAVILY_API_KEY in the environment.",
    };
  }

  try {
    let data: GenericSearchResponse;
    if (customEngineUrl) {
      const baseUrl = customEngineUrl.replace(/\/+$/, "").replace(/\/gradio_api\/?$/, "");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.SEARCH_ENGINE_TOKEN) {
        headers["Authorization"] = `Bearer ${process.env.SEARCH_ENGINE_TOKEN}`;
      }

      if (baseUrl.includes(".hf.space") || baseUrl.includes("/gradio_api/")) {
        const postRes = await fetch(`${baseUrl}/gradio_api/call/search`, {
          method: "POST",
          headers,
          body: JSON.stringify({ data: [query] }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!postRes.ok) {
          const errText = await postRes.text().catch(() => "");
          return {
            ok: false,
            message: `Web search failed (${postRes.status}): ${errText || postRes.statusText}`,
          };
        }
        const { event_id } = (await postRes.json()) as { event_id?: string };
        if (!event_id) {
          return { ok: false, message: "Search service did not return an event ID." };
        }
        const streamRes = await fetch(`${baseUrl}/gradio_api/call/search/${event_id}`, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(15_000),
        });
        const streamText = await streamRes.text();
        let items: SearchResultItem[] = [];
        for (const line of streamText.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
                items = parsed[0] as SearchResultItem[];
              } else if (Array.isArray(parsed)) {
                items = parsed as SearchResultItem[];
              }
            } catch {
              // Ignore non-JSON SSE frames
            }
          }
        }
        data = { results: items };
      } else {
        const res = await fetch(`${baseUrl}/search?q=${encodeURIComponent(query)}&format=json`, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          return {
            ok: false,
            message: `Web search failed (${res.status}): ${errText || res.statusText}`,
          };
        }
        data = (await res.json()) as GenericSearchResponse;
      }
    } else {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query,
          max_results: 5,
          include_answer: true,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          ok: false,
          message: `Web search failed (${res.status}): ${errText || res.statusText}`,
        };
      }
      data = (await res.json()) as GenericSearchResponse;
    }
    const parts: string[] = [];
    if (data.answer) {
      parts.push(`Summary: ${data.answer}`);
    }

    if (Array.isArray(data.results) && data.results.length > 0) {
      parts.push(
        ...data.results.map((r, i) => {
          const title = r.title ?? "Untitled";
          const snippet = (r.content || r.body || r.snippet || "").trim();
          const targetUrl = r.url || r.href;
          const url = targetUrl ? ` (${targetUrl})` : "";
          return `[${i + 1}] ${title}${url}\n${snippet}`;
        }),
      );
    }

    if (parts.length === 0) {
      return { ok: true, message: `No web results found for "${query}".` };
    }

    return { ok: true, message: parts.join("\n\n") };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Web search request failed: ${msg}` };
  }
}

async function runUpdateManual(
  admin: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
  input: Record<string, unknown>,
): Promise<{ ok: boolean, message: string }> {
  const instruction = typeof input.instruction === "string" ? input.instruction : "";
  if (!instruction) return { ok: false, message: "No instruction provided." };

  const { data: employee } = await admin
    .from("employees")
    .select("identity")
    .eq("id", employeeId)
    .eq("org_id", orgId)
    .single();

  if (!employee || !employee.identity) return { ok: false, message: "Could not load current manual." };

  const identity = employee.identity as unknown as Record<string, unknown>;

  // A second, dedicated Sonnet call merges the new instruction into the existing
  // manual. This runs synchronously (the user's reply waits for it). The trade-off
  // is two serial LLM calls for better merge quality: the merge model only thinks
  // about diffing rules, so it's less likely to forget or mangle existing entries
  // than asking the conversational agent to rewrite its own full rule list inline.
  const response = await anthropic().messages.create({
    model: MODELS.sonnet,
    max_tokens: 2000,
    system:
      "You are updating an AI employee's configuration based on a new instruction from its manager. " +
      "Merge the new instruction into the existing scope of work, operating rules, and daily responsibilities. " +
      "Keep the lists concise and prevent bloat by deleting obsolete or contradictory rules.",
    messages: [
      {
        role: "user",
        content: `CURRENT MANUAL:\n${JSON.stringify(identity, null, 2)}\n\nNEW INSTRUCTION:\n${instruction}`,
      },
    ],
    tools: [{
      name: "emit_settings",
      description: "Submit the updated manual settings.",
      input_schema: {
        type: "object",
        properties: {
          scope_of_work: { type: "string" },
          daily_responsibilities: { type: "array", items: { type: "string" } },
          operating_rules: { type: "array", items: { type: "string" } },
        },
        required: ["scope_of_work", "daily_responsibilities", "operating_rules"],
      }
    }],
    tool_choice: { type: "tool", name: "emit_settings" }
  });

  try {
    const toolCall = response.content.find((b) => b.type === "tool_use" && b.name === "emit_settings") as Anthropic.Messages.ToolUseBlock | undefined;
    if (!toolCall) {
      return { ok: false, message: "Failed to update manual: AI did not emit settings." };
    }
    const newIdentity = toolCall.input as Record<string, unknown>;

    if (typeof newIdentity.scope_of_work !== "string") return { ok: false, message: "Failed: missing scope_of_work string" };
    if (!Array.isArray(newIdentity.operating_rules)) return { ok: false, message: "Failed: missing operating_rules array" };
    if (!Array.isArray(newIdentity.daily_responsibilities)) return { ok: false, message: "Failed: missing daily_responsibilities array" };

    const oldRules = Array.isArray(identity.operating_rules) ? identity.operating_rules as unknown[] : [];
    const oldResp = Array.isArray(identity.daily_responsibilities) ? identity.daily_responsibilities as unknown[] : [];
    // Reject both full and partial wipes: if a merge drops more than half the
    // existing items it's almost certainly a model hallucination, not intent.
    if (oldRules.length > 1 && newIdentity.operating_rules.length < oldRules.length / 2) {
      return { ok: false, message: "Failed: AI unexpectedly wiped most operating rules." };
    }
    if (oldResp.length > 1 && newIdentity.daily_responsibilities.length < oldResp.length / 2) {
      return { ok: false, message: "Failed: AI unexpectedly wiped most daily responsibilities." };
    }

    const { error } = await admin.from("employees").update({ 
      identity: { 
        ...identity, 
        scope_of_work: newIdentity.scope_of_work,
        daily_responsibilities: newIdentity.daily_responsibilities,
        operating_rules: newIdentity.operating_rules
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    }).eq("id", employeeId).eq("org_id", orgId);
    if (error) return { ok: false, message: `Failed: DB error ${error.message}` };
    
    return { ok: true, message: "Manual updated successfully. The new rules are now active." };
  } catch (e) {
    console.error("[tools] update_manual json parse failed", e);
    return { ok: false, message: `Failed to parse: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function dispatchBlock(
  admin: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
  session: ComposioSession | undefined,
  authorize?: ToolAuthorization,
  hasAgentmail = false,
) {
  return async (
    block: Anthropic.Messages.ToolUseBlock,
  ): Promise<{ result: Anthropic.Messages.ToolResultBlockParam; outcome: ToolCallOutcome }> => {
    const startedAt = Date.now();
    let signal: AbortSignal | undefined;
    try {
      if (hasAgentmail && DISARMED_PERSONAL_MAIL_ACTIONS.has(block.name)) {
        const error =
          "Direct outbound sending via personal mailboxes is disabled to prevent impersonation. " +
          "Use the send_message tool to send outbound emails as an AI employee.";
        return {
          result: { type: "tool_result", tool_use_id: block.id, content: error, is_error: true },
          outcome: {
            tool: block.name,
            input: block.input,
            successful: false,
            completionUnknown: false,
            error: truncateError(error),
            duration_ms: Date.now() - startedAt,
          },
        };
      }
      if (authorize) {
        const denial = await authorize(block);
        if (denial) {
          return {
            result: { type: "tool_result", tool_use_id: block.id, content: denial, is_error: true },
            outcome: { tool: block.name, input: block.input, successful: false,
              completionUnknown: false, error: truncateError(denial), duration_ms: Date.now() - startedAt },
          };
        }
      }
      if (block.name === READ_DOCUMENT_TOOL.name) {
        const content = await runReadDocument(admin, orgId, employeeId, block.input as Record<string, unknown>);
        return {
          result: { type: "tool_result", tool_use_id: block.id, content, is_error: false },
          outcome: {
            tool: block.name,
            input: block.input,
            successful: true,
            completionUnknown: false,
            error: null,
            duration_ms: Date.now() - startedAt,
          },
        };
      }

      if (block.name === SEARCH_WEB_TOOL.name) {
        const { ok, message } = await runSearchWeb(block.input as Record<string, unknown>);
        return {
          result: { type: "tool_result", tool_use_id: block.id, content: message, is_error: !ok },
          outcome: {
            tool: block.name,
            input: block.input,
            successful: ok,
            error: !ok ? message : null,
            completionUnknown: false,
            duration_ms: Date.now() - startedAt,
          },
        };
      }

      if (block.name === UPDATE_MANUAL_TOOL.name) {
        const { ok, message } = await runUpdateManual(admin, orgId, employeeId, block.input as Record<string, unknown>);
        return {
          result: { type: "tool_result", tool_use_id: block.id, content: message, is_error: !ok },
          outcome: {
            tool: block.name,
            input: block.input,
            successful: ok,
            error: !ok ? message : null,
            completionUnknown: false,
            duration_ms: Date.now() - startedAt,
          },
        };
      }

      if (block.name === SEND_MESSAGE_TOOL.name) {
        const input = block.input as Record<string, unknown>;
        if (input.channel !== "email" && input.channel !== "slack") {
          throw new Error("send_message channel must be email or slack");
        }
        const context = await loadOutboundContext(admin, orgId, employeeId);
        const to = typeof input.to === "string" ? input.to : context.managerEmail;
        const channel = await sendMessage(context, {
          channel: input.channel,
          to,
          subject: typeof input.subject === "string" ? input.subject : undefined,
          text: typeof input.text === "string" ? input.text : "",
        });
        return {
          result: {
            type: "tool_result",
            tool_use_id: block.id,
            content: `Message sent by ${channel}.`,
            is_error: false,
          },
          outcome: {
            tool: block.name,
            input: block.input,
            successful: true,
            completionUnknown: false,
            error: null,
            duration_ms: Date.now() - startedAt,
          },
        };
      }

      if (!session) throw new Error(`no tool session available for ${block.name}`);
      signal = AbortSignal.timeout(60_000);
      const composioResult = await session.execute(block.name, block.input as Record<string, unknown>, undefined, { signal });
      const partialFailure = block.name === "COMPOSIO_MULTI_EXECUTE_TOOL" && batchFailed(composioResult.data);
      const successful = composioResult.error === null && !partialFailure;
      return {
        result: {
          type: "tool_result",
          tool_use_id: block.id,
          // A failure's data can carry the fix (e.g. suggested tool slugs), so the model sees both.
          content: successful ? JSON.stringify(composioResult.data) :
            `${partialFailure ? "One or more batch actions failed; do not retry automatically" : composioResult.error}\n${JSON.stringify(composioResult.data)}`,
          is_error: !successful,
        },
        outcome: {
          tool: block.name,
          input: block.input,
          successful,
          completionUnknown: partialFailure,
          error: truncateError(partialFailure ? "One or more batch actions may have completed" : composioResult.error),
          duration_ms: Date.now() - startedAt,
        },
      };
    } catch (err) {
      // A tool call can also fail outright (revoked auth, network error) rather
      // than resolving with successful: false — still a failure to log (#120).
      const timedOut = signal?.aborted || (err instanceof Error && err.name === "ComposioRequestCancelledError");
      const message = timedOut ? "Timed out; completion could not be confirmed" : err instanceof Error ? err.message : String(err);
      return {
        result: { type: "tool_result", tool_use_id: block.id, content: timedOut ? "This action did not finish in time, and its result is unknown. Do not retry it automatically." : message, is_error: true },
        outcome: {
          tool: block.name,
          input: block.input,
          successful: false,
          completionUnknown: timedOut,
          error: truncateError(message),
          duration_ms: Date.now() - startedAt,
        },
      };
    }
  };
}

export function buildExecute(
  admin: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
  session: ComposioSession | undefined,
  authorize?: ToolAuthorization,
  hasAgentmail = false,
): ToolRuntime["execute"] {
  const dispatch = dispatchBlock(admin, orgId, employeeId, session, authorize, hasAgentmail);
  return async (response) => {
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
    );
    if (toolUseBlocks.length === 0) return { messages: [], outcomes: [] };

    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    const outcomes: ToolCallOutcome[] = [];
    let completionUnknown = false;
    for (const block of toolUseBlocks) {
      if (completionUnknown) {
        results.push({ type: "tool_result", tool_use_id: block.id, content: "Not run because an earlier action could not be confirmed.", is_error: true });
        outcomes.push({ tool: block.name, input: block.input, successful: false, completionUnknown: false, error: "Not run because an earlier action could not be confirmed", duration_ms: 0 });
        continue;
      }
      const dispatched = await dispatch(block);
      results.push(dispatched.result);
      outcomes.push(dispatched.outcome);
      completionUnknown = dispatched.outcome.completionUnknown;
    }
    return { messages: [{ role: "user", content: results }], outcomes };
  };
}

export async function localToolRuntime(
  admin: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
  isManager = false,
  hasAgentmail?: boolean,
  authorize?: ToolAuthorization,
  hasSlackConnector?: boolean,
): Promise<ToolRuntime> {
  let hasEmail = hasAgentmail;
  let hasSlack = hasSlackConnector;
  if (hasEmail === undefined || hasSlack === undefined) {
    const { data: connectors } = await admin
      .from("employee_connectors")
      .select("provider")
      .eq("employee_id", employeeId)
      .eq("org_id", orgId)
      .eq("status", "active");
    if (hasEmail === undefined) {
      hasEmail = (connectors ?? []).some((row) => row.provider === "agentmail");
    }
    if (hasSlack === undefined) {
      hasSlack = (connectors ?? []).some((row) => row.provider === "slack");
    }
  }

  let sendMessageTool: Anthropic.Messages.Tool | null = null;

  if (hasEmail && hasSlack) {
    sendMessageTool = SEND_MESSAGE_TOOL;
  } else if (hasEmail) {
    sendMessageTool = {
      ...SEND_MESSAGE_TOOL,
      description:
        "Send a new email to any recipient whose address you have, or omit the to field to email your manager. " +
        "Slack is not connected, so you cannot send Slack messages.",
      input_schema: {
        ...SEND_MESSAGE_TOOL.input_schema,
        properties: {
          ...(SEND_MESSAGE_TOOL.input_schema as { properties: Record<string, unknown> }).properties,
          channel: { type: "string", enum: ["email"] },
        },
      },
    };
  } else if (hasSlack) {
    sendMessageTool = {
      ...SEND_MESSAGE_TOOL,
      description:
        "Send a Slack message — either to a channel such as #dispatch that you have been invited to, " +
        "or as a DM to your manager. Email is not connected, so you cannot send emails.",
      input_schema: {
        ...SEND_MESSAGE_TOOL.input_schema,
        properties: {
          ...(SEND_MESSAGE_TOOL.input_schema as { properties: Record<string, unknown> }).properties,
          channel: { type: "string", enum: ["slack"] },
        },
      },
    };
  }

  return {
    tools: [
      READ_DOCUMENT_TOOL,
      SEARCH_WEB_TOOL,
      ...(sendMessageTool ? [sendMessageTool] : []),
      ...(isManager ? [UPDATE_MANUAL_TOOL] : []),
    ],
    execute: buildExecute(admin, orgId, employeeId, undefined, authorize, hasEmail),
  };
}


export async function activeProvidersFor(
  admin: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
): Promise<string[]> {
  const [{ data: enabled }, { data: granted }] = await Promise.all([
    admin.from("org_connectors").select("provider").eq("org_id", orgId).eq("status", "active"),
    admin
      .from("employee_connectors")
      .select("provider")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("status", "active"),
  ]);
  const orgProviders = new Set((enabled ?? []).map((row) => row.provider));
  const hasComposioAll = orgProviders.has("composio:all");
  return (granted ?? []).map((row) => row.provider).filter((p) => {
    if (orgProviders.has(p)) return true;
    if (hasComposioAll && connectorSpec(p).reach === "composio") return true;
    return false;
  });
}

export async function toolRuntimeFor(
  admin: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
  isManager = false,
  authorize?: ToolAuthorization,
): Promise<ToolRuntime> {
  const [{ data: enabled }, { data: granted }] = await Promise.all([
    admin.from("org_connectors").select("provider").eq("org_id", orgId).eq("status", "active"),
    admin
      .from("employee_connectors")
      .select("provider")
      .eq("org_id", orgId)
      .eq("employee_id", employeeId)
      .eq("status", "active"),
  ]);
  
  const hasAgentmail = (granted ?? []).some((row) => row.provider === "agentmail");
  const hasSlack = (granted ?? []).some((row) => row.provider === "slack");
  const local = await localToolRuntime(admin, orgId, employeeId, isManager, hasAgentmail, authorize, hasSlack);

  const composio = composioClient();
  if (!composio) return local;

  try {
    // Two gates (#250): the org must have the connector turned on, and this
    // employee must hold an active grant for it. Removing the org row takes the
    // toolkit off every employee's next turn without touching employee rows.

    const orgProviders = new Set((enabled ?? []).map((row) => row.provider));
    const hasComposioAll = orgProviders.has("composio:all");
    const toolkits = (granted ?? [])
      .map((row) => row.provider)
      .filter((provider) => connectorSpec(provider).reach === "composio" && (orgProviders.has(provider) || hasComposioAll));
    if (toolkits.length === 0) return local;

    const session = await composio.create(employeeId, {
      toolkits,
      manageConnections: false,
    }, { signal: AbortSignal.timeout(30_000) }) as ComposioSession;
    const rawComposioTools = (await session.tools(undefined, { signal: AbortSignal.timeout(30_000) })) as Anthropic.Messages.ToolUnion[];
    const composioTools = hasAgentmail
      ? rawComposioTools.filter((tool) => !("name" in tool && DISARMED_PERSONAL_MAIL_ACTIONS.has(tool.name)))
      : rawComposioTools;

    return {
      tools: [...local.tools, ...composioTools],
      execute: buildExecute(admin, orgId, employeeId, session, authorize, hasAgentmail),
    };
  } catch (err) {
    console.error("[tools] composio session failed", err);
    throw err;
  }
}

/**
 * Result blocks for a tool call that could not be executed at all (#118).
 * Every `tool_use` block needs an answer or the next Anthropic call rejects
 * the conversation. The content also steers the reply — the model must not
 * relay our infrastructure problems to the sender (#115, #116).
 */
export function toolFailureResults(
  response: Anthropic.Message,
): Anthropic.Messages.MessageParam[] {
  const content = response.content
    .filter((block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use")
    .map((block) => ({
      type: "tool_result" as const,
      tool_use_id: block.id,
      is_error: true,
      content:
        "This action is unavailable right now. Answer without it, and do not mention tools or technical problems.",
    }));
  return content.length > 0 ? [{ role: "user", content }] : [];
}
