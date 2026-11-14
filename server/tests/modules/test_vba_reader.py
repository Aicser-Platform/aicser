"""VBA macros are read as text (MS-OVBA decompression), never run."""

import io
import zipfile

import pytest

from src.modules.workbooks.vba import VbaError, decompress, extract_macros


def test_decompresses_the_specification_example():
    # MS-OVBA 3.2.3 example: a CompressedContainer and the text it holds.
    compressed = bytes.fromhex(
        "01 2F B0 00 23 61 61 61 62 63 64 65 82 66 00 70 61 67 68 69 6A 01 38 08 61 6B 6C 00 30 6D 6E 6F 70 06 71 "
        "02 70 04 10 72 73 74 75 76 10 77 78 79 7A 00 3C".replace(" ", "")
    )
    assert decompress(compressed) == b"#aaabcdefaaaaghijaaaaaklaaamnopqaaaaaaaaaaaarstuvwxyzaaa"


def test_uncompressed_chunk_and_bad_input():
    with pytest.raises(VbaError):
        decompress(b"\x00abc")


def test_a_workbook_without_macros_has_none():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", "<workbook/>")
    assert extract_macros(buf.getvalue(), "plain.xlsx") == []


def test_not_an_excel_file():
    with pytest.raises(VbaError):
        extract_macros(b"hello world", "notes.txt")
