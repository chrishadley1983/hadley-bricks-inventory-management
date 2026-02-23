"""Tests for the session module (F9, F13, E1-supabase)."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from config import ScannerConfig
from models import BrickognizeItem, IdentificationResult, SessionSummary
from session import SessionManager


@pytest.fixture
def mock_supabase():
    """Mock Supabase client."""
    client = MagicMock()

    # Mock table operations (chained)
    table_mock = MagicMock()
    table_mock.insert.return_value = table_mock
    table_mock.update.return_value = table_mock
    table_mock.eq.return_value = table_mock
    table_mock.execute.return_value = MagicMock(
        data=[{"id": "test-session-id-001"}]
    )

    client.table.return_value = table_mock

    # Mock storage
    storage_mock = MagicMock()
    storage_mock.upload.return_value = None
    client.storage.from_.return_value = storage_mock

    return client


@pytest.fixture
def session_manager(config: ScannerConfig, mock_supabase) -> SessionManager:
    with patch("session.create_client", return_value=mock_supabase):
        mgr = SessionManager(config)
        mgr.supabase = mock_supabase
        return mgr


class TestSessionStart:
    """F9: Session creates scanner_sessions row."""

    @pytest.mark.asyncio
    async def test_start_creates_session(self, session_manager: SessionManager):
        session_id = await session_manager.start(
            confidence_threshold=0.70,
            camera_config={"ip": "192.168.1.100", "port": 8080},
        )
        assert session_id == "test-session-id-001"
        assert session_manager.session_id == "test-session-id-001"
        assert session_manager.start_time is not None

    @pytest.mark.asyncio
    async def test_start_inserts_with_calibrating_status(
        self, session_manager: SessionManager, mock_supabase
    ):
        await session_manager.start(0.70, {})
        mock_supabase.table.assert_called_with("scanner_sessions")
        insert_call = mock_supabase.table().insert.call_args
        assert insert_call[0][0]["status"] == "calibrating"


class TestRecordPiece:
    """F9: Pieces recorded to scanner_pieces."""

    @pytest.mark.asyncio
    async def test_record_piece_inserts_row(
        self,
        session_manager: SessionManager,
        sample_identification_result: IdentificationResult,
        mock_supabase,
    ):
        await session_manager.start(0.70, {})

        # Mock piece insert
        mock_supabase.table().execute.return_value = MagicMock(
            data=[{"id": "piece-001"}]
        )

        piece_id = await session_manager.record_piece(sample_identification_result)
        assert piece_id == "piece-001"
        assert len(session_manager.pieces) == 1

    @pytest.mark.asyncio
    async def test_record_piece_uploads_image(
        self,
        session_manager: SessionManager,
        sample_identification_result: IdentificationResult,
        mock_supabase,
    ):
        await session_manager.start(0.70, {})
        mock_supabase.table().execute.return_value = MagicMock(
            data=[{"id": "piece-001"}]
        )

        await session_manager.record_piece(sample_identification_result)

        # Verify image upload was called
        mock_supabase.storage.from_.assert_called_with("scanner-images")

    @pytest.mark.asyncio
    async def test_record_piece_without_session_raises(
        self,
        session_manager: SessionManager,
        sample_identification_result: IdentificationResult,
    ):
        with pytest.raises(RuntimeError, match="Session not started"):
            await session_manager.record_piece(sample_identification_result)


class TestSessionEnd:
    """F9: Session end with summary."""

    @pytest.mark.asyncio
    async def test_end_returns_summary(self, session_manager: SessionManager):
        await session_manager.start(0.70, {})

        # Add some pieces
        for i in range(3):
            session_manager.pieces.append(
                IdentificationResult(
                    track_id=i,
                    brickognize_item_id=f"300{i}",
                    item_name=f"Part {i}",
                    confidence=0.85,
                    status="accepted",
                )
            )

        summary = await session_manager.end()
        assert isinstance(summary, SessionSummary)
        assert summary.total_pieces == 3
        assert summary.accepted_count == 3
        assert summary.unique_parts == 3

    @pytest.mark.asyncio
    async def test_end_without_session_raises(self, session_manager: SessionManager):
        with pytest.raises(RuntimeError, match="Session not started"):
            await session_manager.end()


class TestSessionAbort:
    """E1-supabase: Session abort."""

    @pytest.mark.asyncio
    async def test_abort_updates_status(
        self, session_manager: SessionManager, mock_supabase
    ):
        await session_manager.start(0.70, {})
        await session_manager.abort()
        # Should have called update with aborted status
        mock_supabase.table().update.assert_called()


class TestBuildSummary:
    """Summary calculation logic."""

    def test_summary_counts(self, session_manager: SessionManager):
        session_manager.pieces = [
            IdentificationResult(track_id=1, confidence=0.9, status="accepted", brickognize_item_id="3001"),
            IdentificationResult(track_id=2, confidence=0.5, status="flagged", brickognize_item_id="3001"),
            IdentificationResult(track_id=3, confidence=0.0, status="error"),
            IdentificationResult(track_id=4, confidence=0.8, status="accepted", brickognize_item_id="3002"),
        ]

        summary = session_manager._build_summary(120.0)
        assert summary.total_pieces == 4
        assert summary.accepted_count == 2
        assert summary.flagged_count == 1
        assert summary.error_count == 1
        assert summary.unique_parts == 2
        assert summary.duration_seconds == 120.0
        assert summary.pieces_per_minute == 2.0

    def test_summary_empty(self, session_manager: SessionManager):
        summary = session_manager._build_summary(60.0)
        assert summary.total_pieces == 0
        assert summary.pieces_per_minute == 0.0


class TestExport:
    """F13: Export JSON and CSV."""

    def test_export_json(self, session_manager: SessionManager):
        session_manager.pieces = [
            IdentificationResult(
                track_id=1,
                brickognize_item_id="3001",
                item_name="Brick 2 x 4",
                item_category="Brick",
                confidence=0.90,
                status="accepted",
                top_results=[BrickognizeItem(id="3001", name="Brick 2 x 4", score=0.90)],
            ),
            IdentificationResult(
                track_id=2,
                brickognize_item_id="3001",
                item_name="Brick 2 x 4",
                item_category="Brick",
                confidence=0.85,
                status="accepted",
                top_results=[BrickognizeItem(id="3001", name="Brick 2 x 4", score=0.85)],
            ),
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "output.json"
            session_manager.export_json(path)

            data = json.loads(path.read_text())
            assert len(data) == 1  # Consolidated by part_id
            assert data[0]["part_id"] == "3001"
            assert data[0]["quantity"] == 2
            assert data[0]["avg_confidence"] == 0.875

    def test_export_csv(self, session_manager: SessionManager):
        session_manager.pieces = [
            IdentificationResult(
                track_id=1,
                brickognize_item_id="3001",
                item_name="Brick 2 x 4",
                item_category="Brick",
                confidence=0.90,
                status="accepted",
            ),
        ]

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "output.csv"
            session_manager.export_csv(path)

            lines = path.read_text().strip().split("\n")
            assert len(lines) == 2  # Header + 1 row
            assert "part_id" in lines[0]
            assert "3001" in lines[1]
