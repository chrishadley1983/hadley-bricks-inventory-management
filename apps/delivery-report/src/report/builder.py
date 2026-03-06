"""
Hadley Bricks — Amazon Delivery Performance Report Builder

Generates branded HTML for:
  1. Email body (inline CSS, Gmail-safe)
  2. Full report (for PDF conversion / browser viewing)

Ported from the Co-Work skill report_template.py for Cloud Run.
"""

import os

# ── Brand Tokens ─────────────────────────────────────────────────────────
GOLDEN_YELLOW = "#F5A623"
BRICK_ORANGE = "#E8912D"
NAVY_BLUE = "#1E3A5F"
LIGHT_YELLOW = "#FFF8E7"
CREAM = "#FFFDF7"
OFF_WHITE = "#F9FAFB"
WHITE = "#FFFFFF"
SUCCESS_GREEN = "#22C55E"
ALERT_RED = "#EF4444"
INFO_BLUE = "#3B82F6"
DARK_GRAY = "#1F2937"
WARM_GRAY = "#6B7280"
MEDIUM_GRAY = "#9CA3AF"
LIGHT_GRAY = "#E5E7EB"

CARD_BORDER = f"1px solid {LIGHT_GRAY}"
CARD_RADIUS = "12px"
CARD_SHADOW = "0 1px 3px rgba(0,0,0,0.1)"
CARD_PADDING = "24px"

TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")


def _load_logo_base64(size: str = "small") -> str | None:
    path = os.path.join(TEMPLATES_DIR, f"logo_{size}_b64.txt")
    if os.path.exists(path):
        with open(path) as f:
            return f.read().strip()
    return None


def _otdr_border_color(pct: float) -> str:
    if pct >= 90:
        return SUCCESS_GREEN
    elif pct >= 80:
        return BRICK_ORANGE
    else:
        return ALERT_RED


def _status_badge(status_text: str) -> str:
    t = status_text.lower()
    if "on time" in t:
        bg, color = "#DCFCE7", "#166534"  # green
    elif "late" in t:
        bg, color = "#FEE2E2", "#991B1B"  # red
    elif "delivered" in t:
        bg, color = "#D1FAE5", "#065F46"  # green (slightly different shade)
    elif "transit" in t:
        bg, color = "#DBEAFE", "#1E40AF"  # blue
    elif "not dispatched" in t:
        bg, color = "#FEF3C7", "#92400E"  # amber
    elif "not checked" in t or "pending" in t:
        bg, color = "#F1F5F9", "#64748B"  # gray
    elif "expired" in t:
        bg, color = "#FEF3C7", "#78350F"  # dark amber
    elif "unknown" in t:
        bg, color = "#F3E8FF", "#6B21A8"  # purple
    else:
        bg, color = "#F1F5F9", "#64748B"  # gray
    return (
        f'<span style="background-color:{bg};color:{color};padding:4px 10px;'
        f'border-radius:4px;font-weight:500;font-size:8px;white-space:nowrap;">'
        f"{status_text}</span>"
    )


# ═════════════════════════════════════════════════════════════════════════
#  EMAIL BODY (inline CSS, Gmail-safe)
# ═════════════════════════════════════════════════════════════════════════


def build_email_body(
    date_str: str,
    total_orders: int,
    delivered: int,
    in_transit: int,
    on_time_count: int,
    on_time_total: int,
    otdr_now_pct: float,
    otdr_now_on_time: int,
    otdr_now_total: int,
    otdr_now_window: str,
    otdr_next_pct: float,
    otdr_next_on_time: int,
    otdr_next_total: int,
    otdr_next_window: str,
    otdr_90_date: str,
    otdr_90_pct: float,
    otdr_90_window: str,
    late_orders: list[dict],
    e2e_expected_days: float = 0.0,
    e2e_actual_days: float = 0.0,
    e2e_delta_days: float = 0.0,
    e2e_sample_size: int = 0,
    e2e_period_str: str = "",
) -> str:
    logo_b64 = _load_logo_base64("small")
    logo_img = ""
    if logo_b64:
        logo_img = (
            f'<img src="data:image/png;base64,{logo_b64}" '
            f'width="48" height="48" alt="Hadley Bricks" '
            f'style="display:block;border:0;vertical-align:middle;" />'
        )

    on_time_pct = round((on_time_count / on_time_total * 100) if on_time_total > 0 else 0, 1)
    now_border = _otdr_border_color(otdr_now_pct)
    next_border = _otdr_border_color(otdr_next_pct)
    target_border = _otdr_border_color(otdr_90_pct)

    late_rows = ""
    for o in late_orders:
        late_rows += f"""<tr>
            <td style="padding:12px 16px;border-bottom:1px solid {LIGHT_GRAY};font-size:13px;font-family:'Poppins',sans-serif;color:{DARK_GRAY};">{o['order_date']}</td>
            <td style="padding:12px 16px;border-bottom:1px solid {LIGHT_GRAY};font-size:13px;font-family:'Poppins',sans-serif;color:{DARK_GRAY};">{o['item']}</td>
            <td style="padding:12px 16px;border-bottom:1px solid {LIGHT_GRAY};font-size:13px;font-family:monospace;color:{WARM_GRAY};">{o['order_no']}</td>
            <td style="padding:12px 16px;border-bottom:1px solid {LIGHT_GRAY};font-size:13px;font-family:'Poppins',sans-serif;color:{DARK_GRAY};">{o['expected']}</td>
            <td style="padding:12px 16px;border-bottom:1px solid {LIGHT_GRAY};font-size:13px;font-family:'Poppins',sans-serif;color:{ALERT_RED};font-weight:600;">{o['actual']}</td>
            <td style="padding:12px 16px;border-bottom:1px solid {LIGHT_GRAY};font-size:13px;font-family:'Poppins',sans-serif;color:{DARK_GRAY};">{o.get('drop_off', '')}</td>
        </tr>"""

    late_section = ""
    if late_orders:
        late_section = f"""
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
            <tr><td style="padding:0 0 12px 0;">
                <span style="font-family:'Poppins',sans-serif;font-size:18px;font-weight:600;color:{DARK_GRAY};">Late orders (impacting OTDR)</span>
            </td></tr>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid {LIGHT_GRAY};border-radius:8px;border-collapse:separate;overflow:hidden;">
            <thead>
                <tr style="background-color:{OFF_WHITE};">
                    <th style="padding:12px 16px;text-align:left;font-family:'Poppins',sans-serif;font-size:11px;font-weight:600;color:{WARM_GRAY};text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid {LIGHT_GRAY};">Order date</th>
                    <th style="padding:12px 16px;text-align:left;font-family:'Poppins',sans-serif;font-size:11px;font-weight:600;color:{WARM_GRAY};text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid {LIGHT_GRAY};">Item</th>
                    <th style="padding:12px 16px;text-align:left;font-family:'Poppins',sans-serif;font-size:11px;font-weight:600;color:{WARM_GRAY};text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid {LIGHT_GRAY};">Order no</th>
                    <th style="padding:12px 16px;text-align:left;font-family:'Poppins',sans-serif;font-size:11px;font-weight:600;color:{WARM_GRAY};text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid {LIGHT_GRAY};">Expected</th>
                    <th style="padding:12px 16px;text-align:left;font-family:'Poppins',sans-serif;font-size:11px;font-weight:600;color:{WARM_GRAY};text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid {LIGHT_GRAY};">Actual</th>
                    <th style="padding:12px 16px;text-align:left;font-family:'Poppins',sans-serif;font-size:11px;font-weight:600;color:{WARM_GRAY};text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid {LIGHT_GRAY};">OTDR drop-off</th>
                </tr>
            </thead>
            <tbody>
                {late_rows}
            </tbody>
        </table>
        """

    html = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:{CREAM};font-family:'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:{CREAM};padding:20px 0;">
<tr><td align="center">
<table width="680" cellpadding="0" cellspacing="0" style="background-color:{WHITE};border:1px solid {LIGHT_GRAY};border-radius:12px;overflow:hidden;">

    <!-- Header -->
    <tr><td style="border-bottom:3px solid {GOLDEN_YELLOW};padding:24px 30px;">
        <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
                <td style="vertical-align:middle;">{logo_img}</td>
                <td style="vertical-align:middle;padding-left:14px;">
                    <span style="font-family:'Poppins',sans-serif;font-size:22px;font-weight:700;color:{GOLDEN_YELLOW};">Hadley Bricks</span>
                    <span style="font-family:'Poppins',sans-serif;font-size:22px;font-weight:700;color:{DARK_GRAY};"> — Delivery report</span>
                </td>
                <td style="vertical-align:middle;text-align:right;">
                    <span style="background-color:{LIGHT_YELLOW};border:1px solid #FDE68A;color:#92400E;padding:6px 14px;border-radius:6px;font-size:13px;font-weight:500;font-family:'Poppins',sans-serif;">{date_str}</span>
                </td>
            </tr>
        </table>
    </td></tr>

    <!-- Body -->
    <tr><td style="padding:30px;">

        <!-- Summary Cards -->
        <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
                <td width="25%" style="padding:0 8px 0 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:{WHITE};border:{CARD_BORDER};border-radius:{CARD_RADIUS};text-align:center;padding:16px;">
                        <tr><td style="padding:16px;text-align:center;">
                            <div style="font-family:'Poppins',sans-serif;font-size:12px;color:{WARM_GRAY};font-weight:500;">Total orders</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:28px;font-weight:700;color:{NAVY_BLUE};margin-top:6px;">{total_orders}</div>
                        </td></tr>
                    </table>
                </td>
                <td width="25%" style="padding:0 8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:{WHITE};border:{CARD_BORDER};border-radius:{CARD_RADIUS};text-align:center;padding:16px;">
                        <tr><td style="padding:16px;text-align:center;">
                            <div style="font-family:'Poppins',sans-serif;font-size:12px;color:{WARM_GRAY};font-weight:500;">Delivered</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:28px;font-weight:700;color:{SUCCESS_GREEN};margin-top:6px;">{delivered}</div>
                        </td></tr>
                    </table>
                </td>
                <td width="25%" style="padding:0 8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:{WHITE};border:{CARD_BORDER};border-radius:{CARD_RADIUS};text-align:center;padding:16px;">
                        <tr><td style="padding:16px;text-align:center;">
                            <div style="font-family:'Poppins',sans-serif;font-size:12px;color:{WARM_GRAY};font-weight:500;">In transit / pending</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:28px;font-weight:700;color:{BRICK_ORANGE};margin-top:6px;">{in_transit}</div>
                        </td></tr>
                    </table>
                </td>
                <td width="25%" style="padding:0 0 0 8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:{WHITE};border:{CARD_BORDER};border-radius:{CARD_RADIUS};text-align:center;padding:16px;">
                        <tr><td style="padding:16px;text-align:center;">
                            <div style="font-family:'Poppins',sans-serif;font-size:12px;color:{WARM_GRAY};font-weight:500;">On-time rate</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:28px;font-weight:700;color:{NAVY_BLUE};margin-top:6px;">{on_time_count}/{on_time_total}</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:11px;color:{MEDIUM_GRAY};margin-top:2px;">{on_time_pct}%</div>
                        </td></tr>
                    </table>
                </td>
            </tr>
        </table>

        <!-- OTDR Section -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
            <tr><td style="padding:0 0 6px 0;">
                <span style="font-family:'Poppins',sans-serif;font-size:18px;font-weight:600;color:{DARK_GRAY};">Amazon on-time delivery rate (OTDR)</span>
            </td></tr>
            <tr><td style="padding:0 0 16px 0;">
                <span style="font-family:'Poppins',sans-serif;font-size:12px;color:{WARM_GRAY};">Amazon uses a 7-day lag and 15-day rolling window</span>
            </td></tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">
            <tr>
                <td width="33%" style="padding:0 8px 0 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:{WHITE};border:{CARD_BORDER};border-radius:{CARD_RADIUS};border-top:4px solid {now_border};text-align:center;">
                        <tr><td style="padding:20px 16px;text-align:center;">
                            <div style="font-family:'Poppins',sans-serif;font-size:11px;color:{WARM_GRAY};font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Amazon showing now</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:32px;font-weight:700;color:{DARK_GRAY};margin-top:8px;">{otdr_now_pct}%</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:11px;color:{MEDIUM_GRAY};margin-top:6px;">{otdr_now_on_time} on-time / {otdr_now_total} total</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:10px;color:{MEDIUM_GRAY};margin-top:4px;">{otdr_now_window}</div>
                        </td></tr>
                    </table>
                </td>
                <td width="33%" style="padding:0 8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:{WHITE};border:{CARD_BORDER};border-radius:{CARD_RADIUS};border-top:4px solid {next_border};text-align:center;">
                        <tr><td style="padding:20px 16px;text-align:center;">
                            <div style="font-family:'Poppins',sans-serif;font-size:11px;color:{WARM_GRAY};font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Next update (~tomorrow)</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:32px;font-weight:700;color:{DARK_GRAY};margin-top:8px;">{otdr_next_pct}%</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:11px;color:{MEDIUM_GRAY};margin-top:6px;">{otdr_next_on_time} on-time / {otdr_next_total} total</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:10px;color:{MEDIUM_GRAY};margin-top:4px;">{otdr_next_window}</div>
                        </td></tr>
                    </table>
                </td>
                <td width="34%" style="padding:0 0 0 8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:{WHITE};border:{CARD_BORDER};border-radius:{CARD_RADIUS};border-top:4px solid {target_border};text-align:center;">
                        <tr><td style="padding:20px 16px;text-align:center;">
                            <div style="font-family:'Poppins',sans-serif;font-size:11px;color:{WARM_GRAY};font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">When OTDR hits 90%</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:22px;font-weight:700;color:{DARK_GRAY};margin-top:8px;">{otdr_90_date}</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:11px;color:{MEDIUM_GRAY};margin-top:6px;">Projected {otdr_90_pct}%</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:10px;color:{MEDIUM_GRAY};margin-top:4px;">{otdr_90_window}</div>
                        </td></tr>
                    </table>
                </td>
            </tr>
        </table>

        <!-- E2E Delivery Timeline -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
            <tr><td style="padding:0 0 6px 0;">
                <span style="font-family:'Poppins',sans-serif;font-size:18px;font-weight:600;color:{DARK_GRAY};">E2E delivery timeline</span>
            </td></tr>
            <tr><td style="padding:0 0 16px 0;">
                <span style="font-family:'Poppins',sans-serif;font-size:12px;color:{WARM_GRAY};">Average days from order date — delivered orders only</span>
            </td></tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">
            <tr>
                <td width="33%" style="padding:0 8px 0 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:{WHITE};border:{CARD_BORDER};border-radius:{CARD_RADIUS};border-top:4px solid {INFO_BLUE};text-align:center;">
                        <tr><td style="padding:20px 16px;text-align:center;">
                            <div style="font-family:'Poppins',sans-serif;font-size:11px;color:{WARM_GRAY};font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Expected</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:32px;font-weight:700;color:{DARK_GRAY};margin-top:8px;">{e2e_expected_days}</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:11px;color:{MEDIUM_GRAY};margin-top:6px;">days</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:10px;color:{MEDIUM_GRAY};margin-top:6px;">{e2e_sample_size} orders</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:10px;color:{MEDIUM_GRAY};margin-top:4px;">{e2e_period_str}</div>
                        </td></tr>
                    </table>
                </td>
                <td width="33%" style="padding:0 8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:{WHITE};border:{CARD_BORDER};border-radius:{CARD_RADIUS};border-top:4px solid {NAVY_BLUE};text-align:center;">
                        <tr><td style="padding:20px 16px;text-align:center;">
                            <div style="font-family:'Poppins',sans-serif;font-size:11px;color:{WARM_GRAY};font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Actual</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:32px;font-weight:700;color:{DARK_GRAY};margin-top:8px;">{e2e_actual_days}</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:11px;color:{MEDIUM_GRAY};margin-top:6px;">days</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:10px;color:{MEDIUM_GRAY};margin-top:6px;">{e2e_sample_size} orders</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:10px;color:{MEDIUM_GRAY};margin-top:4px;">{e2e_period_str}</div>
                        </td></tr>
                    </table>
                </td>
                <td width="34%" style="padding:0 0 0 8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:{WHITE};border:{CARD_BORDER};border-radius:{CARD_RADIUS};border-top:4px solid {SUCCESS_GREEN if e2e_delta_days <= 0 else BRICK_ORANGE};text-align:center;">
                        <tr><td style="padding:20px 16px;text-align:center;">
                            <div style="font-family:'Poppins',sans-serif;font-size:11px;color:{WARM_GRAY};font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">Delta</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:32px;font-weight:700;color:{DARK_GRAY};margin-top:8px;">{"+" if e2e_delta_days > 0 else ""}{e2e_delta_days}</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:11px;color:{MEDIUM_GRAY};margin-top:6px;">days</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:10px;color:{MEDIUM_GRAY};margin-top:6px;">{e2e_sample_size} orders</div>
                            <div style="font-family:'Poppins',sans-serif;font-size:10px;color:{MEDIUM_GRAY};margin-top:4px;">{e2e_period_str}</div>
                        </td></tr>
                    </table>
                </td>
            </tr>
        </table>

        {late_section}

    </td></tr>

    <!-- Footer -->
    <tr><td style="padding:16px 30px;background-color:{OFF_WHITE};border-top:1px solid {LIGHT_GRAY};">
        <span style="font-family:'Poppins',sans-serif;font-size:11px;color:{MEDIUM_GRAY};">
            Generated automatically by Hadley Bricks delivery monitor
        </span>
    </td></tr>

</table>
</td></tr>
</table>
</body>
</html>"""

    return html


# ═════════════════════════════════════════════════════════════════════════
#  FULL REPORT (for browser/PDF — uses <style> block, richer layout)
# ═════════════════════════════════════════════════════════════════════════


def build_full_report(
    date_str: str,
    total_orders: int,
    delivered: int,
    in_transit: int,
    on_time_count: int,
    on_time_total: int,
    otdr_now_pct: float,
    otdr_now_on_time: int,
    otdr_now_total: int,
    otdr_now_window: str,
    otdr_next_pct: float,
    otdr_next_on_time: int,
    otdr_next_total: int,
    otdr_next_window: str,
    otdr_90_date: str,
    otdr_90_pct: float,
    otdr_90_window: str,
    late_orders: list[dict],
    all_orders: list[dict],
    e2e_expected_days: float = 0.0,
    e2e_actual_days: float = 0.0,
    e2e_delta_days: float = 0.0,
    e2e_sample_size: int = 0,
    e2e_period_str: str = "",
) -> str:
    logo_b64 = _load_logo_base64("medium")
    logo_img = ""
    if logo_b64:
        logo_img = (
            f'<img src="data:image/png;base64,{logo_b64}" '
            f'width="40" height="40" alt="Hadley Bricks" '
            f'style="vertical-align:middle;" />'
        )

    on_time_pct = round((on_time_count / on_time_total * 100) if on_time_total > 0 else 0, 1)
    now_border = _otdr_border_color(otdr_now_pct)
    next_border = _otdr_border_color(otdr_next_pct)
    target_border = _otdr_border_color(otdr_90_pct)

    late_rows = ""
    for o in late_orders:
        late_rows += f"""<tr>
            <td>{o['order_date']}</td>
            <td style="overflow-wrap:break-word;">{o['item']}</td>
            <td style="font-family:monospace;color:{WARM_GRAY};font-size:8px;word-break:break-all;">{o['order_no']}</td>
            <td>{o['expected']}</td>
            <td style="color:{ALERT_RED};font-weight:600;">{o['actual']}</td>
            <td>{o.get('drop_off', '')}</td>
        </tr>"""

    all_rows = ""
    for o in all_orders:
        all_rows += f"""<tr>
            <td>{o['order_date']}</td>
            <td style="overflow-wrap:break-word;">{o['item']}</td>
            <td style="font-family:monospace;color:{WARM_GRAY};font-size:8px;word-break:break-all;">{o['order_no']}</td>
            <td style="font-family:monospace;font-size:8px;word-break:break-all;">{o.get('tracking', '')}</td>
            <td>{o['expected']}</td>
            <td>{o.get('actual', '')}</td>
            <td>{_status_badge(o.get('status', 'Unknown'))}</td>
        </tr>"""

    late_section = ""
    if late_orders:
        late_section = f"""
        <div class="section">
            <div class="section-title">Late orders (impacting OTDR)</div>
            <table class="table">
                <thead><tr>
                    <th style="width:11%;">Order date</th><th style="width:30%;">Item</th><th style="width:19%;">Order no</th>
                    <th style="width:13%;">Expected</th><th style="width:13%;">Actual</th><th style="width:14%;">OTDR drop-off</th>
                </tr></thead>
                <tbody>{late_rows}</tbody>
            </table>
        </div>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>Hadley Bricks — Amazon Delivery Performance</title>
    <style>
        @page {{ size: A4 portrait; margin: 15mm 12mm; }}
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background-color: {WHITE}; color: {DARK_GRAY}; padding: 0; font-size: 11px; line-height: 1.5; }}
        .container {{ max-width: 100%; margin: 0 auto; background: {WHITE}; }}
        .header {{ border-bottom: 3px solid {GOLDEN_YELLOW}; padding: 16px 20px; background: {WHITE}; display: flex; justify-content: space-between; align-items: center; }}
        .header-left {{ display: flex; align-items: center; gap: 10px; }}
        .header h1 {{ font-size: 18px; font-weight: 700; line-height: 24px; }}
        .header h1 .brand {{ color: {GOLDEN_YELLOW}; }}
        .date-badge {{ background-color: {LIGHT_YELLOW}; border: 1px solid #FDE68A; color: #92400E; padding: 4px 12px; border-radius: 6px; font-size: 11px; font-weight: 500; }}
        .content {{ padding: 16px 20px; }}
        .section {{ margin-bottom: 20px; }}
        .section-title {{ font-size: 14px; font-weight: 600; margin-bottom: 10px; color: {DARK_GRAY}; }}
        .section-subtitle {{ font-size: 10px; color: {WARM_GRAY}; margin-bottom: 10px; }}
        .summary-cards {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }}
        .card {{ background: {WHITE}; border: {CARD_BORDER}; border-radius: 8px; padding: 12px 8px; text-align: center; }}
        .card-value {{ font-size: 22px; font-weight: 700; margin: 4px 0 2px; }}
        .card-label {{ font-size: 10px; color: {WARM_GRAY}; font-weight: 500; }}
        .card-sub {{ font-size: 9px; color: {MEDIUM_GRAY}; }}
        .otdr-cards {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }}
        .otdr-card {{ background: {WHITE}; border: {CARD_BORDER}; border-radius: 8px; padding: 14px 8px; text-align: center; }}
        .otdr-card .card-value {{ font-size: 24px; }}
        .otdr-card .card-label {{ text-transform: uppercase; letter-spacing: 0.5px; font-size: 9px; }}
        .table {{ width: 100%; border-collapse: collapse; font-size: 9px; table-layout: fixed; }}
        .table thead {{ background-color: {OFF_WHITE}; border-bottom: 2px solid {LIGHT_GRAY}; }}
        .table th {{ padding: 6px 5px; text-align: left; font-weight: 600; color: {WARM_GRAY}; text-transform: uppercase; letter-spacing: 0.3px; font-size: 8px; overflow: hidden; }}
        .table td {{ padding: 5px 5px; border-bottom: 1px solid {LIGHT_GRAY}; overflow-wrap: break-word; word-wrap: break-word; }}
        .table tbody tr {{ page-break-inside: avoid; }}
        .col-date {{ width: 9%; }}
        .col-item {{ width: 28%; }}
        .col-order {{ width: 16%; }}
        .col-tracking {{ width: 15%; word-break: break-all; }}
        .col-expected {{ width: 9%; }}
        .col-actual {{ width: 9%; }}
        .col-status {{ width: 14%; }}
        .footer {{ padding: 10px 20px; background-color: {OFF_WHITE}; border-top: 1px solid {LIGHT_GRAY}; font-size: 9px; color: {MEDIUM_GRAY}; }}
    </style>
</head>
<body>
<div class="container">
    <div class="header">
        <div class="header-left">
            {logo_img}
            <h1><span class="brand">Hadley Bricks</span> — Delivery performance</h1>
        </div>
        <div class="date-badge">{date_str}</div>
    </div>
    <div class="content">
        <div class="section">
            <div class="summary-cards">
                <div class="card">
                    <div class="card-label">Total orders</div>
                    <div class="card-value" style="color:{NAVY_BLUE};">{total_orders}</div>
                </div>
                <div class="card">
                    <div class="card-label">Delivered</div>
                    <div class="card-value" style="color:{SUCCESS_GREEN};">{delivered}</div>
                </div>
                <div class="card">
                    <div class="card-label">In transit / pending</div>
                    <div class="card-value" style="color:{BRICK_ORANGE};">{in_transit}</div>
                </div>
                <div class="card">
                    <div class="card-label">On-time rate</div>
                    <div class="card-value" style="color:{NAVY_BLUE};">{on_time_count}/{on_time_total}</div>
                    <div class="card-sub">{on_time_pct}%</div>
                </div>
            </div>
        </div>
        <div class="section">
            <div class="section-title">Amazon on-time delivery rate (OTDR)</div>
            <div class="section-subtitle">Amazon uses a 7-day lag and 15-day rolling window</div>
            <div class="otdr-cards">
                <div class="otdr-card" style="border-top:4px solid {now_border};">
                    <div class="card-label">Amazon showing now</div>
                    <div class="card-value">{otdr_now_pct}%</div>
                    <div class="card-sub">{otdr_now_on_time} on-time / {otdr_now_total} total</div>
                    <div class="card-sub" style="margin-top:4px;">{otdr_now_window}</div>
                </div>
                <div class="otdr-card" style="border-top:4px solid {next_border};">
                    <div class="card-label">Next update (~tomorrow)</div>
                    <div class="card-value">{otdr_next_pct}%</div>
                    <div class="card-sub">{otdr_next_on_time} on-time / {otdr_next_total} total</div>
                    <div class="card-sub" style="margin-top:4px;">{otdr_next_window}</div>
                </div>
                <div class="otdr-card" style="border-top:4px solid {target_border};">
                    <div class="card-label">When OTDR hits 90%</div>
                    <div class="card-value" style="font-size:18px;">{otdr_90_date}</div>
                    <div class="card-sub">Projected {otdr_90_pct}%</div>
                    <div class="card-sub" style="margin-top:4px;">{otdr_90_window}</div>
                </div>
            </div>
        </div>
        <div class="section">
            <div class="section-title">E2E delivery timeline</div>
            <div class="section-subtitle">Average days from order date — delivered orders only</div>
            <div class="otdr-cards">
                <div class="otdr-card" style="border-top:4px solid {INFO_BLUE};">
                    <div class="card-label">Expected</div>
                    <div class="card-value">{e2e_expected_days}</div>
                    <div class="card-sub">days</div>
                    <div class="card-sub" style="margin-top:6px;">{e2e_sample_size} orders</div>
                    <div class="card-sub" style="margin-top:4px;">{e2e_period_str}</div>
                </div>
                <div class="otdr-card" style="border-top:4px solid {NAVY_BLUE};">
                    <div class="card-label">Actual</div>
                    <div class="card-value">{e2e_actual_days}</div>
                    <div class="card-sub">days</div>
                    <div class="card-sub" style="margin-top:6px;">{e2e_sample_size} orders</div>
                    <div class="card-sub" style="margin-top:4px;">{e2e_period_str}</div>
                </div>
                <div class="otdr-card" style="border-top:4px solid {SUCCESS_GREEN if e2e_delta_days <= 0 else BRICK_ORANGE};">
                    <div class="card-label">Delta</div>
                    <div class="card-value">{"+" if e2e_delta_days > 0 else ""}{e2e_delta_days}</div>
                    <div class="card-sub">days</div>
                    <div class="card-sub" style="margin-top:6px;">{e2e_sample_size} orders</div>
                    <div class="card-sub" style="margin-top:4px;">{e2e_period_str}</div>
                </div>
            </div>
        </div>
        {late_section}
        <div class="section">
            <div class="section-title">All orders</div>
            <table class="table">
                <thead><tr>
                    <th class="col-date">Order date</th><th class="col-item">Item</th><th class="col-order">Order no</th>
                    <th class="col-tracking">Tracking</th><th class="col-expected">Expected</th><th class="col-actual">Actual</th><th class="col-status">Status</th>
                </tr></thead>
                <tbody>{all_rows}</tbody>
            </table>
        </div>
    </div>
    <div class="footer">Generated automatically by Hadley Bricks delivery monitor</div>
</div>
</body>
</html>"""

    return html
