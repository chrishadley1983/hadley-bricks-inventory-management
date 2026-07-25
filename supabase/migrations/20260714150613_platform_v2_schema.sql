-- Platform v2 (Phase 2): per-question responses, paper catalogue key,
-- recency-weighted knowledge gaps, parent PIN hashing.

CREATE TABLE IF NOT EXISTS practice.question_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES practice.attempts(id) ON DELETE CASCADE,
  question_number INT NOT NULL,
  question_id TEXT,
  category TEXT,
  subcategory TEXT,
  is_correct BOOLEAN NOT NULL,
  student_answer TEXT,
  correct_answer TEXT,
  time_taken_seconds NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_question_responses_attempt
  ON practice.question_responses(attempt_id);

ALTER TABLE practice.question_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY question_responses_select_family ON practice.question_responses
  FOR SELECT USING (
    attempt_id IN (
      SELECT a.id
      FROM practice.attempts a
      JOIN practice.students s ON a.student_id = s.id
      JOIN practice.families f ON s.family_id = f.id
      WHERE f.user_id = auth.uid()
    )
  );

ALTER TABLE practice.papers ADD COLUMN IF NOT EXISTS paper_key TEXT;
ALTER TABLE practice.papers ADD COLUMN IF NOT EXISTS level TEXT;
ALTER TABLE practice.papers ADD COLUMN IF NOT EXISTS variant INT;
ALTER TABLE practice.papers ADD COLUMN IF NOT EXISTS format TEXT;
ALTER TABLE practice.papers ADD COLUMN IF NOT EXISTS title TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_papers_paper_key
  ON practice.papers(paper_key);

ALTER TABLE practice.knowledge_gaps ADD COLUMN IF NOT EXISTS weighted_correct NUMERIC;
ALTER TABLE practice.knowledge_gaps ADD COLUMN IF NOT EXISTS weighted_total NUMERIC;
ALTER TABLE practice.knowledge_gaps ADD COLUMN IF NOT EXISTS weights_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN practice.knowledge_gaps.total_attempts IS
  'v2: number of question responses seen in this category (was: papers containing an error)';
COMMENT ON COLUMN practice.knowledge_gaps.total_correct IS
  'v2: number of correct question responses in this category (was: papers without an error)';
COMMENT ON COLUMN practice.knowledge_gaps.weighted_correct IS
  'Recency-weighted correct count (30-day half-life decay, applied on update)';
COMMENT ON COLUMN practice.knowledge_gaps.weighted_total IS
  'Recency-weighted response count (30-day half-life decay, applied on update)';

ALTER TABLE practice.families ADD COLUMN IF NOT EXISTS parent_pin_hash TEXT;

UPDATE practice.families
SET parent_pin_hash = encode(extensions.digest(id::text || ':' || parent_pin, 'sha256'), 'hex')
WHERE parent_pin IS NOT NULL AND parent_pin_hash IS NULL;;
