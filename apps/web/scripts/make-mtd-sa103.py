#!/usr/bin/env python3
"""Fill a My Tax Digital SA103F bridging spreadsheet from a box→value JSON.

    npx tsx scripts/mtd-sa103-boxes.ts --start=2026-04-06 --end=2026-07-06 --json --out=boxes.json
    python scripts/make-mtd-sa103.py boxes.json out.xlsx

Patches the template's raw sheet XML rather than round-tripping through a
spreadsheet library, so every bit of My Tax Digital's own formatting, styling
and cell protection survives untouched — the bridging tool reads a fixed cell
layout and rejects a re-encoded workbook.

GOTCHA (cost us a rejected first attempt on 2026-07-03): each box on the sheet
is a narrow '£' label cell in column B (width 2.13) sitting next to the REAL
value cell in column C (width 19). Writing to B looks plausible in a preview
and parses as nothing. Values go in C — never B.
"""

from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

TEMPLATE = (
    Path(__file__).resolve().parents[3]
    / "docs"
    / "features"
    / "quickfile-cash-basis"
    / "MTD_SA103_template.xlsx"
)

# SA103F box -> template cell. Boxes 17-30 are the DETAILED expense breakdown and
# are mutually exclusive with box 31 (consolidated) — never fill both.
CELL_BY_BOX = {
    "15": "C7",  # turnover
    # Box 16 (any other business income) is deliberately absent: its cell has
    # never been confirmed against the template, and guessing a cell on a tax
    # return is worse than failing. Verify the sheet, then add it.
    "17": "C19",  # cost of goods bought for resale
    "20": "C31",  # car, van and travel expenses
    "21": "C35",  # rent, rates, power and insurance
    "23": "C43",  # phone, stationery and other office costs
    "24.1": "C47",  # advertising
    "26": "C59",  # bank, credit card and other financial charges
    "30": "C75",  # other business expenses
    # Consolidated expenses (ALTERNATIVE to 17-30). Row 77 holds the box-31
    # LABEL only and has no C cell at all; the value cell is C79, one row down,
    # matching every other box's label-then-value layout. Verified against the
    # template 2026-07-25 — the previous "C77" would have aborted with "cell not
    # found", fail-loud but wrong.
    "31": "C79",
}


def patch_sheet(xml: str, boxes: dict[str, float]) -> str:
    for box, value in boxes.items():
        cell = CELL_BY_BOX.get(box)
        if cell is None:
            raise SystemExit(f"No template cell known for SA103F box {box}")

        # Match the empty (self-closing) or already-populated cell, keeping its style.
        pattern = re.compile(
            r'<c r="' + cell + r'"((?:\s+[a-zA-Z:]+="[^"]*")*)\s*(?:/>|>.*?</c>)',
            re.S,
        )
        match = pattern.search(xml)
        if match is None:
            raise SystemExit(f"Cell {cell} (box {box}) not found in the template sheet")

        # Drop any t="s"/t="str" — we are writing an inline number, not a string.
        attrs = re.sub(r'\s+t="[^"]*"', "", match.group(1))
        replacement = f'<c r="{cell}"{attrs}><v>{value:.2f}</v></c>'
        xml = xml[: match.start()] + replacement + xml[match.end() :]
    return xml


def read_back(path: Path) -> dict[str, str]:
    with zipfile.ZipFile(path) as z:
        sheet = next(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))
        xml = z.read(sheet).decode("utf8")
    found = {}
    for box, cell in CELL_BY_BOX.items():
        m = re.search(r'<c r="' + cell + r'"[^>]*>\s*<v>(.*?)</v>', xml, re.S)
        if m:
            found[box] = m.group(1)
    return found


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: make-mtd-sa103.py <boxes.json> <out.xlsx>")

    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf8"))
    boxes = {k: float(v) for k, v in payload["boxes"].items()}
    out = Path(sys.argv[2])

    if "31" in boxes and any(b in boxes for b in ("17", "20", "21", "23", "24.1", "26", "30")):
        raise SystemExit("Box 31 (consolidated) cannot be combined with boxes 17-30")

    # The declared expense total must equal the sum of the expense boxes.
    expense_boxes = {b: v for b, v in boxes.items() if b not in ("15", "16")}
    declared = round(float(payload["expenses"]), 2)
    summed = round(sum(expense_boxes.values()), 2)
    if abs(declared - summed) > 0.01:
        raise SystemExit(f"Expense mismatch: boxes sum to {summed}, payload says {declared}")

    if not TEMPLATE.exists():
        raise SystemExit(f"Template missing: {TEMPLATE}")

    out.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(TEMPLATE) as z:
        sheet_name = next(n for n in z.namelist() if n.startswith("xl/worksheets/sheet"))
        entries = [(i, z.read(i.filename)) for i in z.infolist()]

    patched = patch_sheet(
        next(d for i, d in entries if i.filename == sheet_name).decode("utf8"), boxes
    )

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info, data in entries:
            zout.writestr(
                info, patched.encode("utf8") if info.filename == sheet_name else data
            )

    period = payload.get("period", {})
    print(f"Wrote {out}")
    print(f"  period : {period.get('startDate')} to <{period.get('endDateExclusive')}"
          f"  ({payload.get('basis')} basis)")
    print("  cells verified by re-reading the saved file:")
    back = read_back(out)
    for box, cell in CELL_BY_BOX.items():
        if box in boxes:
            got = back.get(box, "MISSING")
            ok = got != "MISSING" and abs(float(got) - boxes[box]) < 0.005
            print(f"    box {box:<5} {cell:<4} {got:>12}  {'OK' if ok else 'MISMATCH'}")
            if not ok:
                raise SystemExit(f"Verification failed for box {box}")
    print(f"  turnover {payload['turnover']:.2f} - expenses {declared:.2f} "
          f"= profit {payload['profit']:.2f}")


if __name__ == "__main__":
    main()
