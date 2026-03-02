"""Tests for OTDR calculation logic."""

import pytest
from datetime import date
from src.report.otdr import calculate_otdr, project_90_percent, get_late_orders_with_dropoff


def _order(expected: str, rm_status: str = "Delivered", rm_delivery_date: str | None = None, **kwargs):
    return {
        "expected_delivery": expected,
        "rm_status": rm_status,
        "rm_delivery_date": rm_delivery_date or expected,  # default: on time
        "platform_order_id": kwargs.get("oid", "test-order"),
        "order_date": kwargs.get("order_date", "2026-02-15"),
        "item_name": kwargs.get("item_name", "Test Item"),
    }


class TestCalculateOTDR:
    """Test the core OTDR calculation."""

    def test_all_on_time(self):
        """100% OTDR when all orders delivered on time."""
        # Reference date: 2026-03-02
        # Window (lag=7): 2026-02-09 to 2026-02-23
        orders = [
            _order("2026-02-10", "Delivered", "2026-02-10"),
            _order("2026-02-15", "Delivered", "2026-02-14"),
            _order("2026-02-20", "Delivered", "2026-02-20"),
        ]
        result = calculate_otdr(orders, date(2026, 3, 2))
        assert result["pct"] == 100.0
        assert result["on_time"] == 3
        assert result["total"] == 3
        assert result["late"] == 0

    def test_mixed_on_time_and_late(self):
        """Correct percentage with mix of on-time and late."""
        orders = [
            _order("2026-02-10", "Delivered", "2026-02-10"),  # on time
            _order("2026-02-12", "Delivered", "2026-02-12"),  # on time
            _order("2026-02-15", "Delivered", "2026-02-17"),  # late
        ]
        result = calculate_otdr(orders, date(2026, 3, 2))
        assert result["on_time"] == 2
        assert result["late"] == 1
        assert result["total"] == 3
        assert result["pct"] == pytest.approx(66.7, abs=0.1)

    def test_no_orders_in_window(self):
        """0% OTDR when no orders fall in the window."""
        orders = [
            _order("2026-01-01", "Delivered", "2026-01-01"),
        ]
        result = calculate_otdr(orders, date(2026, 3, 2))
        assert result["total"] == 0
        assert result["pct"] == 0

    def test_window_boundaries(self):
        """Orders exactly on window boundaries are included."""
        # Window for 2026-03-02: 2026-02-09 to 2026-02-23
        orders = [
            _order("2026-02-09", "Delivered", "2026-02-09"),  # start boundary
            _order("2026-02-23", "Delivered", "2026-02-23"),  # end boundary
            _order("2026-02-08", "Delivered", "2026-02-08"),  # outside
            _order("2026-02-24", "Delivered", "2026-02-24"),  # outside
        ]
        result = calculate_otdr(orders, date(2026, 3, 2))
        assert result["total"] == 2

    def test_next_day_offset(self):
        """offset_days=1 shifts the window forward by 1 day."""
        # Window for 2026-03-02+1: 2026-02-10 to 2026-02-24
        orders = [
            _order("2026-02-09", "Delivered", "2026-02-09"),  # now outside
            _order("2026-02-10", "Delivered", "2026-02-10"),  # now on boundary
            _order("2026-02-24", "Delivered", "2026-02-24"),  # now on boundary
        ]
        result = calculate_otdr(orders, date(2026, 3, 2), offset_days=1)
        assert result["total"] == 2

    def test_undelivered_orders_not_counted(self):
        """In-transit orders are not counted in OTDR."""
        orders = [
            _order("2026-02-15", "Delivered", "2026-02-15"),
            _order("2026-02-16", "In transit"),
        ]
        result = calculate_otdr(orders, date(2026, 3, 2))
        assert result["total"] == 1
        assert result["on_time"] == 1


class TestProject90Percent:
    """Test the 90% projection."""

    def test_already_at_90(self):
        """If already at 90%, return today's window."""
        orders = [
            _order("2026-02-15", "Delivered", "2026-02-15"),
        ]
        result = project_90_percent(orders, date(2026, 3, 2))
        assert result["pct"] >= 90.0

    def test_late_orders_drop_off(self):
        """Late orders eventually age out, improving OTDR."""
        # Late order has earlier expected_delivery so it drops off first,
        # while on-time orders remain in the window.
        orders = [
            _order("2026-02-10", "Delivered", "2026-02-12"),  # late by 2 days
            _order("2026-02-15", "Delivered", "2026-02-15"),  # on time
            _order("2026-02-18", "Delivered", "2026-02-18"),  # on time
        ]
        result = project_90_percent(orders, date(2026, 3, 2))
        assert result["pct"] >= 90.0


class TestLateOrdersDropoff:
    """Test late order drop-off date calculation."""

    def test_drop_off_calculation(self):
        """drop_off = expected + 14 days + 7 days lag."""
        orders = [
            _order(
                "2026-02-15",
                "Delivered",
                "2026-02-17",  # 2 days late
                oid="late-order",
                item_name="Late LEGO Set",
            ),
        ]
        late = get_late_orders_with_dropoff(orders, date(2026, 3, 2))
        assert len(late) == 1
        assert late[0]["order_no"] == "late-order"
        # drop_off = 2026-02-15 + 14 + 7 = 2026-03-08
        assert "08 Mar 2026" in late[0]["drop_off"]

    def test_on_time_not_included(self):
        """On-time orders should not appear in late list."""
        orders = [
            _order("2026-02-15", "Delivered", "2026-02-14"),  # early
        ]
        late = get_late_orders_with_dropoff(orders, date(2026, 3, 2))
        assert len(late) == 0
