ALTER TABLE practice.papers DROP CONSTRAINT IF EXISTS practice_papers_source_type_check;
ALTER TABLE practice.papers ADD CONSTRAINT practice_papers_source_type_check
  CHECK (source_type = ANY (ARRAY['tutor_email'::text, 'curriculum'::text, 'backfill'::text, 'manual'::text, 'generated'::text]));;
