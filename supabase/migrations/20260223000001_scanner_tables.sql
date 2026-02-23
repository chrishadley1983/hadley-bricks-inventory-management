-- Scanner MVP: sessions, pieces, and image storage
-- Applied via Supabase MCP on 2026-02-23

-- Scanner sessions table
CREATE TABLE IF NOT EXISTS scanner_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'calibrating'
        CHECK (status IN ('calibrating', 'scanning', 'paused', 'completed', 'aborted')),
    confidence_threshold FLOAT DEFAULT 0.70,
    camera_config_json JSONB,
    summary_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scanner pieces table
CREATE TABLE IF NOT EXISTS scanner_pieces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES scanner_sessions(id) ON DELETE CASCADE,
    brickognize_item_id TEXT,
    brickognize_listing_id TEXT,
    item_name TEXT,
    item_category TEXT,
    confidence FLOAT,
    status TEXT NOT NULL DEFAULT 'flagged'
        CHECK (status IN ('accepted', 'flagged', 'rejected', 'error')),
    top_results_json JSONB,
    bounding_box_json JSONB,
    image_path TEXT,
    frame_sharpness FLOAT,
    reviewed_at TIMESTAMPTZ,
    reviewed_item_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scanner_sessions_user_id ON scanner_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_scanner_pieces_session_id ON scanner_pieces(session_id);
CREATE INDEX IF NOT EXISTS idx_scanner_pieces_status ON scanner_pieces(status);

-- RLS
ALTER TABLE scanner_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scanner_pieces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own scanner sessions"
    ON scanner_sessions FOR ALL
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own scanner pieces"
    ON scanner_pieces FOR ALL
    USING (
        session_id IN (
            SELECT id FROM scanner_sessions WHERE user_id = auth.uid()
        )
    );

-- Storage bucket for scanner images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'scanner-images',
    'scanner-images',
    false,
    5242880,
    ARRAY['image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Users can upload scanner images"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'scanner-images'
        AND auth.role() = 'authenticated'
    );

CREATE POLICY "Users can view own scanner images"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'scanner-images'
        AND auth.role() = 'authenticated'
    );
