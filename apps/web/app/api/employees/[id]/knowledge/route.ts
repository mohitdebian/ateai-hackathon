import { NextResponse } from "next/server";
import { embedTexts, groupDocumentsByTitle } from "@ate/shared";
import { getOrgContext } from "../../../../../lib/auth";
import { createClient } from "../../../../../lib/supabase/server";
import { voyageApiKey } from "../../../../../lib/env";
import { chunkText } from "../../../../../lib/knowledge/chunk";
import {
  extractText,
  FileTooLargeError,
  UnsupportedFileError,
} from "../../../../../lib/knowledge/extract";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** List an employee's uploaded knowledge (grouped by document title). */
export async function GET(_req: Request, { params }: Ctx) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id: employeeId } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_docs")
    .select("title, chunk_index, created_at")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ docs: groupDocumentsByTitle(data ?? []) });
}

/**
 * Train step: chunk a document, embed it, store in pgvector.
 *
 * Two intakes, one pipeline: pasted text arrives as JSON, while uploaded files
 * (PDF, .docx, .txt, .md) arrive as multipart and are parsed server-side (#94).
 */
export async function POST(request: Request, { params }: Ctx) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id: employeeId } = await params;

  let title: unknown;
  let content: unknown;

  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "a file is required" }, { status: 400 });
    }
    try {
      content = await extractText(file);
    } catch (err) {
      if (err instanceof FileTooLargeError) {
        return NextResponse.json({ error: err.message }, { status: 413 });
      }
      if (err instanceof UnsupportedFileError) {
        return NextResponse.json({ error: err.message }, { status: 415 });
      }
      // A corrupt or password-protected document lands here.
      const detail = err instanceof Error ? err.message : "could not read that file";
      return NextResponse.json({ error: `Could not read that file: ${detail}` }, { status: 400 });
    }
    const formTitle = form.get("title");
    title = typeof formTitle === "string" && formTitle.trim()
      ? formTitle
      : file.name.replace(/\.[^.]+$/, "");
  } else {
    try {
      ({ title, content } = await request.json());
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }
  }

  if (typeof title !== "string" || typeof content !== "string" || content.trim().length < 20) {
    return NextResponse.json({ error: "title and non-trivial content are required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Confirm the employee is in the caller's org (RLS also enforces this).
  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("id", employeeId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "employee not found" }, { status: 404 });

  const chunks = chunkText(content);
  let embeddings: number[][];
  try {
    embeddings = await embedTexts(chunks, { apiKey: voyageApiKey(), inputType: "document" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "embedding failed";
    return NextResponse.json({ error: detail }, { status: 502 });
  }

  const rows = chunks.map((chunk, i) => ({
    org_id: ctx.orgId,
    employee_id: employeeId,
    title,
    content: chunk,
    chunk_index: i,
    embedding: JSON.stringify(embeddings[i]),
  }));

  const { error } = await supabase.from("knowledge_docs").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, chunks: rows.length });
}

/**
 * Remove every chunk for a document title (#105). Retrieval reads
 * knowledge_docs live, so the doc leaves the employee's knowledge at once.
 */
export async function DELETE(request: Request, { params }: Ctx) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id: employeeId } = await params;

  const title = new URL(request.url).searchParams.get("title");
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("knowledge_docs")
    .delete({ count: "exact" })
    .eq("employee_id", employeeId)
    .eq("org_id", ctx.orgId)
    .eq("title", title);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // Deleting nothing is not success: the title is stale (already removed in
  // another tab) or wrong. RLS also filters rather than raising, so a caller
  // without write access lands here too once roles beyond admin exist.
  if (!count) return NextResponse.json({ error: "document not found" }, { status: 404 });

  return NextResponse.json({ ok: true, chunks: count });
}
