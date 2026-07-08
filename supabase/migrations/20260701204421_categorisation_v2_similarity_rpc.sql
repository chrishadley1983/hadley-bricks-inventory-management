-- pg_trgm-backed similar-transaction lookup. The engine has been silently
-- falling back to token matching because this RPC never existed.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_finance_transactions_desc_trgm
  ON finance.transactions USING gin (lower(description) extensions.gin_trgm_ops);

CREATE OR REPLACE FUNCTION finance.find_similar_transactions(
  search_description text,
  min_similarity double precision DEFAULT 0.3,
  max_results int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  description text,
  category_id uuid,
  category_name text,
  similarity double precision,
  date date
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    t.id,
    t.description,
    t.category_id,
    c.name AS category_name,
    extensions.similarity(lower(t.description), lower(search_description))::double precision AS similarity,
    t.date
  FROM finance.transactions t
  JOIN finance.categories c ON c.id = t.category_id
  WHERE t.category_id IS NOT NULL
    -- Never learn from rows still awaiting review: unverified guesses must not
    -- become precedents for future guesses.
    AND COALESCE(t.needs_review, false) = false
    AND extensions.similarity(lower(t.description), lower(search_description)) >= min_similarity
  ORDER BY similarity DESC, t.date DESC
  LIMIT max_results;
$$;;
