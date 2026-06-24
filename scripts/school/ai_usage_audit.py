"""
Fire-and-forget AI-usage audit logging for the school scripts.

Logs every raw anthropic.Anthropic() call to the shared `public.ai_api_usage`
table in Supabase project modjoikyuhqzouxvieua. Uses the PUBLISHABLE key over the
PostgREST REST endpoint (insert-only via RLS), so no service-role key is needed
in these scripts.

STRICTLY fire-and-forget: a logging failure must NEVER block, slow, or break the
script's real work. log_ai_usage() swallows every error and returns nothing.

Usage:
    from ai_usage_audit import log_ai_usage

    started = time.time()
    response = client.messages.create(...)
    log_ai_usage(
        feature="school_newsletter",
        model=response.model,
        usage=response.usage,
        request_ms=int((time.time() - started) * 1000),
        anthropic_message_id=response.id,
    )

On failure:
    log_ai_usage(feature="school_newsletter", model="claude-sonnet-4-6",
                 status="error", error=str(exc))
"""
import os

import httpx

# modjoikyuhqzouxvieua is Hadley Bricks' Supabase DB; publishable key can INSERT
# (RLS is insert-only) but cannot read back.
AI_USAGE_SUPABASE_URL = os.environ.get(
    "AI_USAGE_SUPABASE_URL", "https://modjoikyuhqzouxvieua.supabase.co"
)
AI_USAGE_SUPABASE_KEY = os.environ.get(
    "AI_USAGE_SUPABASE_KEY", "sb_publishable_ZfSKKyHywBhDtS4RLLUi5w_3Q_5Fu6v"
)

PROJECT = "hadley-bricks"


def log_ai_usage(
    *,
    feature: str | None = None,
    model: str | None = None,
    usage=None,
    request_ms: int | None = None,
    status: str = "success",
    error: str | None = None,
    anthropic_message_id: str | None = None,
    metadata: dict | None = None,
) -> None:
    """
    Fire-and-forget insert into public.ai_api_usage. Never raises.

    `usage` may be an anthropic Usage object (has .input_tokens etc.) or a dict;
    its token counts are flattened onto the row. Null fields are omitted.
    """
    try:
        row: dict = {
            "project": PROJECT,
            "billing_source": "api_key",
            "feature": feature,
            "model": model,
            "request_ms": request_ms,
            "status": status,
            "error": error,
            "anthropic_message_id": anthropic_message_id,
            "metadata": metadata,
        }

        if usage is not None:
            def _get(name):
                if isinstance(usage, dict):
                    return usage.get(name)
                return getattr(usage, name, None)

            row["input_tokens"] = _get("input_tokens")
            row["output_tokens"] = _get("output_tokens")
            row["cache_creation_input_tokens"] = _get("cache_creation_input_tokens")
            row["cache_read_input_tokens"] = _get("cache_read_input_tokens")

        # Omit null fields.
        row = {k: v for k, v in row.items() if v is not None}

        httpx.post(
            f"{AI_USAGE_SUPABASE_URL}/rest/v1/ai_api_usage",
            json=row,
            headers={
                "apikey": AI_USAGE_SUPABASE_KEY,
                "Authorization": f"Bearer {AI_USAGE_SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            timeout=5,
        )
    except Exception:
        # Swallow — audit logging must never affect the script's real work.
        pass
