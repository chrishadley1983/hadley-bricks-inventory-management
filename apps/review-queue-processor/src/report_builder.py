"""HTML email report builder for review queue processing results."""

from datetime import datetime


def _row(cells: list[str], tag: str = "td") -> str:
    return "<tr>" + "".join(f"<{tag}>{c}</{tag}>" for c in cells) + "</tr>"


def build_report(
    approved: list[dict],
    dismissed: list[dict],
    skipped: list[dict],
    errors: list[dict],
) -> str:
    """Build a branded HTML email summarising the review queue run.

    Each list contains dicts with item info. Expected keys:
    - approved: item_name, set_numbers, cost, source
    - dismissed: item_name, reason
    - skipped: item_name, reason
    - errors: item_name, error
    """
    total = len(approved) + len(dismissed) + len(skipped) + len(errors)
    date_str = datetime.now().strftime("%d %b %Y")

    html = f"""<!DOCTYPE html>
<html>
<head>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; background: #f5f5f5; }}
  .container {{ max-width: 640px; margin: 0 auto; background: #fff; }}
  .header {{ background: #1a1a2e; color: #fff; padding: 24px 32px; }}
  .header h1 {{ margin: 0; font-size: 20px; font-weight: 600; }}
  .header p {{ margin: 4px 0 0; font-size: 13px; color: #a0a0b0; }}
  .content {{ padding: 24px 32px; }}
  .summary {{ display: flex; gap: 16px; margin-bottom: 24px; }}
  .stat {{ background: #f8f9fa; border-radius: 8px; padding: 12px 16px; flex: 1; text-align: center; }}
  .stat .num {{ font-size: 28px; font-weight: 700; color: #1a1a2e; }}
  .stat .label {{ font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }}
  .stat.approved .num {{ color: #16a34a; }}
  .stat.dismissed .num {{ color: #9333ea; }}
  .stat.skipped .num {{ color: #d97706; }}
  .stat.errors .num {{ color: #dc2626; }}
  h2 {{ font-size: 15px; color: #1a1a2e; margin: 24px 0 8px; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
  th {{ background: #f8f9fa; text-align: left; padding: 8px 10px; font-weight: 600; color: #374151; }}
  td {{ padding: 8px 10px; border-bottom: 1px solid #f0f0f0; }}
  .footer {{ padding: 16px 32px; background: #f8f9fa; font-size: 11px; color: #999; text-align: center; }}
  .empty {{ color: #999; font-style: italic; padding: 12px 0; }}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Review Queue Report</h1>
    <p>{date_str} &middot; Hadley Bricks</p>
  </div>
  <div class="content">
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
      <tr>
        <td style="background:#f8f9fa;border-radius:8px;padding:12px 16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#1a1a2e;">{total}</div>
          <div style="font-size:11px;color:#666;text-transform:uppercase;">Total</div>
        </td>
        <td width="12"></td>
        <td style="background:#f8f9fa;border-radius:8px;padding:12px 16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#16a34a;">{len(approved)}</div>
          <div style="font-size:11px;color:#666;text-transform:uppercase;">Approved</div>
        </td>
        <td width="12"></td>
        <td style="background:#f8f9fa;border-radius:8px;padding:12px 16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#9333ea;">{len(dismissed)}</div>
          <div style="font-size:11px;color:#666;text-transform:uppercase;">Dismissed</div>
        </td>
        <td width="12"></td>
        <td style="background:#f8f9fa;border-radius:8px;padding:12px 16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#d97706;">{len(skipped)}</div>
          <div style="font-size:11px;color:#666;text-transform:uppercase;">Manual</div>
        </td>
      </tr>
    </table>"""

    # Approved items table
    if approved:
        html += """
    <h2>Approved</h2>
    <table>"""
        html += _row(["Item", "Set Number(s)", "Cost", "Source"], "th")
        for item in approved:
            html += _row([
                item.get("item_name", "—"),
                item.get("set_numbers", "—"),
                f"£{item.get('cost', '?')}",
                item.get("source", "—"),
            ])
        html += "</table>"

    # Dismissed items table
    if dismissed:
        html += """
    <h2>Dismissed (Non-LEGO)</h2>
    <table>"""
        html += _row(["Item", "Reason"], "th")
        for item in dismissed:
            html += _row([
                item.get("item_name", "—"),
                item.get("reason", "—"),
            ])
        html += "</table>"

    # Skipped (left for manual review)
    if skipped:
        html += """
    <h2>Left for Manual Review</h2>
    <table>"""
        html += _row(["Item", "Reason"], "th")
        for item in skipped:
            html += _row([
                item.get("item_name", "—"),
                item.get("reason", "—"),
            ])
        html += "</table>"

    # Errors
    if errors:
        html += """
    <h2>Errors</h2>
    <table>"""
        html += _row(["Item", "Error"], "th")
        for item in errors:
            html += _row([
                item.get("item_name", "—"),
                item.get("error", "—"),
            ])
        html += "</table>"

    if total == 0:
        html += '<p class="empty">No items in the review queue.</p>'

    html += """
  </div>
  <div class="footer">
    Automated by Review Queue Processor
  </div>
</div>
</body>
</html>"""

    return html
