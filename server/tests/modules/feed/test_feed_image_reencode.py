import io

import pytest
from PIL import Image

from src.modules.feed.image_service import MAX_DIMENSION, reencode_image


def _jpeg_with_gps(w=3000, h=1500) -> bytes:
    img = Image.new("RGB", (w, h), (10, 20, 30))
    exif = img.getexif()
    exif[0x8825] = {2: (1, 2, 3)}  # GPS IFD
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def test_reencode_downscales_and_strips_metadata():
    out, w, h = reencode_image(_jpeg_with_gps())
    assert (w, h) == (MAX_DIMENSION, MAX_DIMENSION // 2)
    got = Image.open(io.BytesIO(out))
    assert got.format == "WEBP" and not dict(got.getexif())


@pytest.mark.parametrize("raw", [b"", b"not an image", b"%PDF-1.7 fake"])
def test_rejects_non_images(raw):
    with pytest.raises(ValueError):
        reencode_image(raw)
