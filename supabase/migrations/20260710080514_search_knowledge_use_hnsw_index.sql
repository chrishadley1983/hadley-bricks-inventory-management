-- search_knowledge was seq-scanning all ~27.6k knowledge_chunks (ORDER BY
-- 1-(embedding<=>q) DESC cannot use the HNSW index), exceeding the REST
-- role's statement timeout as the KB grew -> every /brain/search 500'd.
-- Rewrite: HNSW KNN first (index-friendly ORDER BY distance ASC, oversampled
-- 5x to survive the post-filters), then join/filter the small candidate set.
CREATE OR REPLACE FUNCTION public.search_knowledge(query_embedding vector, match_threshold double precision DEFAULT 0.75, match_count integer DEFAULT 20, min_decay double precision DEFAULT 0.2, capture_types text[] DEFAULT NULL::text[], exclude_parent uuid DEFAULT NULL::uuid)
 RETURNS TABLE(chunk_id uuid, parent_id uuid, chunk_index integer, chunk_content text, similarity double precision, content_type text, capture_type text, title text, source_url text, source_message_id text, source_system text, full_text text, summary text, topics text[], base_priority double precision, last_accessed_at timestamp with time zone, access_count integer, decay_score double precision, created_at timestamp with time zone, promoted_at timestamp with time zone, status text, facts jsonb, concepts jsonb)
 LANGUAGE plpgsql
AS $function$
DECLARE
    knn_limit integer := GREATEST(match_count * 5, 100);
BEGIN
    -- HNSW returns at most ef_search candidates; lift it to cover knn_limit
    PERFORM set_config('hnsw.ef_search', GREATEST(knn_limit, 100)::text, true);

    RETURN QUERY
    WITH nn AS MATERIALIZED (
        SELECT
            c.id,
            c.parent_id AS nn_parent_id,
            c.chunk_index,
            c.content,
            c.embedding <=> query_embedding AS dist
        FROM knowledge_chunks c
        WHERE c.embedding IS NOT NULL
        ORDER BY c.embedding <=> query_embedding
        LIMIT knn_limit
    )
    SELECT
        nn.id AS chunk_id,
        nn.nn_parent_id AS parent_id,
        nn.chunk_index,
        nn.content AS chunk_content,
        1 - nn.dist AS similarity,
        ki.content_type,
        ki.capture_type,
        ki.title,
        ki.source_url,
        ki.source_message_id,
        ki.source_system,
        ki.full_text,
        ki.summary,
        ki.topics,
        ki.base_priority,
        ki.last_accessed_at,
        ki.access_count,
        ki.decay_score,
        ki.created_at,
        ki.promoted_at,
        ki.status,
        ki.facts,
        ki.concepts
    FROM nn
    JOIN knowledge_items ki ON nn.nn_parent_id = ki.id
    WHERE
        ki.status = 'active'
        AND ki.decay_score >= min_decay
        AND 1 - nn.dist >= match_threshold
        AND (capture_types IS NULL OR ki.capture_type = ANY(capture_types))
        AND (exclude_parent IS NULL OR nn.nn_parent_id != exclude_parent)
    ORDER BY similarity DESC
    LIMIT match_count;
END;
$function$;;
