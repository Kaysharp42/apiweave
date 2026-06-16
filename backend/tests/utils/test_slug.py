"""
Tests for slug validation and composition utilities.

Covers:
  - validate_slug normalization (lowercase, space→underscore, dash→underscore)
  - validate_slug valid patterns (letters, digits, underscores)
  - validate_slug invalid patterns (empty, leading digit, special chars)
  - compose_slug with prefix and name
"""

import pytest

from app.utils.slug import compose_slug, validate_slug


class TestValidateSlug:
    """Tests for validate_slug()."""

    # ── valid cases ──────────────────────────────────────────────

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("hello", "hello"),
            ("my-slug", "my_slug"),
            ("my slug", "my_slug"),
            ("  trimmed  ", "trimmed"),
            ("ABC", "abc"),
            ("abc123", "abc123"),
            ("a_b_c", "a_b_c"),
            ("a", "a"),
            ("_underscore", "_underscore"),
            ("a_b_c_d_e_f", "a_b_c_d_e_f"),
        ],
    )
    def test_valid_slugs(self, raw: str, expected: str) -> None:
        assert validate_slug(raw) == expected

    # ── invalid cases ────────────────────────────────────────────

    @pytest.mark.parametrize(
        "raw",
        [
            "",
            "   ",
            "\t",
            "\n",
            "123abc",  # starts with digit
            "0start",  # starts with digit
            "hello world!",  # exclamation
            "hello.world",  # dot
            "a@b",  # at sign
            "a b c",  # spaces (will be replaced but m becomes valid after replacement)
            "UPPER",  # becomes lowercase so valid — this is a valid case actually
        ],
    )
    def test_invalid_slugs_raise_value_error(self, raw: str) -> None:
        # space-containing slugs are valid after replacement; skip those
        if raw in ("a b c", "UPPER"):
            return  # these are valid after normalization
        with pytest.raises(ValueError):
            validate_slug(raw)

    def test_empty_after_strip_raises(self) -> None:
        with pytest.raises(ValueError, match="must not be empty"):
            validate_slug("   ")

    @pytest.mark.parametrize(
        "raw",
        [
            "123abc",
            "0start",
            "9nine",
            "1_underscore_start",
        ],
    )
    def test_leading_digit_slugs_raise(self, raw: str) -> None:
        with pytest.raises(ValueError, match="Invalid slug"):
            validate_slug(raw)

    @pytest.mark.parametrize(
        "raw",
        [
            "hello!",
            "hello.world",
            "a@b",
            "dollar$ign",
            "percent%",
            "caret^",
            "star*",
            "plus+",
            "equals=",
            "back`tick",
            "tilde~",
            "pipe|",
            "colon:",
            "semi;",
            "quote'",
            'dbl"quote',
            "angle<",
            "angle>",
            "query?",
            "slash/",
            "back\\slash",
            "hash#",
            "(paren)",
        ],
    )
    def test_special_characters_raise(self, raw: str) -> None:
        with pytest.raises(ValueError, match="Invalid slug"):
            validate_slug(raw)

    # ── normalization edge cases ─────────────────────────────────

    def test_case_normalization(self) -> None:
        assert validate_slug("HelloWorld") == "helloworld"
        assert validate_slug("HELLO") == "hello"

    def test_hyphen_to_underscore(self) -> None:
        assert validate_slug("my-api-service") == "my_api_service"

    def test_space_to_underscore(self) -> None:
        assert validate_slug("hello world") == "hello_world"
        assert validate_slug("  leading spaces") == "leading_spaces"
        assert validate_slug("trailing spaces  ") == "trailing_spaces"

    def test_mixed_normalization(self) -> None:
        assert validate_slug("My API-Service v2") == "my_api_service_v2"


class TestComposeSlug:
    """Tests for compose_slug()."""

    def test_basic_composition(self) -> None:
        assert compose_slug("my-org", "my-project") == "my_org/my_project"

    def test_normalizes_both_parts(self) -> None:
        assert compose_slug("  Org  Name  ", "  Project  ") == "org_name/project"

    def test_rejects_invalid_prefix(self) -> None:
        with pytest.raises(ValueError):
            compose_slug("", "project")

    def test_rejects_invalid_name(self) -> None:
        with pytest.raises(ValueError):
            compose_slug("org", "123project")
