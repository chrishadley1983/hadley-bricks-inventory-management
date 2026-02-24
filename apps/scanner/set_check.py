"""Set completeness checker: checklist tracking, missing parts display, BrickLink wishlist export."""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

from rich.console import Console
from rich.panel import Panel
from rich.progress_bar import ProgressBar
from rich.table import Table
from rich.text import Text

logger = logging.getLogger(__name__)


class MatchResult(Enum):
    """Result of matching a scanned piece against the checklist."""
    FOUND = "found"           # Piece was expected and still needed
    COMPLETE = "complete"     # Piece was expected but we already have enough
    EXTRA = "extra"           # Piece is not in the expected parts list


@dataclass
class ChecklistEntry:
    """A single part+color combination in the set checklist."""
    part_num: str
    name: str
    color_id: int            # Rebrickable color ID
    color_name: str
    color_rgb: str
    bl_color_id: int | None  # BrickLink color ID (for XML export)
    expected_qty: int
    found_qty: int = 0
    is_spare: bool = False

    @property
    def needed_qty(self) -> int:
        return max(0, self.expected_qty - self.found_qty)

    @property
    def is_complete(self) -> bool:
        return self.found_qty >= self.expected_qty


class SetChecklist:
    """Tracks found vs expected parts for a LEGO set."""

    def __init__(self, parts: list[dict], set_name: str, set_num: str):
        self.set_name = set_name
        self.set_num = set_num
        self._entries: dict[tuple[str, int], ChecklistEntry] = {}
        self._spare_entries: dict[tuple[str, int], ChecklistEntry] = {}

        for part in parts:
            key = (part["part_num"], part["color_id"])
            target = self._spare_entries if part.get("is_spare", False) else self._entries

            if key in target:
                target[key].expected_qty += part["quantity"]
            else:
                target[key] = ChecklistEntry(
                    part_num=part["part_num"],
                    name=part["name"],
                    color_id=part["color_id"],
                    color_name=part["color_name"],
                    color_rgb=part.get("color_rgb", "000000"),
                    bl_color_id=part.get("bl_color_id"),
                    expected_qty=part["quantity"],
                    is_spare=part.get("is_spare", False),
                )

    def mark_found(self, part_num: str, color_id: int) -> MatchResult:
        """Mark a scanned piece as found. Returns the match result."""
        key = (part_num, color_id)

        # Check main entries first
        if key in self._entries:
            entry = self._entries[key]
            entry.found_qty += 1
            if entry.found_qty <= entry.expected_qty:
                return MatchResult.FOUND
            return MatchResult.COMPLETE

        # Check spare entries
        if key in self._spare_entries:
            entry = self._spare_entries[key]
            entry.found_qty += 1
            if entry.found_qty <= entry.expected_qty:
                return MatchResult.FOUND
            return MatchResult.COMPLETE

        return MatchResult.EXTRA

    def get_missing(self) -> list[ChecklistEntry]:
        """Get all non-spare parts where found_qty < expected_qty."""
        return [e for e in self._entries.values() if not e.is_complete]

    def get_progress(self) -> tuple[int, int]:
        """Get (found_total, expected_total) counting only non-spare parts."""
        found = sum(min(e.found_qty, e.expected_qty) for e in self._entries.values())
        expected = sum(e.expected_qty for e in self._entries.values())
        return found, expected

    def get_all_entries(self) -> list[ChecklistEntry]:
        """Get all non-spare entries."""
        return list(self._entries.values())

    @property
    def total_unique_parts(self) -> int:
        """Number of unique part+color combinations (non-spare)."""
        return len(self._entries)

    def export_bricklink_xml(self, output_path: Path) -> int:
        """Export missing parts as BrickLink Mass Upload XML.

        Returns the number of missing items exported.
        """
        missing = self.get_missing()
        if not missing:
            return 0

        root = ET.Element("INVENTORY")

        for entry in missing:
            item = ET.SubElement(root, "ITEM")
            ET.SubElement(item, "ITEMTYPE").text = "P"
            ET.SubElement(item, "ITEMID").text = entry.part_num
            if entry.bl_color_id is not None:
                ET.SubElement(item, "COLOR").text = str(entry.bl_color_id)
            ET.SubElement(item, "MINQTY").text = str(entry.needed_qty)

        tree = ET.ElementTree(root)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        ET.indent(tree, space="  ")
        tree.write(output_path, encoding="unicode", xml_declaration=True)

        logger.info(f"Exported {len(missing)} missing parts to {output_path}")
        return len(missing)


def format_missing_table(checklist: SetChecklist) -> Table:
    """Build a Rich table showing all missing parts."""
    missing = checklist.get_missing()
    found, expected = checklist.get_progress()

    table = Table(
        title=f"Missing Parts: {checklist.set_name} ({checklist.set_num})",
        show_header=True,
        header_style="bold",
    )
    table.add_column("Part", min_width=10)
    table.add_column("Color", min_width=15)
    table.add_column("Description", min_width=25)
    table.add_column("Need", justify="right", width=6)
    table.add_column("Found", justify="right", width=6)
    table.add_column("Expected", justify="right", width=8)

    # Sort by part number then color name
    for entry in sorted(missing, key=lambda e: (e.part_num, e.color_name)):
        table.add_row(
            entry.part_num,
            entry.color_name,
            entry.name,
            str(entry.needed_qty),
            str(entry.found_qty),
            str(entry.expected_qty),
        )

    table.caption = (
        f"{found}/{expected} parts found | "
        f"{len(missing)} unique parts missing | "
        f"{sum(e.needed_qty for e in missing)} total pieces needed"
    )

    return table


def build_set_check_dashboard(
    checklist: SetChecklist,
    status: str,
    elapsed: str,
    recent_matches: list[tuple[str, str, MatchResult]],
) -> Panel:
    """Build the Rich dashboard for set-check mode.

    Args:
        checklist: The current set checklist
        status: Current status string (scanning/paused/checking)
        elapsed: Formatted elapsed time string
        recent_matches: List of (part_name, color_name, match_result) tuples
    """
    table = Table.grid(padding=1)
    table.add_column(ratio=1)

    # Set info
    found, expected = checklist.get_progress()
    pct = (found / expected * 100) if expected > 0 else 0

    set_text = Text()
    set_text.append(f"Set: ", style="bold")
    set_text.append(f"{checklist.set_num} - {checklist.set_name}  ", style="cyan")
    set_text.append(f"Status: ", style="bold")
    color = {"scanning": "green", "paused": "yellow", "checking": "cyan"}.get(status, "white")
    set_text.append(f"{status}  ", style=color)
    set_text.append(f"Duration: {elapsed}", style="bold")
    table.add_row(set_text)

    # Progress
    progress_text = Text()
    progress_text.append(f"Progress: ", style="bold")
    progress_text.append(f"{found}/{expected} parts found ", style="green" if pct > 90 else ("yellow" if pct > 50 else "white"))
    progress_text.append(f"({pct:.0f}%)  ", style="bold")
    missing_count = len(checklist.get_missing())
    progress_text.append(f"Missing: ", style="bold")
    progress_text.append(f"{missing_count} unique parts", style="red" if missing_count > 0 else "green")
    table.add_row(progress_text)

    # Progress bar
    bar_width = 40
    filled = int(bar_width * pct / 100)
    bar = "[green]" + "█" * filled + "[/green][dim]" + "░" * (bar_width - filled) + "[/dim]"
    table.add_row(Text.from_markup(f"  {bar} {pct:.0f}%"))

    # Recent matches
    if recent_matches:
        recent_table = Table(show_header=True, header_style="bold", box=None)
        recent_table.add_column("#", width=4)
        recent_table.add_column("Part", min_width=20)
        recent_table.add_column("Color", min_width=15)
        recent_table.add_column("Result", width=10)

        for i, (part_name, color_name, result) in enumerate(reversed(recent_matches[-10:]), 1):
            if result == MatchResult.FOUND:
                style = "green"
                result_text = "Found"
            elif result == MatchResult.COMPLETE:
                style = "yellow"
                result_text = "Already have"
            elif result == MatchResult.EXTRA:
                style = "dim"
                result_text = "Extra"
            else:
                style = "dim"
                result_text = "Skipped"

            recent_table.add_row(str(i), part_name, color_name, result_text, style=style)

        table.add_row(recent_table)

    return Panel(
        table,
        title="[bold]LEGO Set Checker[/bold]",
        subtitle="[dim]Space=Pause  C=Check missing  S/Q=Stop[/dim]",
    )
