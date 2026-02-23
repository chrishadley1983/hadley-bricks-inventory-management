"""Record raw frames from the camera for offline replay/tuning."""

import asyncio
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from camera import CameraClient
from config import load_config

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s.%(msecs)03d [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("record")


async def main():
    config = load_config()
    if len(sys.argv) > 1:
        config.phone_ip = sys.argv[1]

    session_name = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path("recordings") / session_name
    out_dir.mkdir(parents=True, exist_ok=True)

    log.info(f"Recording session: {session_name}")
    log.info(f"Output: {out_dir.resolve()}")
    log.info(f"Camera: {config.phone_ip}:{config.phone_port}")
    log.info(f"Target FPS: {config.camera_fps}")

    camera = CameraClient(config)
    log.info("Connecting to camera...")
    ok = await camera.health_check()
    if not ok:
        log.error("CANNOT REACH CAMERA")
        await camera.close()
        return
    log.info("Camera connected OK")

    # Phase 1: Record background frames (belt empty)
    log.info("")
    log.info("=== RECORDING BACKGROUND (belt should be EMPTY) ===")
    bg_count = config.calibration_frames
    for i in range(bg_count):
        frame = await camera.capture_frame_with_retry()
        if frame is not None:
            cv2.imwrite(str(out_dir / f"bg_{i:04d}.jpg"), frame)
            if i % 10 == 0:
                log.info(f"  Background frame {i+1}/{bg_count}")
    log.info(f"Saved {bg_count} background frames")

    # Phase 2: Record detection frames (belt running with pieces)
    log.info("")
    log.info("=== RECORDING DETECTION FRAMES (60 seconds) ===")
    log.info("Start the belt with pieces NOW")

    frame_count = 0
    start = time.time()
    duration = 60

    while time.time() - start < duration:
        t0 = time.time()
        frame = await camera.capture_frame_with_retry()
        if frame is not None:
            cv2.imwrite(str(out_dir / f"frame_{frame_count:04d}.jpg"), frame)
            frame_count += 1

            if frame_count % 30 == 0:
                elapsed = time.time() - start
                log.info(f"  {frame_count} frames in {elapsed:.0f}s")

        elapsed_frame = time.time() - t0
        sleep_time = max(0, (1.0 / config.camera_fps) - elapsed_frame)
        await asyncio.sleep(sleep_time)

    elapsed = time.time() - start
    log.info("")
    log.info(f"Recording complete: {frame_count} frames in {elapsed:.0f}s")
    log.info(f"FPS: {frame_count / elapsed:.1f}")
    log.info(f"Saved to: {out_dir.resolve()}")

    await camera.close()


if __name__ == "__main__":
    asyncio.run(main())
