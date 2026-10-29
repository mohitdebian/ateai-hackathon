import crypto from "crypto";

/**
 * Composio signs each delivery over `{webhook-id}.{webhook-timestamp}.{body}`
 * with HMAC-SHA256, base64, and sends it as `v1,<digest>` in `webhook-signature`
 * (docs.composio.dev/docs/webhook-verification). The secret is read per call so
 * a rotated value takes effect without a redeploy.
 */
export function verifyComposioSignature(
  rawBody: string,
  webhookId: string | null,
  timestamp: string | null,
  signature: string | null,
): boolean {
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret || !webhookId || !timestamp || !signature) return false;

  // Reject replays outside Composio's default 300s tolerance.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${webhookId}.${timestamp}.${rawBody}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  // A header may carry several space-separated versioned signatures.
  return signature.split(" ").some((candidate) => {
    const sig = Buffer.from(candidate.split(",")[1] ?? candidate);
    return sig.length === expectedBuf.length && crypto.timingSafeEqual(sig, expectedBuf);
  });
}
