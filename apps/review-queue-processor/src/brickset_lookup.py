"""Brickset lookup — query set names directly from Supabase brickset_sets table."""

import logging

from src.supabase_client import _client

log = logging.getLogger(__name__)


def _normalise_set_number(set_number: str) -> str:
    """Normalise set number to include variant suffix.

    Brickset stores set numbers as "42136-1" (with -1 variant suffix).
    If the input doesn't have a suffix, append "-1".
    """
    if "-" not in set_number:
        return f"{set_number}-1"
    return set_number


def lookup_set(set_number: str) -> dict | None:
    """Look up a LEGO set from the brickset_sets cache table.

    Args:
        set_number: LEGO set number (e.g. "42136" or "42136-1").

    Returns:
        Dict with set_name, theme, year_from, uk_retail_price, pieces,
        or None if not found.
    """
    normalised = _normalise_set_number(set_number)

    try:
        response = (
            _client.table("brickset_sets")
            .select("set_number, set_name, theme, year_from, uk_retail_price, pieces")
            .eq("set_number", normalised)
            .maybe_single()
            .execute()
        )

        if response.data:
            log.info(
                "Brickset lookup: %s → %s (%s, %s)",
                set_number,
                response.data["set_name"],
                response.data.get("theme", "?"),
                response.data.get("year_from", "?"),
            )
            return response.data

        log.warning("Brickset lookup: %s → not found", set_number)
        return None

    except Exception as e:
        log.error("Brickset lookup failed for %s: %s", set_number, e)
        return None


def lookup_set_name(set_number: str) -> str | None:
    """Convenience wrapper — returns just the set name, or None."""
    result = lookup_set(set_number)
    return result["set_name"] if result else None
