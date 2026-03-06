"""Tests for the brickset_lookup module — set number normalisation."""

from src.brickset_lookup import _normalise_set_number


class TestNormaliseSetNumber:
    def test_plain_number(self):
        assert _normalise_set_number("42136") == "42136-1"

    def test_already_has_variant(self):
        assert _normalise_set_number("42136-1") == "42136-1"

    def test_variant_2(self):
        assert _normalise_set_number("42136-2") == "42136-2"

    def test_five_digit(self):
        assert _normalise_set_number("10307") == "10307-1"
