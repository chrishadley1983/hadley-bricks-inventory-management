"""Replay a recorded session through the detection pipeline for offline tuning.

Usage:
    python replay_session.py recordings/20260223_161500
    python replay_session.py recordings/20260223_161500 --no-api   # skip Brickognize
    python replay_session.py recordings/20260223_161500 --merge-threshold 80000
    python replay_session.py recordings/20260223_161500 --min-area 8000
"""

import asyncio
import argparse
import logging
import sys
import time
from pathlib import Path

import cv2
import numpy as np

from config import ScannerConfig, load_config
from detector import PieceDetector, CentroidTracker, BestFrameSelector
from color import identify_color
from identifier import BrickognizeClient, build_identification_result, build_error_result, frame_to_jpeg_bytes

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s.%(msecs)03d [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("replay")


def parse_args():
    parser = argparse.ArgumentParser(description="Replay recorded session")
    parser.add_argument("session_dir", type=str, help="Path to recorded session")
    parser.add_argument("--no-api", action="store_true", help="Skip Brickognize API calls")
    parser.add_argument("--min-area", type=int, default=None, help="Override min_contour_area")
    parser.add_argument("--max-area", type=int, default=None, help="Override max_contour_area")
    parser.add_argument("--edge-margin", type=int, default=None, help="Override EDGE_MARGIN")
    parser.add_argument("--max-distance", type=int, default=300, help="Tracker max_distance")
    parser.add_argument("--max-disappeared", type=int, default=10, help="Tracker max_disappeared")
    return parser.parse_args()


async def main():
    args = parse_args()
    session_dir = Path(args.session_dir)

    if not session_dir.exists():
        log.error(f"Session directory not found: {session_dir}")
        return

    # Load frames
    bg_files = sorted(session_dir.glob("bg_*.jpg"))
    frame_files = sorted(session_dir.glob("frame_*.jpg"))

    if not bg_files or not frame_files:
        log.error(f"No frames found in {session_dir}")
        return

    log.info("=" * 60)
    log.info("REPLAY SESSION")
    log.info("=" * 60)
    log.info(f"Session: {session_dir}")
    log.info(f"Background frames: {len(bg_files)}")
    log.info(f"Detection frames: {len(frame_files)}")

    # Load config with overrides
    config = load_config()
    if args.min_area is not None:
        config.min_contour_area = args.min_area
    if args.max_area is not None:
        config.max_contour_area = args.max_area

    # Apply overrides
    if args.edge_margin is not None:
        PieceDetector.EDGE_MARGIN = args.edge_margin
        log.info(f"Override edge_margin: {args.edge_margin}")

    log.info(f"Min contour area: {config.min_contour_area}px")
    log.info(f"Max contour area: {config.max_contour_area}px")
    log.info(f"Edge margin: {PieceDetector.EDGE_MARGIN}px")
    log.info(f"Tracker max_distance: {args.max_distance}px")
    log.info(f"Tracker max_disappeared: {args.max_disappeared}")
    log.info(f"Brickognize API: {'DISABLED' if args.no_api else 'ENABLED'}")
    log.info("")

    # Train background
    log.info("Training background model...")
    detector = PieceDetector(config)
    bg_frames = [cv2.imread(str(f)) for f in bg_files]
    bg_frames = [f for f in bg_frames if f is not None]
    detector.train_background(bg_frames)

    # Setup tracking
    tracker = CentroidTracker(
        max_disappeared=args.max_disappeared,
        max_distance=args.max_distance,
    )
    selector = BestFrameSelector()
    brickognize = BrickognizeClient(config) if not args.no_api else None

    previous_ids = set()
    detection_count = 0
    departed_count = 0
    accepted_count = 0
    flagged_count = 0
    error_count = 0
    identifications = []
    pending_api_tasks = []

    color_results: dict[int, dict] = {}

    async def identify_piece(track_id, best_frame, sharpness):
        nonlocal accepted_count, flagged_count, error_count
        try:
            image_bytes = frame_to_jpeg_bytes(best_frame)
            t_api = time.time()
            response = await brickognize.identify(image_bytes)
            api_ms = (time.time() - t_api) * 1000
            result = build_identification_result(
                track_id, response, config.confidence_threshold, image_bytes, sharpness
            )
            identifications.append(result)

            # Color identification (constrained by Brickognize part ID)
            part_id = result.brickognize_item_id
            color_info = await asyncio.to_thread(identify_color, best_frame, part_id)
            color_results[track_id] = color_info

            if result.status == "accepted":
                accepted_count += 1
                log.info(
                    f"  [OK] ACCEPTED: #{track_id:03d} {result.item_name} "
                    f"(id={result.brickognize_item_id} conf={result.confidence:.0%}) "
                    f"COLOR={color_info['name']} (dE={color_info['delta_e']:.1f}) "
                    f"[{api_ms:.0f}ms]"
                )
            else:
                flagged_count += 1
                top_names = [f"{r.name} ({r.score:.0%})" for r in result.top_results[:3]]
                log.info(
                    f"  ? FLAGGED: #{track_id:03d} top={', '.join(top_names)} "
                    f"COLOR={color_info['name']} (dE={color_info['delta_e']:.1f}) "
                    f"[{api_ms:.0f}ms]"
                )
        except Exception as e:
            error_count += 1
            log.error(f"  [ERR] ERROR: #{track_id:03d} {e}")
            identifications.append(build_error_result(track_id, str(e)))

    # Process frames
    log.info(f"Processing {len(frame_files)} frames...")
    start = time.time()

    for i, frame_file in enumerate(frame_files):
        frame = cv2.imread(str(frame_file))
        if frame is None:
            continue

        contours = detector.detect(frame)
        current_objects = tracker.update(contours)
        current_ids = set(current_objects.keys())

        bbox_lookup = {c.centroid: c.bounding_rect for c in contours}

        for track_id, centroid in current_objects.items():
            bbox = bbox_lookup.get(centroid)
            if bbox is not None:
                selector.add_frame(track_id, frame, centroid, bbox, detector.roi)

        # Departed pieces
        departed = previous_ids - current_ids
        for track_id in departed:
            departed_count += 1
            best = selector.get_best_frame(track_id)
            if best:
                best_frame, sharpness = best
                bh, bw = best_frame.shape[:2]
                log.info(f"  >>> DEPARTED: #{track_id:03d} sharpness={sharpness:.1f} crop={bw}x{bh}")

                if brickognize:
                    task = asyncio.create_task(identify_piece(track_id, best_frame, sharpness))
                    pending_api_tasks.append(task)
            else:
                log.info(f"  >>> DEPARTED: #{track_id:03d} (no best frame)")
            selector.remove(track_id)

        if contours:
            detection_count += 1
            if detection_count % 10 == 1:
                log.debug(
                    f"[frame {i}] contours={len(contours)} "
                    f"tracking={len(current_objects)} ids={sorted(current_ids)}"
                )
                for c in contours:
                    merged = " *** LARGE" if c.area > 40000 else ""
                    log.debug(f"  area={c.area:.0f}px bbox={c.bounding_rect}{merged}")

        previous_ids = current_ids

    # Handle remaining tracked objects as departed
    for track_id in list(tracker.objects.keys()):
        departed_count += 1
        best = selector.get_best_frame(track_id)
        if best:
            best_frame, sharpness = best
            bh, bw = best_frame.shape[:2]
            log.info(f"  >>> DEPARTED (end): #{track_id:03d} sharpness={sharpness:.1f} crop={bw}x{bh}")

            if brickognize:
                task = asyncio.create_task(identify_piece(track_id, best_frame, sharpness))
                pending_api_tasks.append(task)
        selector.remove(track_id)

    # Wait for API calls
    if pending_api_tasks:
        log.info(f"Waiting for {len(pending_api_tasks)} Brickognize calls...")
        await asyncio.gather(*pending_api_tasks, return_exceptions=True)

    elapsed = time.time() - start

    # Summary
    log.info("")
    log.info("=" * 60)
    log.info("REPLAY SUMMARY")
    log.info("=" * 60)
    log.info(f"Frames processed: {len(frame_files)} in {elapsed:.1f}s")
    log.info(f"Frames with detections: {detection_count}")
    log.info("")
    log.info(f"Pieces departed: {departed_count}")
    if brickognize:
        log.info(f"  Accepted (>={config.confidence_threshold:.0%}): {accepted_count}")
        log.info(f"  Flagged (<{config.confidence_threshold:.0%}): {flagged_count}")
        log.info(f"  Errors: {error_count}")
    log.info("")

    if identifications:
        log.info("PIECE LIST")
        log.info("-" * 80)
        for r in sorted(identifications, key=lambda x: x.track_id):
            color = color_results.get(r.track_id)
            color_str = f" | {color['name']} (dE={color['delta_e']:.1f})" if color else ""
            if r.status == "error":
                log.info(f"  #{r.track_id:03d} ERROR: {r.error_message}")
            elif r.status == "accepted":
                log.info(f"  #{r.track_id:03d} [OK] {r.item_name} (id={r.brickognize_item_id} conf={r.confidence:.0%}){color_str}")
            else:
                top = r.top_results[0] if r.top_results else None
                name = top.name if top else "unknown"
                conf = top.score if top else 0
                log.info(f"  #{r.track_id:03d} ? {name} (conf={conf:.0%}){color_str}")
    elif not brickognize:
        log.info("(Brickognize disabled - detection count only)")

    log.info("")

    if brickognize:
        await brickognize.close()


if __name__ == "__main__":
    asyncio.run(main())
