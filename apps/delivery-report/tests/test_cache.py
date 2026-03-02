"""Tests for cache categorisation logic."""

from datetime import date, timedelta
from src.data.cache import categorise_orders, prune_stale_entries, build_cache_rows


def _order(oid: str, tracking: str | None = "WQ123", **kwargs):
    return {
        "platform_order_id": oid,
        "tracking_number": tracking,
        "order_date": kwargs.get("order_date", "2026-02-20"),
        "dispatch_by": kwargs.get("dispatch_by", "2026-02-24"),
        "item_name": kwargs.get("item_name", "Test Item"),
        "expected_delivery": kwargs.get("expected_delivery", "2026-02-25"),
    }


def _cached(oid: str, status: str = "Delivered", recheck: bool = False, **kwargs):
    return {
        "platform_order_id": oid,
        "rm_status": status,
        "needs_recheck": recheck,
        "tracking_number": kwargs.get("tracking", "WQ123"),
        "item_name": kwargs.get("item_name", "Cached Item"),
        "order_date": kwargs.get("order_date", "2026-02-20"),
    }


class TestCategoriseOrders:
    """Test the bucket categorisation."""

    def test_delivered_in_cache(self):
        """Delivered orders go to cached_delivered bucket."""
        orders = [_order("ORD-1")]
        cache = {"ORD-1": _cached("ORD-1", "Delivered")}

        result = categorise_orders(orders, cache)
        assert len(result["cached_delivered"]) == 1
        assert len(result["needs_recheck"]) == 0
        assert len(result["new_orders"]) == 0

    def test_recheck_in_cache(self):
        """In-transit cached orders go to needs_recheck bucket."""
        orders = [_order("ORD-1")]
        cache = {"ORD-1": _cached("ORD-1", "In transit", recheck=True)}

        result = categorise_orders(orders, cache)
        assert len(result["needs_recheck"]) == 1
        assert len(result["cached_delivered"]) == 0

    def test_new_order(self):
        """Orders not in cache go to new_orders bucket."""
        orders = [_order("ORD-1")]
        cache = {}

        result = categorise_orders(orders, cache)
        assert len(result["new_orders"]) == 1

    def test_no_tracking(self):
        """Orders without tracking go to no_tracking bucket."""
        orders = [_order("ORD-1", tracking=None)]
        cache = {}

        result = categorise_orders(orders, cache)
        assert len(result["no_tracking"]) == 1

    def test_mixed_buckets(self):
        """Multiple orders in different buckets."""
        orders = [
            _order("ORD-1", "WQ111"),  # delivered in cache
            _order("ORD-2", "WQ222"),  # in transit in cache
            _order("ORD-3", "WQ333"),  # new
            _order("ORD-4", None),     # no tracking
        ]
        cache = {
            "ORD-1": _cached("ORD-1", "Delivered"),
            "ORD-2": _cached("ORD-2", "In transit", recheck=True),
        }

        result = categorise_orders(orders, cache)
        assert len(result["cached_delivered"]) == 1
        assert len(result["needs_recheck"]) == 1
        assert len(result["new_orders"]) == 1
        assert len(result["no_tracking"]) == 1


class TestPruneStaleEntries:
    """Test cache pruning."""

    def test_prune_old_entries(self):
        """Entries older than max_age_days are removed."""
        old_date = (date.today() - timedelta(days=40)).isoformat()
        recent_date = (date.today() - timedelta(days=10)).isoformat()

        cache = {
            "OLD-1": {"order_date": old_date},
            "RECENT-1": {"order_date": recent_date},
        }

        result = prune_stale_entries(cache, max_age_days=35)
        assert "OLD-1" not in result
        assert "RECENT-1" in result

    def test_keep_recent_entries(self):
        """Recent entries are kept."""
        recent_date = date.today().isoformat()
        cache = {"ORD-1": {"order_date": recent_date}}

        result = prune_stale_entries(cache, max_age_days=35)
        assert "ORD-1" in result


class TestBuildCacheRows:
    """Test cache row construction."""

    def test_new_rm_result(self):
        """Fresh RM result is used when available."""
        merged = [_order("ORD-1")]
        rm_results = {"ORD-1": {"rm_status": "Delivered", "rm_delivery_date": "2026-02-24"}}

        rows = build_cache_rows(merged, rm_results, {}, set())
        assert len(rows) == 1
        assert rows[0]["rm_status"] == "Delivered"
        assert rows[0]["needs_recheck"] is False

    def test_cached_value_preserved(self):
        """Cached RM value is kept when no fresh result."""
        merged = [_order("ORD-1")]
        cache = {"ORD-1": _cached("ORD-1", "Delivered")}

        rows = build_cache_rows(merged, {}, cache, set())
        assert rows[0]["rm_status"] == "Delivered"

    def test_cancelled_excluded(self):
        """Cancelled orders are not included in cache rows."""
        merged = [_order("ORD-1"), _order("ORD-2")]

        rows = build_cache_rows(merged, {}, {}, {"ORD-2"})
        assert len(rows) == 1
        assert rows[0]["platform_order_id"] == "ORD-1"

    def test_no_tracking_status(self):
        """Orders without tracking get appropriate status."""
        merged = [_order("ORD-1", tracking=None, dispatch_by=date.today().isoformat())]

        rows = build_cache_rows(merged, {}, {}, set())
        assert rows[0]["rm_status"] == "Not dispatched yet"
        assert rows[0]["needs_recheck"] is True
