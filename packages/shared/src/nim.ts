/**
 * NVIDIA NIM (Inference Microservice) client adapter.
 *
 * Implements the Anthropic messages.create interface over NVIDIA NIM's
 * OpenAI-compatible /v1/chat/completions endpoint, allowing the entire agent
 * turn loop, tool-calling, and OCR vision to run completely on NVIDIA's free API
 * without needing an Anthropic API key.
 */

export interface NimMessage {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
}

export interface NimBlock {
  type: string;
  text?: string;
  tool_use_id?: string;
  content?: unknown;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  source?: {
    type?: string;
    media_type?: string;
    data?: string;
  };
}

export interface NimToolParam {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export interface NimMessageParam {
  role: string;
  content: string | NimBlock[];
}

export interface NimCreateOptions {
  model?: string;
  max_tokens?: number;
  system?: string;
  messages: NimMessageParam[];
  tools?: NimToolParam[];
  tool_choice?: { type: string; name?: string } | string;
  temperature?: number;
}

interface OpenAiPart {
  type: string;
  text?: string;
  image_url?: { url: string };
}

interface OpenAiMessage {
  role: string;
  content: string | OpenAiPart[] | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

interface NimApiResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      role?: string;
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export function createNimClient(apiKey: string, baseURL?: string) {
  const url = (baseURL || process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");

  return {
    messages: {
      create: async (params: NimCreateOptions, requestOptions?: { signal?: AbortSignal }): Promise<NimMessage> => {
        const hasImages = params.messages.some((m) =>
          Array.isArray(m.content) && m.content.some((b) => b.type === "image" || b.type === "document")
        );

        // Pick model: custom env var, or vision model if images present, or default Nemotron 3 Ultra 550B
        const defaultModel = "nvidia/nemotron-3-ultra-550b-a55b";
        const defaultVisionModel = "nvidia/nemotron-3.5-super-vl-120b-a12b";
        const model =
          hasImages
            ? (process.env.NVIDIA_VISION_MODEL || defaultVisionModel)
            : (process.env.NVIDIA_MODEL || defaultModel);

        const openAiMessages: OpenAiMessage[] = [];
        if (params.system) {
          openAiMessages.push({ role: "system", content: params.system });
        }

        for (const msg of params.messages) {
          if (typeof msg.content === "string") {
            openAiMessages.push({ role: msg.role, content: msg.content });
            continue;
          }

          if (Array.isArray(msg.content)) {
            const toolUses = msg.content.filter((b) => b.type === "tool_use");
            const textBlocks = msg.content.filter((b) => b.type === "text");
            const toolResults = msg.content.filter((b) => b.type === "tool_result");
            const imageBlocks = msg.content.filter((b) => b.type === "image" || b.type === "document");

            if (toolResults.length > 0) {
              for (const tr of toolResults) {
                openAiMessages.push({
                  role: "tool",
                  tool_call_id: tr.tool_use_id,
                  content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content ?? ""),
                });
              }
            } else if (toolUses.length > 0) {
              openAiMessages.push({
                role: "assistant",
                content: textBlocks.map((t) => t.text ?? "").join("\n") || null,
                tool_calls: toolUses.map((tu) => ({
                  id: tu.id ?? `call_${Date.now()}`,
                  type: "function",
                  function: {
                    name: tu.name ?? "",
                    arguments: JSON.stringify(tu.input ?? {}),
                  },
                })),
              });
            } else if (imageBlocks.length > 0) {
              const parts: OpenAiPart[] = [];
              for (const b of msg.content) {
                if (b.type === "text") {
                  parts.push({ type: "text", text: b.text ?? "" });
                } else if ((b.type === "image" || b.type === "document") && b.source?.type === "base64") {
                  parts.push({
                    type: "image_url",
                    image_url: {
                      url: `data:${b.source.media_type || "image/jpeg"};base64,${b.source.data}`,
                    },
                  });
                }
              }
              openAiMessages.push({ role: msg.role, content: parts });
            } else {
              openAiMessages.push({
                role: msg.role,
                content: textBlocks.map((t) => t.text ?? "").join("\n"),
              });
            }
          }
        }

        // Tools format conversion
        let openAiTools: OpenAiTool[] | undefined;
        if (params.tools && params.tools.length > 0) {
          openAiTools = params.tools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema ?? {},
            },
          }));
        }

        // Tool choice conversion
        let openAiToolChoice: unknown = undefined;
        if (params.tool_choice) {
          if (typeof params.tool_choice === "object" && params.tool_choice.type === "tool" && params.tool_choice.name) {
            openAiToolChoice = {
              type: "function",
              function: { name: params.tool_choice.name },
            };
          } else if (typeof params.tool_choice === "object" && params.tool_choice.type === "any") {
            openAiToolChoice = "required";
          } else if (typeof params.tool_choice === "object" && params.tool_choice.type === "auto") {
            openAiToolChoice = "auto";
          } else if (typeof params.tool_choice === "string") {
            openAiToolChoice = params.tool_choice;
          }
        }

        const body: Record<string, unknown> = {
          model,
          messages: openAiMessages,
          max_tokens: params.max_tokens ?? 4096,
          temperature: params.temperature ?? 0.2,
        };

        if (openAiTools) body.tools = openAiTools;
        if (openAiToolChoice) body.tool_choice = openAiToolChoice;

        const MAX_RETRIES = 2;
        let lastError: Error | null = null;
        let response: Response | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            response = await fetch(`${url}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(body),
              signal: requestOptions?.signal ?? AbortSignal.timeout(120_000),
            });

            if (response.ok) break;

            const errBody = await response.text().catch(() => "");
            lastError = new Error(`NVIDIA NIM API error ${response.status}: ${errBody}`);

            const isRetryable = response.status === 429 || (response.status >= 500 && response.status <= 504);
            if (!isRetryable || attempt === MAX_RETRIES) {
              throw lastError;
            }

            const delay = 1000 * Math.pow(2, attempt);
            console.warn(`[nim] attempt ${attempt + 1} failed (${response.status}), retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt === MAX_RETRIES || (err instanceof Error && err.name === "AbortError")) {
              throw lastError;
            }
            const delay = 1000 * Math.pow(2, attempt);
            console.warn(`[nim] network attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        if (!response || !response.ok) {
          throw lastError || new Error("NVIDIA NIM request failed");
        }

        const data = (await response.json()) as NimApiResponse;
        const choice = data.choices?.[0];

        const content: Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
        > = [];

        if (choice?.message?.content) {
          content.push({ type: "text", text: choice.message.content });
        } else if (
          choice?.message?.reasoning_content &&
          (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0)
        ) {
          content.push({ type: "text", text: choice.message.reasoning_content });
        }

        if (choice?.message?.tool_calls && Array.isArray(choice.message.tool_calls)) {
          for (const tc of choice.message.tool_calls) {
            let parsedInput: Record<string, unknown> = {};
            try {
              parsedInput = JSON.parse(tc.function.arguments || "{}");
            } catch {
              parsedInput = { raw: tc.function.arguments };
            }
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input: parsedInput,
            });
          }
        }

        let stopReason: "end_turn" | "tool_use" | "max_tokens" | null = "end_turn";
        if (choice?.finish_reason === "tool_calls" || (choice?.message?.tool_calls && choice.message.tool_calls.length > 0)) {
          stopReason = "tool_use";
        } else if (choice?.finish_reason === "length") {
          stopReason = "max_tokens";
        }

        return {
          id: data.id || `nim-${Date.now()}`,
          type: "message",
          role: "assistant",
          content,
          model: data.model || model,
          stop_reason: stopReason,
          usage: {
            input_tokens: data.usage?.prompt_tokens ?? 0,
            output_tokens: data.usage?.completion_tokens ?? 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        };
      },
    },
  };
}
