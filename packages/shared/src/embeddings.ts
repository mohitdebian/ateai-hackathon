/**
 * Voyage AI embeddings. Anthropic's recommended embeddings partner.
 * `voyage-3.5` at 1024 dimensions matches the `knowledge_docs.embedding
 * vector(1024)` column. Used on both sides: the web app embeds documents on
 * upload, the worker embeds the query at retrieval. Plain fetch, no SDK.
 */
export const EMBEDDING_MODEL = "voyage-3.5";
export const EMBEDDING_DIM = 1024;

/** Documents are embedded for storage; queries with the query input type. */
export type EmbeddingInputType = "document" | "query";

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
}

/**
 * Embed a batch of texts. Returns one vector per input, in input order.
 * Throws (fail loud) on a non-2xx response so the caller surfaces it.
 */
export async function embedTexts(
  texts: string[],
  opts: { apiKey: string; inputType: EmbeddingInputType },
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: EMBEDDING_MODEL,
      input_type: opts.inputType,
      output_dimension: EMBEDDING_DIM,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`voyage embeddings ${res.status}: ${body}`);
  }
  const json = (await res.json()) as VoyageResponse;
  return json.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}
