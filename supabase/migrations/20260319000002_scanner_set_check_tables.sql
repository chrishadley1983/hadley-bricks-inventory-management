-- Set-check sessions linked to scanner_sessions
CREATE TABLE scanner_set_check_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES scanner_sessions(id) ON DELETE CASCADE,
    set_num TEXT NOT NULL,
    set_name TEXT NOT NULL,
    set_year INT,
    total_expected INT NOT NULL,
    total_unique INT NOT NULL,
    spare_count INT NOT NULL DEFAULT 0,
    parts_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scanner_set_check_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    set_check_session_id UUID NOT NULL REFERENCES scanner_set_check_sessions(id) ON DELETE CASCADE,
    part_num TEXT NOT NULL,
    color_id INT NOT NULL,
    color_name TEXT NOT NULL,
    expected_qty INT NOT NULL,
    found_qty INT NOT NULL DEFAULT 0,
    is_spare BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(set_check_session_id, part_num, color_id)
);

CREATE INDEX idx_set_check_sessions_session ON scanner_set_check_sessions(session_id);
CREATE INDEX idx_set_check_progress_session ON scanner_set_check_progress(set_check_session_id);

-- RLS
ALTER TABLE scanner_set_check_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scanner_set_check_progress ENABLE ROW LEVEL SECURITY;

-- Policies: users can manage their own set-check data (via scanner_sessions.user_id join)
CREATE POLICY "Users can view own set-check sessions"
    ON scanner_set_check_sessions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM scanner_sessions ss
        WHERE ss.id = scanner_set_check_sessions.session_id
        AND ss.user_id = auth.uid()
    ));

CREATE POLICY "Users can insert own set-check sessions"
    ON scanner_set_check_sessions FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM scanner_sessions ss
        WHERE ss.id = scanner_set_check_sessions.session_id
        AND ss.user_id = auth.uid()
    ));

CREATE POLICY "Users can view own set-check progress"
    ON scanner_set_check_progress FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM scanner_set_check_sessions scs
        JOIN scanner_sessions ss ON ss.id = scs.session_id
        WHERE scs.id = scanner_set_check_progress.set_check_session_id
        AND ss.user_id = auth.uid()
    ));

CREATE POLICY "Users can manage own set-check progress"
    ON scanner_set_check_progress FOR ALL
    USING (EXISTS (
        SELECT 1 FROM scanner_set_check_sessions scs
        JOIN scanner_sessions ss ON ss.id = scs.session_id
        WHERE scs.id = scanner_set_check_progress.set_check_session_id
        AND ss.user_id = auth.uid()
    ));
