-- Relevance floor for knowledge retrieval (#104). Migration 0002 returned the
-- top `match_count` chunks however bad the match, so "thanks!" still pulled the
-- whole handbook into the system prompt. With a floor the count can be
-- generous: ask for more, get back only what clears the bar. The worker passes
-- p_min_score from KNOWLEDGE_MIN_SCORE so it's tunable without a migration.
--
-- Dropped and recreated, not CREATE OR REPLACE: the argument list changes, so
-- Postgres treats it as a different function and the grants must be re-issued.

drop function if exists public.match_knowledge(uuid, uuid, vector, int);

create function public.match_knowledge(
  p_org uuid,
  p_employee uuid,
  query_embedding vector(1024),
  match_count int default 12,
  p_min_score float default 0.4
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
    and 1 - (embedding <=> query_embedding) >= p_min_score
  order by embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_knowledge(uuid, uuid, vector, int, float) from public;
grant execute on function public.match_knowledge(uuid, uuid, vector, int, float) to service_role;
