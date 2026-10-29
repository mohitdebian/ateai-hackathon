import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, DocumentSummary, KnowledgeChunk, KnowledgeRetriever } from "@ate/shared";
import { embedTexts, groupDocumentsByTitle, stubKnowledgeRetriever } from "@ate/shared";

export type { DocumentSummary } from "@ate/shared";

const envMinScore = Number(process.env.KNOWLEDGE_MIN_SCORE);
const MIN_SCORE = Number.isFinite(envMinScore) && envMinScore > 0 ? envMinScore : 0.3;

const MATCH_COUNT = 12;
const CHAR_BUDGET = 6_000;
const KEEP_RATIO = 0.9;
const DOC_CHAR_BUDGET = 20_000;

// ponytail: regex misses arbitrary small talk; expose knowledge as a model-chosen tool if that matters.
const NON_QUERY =
  /^(?:ok(?:ay)?|k|thanks?(?: (?:a lot|so much|again))?|thank you|thx|ty|got it|noted|understood|sure(?: thing)?|sounds good|makes sense|yes|yeah|yep|no|nope|np|no worries|cool|nice|great|perfect|awesome|hi|hey|hello|bye|cheers|will do|(?:(?:i|we) ll|will) (?:look into it|take a look|get back to you|follow up))$/;

export function isContentless(query: string): boolean {
  const normalized = query.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return normalized.length === 0 || NON_QUERY.test(normalized);
}

export function fitChunks(bestFirst: KnowledgeChunk[], budget = CHAR_BUDGET): KnowledgeChunk[] {
  const top = bestFirst[0]?.score ?? 0;
  const kept: KnowledgeChunk[] = [];
  let used = 0;
  for (const chunk of bestFirst) {
    if (chunk.score < top * KEEP_RATIO) break;
    used += chunk.content.length;
    if (used > budget && kept.length > 0) break;
    kept.push(chunk);
  }
  return kept;
}

/**
 * pgvector-backed KnowledgeRetriever. Embeds the query with Voyage, then
 * runs cosine similarity search via the `match_knowledge` RPC, scoped to the
 * employee and floored at MIN_SCORE. Falls back to the stub when the Voyage
 * key is absent.
 */
export function createKnowledgeRetriever(
  client: SupabaseClient<Database>,
  voyageApiKey: string | undefined,
): KnowledgeRetriever {
  if (!voyageApiKey) return stubKnowledgeRetriever;

  return {
    async retrieve(orgId, employeeId, query, limit = MATCH_COUNT) {
      if (isContentless(query)) return [];

      const [embedding] = await embedTexts([query], {
        apiKey: voyageApiKey,
        inputType: "query",
      });
      const { data, error } = await client.rpc("match_knowledge", {
        p_org: orgId,
        p_employee: employeeId,
        query_embedding: JSON.stringify(embedding),
        match_count: limit,
        p_min_score: MIN_SCORE,
      });
      if (error) throw new Error(`match_knowledge failed: ${error.message}`);
      const chunks = fitChunks(
        (data ?? []).map((r) => ({
          doc_id: r.doc_id,
          title: r.title,
          content: r.content,
          score: r.score,
        })),
      );
      // Junk coming through means raise MIN_SCORE, a persistent 0 means lower it.
      console.log(
        `[knowledge] ${chunks.length} chunk(s) over ${MIN_SCORE}` +
          (chunks[0] ? `, top ${chunks[0].score.toFixed(3)}` : ""),
      );
      return chunks;
    },
  };
}

export async function listDocuments(
  client: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
): Promise<DocumentSummary[]> {
  const { data, error } = await client
    .from("knowledge_docs")
    .select("title, created_at")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listDocuments failed: ${error.message}`);

  return groupDocumentsByTitle(data ?? []);
}

export function resolveTitle(requested: string, available: string[]): string | null {
  const normalized = requested.trim().toLowerCase();
  return available.find((title) => title.trim().toLowerCase() === normalized) ?? null;
}

export function fitDocument(chunks: string[], budget = DOC_CHAR_BUDGET): string {
  const full = chunks.join("\n\n");
  if (full.length <= budget) return full;
  return `${full.slice(0, budget)}\n\n[truncated — document continues beyond what fits here]`;
}

export async function readDocument(
  client: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
  title: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("knowledge_docs")
    .select("content, chunk_index, created_at")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .eq("title", title)
    .order("created_at", { ascending: false })
    .order("chunk_index", { ascending: true });
  if (error) throw new Error(`readDocument failed: ${error.message}`);
  if (!data || data.length === 0) return null;

  // Exact-equality works because one upload is one batch insert, so Postgres stamps every chunk the same.
  const latestUpload = data[0].created_at;
  const chunks = data.filter((row) => row.created_at === latestUpload).map((row) => row.content);
  return fitDocument(chunks);
}
