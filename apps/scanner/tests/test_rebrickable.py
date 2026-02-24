"""Tests for Rebrickable API client (F2, E1, E2, E3, P1)."""

from __future__ import annotations

import os
import time
from unittest.mock import MagicMock, patch

import pytest

from rebrickable import (
    RebrickableClient,
    RebrickableError,
    SetNotFoundError,
)


# ---------------------------------------------------------------------------
# Mock response helpers
# ---------------------------------------------------------------------------

def _mock_set_info_response() -> dict:
    return {
        "set_num": "60370-1",
        "name": "Street Skate Park",
        "year": 2024,
        "num_parts": 454,
        "set_img_url": "https://cdn.rebrickable.com/media/sets/60370-1.jpg",
    }


def _mock_parts_response(page: int = 1, has_next: bool = False) -> dict:
    return {
        "count": 2,
        "next": "https://rebrickable.com/api/v3/lego/sets/60370-1/parts/?page=2" if has_next else None,
        "results": [
            {
                "part": {
                    "part_num": "3001",
                    "name": "Brick 2 x 4",
                },
                "color": {
                    "id": 4,
                    "name": "Red",
                    "rgb": "C91A09",
                    "is_trans": False,
                    "external_ids": {
                        "BrickLink": {
                            "ext_ids": [5],
                            "ext_descrs": [["Red"]],
                        }
                    },
                },
                "quantity": 3,
                "is_spare": False,
            },
            {
                "part": {
                    "part_num": "3010",
                    "name": "Brick 1 x 4",
                },
                "color": {
                    "id": 0,
                    "name": "Black",
                    "rgb": "05131D",
                    "is_trans": False,
                    "external_ids": {
                        "BrickLink": {
                            "ext_ids": [11],
                            "ext_descrs": [["Black"]],
                        }
                    },
                },
                "quantity": 5,
                "is_spare": False,
            },
        ],
    }


# ---------------------------------------------------------------------------
# F2: Parts list loaded from Rebrickable API
# ---------------------------------------------------------------------------

class TestRebrickableClient:
    """F2: Rebrickable API client tests."""

    def test_get_set_info(self):
        """Fetches set metadata correctly."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = _mock_set_info_response()

        client = RebrickableClient("test-key")
        with patch.object(client._session, "get", return_value=mock_resp):
            info = client.get_set_info("60370-1")

        assert info["set_num"] == "60370-1"
        assert info["name"] == "Street Skate Park"
        assert info["year"] == 2024
        assert info["num_parts"] == 454

    def test_get_set_parts(self):
        """Fetches and parses parts list correctly."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = _mock_parts_response()

        client = RebrickableClient("test-key")
        with patch.object(client._session, "get", return_value=mock_resp):
            parts = client.get_set_parts("60370-1")

        assert len(parts) == 2
        assert parts[0]["part_num"] == "3001"
        assert parts[0]["color_id"] == 4
        assert parts[0]["color_name"] == "Red"
        assert parts[0]["bl_color_id"] == 5
        assert parts[0]["quantity"] == 3
        assert parts[0]["is_spare"] is False

    def test_get_set_parts_extracts_bl_color_id(self):
        """BrickLink color ID correctly extracted from external_ids."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = _mock_parts_response()

        client = RebrickableClient("test-key")
        with patch.object(client._session, "get", return_value=mock_resp):
            parts = client.get_set_parts("60370-1")

        # Red: RB 4 → BL 5
        assert parts[0]["bl_color_id"] == 5
        # Black: RB 0 → BL 11
        assert parts[1]["bl_color_id"] == 11

    def test_get_set_parts_pagination(self):
        """Handles multi-page responses."""
        page1_resp = MagicMock()
        page1_resp.status_code = 200
        page1_resp.json.return_value = _mock_parts_response(page=1, has_next=True)

        page2_resp = MagicMock()
        page2_resp.status_code = 200
        page2_resp.json.return_value = _mock_parts_response(page=2, has_next=False)

        client = RebrickableClient("test-key")
        with patch.object(client._session, "get", side_effect=[page1_resp, page2_resp]):
            parts = client.get_set_parts("60370-1")

        assert len(parts) == 4  # 2 per page × 2 pages

    def test_get_set_parts_missing_external_ids(self):
        """Handles parts without BrickLink external IDs."""
        data = _mock_parts_response()
        # Remove external_ids from first part
        data["results"][0]["color"]["external_ids"] = {}

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = data

        client = RebrickableClient("test-key")
        with patch.object(client._session, "get", return_value=mock_resp):
            parts = client.get_set_parts("60370-1")

        assert parts[0]["bl_color_id"] is None
        assert parts[1]["bl_color_id"] == 11


# ---------------------------------------------------------------------------
# E1: Invalid set number
# ---------------------------------------------------------------------------

class TestInvalidSetNumber:
    """E1: Invalid set number handling."""

    def test_get_set_info_404(self):
        """404 raises SetNotFoundError with correct message."""
        mock_resp = MagicMock()
        mock_resp.status_code = 404

        client = RebrickableClient("test-key")
        with patch.object(client._session, "get", return_value=mock_resp):
            with pytest.raises(SetNotFoundError) as exc_info:
                client.get_set_info("99999-1")

        assert "99999-1" in str(exc_info.value)
        assert "not found" in str(exc_info.value).lower()

    def test_get_set_parts_404(self):
        """404 on parts endpoint raises SetNotFoundError."""
        mock_resp = MagicMock()
        mock_resp.status_code = 404

        client = RebrickableClient("test-key")
        with patch.object(client._session, "get", return_value=mock_resp):
            with pytest.raises(SetNotFoundError):
                client.get_set_parts("99999-1")


# ---------------------------------------------------------------------------
# E2: Rebrickable API failure
# ---------------------------------------------------------------------------

class TestApiFailure:
    """E2: API failure handling."""

    def test_get_set_info_500(self):
        """Server error raises RebrickableError with status code."""
        mock_resp = MagicMock()
        mock_resp.status_code = 500

        client = RebrickableClient("test-key")
        with patch.object(client._session, "get", return_value=mock_resp):
            with pytest.raises(RebrickableError) as exc_info:
                client.get_set_info("60370-1")

        assert exc_info.value.status_code == 500
        assert "500" in str(exc_info.value)

    def test_get_set_parts_connection_error(self):
        """Network error raises appropriate exception."""
        client = RebrickableClient("test-key")
        with patch.object(
            client._session, "get",
            side_effect=ConnectionError("Network unreachable"),
        ):
            with pytest.raises(ConnectionError):
                client.get_set_parts("60370-1")


# ---------------------------------------------------------------------------
# F1 + E3: CLI args (tested via config)
# ---------------------------------------------------------------------------

class TestCliArgs:
    """F1: CLI --check-set argument and E3: missing API key."""

    def test_check_set_arg_parsed(self):
        """--check-set argument populates config.check_set."""
        from config import parse_cli_args

        env = {
            "NEXT_PUBLIC_SUPABASE_URL": "https://x.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "key",
            "REBRICKABLE_API_KEY": "rb-key",
        }
        with patch.dict("os.environ", env, clear=False):
            with patch("config.load_dotenv"):
                config = parse_cli_args(["--check-set", "75192-1"])

        assert config.check_set == "75192-1"

    def test_check_set_not_set_by_default(self):
        """Config has check_set=None by default."""
        from config import parse_cli_args

        env = {
            "NEXT_PUBLIC_SUPABASE_URL": "https://x.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "key",
        }
        with patch.dict("os.environ", env, clear=False):
            with patch("config.load_dotenv"):
                config = parse_cli_args([])

        assert config.check_set is None

    def test_rebrickable_api_key_from_env(self):
        """E3: REBRICKABLE_API_KEY loaded from environment."""
        from config import parse_cli_args

        env = {
            "NEXT_PUBLIC_SUPABASE_URL": "https://x.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "key",
            "REBRICKABLE_API_KEY": "my-rb-key",
        }
        with patch.dict("os.environ", env, clear=False):
            with patch("config.load_dotenv"):
                config = parse_cli_args([])

        assert config.rebrickable_api_key == "my-rb-key"

    def test_rebrickable_api_key_missing(self):
        """E3: Missing API key results in empty string."""
        from config import ScannerConfig

        with patch.dict("os.environ", {"REBRICKABLE_API_KEY": ""}, clear=False):
            config = ScannerConfig(
                supabase_url="https://x.supabase.co",
                supabase_key="key",
            )

        assert config.rebrickable_api_key == ""


# ---------------------------------------------------------------------------
# P1: Parts list load time (integration test — requires real API key)
# ---------------------------------------------------------------------------

class TestPerformance:
    """P1: Parts list load time — verify our code adds minimal overhead.

    Note: Rebrickable API response times vary by server load (typically 2-25s
    for large sets). The time limit here accounts for external API latency;
    the intent is to verify our pagination/parsing code is efficient.
    """

    @pytest.mark.skipif(
        not os.environ.get("REBRICKABLE_API_KEY"),
        reason="REBRICKABLE_API_KEY not set (integration test)",
    )
    def test_set_parts_loads_successfully(self):
        """P1: Fetching a set's parts returns correct data within API timeout."""
        api_key = os.environ["REBRICKABLE_API_KEY"]
        client = RebrickableClient(api_key)

        start = time.time()
        try:
            parts = client.get_set_parts("60370-1")
        finally:
            client.close()
        elapsed = time.time() - start

        assert len(parts) > 50, f"Expected 50+ parts, got {len(parts)}"
        assert elapsed < 30.0, f"Took {elapsed:.1f}s, expected < 30s"
        # Verify part structure is correct
        assert all("part_num" in p for p in parts)
        assert all("color_id" in p for p in parts)
        assert all("bl_color_id" in p for p in parts)
