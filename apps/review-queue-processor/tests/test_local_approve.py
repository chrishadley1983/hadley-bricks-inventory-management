"""Tests for the local_approve module — cost allocation and payment method logic."""

from src.local_approve import _allocate_costs, _determine_payment_method


class TestAllocateCosts:
    def test_single_item(self):
        items = [{"set_number": "42136", "_brickset_data": None}]
        assert _allocate_costs(items, 15.00) == [15.00]

    def test_equal_split_no_rrp(self):
        items = [
            {"set_number": "42136", "_brickset_data": None},
            {"set_number": "42137", "_brickset_data": None},
        ]
        costs = _allocate_costs(items, 20.00)
        assert costs == [10.00, 10.00]

    def test_proportional_by_rrp(self):
        items = [
            {
                "set_number": "42136",
                "_brickset_data": {"uk_retail_price": 30.00},
            },
            {
                "set_number": "42137",
                "_brickset_data": {"uk_retail_price": 10.00},
            },
        ]
        costs = _allocate_costs(items, 20.00)
        assert costs[0] == 15.00  # 30/(30+10) * 20 = 15
        assert costs[1] == 5.00  # 10/(30+10) * 20 = 5

    def test_mixed_rrp_falls_back_to_equal(self):
        items = [
            {
                "set_number": "42136",
                "_brickset_data": {"uk_retail_price": 30.00},
            },
            {"set_number": "42137", "_brickset_data": None},
        ]
        costs = _allocate_costs(items, 20.00)
        assert costs == [10.00, 10.00]


class TestDeterminePaymentMethod:
    def test_vinted(self):
        assert _determine_payment_method("Vinted") == "Vinted Wallet"

    def test_vinted_lowercase(self):
        assert _determine_payment_method("vinted") == "Vinted Wallet"

    def test_ebay(self):
        assert _determine_payment_method("eBay") == "PayPal"

    def test_empty(self):
        assert _determine_payment_method("") == "PayPal"
