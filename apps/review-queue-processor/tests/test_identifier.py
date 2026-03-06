"""Tests for the identifier module — JSON extraction and prompt building."""

import json
import pytest

from src.identifier import _extract_json, _build_prompt


class TestExtractJson:
    def test_plain_json(self):
        text = '{"items": [{"set_number": "10307"}], "is_lego": true, "confidence": "high", "reasoning": "clear"}'
        result = json.loads(_extract_json(text))
        assert result["is_lego"] is True
        assert result["items"][0]["set_number"] == "10307"

    def test_json_in_code_block(self):
        text = 'Here is the result:\n```json\n{"items": [], "is_lego": false, "confidence": "high", "reasoning": "postage"}\n```'
        result = json.loads(_extract_json(text))
        assert result["is_lego"] is False

    def test_json_with_surrounding_text(self):
        text = 'I identified this as LEGO set 10307.\n\n{"items": [{"set_number": "10307", "condition": "New"}], "is_lego": true, "confidence": "high", "reasoning": "clear from title"}\n\nHope that helps!'
        result = json.loads(_extract_json(text))
        assert result["items"][0]["set_number"] == "10307"

    def test_no_json_raises(self):
        with pytest.raises(ValueError, match="No JSON found"):
            _extract_json("This has no JSON at all.")

    def test_non_lego_item(self):
        text = '{"items": [], "is_lego": false, "confidence": "high", "reasoning": "This is a postage label, not a LEGO set"}'
        result = json.loads(_extract_json(text))
        assert result["is_lego"] is False
        assert result["items"] == []


class TestBuildPrompt:
    def test_basic_prompt(self):
        item = {
            "item_name": "Lego Fire Engine",
            "email_subject": "Order confirmed",
            "source": "Vinted",
            "cost": "12.50",
        }
        prompt = _build_prompt(item)
        assert "Lego Fire Engine" in prompt
        assert "Vinted" in prompt
        assert "£12.50" in prompt

    def test_prompt_includes_seller(self):
        item = {
            "item_name": "Lego Set",
            "source": "Vinted",
            "cost": "5",
            "seller_username": "lego_fan_99",
        }
        prompt = _build_prompt(item)
        assert "lego_fan_99" in prompt

    def test_prompt_without_optional_fields(self):
        item = {"item_name": "Unknown", "source": "Unknown", "cost": "?"}
        prompt = _build_prompt(item)
        assert "Unknown" in prompt
        assert "JSON" in prompt
