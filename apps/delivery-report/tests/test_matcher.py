"""Tests for order matching logic."""

from datetime import date, timedelta
from src.data.matcher import match_orders


def _supabase_order(oid: str, order_date: str, **kwargs):
    return {
        "platform_order_id": oid,
        "order_date": order_date,
        "dispatch_by": kwargs.get("dispatch_by", order_date),
        "expected_delivery": kwargs.get("expected_delivery"),
        "order_status": kwargs.get("order_status", "Shipped"),
    }


class TestMatchOrders:
    """Test the order matching/joining logic."""

    def test_basic_match(self):
        """Orders with matching tracking data are merged."""
        orders = [_supabase_order("ORD-1", "2026-02-20")]
        tracking = {"ORD-1": {"tracking": "WQ123", "cd_status": "Delivered", "despatch_date": "2026-02-20"}}

        result = match_orders(orders, tracking, set(), {})
        assert len(result) == 1
        assert result[0]["tracking_number"] == "WQ123"

    def test_cancelled_excluded(self):
        """Cancelled orders are excluded."""
        orders = [
            _supabase_order("ORD-1", "2026-02-20"),
            _supabase_order("ORD-2", "2026-02-20"),
        ]
        tracking = {
            "ORD-1": {"tracking": "WQ123", "cd_status": "Delivered"},
            "ORD-2": {"tracking": "WQ456", "cd_status": "Delivered"},
        }

        result = match_orders(orders, tracking, {"ORD-2"}, {})
        assert len(result) == 1
        assert result[0]["platform_order_id"] == "ORD-1"

    def test_canceled_status_excluded(self):
        """Orders with Canceled order_status are excluded."""
        orders = [
            _supabase_order("ORD-1", "2026-02-20", order_status="Canceled"),
            _supabase_order("ORD-2", "2026-02-20"),
        ]

        result = match_orders(orders, {}, set(), {})
        assert len(result) == 1
        assert result[0]["platform_order_id"] == "ORD-2"

    def test_no_tracking_included(self):
        """Orders without tracking are included if recent."""
        orders = [_supabase_order("ORD-1", date.today().isoformat())]

        result = match_orders(orders, {}, set(), {})
        assert len(result) == 1
        assert result[0]["tracking_number"] is None

    def test_stale_no_tracking_filtered(self):
        """No-tracking orders older than 21 days are filtered out."""
        old_date = (date.today() - timedelta(days=25)).isoformat()
        orders = [_supabase_order("ORD-1", old_date)]

        result = match_orders(orders, {}, set(), {}, stale_no_tracking_days=21)
        assert len(result) == 0

    def test_tracking_from_cache(self):
        """If CD doesn't have tracking, fall back to cache."""
        orders = [_supabase_order("ORD-1", "2026-02-20")]
        cache = {"ORD-1": {"tracking_number": "WQ999", "item_name": "Cached Item"}}

        result = match_orders(orders, {}, set(), cache)
        assert len(result) == 1
        assert result[0]["tracking_number"] == "WQ999"
        assert result[0]["item_name"] == "Cached Item"

    def test_expected_delivery_iso_parsed(self):
        """ISO timestamp expected_delivery is trimmed to date."""
        orders = [
            _supabase_order("ORD-1", "2026-02-20", expected_delivery="2026-02-25T23:59:59Z")
        ]

        result = match_orders(orders, {}, set(), {})
        assert result[0]["expected_delivery"] == "2026-02-25"
