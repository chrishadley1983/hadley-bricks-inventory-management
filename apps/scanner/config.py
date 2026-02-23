"""Configuration for the LEGO conveyor belt scanner."""

import argparse
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Load env from apps/web/.env.local (same Supabase creds the web app uses)
_project_root = Path(__file__).resolve().parent.parent.parent
_env_path = _project_root / "apps" / "web" / ".env.local"
if _env_path.exists():
    load_dotenv(_env_path)

# Also load local .env if present (overrides)
_local_env = Path(__file__).resolve().parent / ".env"
if _local_env.exists():
    load_dotenv(_local_env, override=True)


@dataclass
class ScannerConfig:
    """Scanner configuration with defaults from .env and CLI overrides."""

    # Supabase
    supabase_url: str = ""
    supabase_key: str = ""

    # Camera
    phone_ip: str = "auto"
    phone_port: int = 8080
    camera_fps: int = 3
    camera_resolution: str = "1280x720"

    # Detection
    confidence_threshold: float = 0.70
    min_contour_area: int = 500
    max_contour_area: int = 50000
    calibration_frames: int = 30

    # Brickognize
    brickognize_max_rps: int = 2
    brickognize_top_n: int = 5

    # Storage
    image_retention_days: int = 90

    # Runtime (set after init)
    user_id: str = ""

    def __post_init__(self):
        if not self.supabase_url:
            self.supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
        if not self.supabase_key:
            self.supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    def validate(self) -> list[str]:
        """Return list of validation errors, empty if valid."""
        errors = []
        if not self.supabase_url:
            errors.append("SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL is required")
        if not self.supabase_key:
            errors.append("SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY is required")
        if self.camera_fps < 1 or self.camera_fps > 30:
            errors.append("CAMERA_FPS must be between 1 and 30")
        if self.confidence_threshold < 0 or self.confidence_threshold > 1:
            errors.append("CONFIDENCE_THRESHOLD must be between 0 and 1")
        return errors


def load_config() -> ScannerConfig:
    """Load config from environment variables with defaults."""
    return ScannerConfig(
        phone_ip=os.environ.get("PHONE_IP", "auto"),
        phone_port=int(os.environ.get("PHONE_PORT", "8080")),
        camera_fps=int(os.environ.get("CAMERA_FPS", "3")),
        camera_resolution=os.environ.get("CAMERA_RESOLUTION", "1280x720"),
        confidence_threshold=float(os.environ.get("CONFIDENCE_THRESHOLD", "0.70")),
        min_contour_area=int(os.environ.get("MIN_CONTOUR_AREA", "500")),
        max_contour_area=int(os.environ.get("MAX_CONTOUR_AREA", "50000")),
        calibration_frames=int(os.environ.get("CALIBRATION_FRAMES", "30")),
        brickognize_max_rps=int(os.environ.get("BRICKOGNIZE_MAX_RPS", "2")),
        brickognize_top_n=int(os.environ.get("BRICKOGNIZE_TOP_N", "5")),
        image_retention_days=int(os.environ.get("IMAGE_RETENTION_DAYS", "90")),
    )


def parse_cli_args(args: list[str] | None = None) -> ScannerConfig:
    """Parse CLI arguments, merging with env-based config."""
    parser = argparse.ArgumentParser(
        description="LEGO Conveyor Belt Scanner - Identify LEGO pieces via Brickognize API"
    )
    parser.add_argument("--ip", type=str, help="IP Webcam phone IP address")
    parser.add_argument(
        "--threshold", type=float, help="Confidence threshold (0.0-1.0)"
    )
    parser.add_argument("--fps", type=int, help="Frames per second to capture")

    parsed = parser.parse_args(args)
    config = load_config()

    # CLI args override env
    if parsed.ip:
        config.phone_ip = parsed.ip
    if parsed.threshold is not None:
        config.confidence_threshold = parsed.threshold
    if parsed.fps is not None:
        config.camera_fps = parsed.fps

    return config
