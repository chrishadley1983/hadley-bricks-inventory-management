-- Shared cross-project Anthropic API usage audit log.
-- Written (fire-and-forget) by every project that calls the Anthropic API with the shared key.
-- Reconciled against Anthropic's Admin usage_report / cost_report by a job in discord-messenger.
-- RLS enabled with NO policies => only the service_role (which bypasses RLS) may read/write.

CREATE TABLE IF NOT EXISTS public.ai_api_usage (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project                     text NOT NULL,                 -- 'hadley-bricks','football-predictor','discord-messenger',...
  feature                     text NOT NULL,                 -- 'ebay_listing_generation','pundit:bright','pdf_vision_parse',...
  model                       text NOT NULL,
  billing_source              text NOT NULL DEFAULT 'api_key',-- 'api_key' | 'programmatic' | 'subscription'
  input_tokens                integer NOT NULL DEFAULT 0,
  output_tokens               integer NOT NULL DEFAULT 0,
  cache_creation_input_tokens integer NOT NULL DEFAULT 0,
  cache_read_input_tokens     integer NOT NULL DEFAULT 0,
  cost_usd                    numeric(12,6),                 -- estimated client-side; truth comes from cost_report
  request_ms                  integer,
  status                      text NOT NULL DEFAULT 'success',-- 'success' | 'error'
  error                       text,
  anthropic_message_id        text,                          -- msg_...
  request_id                  text,                          -- optional caller correlation id
  metadata                    jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_api_usage_created_at        ON public.ai_api_usage (created_at);
CREATE INDEX IF NOT EXISTS idx_ai_api_usage_project_created   ON public.ai_api_usage (project, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_api_usage_model_created     ON public.ai_api_usage (model, created_at);

ALTER TABLE public.ai_api_usage ENABLE ROW LEVEL SECURITY;

-- Registry mapping Anthropic api_key_id -> project. Trivial today (single shared key),
-- present so per-project attribution becomes possible if keys are ever split.
CREATE TABLE IF NOT EXISTS public.anthropic_api_keys (
  api_key_id  text PRIMARY KEY,            -- Anthropic 'apikey_...' id (or 'shared')
  project     text NOT NULL DEFAULT 'shared',
  label       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.anthropic_api_keys ENABLE ROW LEVEL SECURITY;

-- Daily reconciliation: Anthropic ground truth vs sum of logged calls. Gap exposes
-- un-instrumented usage (api_key_id='' / 'console' rows = Workbench/Console, unattributable).
CREATE TABLE IF NOT EXISTS public.ai_usage_reconciliation (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_date                      date NOT NULL,
  model                           text NOT NULL,
  api_key_id                      text NOT NULL DEFAULT 'unknown', -- 'console' for null-key Workbench usage
  anthropic_input_tokens          bigint NOT NULL DEFAULT 0,
  anthropic_output_tokens         bigint NOT NULL DEFAULT 0,
  anthropic_cache_creation_tokens bigint NOT NULL DEFAULT 0,
  anthropic_cache_read_tokens     bigint NOT NULL DEFAULT 0,
  anthropic_cost_usd              numeric(12,4),
  logged_input_tokens             bigint NOT NULL DEFAULT 0,
  logged_output_tokens            bigint NOT NULL DEFAULT 0,
  logged_cost_usd                 numeric(12,6),
  gap_input_tokens                bigint,   -- anthropic - logged
  gap_output_tokens               bigint,
  gap_pct                         numeric,  -- output-token gap as % of anthropic output
  note                            text,
  computed_at                     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usage_date, model, api_key_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_recon_date ON public.ai_usage_reconciliation (usage_date);
ALTER TABLE public.ai_usage_reconciliation ENABLE ROW LEVEL SECURITY;;
