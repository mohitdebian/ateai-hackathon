import type { Counterparty, Envelope } from "@ate/shared";
import { MODELS } from "@ate/shared";
import { anthropic, textOf } from "./anthropic.js";
import { plainText } from "./format.js";

/** Long enough that only a real wait is announced; any turn using tools passes 10s. */
export const NOTICE_AFTER_MS = 25_000;

export const FALLBACK_NOTICE = "Let me check on that.";

const NOTICE_SYSTEM_PROMPT =
  "The message below may take you a little while to deal with. Write one short, casual " +
  "sentence that takes up what was actually asked and hints you need a moment to get to it. " +
  "You do not have the answer yet, so never answer the question or state any fact about the " +
  "work. Never open with an acknowledgement word such as Understood, Noted or Got it. No " +
  "greeting, no markdown, no dashes, no promise to report back later, no specific time, and " +
  "never describe how you work or what tools you use. Vary the wording each time.";

/**
 * Who the notice is addressed to (#43). The full counterparty briefing in
 * `prompt.ts` is about candor and disclosure over a whole turn; a one-sentence
 * acknowledgement only needs the name and whether the sender is external.
 */
export function addressee(counterparty: Counterparty | undefined): string {
  if (!counterparty || counterparty.kind === "external") {
    return (
      "\n\nThe sender is outside the company" +
      (counterparty?.name ? ` (${counterparty.name})` : "") +
      ". Name no internal system, document, or colleague."
    );
  }
  return counterparty.name ? `\n\nThe sender is ${counterparty.name}, a colleague.` : "";
}

export function cleanNotice(raw: string): string {
  const text = plainText(raw)
    .split("\n")[0]
    .trim()
    .replace(/^["']|["']$/g, "")
    // The prompt forbids these and the model used one anyway, so make it true here.
    .replace(/\s*[—–]\s*/g, ", ");
  if (!text || text.length > 200) return FALLBACK_NOTICE;
  return text;
}

export async function composeNotice(envelope: Envelope): Promise<string> {
  try {
    const result = await anthropic().messages.create({
      model: MODELS.sonnet,
      max_tokens: 48,
      system: NOTICE_SYSTEM_PROMPT + addressee(envelope.counterparty),
      messages: [{ role: "user", content: envelope.text }],
    });
    return cleanNotice(textOf(result));
  } catch (err) {
    console.error("[notice] compose failed", err);
    return FALLBACK_NOTICE;
  }
}

export const STOP_WAIT_MS = 8_000;

export function noticeAfter(
  afterMs: number,
  send: () => Promise<void>,
  stopWaitMs = STOP_WAIT_MS,
): () => Promise<void> {
  let sent: Promise<void> | null = null;
  const timer = setTimeout(() => {
    sent = send().catch((err: unknown) => console.error("[notice] send failed", err));
  }, afterMs);
  return async () => {
    clearTimeout(timer);
    if (!sent) return;
    await Promise.race([sent, new Promise<void>((resolve) => setTimeout(resolve, stopWaitMs))]);
  };
}
