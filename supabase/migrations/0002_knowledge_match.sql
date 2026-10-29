-- Knowledge retrieval. Cosine-similarity search over an employee's
-- knowledge chunks. Called by the worker's KnowledgeRetriever at turn start
-- with the query embedding (docs/architecture.md "The flow").
--
-- SECURITY DEFINER + explicit org/employee scoping: the worker calls this via
-- the service role, so the function itself enforces the tenant boundary.

create or replace function public.match_knowledge(
  p_org uuid,
  p_employee uuid,
  query_embedding vector(1024),
  match_count int default 5
)
returns table (doc_id uuid, title text, content text, score float)
language sql stable security definer set search_path = public as $$
  select
    id as doc_id,
    title,
    content,
    1 - (embedding <=> query_embedding) as score
  from knowledge_docs
  where org_id = p_org
    and employee_id = p_employee
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_knowledge(uuid, uuid, vector, int) from public;
grant execute on function public.match_knowledge(uuid, uuid, vector, int) to service_role;
