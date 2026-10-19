"""Personal data is removed from document text; numbers that only look similar are kept."""

from src.shared.redaction import redact


def test_personal_data_is_replaced_and_counted():
    text = ("Contact sok.dara@example.com or +855 12 345 678, office (023) 456-789. "
            "Card 4111 1111 1111 1111, IBAN GB82 WEST 1234 5698 7654 32.")
    out, counts = redact(text)
    assert "example.com" not in out and "4111" not in out and "WEST" not in out and "345 678" not in out
    assert counts == {"email": 1, "iban": 1, "card": 1, "phone": 2}


def test_amounts_dates_and_ids_stay():
    text = "Invoice 2026-10-17 total 1,250,000 KHR on 01-02-2026, order 123456789012, year 2026."
    out, counts = redact(text)
    assert out == text and counts == {}


def test_invalid_card_and_iban_numbers_stay():
    out, counts = redact("Ref 4111 1111 1111 1112 and GB00 WEST 1234 5698 7654 32")
    assert counts == {}
