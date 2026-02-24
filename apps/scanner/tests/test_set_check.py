"""Tests for set completeness checker (F3, F4, F6, F7, F8, E4)."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from set_check import (
    ChecklistEntry,
    MatchResult,
    SetChecklist,
    build_set_check_dashboard,
    format_missing_table,
)


# ---------------------------------------------------------------------------
# Sample parts data (mimics Rebrickable API response shape)
# ---------------------------------------------------------------------------

def _make_parts() -> list[dict]:
    """Create a sample parts list for testing."""
    return [
        {
            "part_num": "3001",
            "name": "Brick 2 x 4",
            "color_id": 4,
            "color_name": "Red",
            "color_rgb": "C91A09",
            "bl_color_id": 5,
            "quantity": 4,
            "is_spare": False,
        },
        {
            "part_num": "3001",
            "name": "Brick 2 x 4",
            "color_id": 1,
            "color_name": "Blue",
            "color_rgb": "0055BF",
            "bl_color_id": 7,
            "quantity": 2,
            "is_spare": False,
        },
        {
            "part_num": "3010",
            "name": "Brick 1 x 4",
            "color_id": 0,
            "color_name": "Black",
            "color_rgb": "05131D",
            "bl_color_id": 11,
            "quantity": 3,
            "is_spare": False,
        },
        {
            "part_num": "3001",
            "name": "Brick 2 x 4",
            "color_id": 4,
            "color_name": "Red",
            "color_rgb": "C91A09",
            "bl_color_id": 5,
            "quantity": 1,
            "is_spare": True,
        },
    ]


@pytest.fixture
def sample_parts() -> list[dict]:
    return _make_parts()


@pytest.fixture
def checklist(sample_parts: list[dict]) -> SetChecklist:
    return SetChecklist(sample_parts, "Test Set", "12345-1")


# ---------------------------------------------------------------------------
# F3: Checklist tracks found vs expected
# ---------------------------------------------------------------------------

class TestSetChecklist:
    """F3: SetChecklist data structure tests."""

    def test_initial_progress(self, checklist: SetChecklist):
        """Initial progress is 0/total."""
        found, expected = checklist.get_progress()
        assert found == 0
        assert expected == 9  # 4 red + 2 blue + 3 black (spares excluded)

    def test_total_unique_parts(self, checklist: SetChecklist):
        """Counts unique part+color combinations (non-spare)."""
        assert checklist.total_unique_parts == 3  # 3001-Red, 3001-Blue, 3010-Black

    def test_mark_found_expected_part(self, checklist: SetChecklist):
        """Marking an expected part returns FOUND."""
        result = checklist.mark_found("3001", 4)  # Red brick
        assert result == MatchResult.FOUND

    def test_mark_found_increments_count(self, checklist: SetChecklist):
        """Each mark_found increments found_qty."""
        checklist.mark_found("3001", 4)
        checklist.mark_found("3001", 4)
        found, expected = checklist.get_progress()
        assert found == 2
        assert expected == 9

    def test_mark_found_all_returns_complete(self, checklist: SetChecklist):
        """Marking beyond expected quantity returns COMPLETE."""
        for _ in range(4):
            checklist.mark_found("3001", 4)
        result = checklist.mark_found("3001", 4)
        assert result == MatchResult.COMPLETE

    def test_mark_found_unknown_part_returns_extra(self, checklist: SetChecklist):
        """Unknown part+color returns EXTRA."""
        result = checklist.mark_found("9999", 99)
        assert result == MatchResult.EXTRA

    def test_get_missing(self, checklist: SetChecklist):
        """get_missing returns parts with found < expected."""
        checklist.mark_found("3001", 4)  # 1 of 4 red bricks
        checklist.mark_found("3001", 4)  # 2 of 4
        missing = checklist.get_missing()
        assert len(missing) == 3  # Still missing some red, all blue, all black

    def test_get_missing_after_complete(self, checklist: SetChecklist):
        """Completed parts don't appear in missing."""
        # Complete all red bricks
        for _ in range(4):
            checklist.mark_found("3001", 4)
        missing = checklist.get_missing()
        part_keys = [(e.part_num, e.color_id) for e in missing]
        assert ("3001", 4) not in part_keys
        assert len(missing) == 2  # Blue and Black still missing

    def test_progress_with_marks(self, checklist: SetChecklist):
        """F3 evidence: create checklist with 3 parts, mark 2 found."""
        checklist.mark_found("3001", 4)  # 1 red
        checklist.mark_found("3001", 1)  # 1 blue
        found, expected = checklist.get_progress()
        assert found == 2
        assert expected == 9
        missing = checklist.get_missing()
        assert len(missing) == 3  # All 3 unique parts still need more

    def test_spare_parts_tracked_separately(self, checklist: SetChecklist):
        """Spare parts don't count toward main progress."""
        found, expected = checklist.get_progress()
        assert expected == 9  # Spares excluded from expected total

    def test_excess_after_complete_returns_complete(self, checklist: SetChecklist):
        """Scanning beyond expected qty returns COMPLETE (user has enough)."""
        # Mark all 4 red non-spares as found
        for _ in range(4):
            checklist.mark_found("3001", 4)
        # 5th one — user already has enough
        result = checklist.mark_found("3001", 4)
        assert result == MatchResult.COMPLETE

    def test_duplicate_part_entries_merged(self):
        """Parts with same part_num+color_id in input are merged."""
        parts = [
            {"part_num": "3001", "name": "Brick 2 x 4", "color_id": 4,
             "color_name": "Red", "bl_color_id": 5, "quantity": 2, "is_spare": False},
            {"part_num": "3001", "name": "Brick 2 x 4", "color_id": 4,
             "color_name": "Red", "bl_color_id": 5, "quantity": 3, "is_spare": False},
        ]
        cl = SetChecklist(parts, "Test", "1-1")
        _, expected = cl.get_progress()
        assert expected == 5  # 2 + 3 merged


# ---------------------------------------------------------------------------
# F7 + F8: BrickLink wishlist XML export and color ID mapping
# ---------------------------------------------------------------------------

class TestBrickLinkExport:
    """F7: BrickLink XML export and F8: color ID mapping."""

    def test_export_xml_structure(self, checklist: SetChecklist, tmp_path: Path):
        """XML has correct BrickLink Mass Upload structure."""
        output = tmp_path / "wishlist.xml"
        count = checklist.export_bricklink_xml(output)
        assert count == 3  # 3 unique missing parts

        tree = ET.parse(output)
        root = tree.getroot()
        assert root.tag == "INVENTORY"

        items = root.findall("ITEM")
        assert len(items) == 3

    def test_export_xml_item_fields(self, checklist: SetChecklist, tmp_path: Path):
        """Each ITEM has correct fields."""
        output = tmp_path / "wishlist.xml"
        checklist.export_bricklink_xml(output)

        tree = ET.parse(output)
        root = tree.getroot()
        items = root.findall("ITEM")

        # Find the Red 3001 entry
        for item in items:
            if item.find("ITEMID").text == "3001":
                color_el = item.find("COLOR")
                if color_el is not None and color_el.text == "5":  # BL Red = 5
                    assert item.find("ITEMTYPE").text == "P"
                    assert item.find("MINQTY").text == "4"
                    break
        else:
            pytest.fail("Red 3001 not found in XML")

    def test_export_xml_bl_color_ids(self, checklist: SetChecklist, tmp_path: Path):
        """F8: BrickLink color IDs are correctly mapped from Rebrickable."""
        output = tmp_path / "wishlist.xml"
        checklist.export_bricklink_xml(output)

        tree = ET.parse(output)
        root = tree.getroot()

        # Collect all color IDs from XML
        color_ids = set()
        for item in root.findall("ITEM"):
            color_el = item.find("COLOR")
            if color_el is not None:
                color_ids.add(int(color_el.text))

        # Verify BrickLink color IDs (not Rebrickable IDs)
        assert 5 in color_ids   # BL Red (RB 4)
        assert 7 in color_ids   # BL Blue (RB 1)
        assert 11 in color_ids  # BL Black (RB 0)

    def test_export_no_missing_returns_zero(self, checklist: SetChecklist, tmp_path: Path):
        """Export with all parts found returns 0."""
        # Mark everything as found
        for _ in range(4):
            checklist.mark_found("3001", 4)
        for _ in range(2):
            checklist.mark_found("3001", 1)
        for _ in range(3):
            checklist.mark_found("3010", 0)

        output = tmp_path / "wishlist.xml"
        count = checklist.export_bricklink_xml(output)
        assert count == 0

    def test_export_partial_quantities(self, checklist: SetChecklist, tmp_path: Path):
        """Export shows only needed quantity (expected - found)."""
        # Find 2 of 4 red bricks
        checklist.mark_found("3001", 4)
        checklist.mark_found("3001", 4)

        output = tmp_path / "wishlist.xml"
        checklist.export_bricklink_xml(output)

        tree = ET.parse(output)
        root = tree.getroot()

        for item in root.findall("ITEM"):
            if item.find("ITEMID").text == "3001":
                color_el = item.find("COLOR")
                if color_el is not None and color_el.text == "5":  # Red
                    assert item.find("MINQTY").text == "2"  # Need 2 more
                    return

        pytest.fail("Red 3001 not found in XML")


# ---------------------------------------------------------------------------
# F5: Dashboard rendering
# ---------------------------------------------------------------------------

class TestSetCheckDashboard:
    """F5: Real-time progress display."""

    def test_dashboard_renders(self, checklist: SetChecklist):
        """Dashboard builds without errors."""
        panel = build_set_check_dashboard(
            checklist=checklist,
            status="scanning",
            elapsed="01:30",
            recent_matches=[],
        )
        assert panel is not None

    def test_dashboard_with_matches(self, checklist: SetChecklist):
        """Dashboard renders with recent matches."""
        matches = [
            ("Brick 2 x 4", "Red", MatchResult.FOUND),
            ("Brick 1 x 4", "Black", MatchResult.FOUND),
            ("Plate 1 x 2", "White", MatchResult.EXTRA),
        ]
        panel = build_set_check_dashboard(
            checklist=checklist,
            status="scanning",
            elapsed="02:15",
            recent_matches=matches,
        )
        assert panel is not None


# ---------------------------------------------------------------------------
# F6: format_missing_table
# ---------------------------------------------------------------------------

class TestFormatMissingTable:
    """F6: Missing parts table formatting."""

    def test_table_has_all_missing(self, checklist: SetChecklist):
        """Table includes all missing parts."""
        table = format_missing_table(checklist)
        assert table is not None
        assert table.row_count == 3  # 3 unique missing parts

    def test_table_after_partial_scan(self, checklist: SetChecklist):
        """Table reflects partial progress."""
        # Complete red bricks
        for _ in range(4):
            checklist.mark_found("3001", 4)
        table = format_missing_table(checklist)
        assert table.row_count == 2  # Blue and Black still missing


# ---------------------------------------------------------------------------
# E4: Unrecognised piece handling
# ---------------------------------------------------------------------------

class TestUnrecognisedPieceHandling:
    """E4: Unrecognised pieces don't affect checklist."""

    def test_extra_piece_no_checklist_change(self, checklist: SetChecklist):
        """Marking an unknown part as EXTRA doesn't change progress."""
        before_found, before_expected = checklist.get_progress()
        result = checklist.mark_found("UNKNOWN", -1)
        after_found, after_expected = checklist.get_progress()
        assert result == MatchResult.EXTRA
        assert before_found == after_found
        assert before_expected == after_expected
