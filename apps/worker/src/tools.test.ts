import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@ate/shared";
import { buildExecute, DISARMED_PERSONAL_MAIL_ACTIONS, runSearchWeb, SEARCH_WEB_TOOL } from "./tools.js";

test("an unknown completion stops later tool executions", async () => {
  let calls = 0;
  const session = {
    async execute() {
      calls++;
      const error = new Error("cancelled");
      error.name = "ComposioRequestCancelledError";
      throw error;
    },
  };
  const execute = buildExecute({} as SupabaseClient<Database>, "org", "employee", session as never);
  const response = { content: [
    { type: "tool_use", id: "first", name: "SEND_EMAIL", input: {} },
    { type: "tool_use", id: "second", name: "SEND_EMAIL", input: {} },
  ] } as Anthropic.Message;

  const result = await execute(response);

  assert.equal(calls, 1);
  assert.equal(result.outcomes[0]?.completionUnknown, true);
  assert.match(result.outcomes[1]?.error ?? "", /Not run/);
});

test("a failed tool call still shows the model its data", async () => {
  const session = {
    async execute() {
      return { error: "Some tools were not found", data: { suggestions: ["GMAIL_SEND_EMAIL"] }, logId: "log" };
    },
  };
  const execute = buildExecute({} as SupabaseClient<Database>, "org", "employee", session as never);
  const response = { content: [{ type: "tool_use", id: "only", name: "GMAIL_SEND", input: {} }] } as Anthropic.Message;

  const result = await execute(response);

  assert.match(JSON.stringify(result.messages[0]?.content), /GMAIL_SEND_EMAIL/);
  assert.equal(result.outcomes[0]?.error, "Some tools were not found");
});

test("an automatic tool denial never reaches the connected app", async () => {
  let calls = 0;
  const session = { async execute() { calls++; return { error: null, data: {} }; } };
  const execute = buildExecute({} as SupabaseClient<Database>, "org", "employee", session as never,
    async () => "Manager approval is required");
  const response = { content: [{ type: "tool_use", id: "only", name: "ANY_CONNECTED_APP_WRITE",
    input: { destination: "unknown" } }] } as Anthropic.Message;

  const result = await execute(response);

  assert.equal(calls, 0);
  assert.equal(result.outcomes[0]?.successful, false);
  assert.match(result.outcomes[0]?.error ?? "", /Manager approval/);
});

test("a partially failed Composio batch stops later actions", async () => {
  let calls = 0;
  const session = { async execute() {
    calls++;
    return { error: null, data: { results: [{ successful: true }, { successful: false }] } };
  } };
  const execute = buildExecute({} as SupabaseClient<Database>, "org", "employee", session as never);
  const response = { content: [
    { type: "tool_use", id: "batch", name: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [] } },
    { type: "tool_use", id: "next", name: "COMPOSIO_MULTI_EXECUTE_TOOL", input: { tools: [] } },
  ] } as Anthropic.Message;

  const result = await execute(response);

  assert.equal(calls, 1);
  assert.equal(result.outcomes[0]?.completionUnknown, true);
  assert.match(result.outcomes[1]?.error ?? "", /Not run/);
});

test("runSearchWeb validates empty query", async () => {
  const result = await runSearchWeb({ query: "" });
  assert.equal(result.ok, false);
  assert.match(result.message, /Search query is required/);
});

test("runSearchWeb informs when neither SEARCH_ENGINE_URL nor TAVILY_API_KEY is configured", async () => {
  const origKey = process.env.TAVILY_API_KEY;
  const origUrl = process.env.SEARCH_ENGINE_URL;
  delete process.env.TAVILY_API_KEY;
  delete process.env.SEARCH_ENGINE_URL;
  try {
    const result = await runSearchWeb({ query: "acne skincare products" });
    assert.equal(result.ok, false);
    assert.match(result.message, /SEARCH_ENGINE_URL or TAVILY_API_KEY/);
  } finally {
    if (origKey !== undefined) process.env.TAVILY_API_KEY = origKey;
    if (origUrl !== undefined) process.env.SEARCH_ENGINE_URL = origUrl;
  }
});

test("runSearchWeb queries custom SEARCH_ENGINE_URL with optional token", async (t) => {
  const origUrl = process.env.SEARCH_ENGINE_URL;
  const origToken = process.env.SEARCH_ENGINE_TOKEN;
  process.env.SEARCH_ENGINE_URL = "https://custom-search.example.com";
  process.env.SEARCH_ENGINE_TOKEN = "secret-token";

  let requestedUrl = "";
  let authHeader = "";

  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
    if (origUrl !== undefined) process.env.SEARCH_ENGINE_URL = origUrl;
    else delete process.env.SEARCH_ENGINE_URL;
    if (origToken !== undefined) process.env.SEARCH_ENGINE_TOKEN = origToken;
    else delete process.env.SEARCH_ENGINE_TOKEN;
  });

  globalThis.fetch = async (input: unknown, init?: unknown) => {
    requestedUrl = String(input);
    authHeader = ((init as { headers?: Record<string, string> })?.headers?.["Authorization"]) ?? "";
    return new Response(
      JSON.stringify({
        results: [
          {
            title: "Custom Search Result",
            url: "https://example.com/item",
            content: "Top match from custom engine",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await runSearchWeb({ query: "test query" });
  assert.equal(result.ok, true);
  assert.match(requestedUrl, /https:\/\/custom-search\.example\.com\/search\?q=test%20query/);
  assert.equal(authHeader, "Bearer secret-token");
  assert.match(result.message, /Custom Search Result/);
  assert.match(result.message, /https:\/\/example.com\/item/);
});

test("runSearchWeb formats Tavily search results and answer", async (t) => {
  const origKey = process.env.TAVILY_API_KEY;
  const origUrl = process.env.SEARCH_ENGINE_URL;
  delete process.env.SEARCH_ENGINE_URL;
  process.env.TAVILY_API_KEY = "test-tavily-key";
  
  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
    if (origKey !== undefined) process.env.TAVILY_API_KEY = origKey;
    else delete process.env.TAVILY_API_KEY;
    if (origUrl !== undefined) process.env.SEARCH_ENGINE_URL = origUrl;
    else delete process.env.SEARCH_ENGINE_URL;
  });

  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        answer: "Salicylic acid and niacinamide are top recommended ingredients for acne.",
        results: [
          {
            title: "Best Acne Cleansers of 2026",
            url: "https://example.com/acne-cleansers",
            content: "Gentle daily cleansers containing BHA help keep pores clear without drying out skin.",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await runSearchWeb({ query: "best acne cleansers" });
  assert.equal(result.ok, true);
  assert.match(result.message, /Salicylic acid and niacinamide/);
  assert.match(result.message, /Best Acne Cleansers of 2026/);
  assert.match(result.message, /https:\/\/example.com\/acne-cleansers/);
});

test("runSearchWeb queries Hugging Face Gradio space via SSE protocol", async (t) => {
  const origUrl = process.env.SEARCH_ENGINE_URL;
  const origToken = process.env.SEARCH_ENGINE_TOKEN;
  process.env.SEARCH_ENGINE_URL = "https://my-space.hf.space";
  process.env.SEARCH_ENGINE_TOKEN = "hf_token_xyz";

  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
    if (origUrl !== undefined) process.env.SEARCH_ENGINE_URL = origUrl;
    else delete process.env.SEARCH_ENGINE_URL;
    if (origToken !== undefined) process.env.SEARCH_ENGINE_TOKEN = origToken;
    else delete process.env.SEARCH_ENGINE_TOKEN;
  });

  const calls: { url: string; auth: string; body?: unknown }[] = [];
  globalThis.fetch = async (input: unknown, init?: unknown) => {
    const url = String(input);
    const headers = (init as { headers?: Record<string, string> })?.headers;
    const auth = headers?.["Authorization"] ?? "";
    calls.push({ url, auth });

    if (url.includes("/gradio_api/call/search/test-event-123")) {
      const sseData = `event: complete\ndata: [[{"title":"HF Result","url":"https://hf.space/doc","content":"Snippet from HF"}]]\n\n`;
      return new Response(sseData, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }

    if (url.includes("/gradio_api/call/search")) {
      return new Response(JSON.stringify({ event_id: "test-event-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  };

  const result = await runSearchWeb({ query: "hormonal acne" });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].auth, "Bearer hf_token_xyz");
  assert.match(calls[0].url, /\/gradio_api\/call\/search$/);
  assert.match(calls[1].url, /\/gradio_api\/call\/search\/test-event-123$/);
  assert.match(result.message, /HF Result/);
  assert.match(result.message, /https:\/\/hf.space\/doc/);
});

test("search_web dispatches via buildExecute", async () => {
  const origKey = process.env.TAVILY_API_KEY;
  const origUrl = process.env.SEARCH_ENGINE_URL;
  delete process.env.TAVILY_API_KEY;
  delete process.env.SEARCH_ENGINE_URL;

  try {
    const execute = buildExecute({} as SupabaseClient<Database>, "org", "employee", undefined);
    const response = {
      content: [
        { type: "tool_use", id: "search_1", name: SEARCH_WEB_TOOL.name, input: { query: "skincare routine" } },
      ],
    } as Anthropic.Message;

    const result = await execute(response);
    assert.equal(result.outcomes.length, 1);
    assert.equal(result.outcomes[0]?.tool, "search_web");
    assert.match(result.outcomes[0]?.error ?? "", /SEARCH_ENGINE_URL or TAVILY_API_KEY/);
  } finally {
    if (origKey !== undefined) process.env.TAVILY_API_KEY = origKey;
    if (origUrl !== undefined) process.env.SEARCH_ENGINE_URL = origUrl;
  }
});

test("disarmed personal mail tools are blocked fail-closed when hasAgentmail is true", async () => {
  let sessionCalls = 0;
  const session = {
    async execute() {
      sessionCalls++;
      return { error: null, data: {} };
    },
  };

  const execute = buildExecute(
    {} as SupabaseClient<Database>,
    "org",
    "employee",
    session as never,
    undefined,
    true, // hasAgentmail
  );

  for (const toolName of DISARMED_PERSONAL_MAIL_ACTIONS) {
    const response = {
      content: [
        { type: "tool_use", id: `call_${toolName}`, name: toolName, input: { to: "user@example.com" } },
      ],
    } as Anthropic.Message;

    const result = await execute(response);
    assert.equal(result.outcomes.length, 1);
    assert.equal(result.outcomes[0]?.tool, toolName);
    assert.equal(result.outcomes[0]?.successful, false);
    assert.match(result.outcomes[0]?.error ?? "", /Direct outbound sending via personal mailboxes is disabled/);
    assert.match(JSON.stringify(result.messages[0]?.content), /Direct outbound sending via personal mailboxes is disabled/);
  }

  assert.equal(sessionCalls, 0);
});

test("non-disarmed actions like GMAIL_CREATE_EMAIL_DRAFT are permitted even when hasAgentmail is true", async () => {
  let sessionCalls = 0;
  let executedAction = "";
  const session = {
    async execute(name: string) {
      sessionCalls++;
      executedAction = name;
      return { error: null, data: { draft_id: "draft_123" } };
    },
  };

  const execute = buildExecute(
    {} as SupabaseClient<Database>,
    "org",
    "employee",
    session as never,
    undefined,
    true, // hasAgentmail
  );

  const response = {
    content: [
      { type: "tool_use", id: "draft_call", name: "GMAIL_CREATE_EMAIL_DRAFT", input: { to: "boss@example.com" } },
    ],
  } as Anthropic.Message;

  const result = await execute(response);
  assert.equal(sessionCalls, 1);
  assert.equal(executedAction, "GMAIL_CREATE_EMAIL_DRAFT");
  assert.equal(result.outcomes[0]?.successful, true);
});



