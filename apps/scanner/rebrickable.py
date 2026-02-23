"""Rebrickable API client for fetching LEGO set inventories."""

from __future__ import annotations

import logging
from typing import Any

import requests

logger = logging.getLogger(__name__)

REBRICKABLE_BASE_URL = "https://rebrickable.com/api/v3"


class RebrickableError(Exception):
    """Base exception for Rebrickable API errors."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class SetNotFoundError(RebrickableError):
    """Raised when a set number is not found on Rebrickable."""
    pass


class RebrickableClient:
    """Synchronous client for the Rebrickable API v3."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"key {api_key}",
            "Accept": "application/json",
        })

    def get_set_info(self, set_num: str) -> dict:
        """Fetch set metadata from Rebrickable.

        Returns dict with: set_num, name, year, num_parts, set_img_url.
        Raises SetNotFoundError if set doesn't exist.
        """
        url = f"{REBRICKABLE_BASE_URL}/lego/sets/{set_num}/"
        resp = self._session.get(url, timeout=30)

        if resp.status_code == 404:
            raise SetNotFoundError(
                f"Set '{set_num}' not found on Rebrickable. Check the set number and try again.",
                status_code=404,
            )
        if resp.status_code >= 500:
            raise RebrickableError(
                f"Failed to fetch set info from Rebrickable: HTTP {resp.status_code}. "
                "Check your API key and network connection.",
                status_code=resp.status_code,
            )
        if resp.status_code != 200:
            raise RebrickableError(
                f"Failed to fetch set info from Rebrickable: HTTP {resp.status_code}. "
                "Check your API key and network connection.",
                status_code=resp.status_code,
            )

        data = resp.json()
        return {
            "set_num": data["set_num"],
            "name": data["name"],
            "year": data.get("year", 0),
            "num_parts": data.get("num_parts", 0),
            "set_img_url": data.get("set_img_url"),
        }

    def get_set_parts(self, set_num: str, inc_minifig_parts: bool = False) -> list[dict]:
        """Fetch all parts for a set, handling pagination.

        Each part dict contains:
            part_num, name, color_id, color_name, color_rgb,
            bl_color_id, quantity, is_spare

        Args:
            set_num: Rebrickable set number (e.g., "75192-1")
            inc_minifig_parts: Whether to include individual minifig parts

        Returns list of part dicts.
        """
        all_parts: list[dict] = []
        page = 1
        page_size = 1000

        while True:
            url = f"{REBRICKABLE_BASE_URL}/lego/sets/{set_num}/parts/"
            params = {
                "page": page,
                "page_size": page_size,
                "inc_color_details": 1,
                "inc_part_details": 1,
                "inc_minifig_parts": 1 if inc_minifig_parts else 0,
            }

            resp = self._session.get(url, params=params, timeout=30)

            if resp.status_code == 404:
                raise SetNotFoundError(
                    f"Set '{set_num}' not found on Rebrickable. Check the set number and try again.",
                    status_code=404,
                )
            if resp.status_code >= 500:
                raise RebrickableError(
                    f"Failed to fetch parts list from Rebrickable: HTTP {resp.status_code}. "
                    "Check your API key and network connection.",
                    status_code=resp.status_code,
                )
            if resp.status_code != 200:
                raise RebrickableError(
                    f"Failed to fetch parts list from Rebrickable: HTTP {resp.status_code}. "
                    "Check your API key and network connection.",
                    status_code=resp.status_code,
                )

            data = resp.json()
            results = data.get("results", [])

            for item in results:
                part_data = item.get("part", {})
                color_data = item.get("color", {})

                # Extract BrickLink color ID from external_ids
                bl_color_id = None
                ext_ids = color_data.get("external_ids", {})
                bl_ext = ext_ids.get("BrickLink", {})
                bl_ids = bl_ext.get("ext_ids", [])
                if bl_ids:
                    bl_color_id = bl_ids[0]

                all_parts.append({
                    "part_num": part_data.get("part_num", ""),
                    "name": part_data.get("name", "Unknown"),
                    "color_id": color_data.get("id", -1),
                    "color_name": color_data.get("name", "Unknown"),
                    "color_rgb": color_data.get("rgb", "000000"),
                    "is_trans": color_data.get("is_trans", False),
                    "bl_color_id": bl_color_id,
                    "quantity": item.get("quantity", 1),
                    "is_spare": item.get("is_spare", False),
                })

            # Check for more pages
            if data.get("next") is None:
                break
            page += 1

        logger.info(f"Fetched {len(all_parts)} parts for set {set_num}")
        return all_parts

    def close(self) -> None:
        """Close the HTTP session."""
        self._session.close()
