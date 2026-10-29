import Anthropic from "@anthropic-ai/sdk";
import { createNimClient } from "@ate/shared";
import { anthropicApiKey, isNimConfigured, nimApiKey } from "./env";

let anthropicClient: Anthropic | null = null;
let nimClient: Anthropic | null = null;

/** Server-only Anthropic or NVIDIA NIM client (used by the create step). */
export function anthropic(): Anthropic {
  if (isNimConfigured()) {
    if (!nimClient) {
      nimClient = createNimClient(nimApiKey()) as unknown as Anthropic;
    }
    return nimClient;
  }
  // 529 Overloaded is routine, so keep the SDK's two retries; the 120s cap is
  // per attempt, which is what stops a hung call rather than a busy one.
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: anthropicApiKey(), timeout: 120_000, maxRetries: 2 });
  }
  return anthropicClient;
}
