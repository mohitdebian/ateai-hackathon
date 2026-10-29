import test from "node:test";
import assert from "node:assert/strict";
import { createNimClient } from "@ate/shared";

interface MockRequestBody {
  model?: string;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  }>;
  tools?: Array<{
    type: string;
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
  }>;
  tool_choice?: unknown;
}

test("NIM client converts text messages and returns Anthropic-compatible format", async (t) => {
  const originalFetch = globalThis.fetch;
  let interceptedUrl = "";
  let interceptedHeaders: Record<string, string> = {};
  let interceptedBody: MockRequestBody = { messages: [] };

  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    interceptedUrl = url.toString();
    interceptedHeaders = (init?.headers ?? {}) as Record<string, string>;
    interceptedBody = JSON.parse(init?.body as string) as MockRequestBody;

    return new Response(
      JSON.stringify({
        id: "chatcmpl-test-123",
        model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello from NVIDIA NIM!",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 42,
          completion_tokens: 12,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = createNimClient("nvapi-test-key-123");
  const response = await client.messages.create({
    system: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Hi" }],
  });

  assert.equal(interceptedUrl, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(interceptedHeaders["Authorization"], "Bearer nvapi-test-key-123");
  assert.equal(interceptedBody.model, "nvidia/nemotron-3-ultra-550b-a55b");
  assert.equal(interceptedBody.messages.length, 2);
  assert.equal(interceptedBody.messages[0].role, "system");
  assert.equal(interceptedBody.messages[0].content, "You are a helpful assistant.");
  assert.equal(interceptedBody.messages[1].role, "user");
  assert.equal(interceptedBody.messages[1].content, "Hi");

  assert.equal(response.id, "chatcmpl-test-123");
  assert.equal(response.type, "message");
  assert.equal(response.role, "assistant");
  assert.equal(response.stop_reason, "end_turn");
  assert.equal(response.content.length, 1);
  assert.equal(response.content[0].type, "text");
  if (response.content[0].type === "text") {
    assert.equal(response.content[0].text, "Hello from NVIDIA NIM!");
  }
  assert.equal(response.usage.input_tokens, 42);
  assert.equal(response.usage.output_tokens, 12);
});

test("NIM client converts tools and translates tool calls back into Anthropic tool_use blocks", async (t) => {
  const originalFetch = globalThis.fetch;
  let interceptedBody: MockRequestBody = { messages: [] };

  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    interceptedBody = JSON.parse(init?.body as string) as MockRequestBody;

    return new Response(
      JSON.stringify({
        id: "chatcmpl-tool-call",
        model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_abc123",
                  type: "function",
                  function: {
                    name: "send_message",
                    arguments: JSON.stringify({ to: "manager", text: "Task done!" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 25 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = createNimClient("nvapi-test-key");
  const response = await client.messages.create({
    messages: [{ role: "user", content: "Notify manager" }],
    tools: [
      {
        name: "send_message",
        description: "Send a message",
        input_schema: {
          type: "object",
          properties: {
            to: { type: "string" },
            text: { type: "string" },
          },
        },
      },
    ],
    tool_choice: { type: "tool", name: "send_message" },
  });

  assert.equal(interceptedBody.tools?.length, 1);
  assert.equal(interceptedBody.tools[0].type, "function");
  assert.equal(interceptedBody.tools[0].function.name, "send_message");
  assert.deepEqual(interceptedBody.tool_choice, {
    type: "function",
    function: { name: "send_message" },
  });

  assert.equal(response.stop_reason, "tool_use");
  assert.equal(response.content.length, 1);
  assert.equal(response.content[0].type, "tool_use");
  if (response.content[0].type === "tool_use") {
    assert.equal(response.content[0].id, "call_abc123");
    assert.equal(response.content[0].name, "send_message");
    assert.deepEqual(response.content[0].input, { to: "manager", text: "Task done!" });
  }
});

test("NIM client picks vision model when image block is passed", async (t) => {
  const originalFetch = globalThis.fetch;
  let interceptedBody: MockRequestBody = { messages: [] };

  globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    interceptedBody = JSON.parse(init?.body as string) as MockRequestBody;

    return new Response(
      JSON.stringify({
        id: "chatcmpl-vision",
        model: "nvidia/nemotron-3.5-super-vl-120b-a12b",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Invoice #1001 Total: $500",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 10 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = createNimClient("nvapi-test-key");
  const response = await client.messages.create({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "iVBORw0KGgoAAAANSUhEUg==",
            },
          },
          {
            type: "text",
            text: "Extract invoice text",
          },
        ],
      },
    ],
  });

  assert.equal(interceptedBody.model, "nvidia/nemotron-3.5-super-vl-120b-a12b");
  assert.equal(interceptedBody.messages[0].content.length, 2);
  const parts = interceptedBody.messages[0].content as Array<{ type: string; image_url?: { url: string }; text?: string }>;
  assert.equal(parts[0].type, "image_url");
  assert.equal(parts[0].image_url?.url, "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
  assert.equal(parts[1].type, "text");
  assert.equal(parts[1].text, "Extract invoice text");
  assert.equal(response.content[0].type, "text");
  if (response.content[0].type === "text") {
    assert.equal(response.content[0].text, "Invoice #1001 Total: $500");
  }
});
