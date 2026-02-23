"""Color identification: extract dominant color from crops and match against BrickLink palette."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import cv2
import numpy as np
import requests

logger = logging.getLogger(__name__)

# BrickLink/Rebrickable color palette (id, name, hex, is_transparent)
# Source: Rebrickable colors database - covers all standard LEGO colors
_COLORS_CACHE: list[dict] | None = None
_COLORS_FILE = Path(__file__).parent / "data" / "colors.json"

# Known colors per part cache (avoids repeated web requests)
_PART_COLORS_CACHE: dict[str, list[int]] = {}


def _rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """Convert RGB (0-255) to CIELAB color space via OpenCV."""
    pixel = np.uint8([[rgb]])
    lab = cv2.cvtColor(pixel, cv2.COLOR_RGB2LAB)
    # OpenCV LAB ranges: L [0,255], a [0,255], b [0,255]
    # Convert to standard LAB: L [0,100], a [-128,127], b [-128,127]
    L = lab[0, 0, 0] * 100.0 / 255.0
    a = lab[0, 0, 1] - 128.0
    b = lab[0, 0, 2] - 128.0
    return np.array([L, a, b])


def delta_e_ciede2000(lab1: np.ndarray, lab2: np.ndarray) -> float:
    """Compute CIEDE2000 color difference between two LAB colors.

    Implementation follows the CIE DE2000 formula (CIE 142-2001).
    """
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2

    # Step 1: Calculate C' and h'
    C1 = np.sqrt(a1**2 + b1**2)
    C2 = np.sqrt(a2**2 + b2**2)
    C_avg = (C1 + C2) / 2.0
    C_avg_7 = C_avg**7
    G = 0.5 * (1.0 - np.sqrt(C_avg_7 / (C_avg_7 + 25.0**7)))

    a1p = a1 * (1.0 + G)
    a2p = a2 * (1.0 + G)

    C1p = np.sqrt(a1p**2 + b1**2)
    C2p = np.sqrt(a2p**2 + b2**2)

    h1p = np.degrees(np.arctan2(b1, a1p)) % 360.0
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360.0

    # Step 2: Calculate delta L', delta C', delta H'
    dLp = L2 - L1
    dCp = C2p - C1p

    if C1p * C2p == 0:
        dhp = 0.0
    elif abs(h2p - h1p) <= 180.0:
        dhp = h2p - h1p
    elif h2p - h1p > 180.0:
        dhp = h2p - h1p - 360.0
    else:
        dhp = h2p - h1p + 360.0

    dHp = 2.0 * np.sqrt(C1p * C2p) * np.sin(np.radians(dhp / 2.0))

    # Step 3: Calculate CIEDE2000
    Lp_avg = (L1 + L2) / 2.0
    Cp_avg = (C1p + C2p) / 2.0

    if C1p * C2p == 0:
        hp_avg = h1p + h2p
    elif abs(h1p - h2p) <= 180.0:
        hp_avg = (h1p + h2p) / 2.0
    elif h1p + h2p < 360.0:
        hp_avg = (h1p + h2p + 360.0) / 2.0
    else:
        hp_avg = (h1p + h2p - 360.0) / 2.0

    T = (1.0
         - 0.17 * np.cos(np.radians(hp_avg - 30.0))
         + 0.24 * np.cos(np.radians(2.0 * hp_avg))
         + 0.32 * np.cos(np.radians(3.0 * hp_avg + 6.0))
         - 0.20 * np.cos(np.radians(4.0 * hp_avg - 63.0)))

    SL = 1.0 + 0.015 * (Lp_avg - 50.0)**2 / np.sqrt(20.0 + (Lp_avg - 50.0)**2)
    SC = 1.0 + 0.045 * Cp_avg
    SH = 1.0 + 0.015 * Cp_avg * T

    Cp_avg_7 = Cp_avg**7
    RT = (-2.0 * np.sqrt(Cp_avg_7 / (Cp_avg_7 + 25.0**7))
          * np.sin(np.radians(60.0 * np.exp(-((hp_avg - 275.0) / 25.0)**2))))

    dE = np.sqrt(
        (dLp / SL)**2
        + (dCp / SC)**2
        + (dHp / SH)**2
        + RT * (dCp / SC) * (dHp / SH)
    )

    return float(dE)


def load_color_palette() -> list[dict]:
    """Load the BrickLink/Rebrickable color palette from bundled JSON."""
    global _COLORS_CACHE
    if _COLORS_CACHE is not None:
        return _COLORS_CACHE

    if _COLORS_FILE.exists():
        with open(_COLORS_FILE) as f:
            _COLORS_CACHE = json.load(f)
        logger.info(f"Loaded {len(_COLORS_CACHE)} colors from {_COLORS_FILE}")
        return _COLORS_CACHE

    logger.warning(f"Color palette not found at {_COLORS_FILE}, downloading from Rebrickable")
    _COLORS_CACHE = _download_rebrickable_colors()
    return _COLORS_CACHE


def _download_rebrickable_colors() -> list[dict]:
    """Download color palette from Rebrickable and cache to disk."""
    url = "https://cdn.rebrickable.com/media/downloads/colors.csv.gz"
    try:
        import gzip
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        csv_text = gzip.decompress(resp.content).decode("utf-8")
    except Exception:
        # Fallback: try uncompressed
        url = "https://cdn.rebrickable.com/media/downloads/colors.csv"
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        csv_text = resp.text

    colors = []
    for line in csv_text.strip().split("\n")[1:]:  # skip header
        parts = line.split(",")
        if len(parts) < 4:
            continue
        color_id = int(parts[0])
        name = parts[1]
        hex_val = parts[2]
        is_trans = parts[3].strip().lower() in ("t", "true")

        if color_id < 0:
            continue

        colors.append({
            "id": color_id,
            "name": name,
            "hex": hex_val,
            "is_trans": is_trans,
            "rgb": [int(hex_val[i:i+2], 16) for i in (0, 2, 4)],
        })

    # Save to disk for next time
    _COLORS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(_COLORS_FILE, "w") as f:
        json.dump(colors, f, indent=2)
    logger.info(f"Downloaded and cached {len(colors)} colors to {_COLORS_FILE}")

    return colors


def get_known_colors_for_part(part_id: str) -> list[dict] | None:
    """Get list of known colors for a part by scraping BrickLink catalog page.

    Returns list of dicts with 'bl_id' (BrickLink color ID) and 'name',
    or None if lookup fails.
    """
    if part_id in _PART_COLORS_CACHE:
        return _PART_COLORS_CACHE[part_id]

    url = f"https://www.bricklink.com/catalogColors.asp?itemType=P&itemNo={part_id}"
    try:
        resp = requests.get(url, timeout=10, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        if resp.status_code != 200:
            logger.warning(f"BrickLink colors page returned {resp.status_code} for {part_id}")
            return None

        import re
        # Pattern: idColor=N ... then color name in FONT tag like:
        # <A HREF="...idColor=1"><IMG ...></A> ... <FONT ...>White<BR>
        colors = []
        for m in re.finditer(r'idColor=(\d+)', resp.text):
            bl_id = int(m.group(1))
            # Find the color name in the next FONT tag after the image
            after = resp.text[m.end():m.end() + 600]
            name_match = re.search(
                r'<FONT[^>]*>([A-Za-z][A-Za-z ./-]+?)(?:<BR|</FONT)',
                after,
            )
            name = name_match.group(1).strip() if name_match else f"BL-{bl_id}"
            # Deduplicate
            if not any(c["bl_id"] == bl_id for c in colors):
                colors.append({"bl_id": bl_id, "name": name})

        if not colors:
            logger.warning(f"No colors found on BrickLink page for part {part_id}")
            return None

        _PART_COLORS_CACHE[part_id] = colors
        logger.info(f"Part {part_id}: {len(colors)} known colors from BrickLink")
        return colors

    except Exception as e:
        logger.warning(f"Failed to fetch BrickLink colors for {part_id}: {e}")
        return None


# Mapping from BrickLink color names to Rebrickable color IDs
# Built lazily from the palette
_BL_NAME_TO_RB: dict[str, int] | None = None


def _build_bl_name_map() -> dict[str, int]:
    """Build a mapping from BrickLink color names to Rebrickable palette entries."""
    global _BL_NAME_TO_RB
    if _BL_NAME_TO_RB is not None:
        return _BL_NAME_TO_RB

    palette = load_color_palette()
    _BL_NAME_TO_RB = {}
    for c in palette:
        # Exact match
        _BL_NAME_TO_RB[c["name"].lower()] = c["id"]
        # BrickLink sometimes uses slightly different names
        # e.g. "Reddish Brown" vs "Reddish-Brown"
        _BL_NAME_TO_RB[c["name"].lower().replace("-", " ")] = c["id"]
        _BL_NAME_TO_RB[c["name"].lower().replace(" ", "-")] = c["id"]

    return _BL_NAME_TO_RB


def resolve_bl_colors_to_palette(bl_colors: list[dict]) -> list[dict]:
    """Map BrickLink color names to Rebrickable palette entries with RGB values."""
    name_map = _build_bl_name_map()
    palette = load_color_palette()
    palette_by_id = {c["id"]: c for c in palette}

    resolved = []
    for blc in bl_colors:
        name_lower = blc["name"].lower()
        rb_id = name_map.get(name_lower)
        if rb_id is None:
            # Try fuzzy: "Trans-Clear" -> "trans clear" etc.
            rb_id = name_map.get(name_lower.replace("-", " "))
        if rb_id is None:
            rb_id = name_map.get(name_lower.replace(" ", "-"))

        if rb_id is not None and rb_id in palette_by_id:
            entry = palette_by_id[rb_id].copy()
            entry["bl_id"] = blc["bl_id"]
            entry["bl_name"] = blc["name"]
            resolved.append(entry)
        else:
            logger.debug(f"Could not resolve BrickLink color '{blc['name']}' (id={blc['bl_id']})")

    return resolved


def extract_dominant_color(
    crop: np.ndarray,
    color_distance_threshold: float = 35.0,
) -> tuple[np.ndarray, int]:
    """Extract dominant color from a cropped piece image on a dark belt.

    Uses a four-stage approach:
    1. Estimate belt color from crop corners
    2. Center crop (inner 40%) to reduce belt-to-piece pixel ratio
    3. LAB-distance filter to separate foreground from belt
    4. 60th percentile extraction from brightness-trimmed pixels

    Args:
        crop: BGR image of the cropped piece
        color_distance_threshold: minimum LAB Euclidean distance from belt to count as piece

    Returns:
        (rgb_array, pixel_count) - dominant color as [R, G, B] and number of piece pixels
    """
    h, w = crop.shape[:2]

    # Stage 1: Estimate belt color from full crop corners (before center-cropping)
    full_lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).astype(np.float64)
    edge_size = max(8, min(h, w) // 8)
    corners = np.concatenate([
        full_lab[:edge_size, :edge_size].reshape(-1, 3),
        full_lab[:edge_size, -edge_size:].reshape(-1, 3),
        full_lab[-edge_size:, :edge_size].reshape(-1, 3),
        full_lab[-edge_size:, -edge_size:].reshape(-1, 3),
    ])
    belt_lab = np.median(corners, axis=0)

    # Stage 2: Center crop - focus on inner 40% where the piece is
    # With 80px crop padding, the piece occupies ~60% of the crop center.
    # Cropping to inner 40% ensures mostly piece pixels, minimal belt.
    pad_y = int(h * 0.3)
    pad_x = int(w * 0.3)
    center = crop[pad_y:h - pad_y, pad_x:w - pad_x]
    ch, cw = center.shape[:2]

    if ch < 10 or cw < 10:
        center = crop  # Too small to crop, use full
        ch, cw = h, w

    center_rgb = cv2.cvtColor(center, cv2.COLOR_BGR2RGB)
    center_lab = cv2.cvtColor(center, cv2.COLOR_BGR2LAB).astype(np.float64)
    center_hsv = cv2.cvtColor(center, cv2.COLOR_BGR2HSV)

    # Stage 3: LAB distance filter on center crop
    lab_flat = center_lab.reshape(-1, 3)
    distances = np.sqrt(np.sum((lab_flat - belt_lab) ** 2, axis=1))
    fg_mask = distances > color_distance_threshold

    rgb_flat = center_rgb.reshape(-1, 3).astype(np.float64)
    hsv_flat = center_hsv.reshape(-1, 3)
    fg_rgb = rgb_flat[fg_mask]
    fg_hsv = hsv_flat[fg_mask]

    if len(fg_rgb) < 30:
        # Very few distinct pixels - piece is very similar to belt (e.g. black)
        # Fall back to strict center sampling
        cy, cx = ch // 2, cw // 2
        r = max(5, min(ch, cw) // 6)
        tiny_center = center_rgb[max(0, cy - r):cy + r, max(0, cx - r):cx + r]
        pixels = tiny_center.reshape(-1, 3).astype(np.float64)
        return pixels.mean(axis=0).astype(np.uint8), len(pixels)

    # Stage 4: Upper-percentile color extraction
    # Camera lighting consistently makes pieces appear darker than their true color.
    # Take the 60th percentile of each RGB channel from brightness-filtered pixels.
    # This picks the "well-lit face" of the piece, compensating for camera dimming
    # without overshooting into specular highlights (which 75th percentile does).
    brightness = fg_rgb.sum(axis=1)
    p_low = np.percentile(brightness, 30)
    trimmed = fg_rgb[brightness >= p_low]

    if len(trimmed) < 10:
        trimmed = fg_rgb  # Fallback to all foreground

    dominant = np.percentile(trimmed, 60, axis=0)
    return dominant.astype(np.uint8), len(trimmed)


def match_color(
    extracted_rgb: np.ndarray,
    part_id: str | None = None,
    is_transparent_hint: bool = False,
    belt_color: tuple[int, int, int] = (25, 25, 25),
) -> dict:
    """Match extracted RGB against BrickLink color palette.

    If part_id is provided, constrains to known colors for that part.

    Returns dict with: id, name, hex, is_trans, delta_e, confidence
    """
    palette = load_color_palette()

    # Get candidate colors - constrain to known colors for this part
    candidates = None
    if part_id:
        bl_colors = get_known_colors_for_part(part_id)
        if bl_colors:
            candidates = resolve_bl_colors_to_palette(bl_colors)

    if not candidates:
        candidates = palette  # Fallback to full palette

    extracted_lab = _rgb_to_lab(extracted_rgb)

    best_match = None
    best_delta_e = float("inf")

    for color in candidates:
        color_rgb = np.array(color["rgb"], dtype=np.uint8)

        if color["is_trans"]:
            # For transparent colors, try both raw and belt-blended targets.
            # Thin transparent pieces (visors) look close to their catalog color,
            # while thick transparent pieces show more belt bleed-through.
            # Use whichever gives a better match.
            raw_lab = _rgb_to_lab(color_rgb)
            adjusted = (
                np.array(color["rgb"], dtype=np.float64) * 0.4
                + np.array(belt_color, dtype=np.float64) * 0.6
            )
            blended_lab = _rgb_to_lab(adjusted.astype(np.uint8))
            de_raw = delta_e_ciede2000(extracted_lab, raw_lab)
            de_blended = delta_e_ciede2000(extracted_lab, blended_lab)
            de = min(de_raw, de_blended)
        else:
            color_lab = _rgb_to_lab(color_rgb)
            de = delta_e_ciede2000(extracted_lab, color_lab)

        if de < best_delta_e:
            best_delta_e = de
            best_match = color

    if best_match is None:
        return {"id": -1, "name": "Unknown", "hex": "000000", "is_trans": False,
                "delta_e": 999.0, "confidence": 0.0}

    # Confidence: Delta-E 0 = perfect, 30+ = poor match
    confidence = max(0.0, min(1.0, 1.0 - (best_delta_e / 30.0)))

    return {
        "id": best_match["id"],
        "name": best_match["name"],
        "hex": best_match["hex"],
        "is_trans": best_match["is_trans"],
        "delta_e": round(best_delta_e, 1),
        "confidence": round(confidence, 2),
    }


def identify_color(
    crop: np.ndarray,
    part_id: str | None = None,
) -> dict:
    """Full pipeline: extract color from crop, match against palette.

    Args:
        crop: BGR image of cropped piece
        part_id: BrickLink part ID (e.g. "3834") to constrain known colors

    Returns dict with: id, name, hex, is_trans, delta_e, confidence, extracted_rgb
    """
    extracted_rgb, pixel_count = extract_dominant_color(crop)

    result = match_color(extracted_rgb, part_id=part_id)
    result["extracted_rgb"] = extracted_rgb.tolist()
    result["pixel_count"] = pixel_count

    # If solid match has poor confidence, retry with transparent hint
    if result["confidence"] < 0.5 and not result["is_trans"]:
        trans_result = match_color(extracted_rgb, part_id=part_id, is_transparent_hint=True)
        if trans_result["confidence"] > result["confidence"]:
            trans_result["extracted_rgb"] = extracted_rgb.tolist()
            trans_result["pixel_count"] = pixel_count
            return trans_result

    return result
