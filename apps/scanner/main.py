"""LEGO Conveyor Belt Scanner - Entry point and CLI interface."""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from calibration import CalibrationFlow
from camera import CameraClient
from config import ScannerConfig, parse_cli_args
from detector import BestFrameSelector, CentroidTracker, PieceDetector
from identifier import (
    BrickognizeClient,
    build_error_result,
    build_identification_result,
    frame_to_jpeg_bytes,
)
from models import IdentificationResult, SessionSummary
from session import SessionManager

console = Console()
logger = logging.getLogger("scanner")


# ---------------------------------------------------------------------------
# Pipeline coroutines
# ---------------------------------------------------------------------------

async def camera_loop(
    camera: CameraClient,
    frame_queue: asyncio.Queue,
    stop_event: asyncio.Event,
) -> None:
    """Capture frames from camera and put into queue."""
    await camera.stream_frames(frame_queue, stop_event)


async def detection_loop(
    detector: PieceDetector,
    tracker: CentroidTracker,
    selector: BestFrameSelector,
    frame_queue: asyncio.Queue,
    best_frame_queue: asyncio.Queue,
    stop_event: asyncio.Event,
) -> None:
    """Detect pieces, track centroids, select best frames."""
    previous_ids: set[int] = set()

    while not stop_event.is_set():
        try:
            frame = await asyncio.wait_for(frame_queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue

        contours = detector.detect(frame)
        current_objects = tracker.update(contours)
        current_ids = set(current_objects.keys())

        # Add frames for currently tracked pieces
        for track_id, centroid in current_objects.items():
            selector.add_frame(track_id, frame, centroid, detector.roi)

        # Check for pieces that left the frame (deregistered)
        departed = previous_ids - current_ids
        for track_id in departed:
            best = selector.get_best_frame(track_id)
            if best is not None:
                best_frame, sharpness = best
                try:
                    best_frame_queue.put_nowait((track_id, best_frame, sharpness))
                except asyncio.QueueFull:
                    logger.warning(f"Best frame queue full, dropping piece {track_id}")
                selector.remove(track_id)

        previous_ids = current_ids


async def identification_loop(
    identifier: BrickognizeClient,
    best_frame_queue: asyncio.Queue,
    result_queue: asyncio.Queue,
    config: ScannerConfig,
    stop_event: asyncio.Event,
) -> None:
    """Identify pieces via Brickognize API."""
    while not stop_event.is_set():
        try:
            track_id, frame, sharpness = await asyncio.wait_for(
                best_frame_queue.get(), timeout=1.0
            )
        except asyncio.TimeoutError:
            continue

        image_bytes = frame_to_jpeg_bytes(frame)

        try:
            response = await identifier.identify(image_bytes)
            result = build_identification_result(
                track_id=track_id,
                response=response,
                threshold=config.confidence_threshold,
                image_bytes=image_bytes,
                frame_sharpness=sharpness,
            )
        except Exception as e:
            logger.error(f"Identification failed for piece {track_id}: {e}")
            result = build_error_result(
                track_id=track_id,
                error_message=str(e),
                image_bytes=image_bytes,
                frame_sharpness=sharpness,
            )

        try:
            result_queue.put_nowait(result)
        except asyncio.QueueFull:
            logger.warning("Result queue full, dropping result")


async def persistence_loop(
    session: SessionManager,
    result_queue: asyncio.Queue,
    stop_event: asyncio.Event,
) -> None:
    """Persist identification results to Supabase."""
    while not stop_event.is_set():
        try:
            result = await asyncio.wait_for(result_queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            continue

        try:
            await session.record_piece(result)
        except Exception as e:
            logger.error(f"Failed to persist piece {result.track_id}: {e}")


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

def build_dashboard(
    session: SessionManager,
    status: str,
    start_time: datetime | None,
    config: ScannerConfig,
) -> Panel:
    """Build Rich dashboard layout."""
    table = Table.grid(padding=1)
    table.add_column(ratio=1)

    # Status bar
    elapsed = ""
    if start_time:
        delta = (datetime.now(timezone.utc) - start_time).total_seconds()
        mins, secs = divmod(int(delta), 60)
        elapsed = f"{mins:02d}:{secs:02d}"

    status_text = Text()
    status_text.append(f"Session: ", style="bold")
    status_text.append(f"{session.session_id or 'N/A'}  ", style="dim")
    status_text.append(f"Status: ", style="bold")
    color = {"scanning": "green", "paused": "yellow", "calibrating": "cyan"}.get(status, "white")
    status_text.append(f"{status}  ", style=color)
    status_text.append(f"Duration: {elapsed}  ", style="bold")
    status_text.append(f"Threshold: {config.confidence_threshold:.2f}", style="bold")
    table.add_row(status_text)

    # Last identified piece
    if session.pieces:
        last = session.pieces[-1]
        last_text = Text()
        last_text.append("Last: ", style="bold")
        last_text.append(f"{last.item_name or 'Unknown'} ", style="cyan")
        last_text.append(f"({last.brickognize_item_id or '?'}) ", style="dim")
        last_text.append(f"{last.confidence:.1%} ", style="green" if last.status == "accepted" else "yellow")
        last_text.append(f"[{last.status}]", style="bold")
        table.add_row(last_text)

    # Running totals
    accepted = sum(1 for p in session.pieces if p.status == "accepted")
    flagged = sum(1 for p in session.pieces if p.status == "flagged")
    errors = sum(1 for p in session.pieces if p.status == "error")
    total = len(session.pieces)

    totals = Text()
    totals.append("Accepted: ", style="bold")
    totals.append(f"{accepted}  ", style="green")
    totals.append("Flagged: ", style="bold")
    totals.append(f"{flagged}  ", style="yellow")
    totals.append("Errors: ", style="bold")
    totals.append(f"{errors}  ", style="red")
    totals.append("Total: ", style="bold")
    totals.append(f"{total}", style="white")
    table.add_row(totals)

    # Throughput
    if start_time and total > 0:
        elapsed_s = (datetime.now(timezone.utc) - start_time).total_seconds()
        ppm = total / elapsed_s * 60 if elapsed_s > 0 else 0
        table.add_row(Text(f"Throughput: {ppm:.1f} pieces/min", style="dim"))

    # Recent activity (last 5)
    if session.pieces:
        recent_table = Table(show_header=True, header_style="bold", box=None)
        recent_table.add_column("#", width=4)
        recent_table.add_column("Part", min_width=20)
        recent_table.add_column("Confidence", width=12)
        recent_table.add_column("Status", width=10)

        for i, p in enumerate(reversed(session.pieces[-10:]), 1):
            style = "green" if p.status == "accepted" else ("yellow" if p.status == "flagged" else "red")
            recent_table.add_row(
                str(i),
                p.item_name or "Unknown",
                f"{p.confidence:.1%}",
                p.status,
                style=style,
            )
        table.add_row(recent_table)

    return Panel(
        table,
        title="[bold]LEGO Scanner[/bold]",
        subtitle="[dim]Space=Pause  S=Stop  R=Review  Q=Quit  T=Threshold[/dim]",
    )


def display_summary(summary: SessionSummary) -> None:
    """Print formatted session summary."""
    console.print()
    console.print(Panel(
        f"[bold]Total pieces:[/bold] {summary.total_pieces}\n"
        f"[green]Accepted:[/green] {summary.accepted_count}\n"
        f"[yellow]Flagged:[/yellow] {summary.flagged_count}\n"
        f"[red]Errors:[/red] {summary.error_count}\n"
        f"[bold]Unique parts:[/bold] {summary.unique_parts}\n"
        f"[bold]Duration:[/bold] {summary.duration_seconds:.0f}s\n"
        f"[bold]Throughput:[/bold] {summary.pieces_per_minute:.1f} pieces/min",
        title="[bold]Session Summary[/bold]",
    ))


# ---------------------------------------------------------------------------
# Review mode
# ---------------------------------------------------------------------------

async def review_mode(session: SessionManager) -> None:
    """Interactive review of flagged pieces."""
    flagged = [p for p in session.pieces if p.status == "flagged"]
    if not flagged:
        console.print("[green]No flagged pieces to review.[/green]")
        return

    console.print(f"\n[bold]Review Mode:[/bold] {len(flagged)} flagged pieces\n")

    for i, piece in enumerate(flagged, 1):
        console.print(f"[bold]Piece {i}/{len(flagged)}[/bold]")
        console.print(f"  Top candidates:")
        for j, candidate in enumerate(piece.top_results[:5], 1):
            style = "bold" if j == 1 else ""
            console.print(
                f"    [{j}] {candidate.name} (ID: {candidate.id}) - "
                f"{candidate.score:.1%}",
                style=style,
            )

        # Open image in default viewer if available
        if piece.image_bytes:
            tmp_path = Path(f"output/_review_{piece.track_id}.jpg")
            tmp_path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path.write_bytes(piece.image_bytes)
            try:
                os.startfile(str(tmp_path))
            except (AttributeError, OSError):
                console.print(f"  [dim]Image saved: {tmp_path}[/dim]")

        choice = console.input(
            "  [1-5] Accept candidate, [S] Skip, [M] Manual ID: "
        ).strip().upper()

        if choice in ("1", "2", "3", "4", "5"):
            idx = int(choice) - 1
            if idx < len(piece.top_results):
                selected = piece.top_results[idx]
                piece.brickognize_item_id = selected.id
                piece.item_name = selected.name
                piece.item_category = selected.category
                piece.confidence = selected.score
                piece.status = "accepted"

                # Update in Supabase
                try:
                    session.supabase.table("scanner_pieces").update({
                        "reviewed_at": datetime.now(timezone.utc).isoformat(),
                        "reviewed_item_id": selected.id,
                        "status": "accepted",
                    }).eq("session_id", session.session_id).eq(
                        "brickognize_listing_id", piece.brickognize_listing_id
                    ).execute()
                except Exception as e:
                    logger.warning(f"Failed to update review: {e}")

                console.print(f"  [green]Accepted: {selected.name}[/green]")
        elif choice == "M":
            manual_id = console.input("  Enter part number: ").strip()
            if manual_id:
                piece.brickognize_item_id = manual_id
                piece.status = "accepted"
                try:
                    session.supabase.table("scanner_pieces").update({
                        "reviewed_at": datetime.now(timezone.utc).isoformat(),
                        "reviewed_item_id": manual_id,
                        "status": "accepted",
                    }).eq("session_id", session.session_id).eq(
                        "brickognize_listing_id", piece.brickognize_listing_id
                    ).execute()
                except Exception as e:
                    logger.warning(f"Failed to update review: {e}")
                console.print(f"  [green]Manually set: {manual_id}[/green]")
        else:
            console.print("  [dim]Skipped[/dim]")

    console.print("\n[bold]Review complete.[/bold]")


# ---------------------------------------------------------------------------
# Keyboard handler
# ---------------------------------------------------------------------------

async def keyboard_handler(
    session: SessionManager,
    config: ScannerConfig,
    status_ref: list[str],
    stop_event: asyncio.Event,
) -> None:
    """Listen for key presses (Windows: msvcrt)."""
    try:
        import msvcrt

        while not stop_event.is_set():
            if msvcrt.kbhit():
                key = msvcrt.getch().decode("utf-8", errors="ignore").upper()

                if key == " ":
                    if status_ref[0] == "scanning":
                        status_ref[0] = "paused"
                        await session.update_status("paused")
                    elif status_ref[0] == "paused":
                        status_ref[0] = "scanning"
                        await session.update_status("scanning")

                elif key == "S":
                    stop_event.set()

                elif key == "R":
                    status_ref[0] = "paused"
                    await review_mode(session)
                    status_ref[0] = "scanning"

                elif key == "Q":
                    stop_event.set()

                elif key == "T":
                    console.print(
                        f"\nCurrent threshold: {config.confidence_threshold:.2f}"
                    )
                    try:
                        new_val = float(
                            console.input("New threshold (0.0-1.0): ").strip()
                        )
                        if 0.0 <= new_val <= 1.0:
                            config.confidence_threshold = new_val
                            console.print(f"Threshold set to {new_val:.2f}")
                        else:
                            console.print("[red]Invalid value[/red]")
                    except ValueError:
                        console.print("[red]Invalid number[/red]")

            await asyncio.sleep(0.1)

    except ImportError:
        # Non-Windows: fall back to simple input
        logger.warning("msvcrt not available, keyboard shortcuts disabled")
        while not stop_event.is_set():
            await asyncio.sleep(1.0)


# ---------------------------------------------------------------------------
# Lookup user_id
# ---------------------------------------------------------------------------

def lookup_user_id(config: ScannerConfig) -> str:
    """Find the first user profile in Supabase."""
    from supabase import create_client

    client = create_client(config.supabase_url, config.supabase_key)
    result = client.table("profiles").select("id").limit(1).execute()
    if result.data:
        return result.data[0]["id"]
    raise RuntimeError("No user profile found in database. Create one first.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main(config: ScannerConfig) -> None:
    """Main async orchestrator."""
    # Validate config
    errors = config.validate()
    if errors:
        for err in errors:
            console.print(f"[red]Config error: {err}[/red]")
        return

    # Lookup user_id
    if not config.user_id:
        try:
            config.user_id = lookup_user_id(config)
            console.print(f"[dim]User: {config.user_id}[/dim]")
        except Exception as e:
            console.print(f"[red]Cannot determine user: {e}[/red]")
            return

    # Initialize modules
    camera = CameraClient(config)
    detector = PieceDetector(config)
    tracker = CentroidTracker()
    selector = BestFrameSelector()
    identifier = BrickognizeClient(config)
    session = SessionManager(config)

    # Health check
    console.print("[bold]Checking camera connection...[/bold]")
    if not await camera.health_check():
        console.print("[red]Cannot reach camera. Check IP Webcam is running.[/red]")
        await camera.close()
        return

    console.print("[green]Camera connected.[/green]")

    # Start session
    camera_config = {
        "phone_ip": config.phone_ip,
        "phone_port": config.phone_port,
        "fps": config.camera_fps,
        "resolution": config.camera_resolution,
    }
    await session.start(config.confidence_threshold, camera_config)

    # Calibration
    console.print("\n[bold]Starting calibration...[/bold]")
    console.print("Ensure the belt is EMPTY, then press Enter.")
    input()

    calibration = CalibrationFlow(camera, config)
    cal_result = await calibration.run()

    if cal_result.lighting_warning:
        console.print(f"[yellow]Warning: {cal_result.lighting_warning}[/yellow]")
    if cal_result.contrast_warning:
        console.print(f"[yellow]Warning: {cal_result.contrast_warning}[/yellow]")

    detector.train_background(cal_result.background_frames)
    detector.roi = cal_result.roi

    await session.update_status("scanning")
    console.print("[green]Calibration complete. Scanning...[/green]\n")

    # Create async queues
    frame_queue: asyncio.Queue = asyncio.Queue(maxsize=30)
    best_frame_queue: asyncio.Queue = asyncio.Queue(maxsize=10)
    result_queue: asyncio.Queue = asyncio.Queue(maxsize=50)

    stop_event = asyncio.Event()
    status_ref = ["scanning"]
    start_time = datetime.now(timezone.utc)

    # Launch pipeline tasks
    tasks = [
        asyncio.create_task(camera_loop(camera, frame_queue, stop_event)),
        asyncio.create_task(
            detection_loop(detector, tracker, selector, frame_queue, best_frame_queue, stop_event)
        ),
        asyncio.create_task(
            identification_loop(identifier, best_frame_queue, result_queue, config, stop_event)
        ),
        asyncio.create_task(persistence_loop(session, result_queue, stop_event)),
        asyncio.create_task(keyboard_handler(session, config, status_ref, stop_event)),
    ]

    # Rich Live display
    try:
        with Live(
            build_dashboard(session, status_ref[0], start_time, config),
            refresh_per_second=2,
            console=console,
        ) as live:
            while not stop_event.is_set():
                live.update(
                    build_dashboard(session, status_ref[0], start_time, config)
                )
                await asyncio.sleep(0.5)
    except KeyboardInterrupt:
        stop_event.set()

    # Cancel all pipeline tasks
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)

    # End session
    summary = await session.end()

    # Export
    output_dir = Path(__file__).parent / "output"
    session.export_json(output_dir / f"{session.session_id}.json")
    session.export_csv(output_dir / f"{session.session_id}.csv")

    display_summary(summary)

    console.print(f"\n[dim]Exports saved to: {output_dir}[/dim]")
    console.print("[dim]Run with -R to review flagged pieces.[/dim]")

    # Cleanup
    await camera.close()
    await identifier.close()


def run():
    """Entry point."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    config = parse_cli_args()
    asyncio.run(main(config))


if __name__ == "__main__":
    run()
