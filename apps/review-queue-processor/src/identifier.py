"""LEGO set identifier — Gemini Flash 2.0 for vision, Claude CLI for text fallback.

Vision path: Sends Vinted listing photos to Gemini Flash 2.0 (free tier)
for high-confidence identification from box art, minifigures, and packaging.

Text fallback: Uses `claude -p` (Max subscription) when no images are
available or Gemini fails.
"""

import json
import logging
import os
import re
import subprocess

log = logging.getLogger(__name__)

# Gemini SDK — optional, gracefully degrades to text-only
try:
    from google import genai
    from PIL import Image

    _HAS_GEMINI = True
except ImportError:
    _HAS_GEMINI = False
    log.info("google-genai or Pillow not installed — vision unavailable")


def _extract_json(text: str) -> str:
    """Extract the first JSON object from Claude/Gemini response text."""
    # Try to find JSON in a code block first
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if match:
        return match.group(1)
    # Fall back to finding first { ... }
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return match.group(0)
    raise ValueError(f"No JSON found in response: {text[:200]}")


def _build_prompt(item: dict) -> str:
    """Build the identification prompt text for Claude CLI."""
    item_name = item.get("item_name", "Unknown")
    email_subject = item.get("email_subject", "")
    source = item.get("source", "Unknown")
    cost = item.get("cost", "?")
    seller = item.get("seller_username", "")

    parts = [
        "Identify LEGO set number(s) from this purchase.",
        f"Item: {item_name}",
    ]
    if email_subject:
        parts.append(f"Subject: {email_subject}")
    parts.append(f"Source: {source}, Cost: £{cost}")
    if seller:
        parts.append(f"Seller: {seller}")

    parts.append("")
    parts.append("Rules:")
    parts.append(
        "- If this is clearly NOT a LEGO set (e.g. postage, packaging, "
        "non-LEGO item), set is_lego to false."
    )
    parts.append(
        "- If it IS LEGO, extract the set number(s). "
        "Set numbers are typically 4-6 digits."
    )
    parts.append(
        "- Confidence: high = set number clearly visible in text or on the box, "
        "medium = reasonable inference from box art / minifigures / title, "
        "low = uncertain guess."
    )
    parts.append("- For bundles with multiple sets, list each separately.")
    parts.append(
        '- Condition: "New" if sealed/new, "Used" if pre-owned/used, '
        'default to "New".'
    )
    parts.append("")
    parts.append("Respond ONLY with JSON, no other text:")
    parts.append(
        '{"items": [{"set_number": "10307", "condition": "New"}], '
        '"is_lego": true, "confidence": "high", '
        '"reasoning": "Set number visible in title"}'
    )
    return "\n".join(parts)


VISION_PROMPT = """\
You are identifying LEGO sets from Vinted listing photos.

Item title: "{item_name}"
Source: {source}, Cost: £{cost}
{seller_line}

Look at the photos carefully for:
- Box art and set number printed on the box
- Minifigures visible
- Distinctive pieces or builds
- Instruction booklets if visible
- Any text on packaging

Rules:
- If this is clearly NOT a LEGO set, set is_lego to false.
- Extract the set number(s). Set numbers are typically 4-6 digits.
- Confidence: high = set number visible on box/packaging, \
medium = identified from box art/builds/minifigures, low = uncertain guess.
- For bundles with multiple sets, list each separately.
- Condition: "New" if sealed/new, "Used" if pre-owned/used, default to "New".

Respond ONLY with JSON, no other text:
{{"items": [{{"set_number": "10307", "condition": "New"}}], \
"is_lego": true, "confidence": "high", \
"reasoning": "Set number 10307 visible on box front"}}"""


def _identify_with_gemini(
    item: dict,
    image_paths: list[str],
) -> dict | None:
    """Identify LEGO sets using Gemini Flash 2.0 vision (free tier).

    Sends listing photos + item metadata to Gemini for visual identification.
    Uses the google-genai SDK (new unified SDK).
    """
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not _HAS_GEMINI or not api_key:
        log.info("Gemini not configured — skipping vision identification")
        return None

    item_name = item.get("item_name", "Unknown")

    try:
        client = genai.Client(api_key=api_key)

        # Build content parts: images + text prompt
        parts: list = []

        for img_path in image_paths:
            try:
                img = Image.open(img_path)
                parts.append(img)
                log.info("Loaded image for Gemini: %s", img_path)
            except Exception as e:
                log.warning("Could not load image %s: %s", img_path, e)

        if not parts:
            log.warning("No images could be loaded for Gemini")
            return None

        # Add text prompt
        seller = item.get("seller_username", "")
        prompt = VISION_PROMPT.format(
            item_name=item_name,
            source=item.get("source", "Unknown"),
            cost=item.get("cost", "?"),
            seller_line=f"Seller: {seller}" if seller else "",
        )
        parts.append(prompt)

        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=parts,
        )
        raw = response.text.strip()

        json_str = _extract_json(raw)
        parsed = json.loads(json_str)

        log.info(
            "Gemini Vision identified '%s': is_lego=%s, confidence=%s, items=%s",
            item_name,
            parsed.get("is_lego"),
            parsed.get("confidence"),
            parsed.get("items"),
        )
        return parsed

    except (json.JSONDecodeError, ValueError) as e:
        log.error("Failed to parse Gemini response for '%s': %s", item_name, e)
        return None
    except Exception as e:
        log.error("Gemini Vision failed for '%s': %s", item_name, e)
        return None


def _identify_text_only(item: dict) -> dict | None:
    """Text-only identification via Claude CLI (Max subscription)."""
    prompt = _build_prompt(item)

    try:
        # Strip CLAUDECODE env var so the CLI doesn't refuse to run
        # when invoked from inside a Claude Code session (manual runs).
        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
        result = subprocess.run(
            ["claude", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=60,
            env=env,
        )

        if result.returncode != 0:
            log.error(
                "Claude CLI failed for item %s: %s",
                item.get("id"),
                result.stderr[:200],
            )
            return None

        raw = result.stdout.strip()
        json_str = _extract_json(raw)
        parsed = json.loads(json_str)

        item_name = item.get("item_name", "Unknown")
        log.info(
            "Claude CLI identified '%s': is_lego=%s, confidence=%s, items=%s",
            item_name,
            parsed.get("is_lego"),
            parsed.get("confidence"),
            parsed.get("items"),
        )
        return parsed

    except subprocess.TimeoutExpired:
        log.error("Claude CLI timed out for item %s", item.get("id"))
        return None
    except (json.JSONDecodeError, ValueError) as e:
        log.error(
            "Failed to parse Claude response for item %s: %s",
            item.get("id"),
            e,
        )
        return None


def identify_set_numbers(
    item: dict,
    image_paths: list[str] | None = None,
) -> dict | None:
    """Identify LEGO set numbers from a purchase item.

    Strategy:
    1. If images available + Gemini configured → vision identification (free)
    2. Fallback → Claude CLI text-only (Max subscription, free)

    Returns parsed JSON dict with keys: items, is_lego, confidence, reasoning.
    Returns None if all identification methods fail.
    """
    # Try Gemini Vision first if images are available
    if image_paths:
        result = _identify_with_gemini(item, image_paths)
        if result is not None:
            return result
        log.info("Gemini Vision failed — falling back to Claude CLI text-only")

    # Fall back to Claude CLI (text-only)
    return _identify_text_only(item)
