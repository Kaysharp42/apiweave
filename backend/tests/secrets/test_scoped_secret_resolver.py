import base64

from app.services.scoped_secret_resolver import _decode_ciphertext


def test_decode_ciphertext_accepts_urlsafe_unpadded_base64() -> None:
    ciphertext = b"sealed-box-bytes?\xff"
    encoded = base64.urlsafe_b64encode(ciphertext).decode("ascii").rstrip("=")

    assert _decode_ciphertext(encoded) == ciphertext
