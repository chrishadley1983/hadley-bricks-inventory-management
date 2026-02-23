"""Tests for CLI and main module (F10, F11)."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from config import ScannerConfig, load_config, parse_cli_args
from models import SessionSummary


class TestConfig:
    """F10: Config loading and CLI args."""

    def test_default_config(self):
        """Default config has sensible values."""
        with patch.dict("os.environ", {}, clear=False):
            config = ScannerConfig(
                supabase_url="http://test",
                supabase_key="key",
            )
        assert config.phone_ip == "auto"
        assert config.phone_port == 8080
        assert config.camera_fps == 3
        assert config.confidence_threshold == 0.70
        assert config.min_contour_area == 500
        assert config.max_contour_area == 50000
        assert config.brickognize_max_rps == 2
        assert config.brickognize_top_n == 5
        assert config.calibration_frames == 30
        assert config.image_retention_days == 90

    def test_load_config_from_env(self):
        """Config loads from environment variables."""
        env = {
            "PHONE_IP": "10.0.0.5",
            "PHONE_PORT": "9090",
            "CAMERA_FPS": "10",
            "CONFIDENCE_THRESHOLD": "0.80",
            "MIN_CONTOUR_AREA": "1000",
            "MAX_CONTOUR_AREA": "100000",
            "BRICKOGNIZE_MAX_RPS": "5",
            "BRICKOGNIZE_TOP_N": "3",
            "CALIBRATION_FRAMES": "10",
            "IMAGE_RETENTION_DAYS": "60",
            "NEXT_PUBLIC_SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "srv-key",
        }
        with patch.dict("os.environ", env, clear=False):
            with patch("config.load_dotenv"):
                config = load_config()

        assert config.phone_ip == "10.0.0.5"
        assert config.phone_port == 9090
        assert config.camera_fps == 10
        assert config.confidence_threshold == 0.80
        assert config.supabase_url == "https://test.supabase.co"
        assert config.supabase_key == "srv-key"

    def test_validate_missing_supabase_url(self):
        """Validation catches missing Supabase URL."""
        config = ScannerConfig(phone_ip="10.0.0.1", supabase_url="", supabase_key="")
        errors = config.validate()
        assert any("supabase" in e.lower() for e in errors)

    def test_validate_missing_supabase_key(self):
        """Validation catches missing Supabase key."""
        config = ScannerConfig(
            phone_ip="10.0.0.1",
            supabase_url="https://x.supabase.co",
            supabase_key="",
        )
        errors = config.validate()
        assert any("supabase" in e.lower() for e in errors)

    def test_validate_all_set(self):
        """Valid config passes validation."""
        config = ScannerConfig(
            phone_ip="10.0.0.1",
            supabase_url="https://x.supabase.co",
            supabase_key="key",
            user_id="user-1",
        )
        errors = config.validate()
        assert len(errors) == 0

    def test_parse_cli_args_override(self):
        """CLI args override env config."""
        env = {
            "PHONE_IP": "10.0.0.1",
            "NEXT_PUBLIC_SUPABASE_URL": "https://x.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "key",
        }
        with patch.dict("os.environ", env, clear=False):
            with patch("config.load_dotenv"):
                config = parse_cli_args(["--ip", "192.168.1.50", "--threshold", "0.80", "--fps", "10"])
        assert config.phone_ip == "192.168.1.50"
        assert config.confidence_threshold == 0.80
        assert config.camera_fps == 10


class TestMainEntryPoints:
    """F11: Main module structure."""

    def test_imports(self):
        """Main module imports without error."""
        import main  # noqa: F401

    def test_build_dashboard_returns_panel(self):
        """Dashboard builder returns a Rich Panel."""
        from main import build_dashboard
        from session import SessionManager

        mock_session = MagicMock(spec=SessionManager)
        mock_session.session_id = "test-session-001"
        mock_session.pieces = []

        mock_config = ScannerConfig(
            phone_ip="10.0.0.1",
            supabase_url="https://x.supabase.co",
            supabase_key="key",
        )

        panel = build_dashboard(
            session=mock_session,
            status="scanning",
            start_time=datetime.now(timezone.utc),
            config=mock_config,
        )
        assert panel is not None

    def test_display_summary(self):
        """Summary display runs without error."""
        from main import display_summary

        summary = SessionSummary(
            total_pieces=10,
            accepted_count=8,
            flagged_count=2,
            unique_parts=5,
            duration_seconds=120.0,
            pieces_per_minute=5.0,
        )
        # Just ensure it doesn't raise
        display_summary(summary)
