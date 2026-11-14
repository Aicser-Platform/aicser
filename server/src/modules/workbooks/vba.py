"""Read the VBA macros in an Excel file as text, so they can be explained or rebuilt. Never run.

An .xlsm keeps its macros in xl/vbaProject.bin (an OLE file); an .xls is itself one. The source of each
module is stored compressed (MS-OVBA 2.4.1); the project's "dir" stream says which streams hold modules
and where their source starts. This module only reads: nothing is executed, and the workbook imported
into Aicser carries no macros.
"""

from __future__ import annotations

import io
import zipfile
from typing import Dict, List, Optional

MAX_SOURCE_CHARS = 200_000


class VbaError(ValueError):
    pass


def decompress(data: bytes) -> bytes:
    """MS-OVBA 2.4.1 decompression of a CompressedContainer."""
    if not data or data[0] != 0x01:
        raise VbaError("Not a compressed VBA container.")
    out = bytearray()
    pos = 1
    while pos + 2 <= len(data):
        header = int.from_bytes(data[pos:pos + 2], "little")
        chunk_size = (header & 0x0FFF) + 3
        compressed = (header >> 15) & 1
        chunk_end = min(pos + chunk_size, len(data))
        pos += 2
        start = len(out)
        if not compressed:
            out += data[pos:pos + 4096]
            pos += 4096
            continue
        while pos < chunk_end:
            flags = data[pos]
            pos += 1
            for bit in range(8):
                if pos >= chunk_end:
                    break
                if not (flags >> bit) & 1:
                    out.append(data[pos])
                    pos += 1
                    continue
                token = int.from_bytes(data[pos:pos + 2], "little")
                pos += 2
                done = len(out) - start
                bit_count = max((done - 1).bit_length(), 4)
                length = (token & (0xFFFF >> bit_count)) + 3
                offset = (token >> (16 - bit_count)) + 1
                if offset > done:
                    raise VbaError("Corrupt VBA source.")
                for _ in range(length):
                    out.append(out[-offset])
    return bytes(out)


def _modules(dir_data: bytes) -> tuple[List[Dict[str, object]], str]:
    """(module stream name, display name, source offset) from the decompressed dir stream, and the code page."""
    pos, modules, codepage = 0, [], "cp1252"
    current: Dict[str, object] = {}
    while pos + 6 <= len(dir_data):
        rec_id = int.from_bytes(dir_data[pos:pos + 2], "little")
        size = int.from_bytes(dir_data[pos + 2:pos + 6], "little")
        if rec_id == 0x0009:  # PROJECTVERSION: its size field says 4 but 6 bytes follow
            size = 6
        body = dir_data[pos + 6:pos + 6 + size]
        pos += 6 + size
        if rec_id == 0x0003 and len(body) >= 2:
            codepage = f"cp{int.from_bytes(body[:2], 'little')}"
        elif rec_id == 0x0019:  # MODULENAME
            current = {"name": body.decode(codepage, "replace")}
        elif rec_id == 0x001A:  # MODULESTREAMNAME
            current["stream"] = body.decode(codepage, "replace")
        elif rec_id == 0x0031 and len(body) >= 4:  # MODULEOFFSET
            current["offset"] = int.from_bytes(body[:4], "little")
        elif rec_id == 0x0021:  # procedural module
            current["kind"] = "module"
        elif rec_id == 0x0022:  # document / class module (ThisWorkbook, Sheet1, classes)
            current["kind"] = "document or class"
        elif rec_id == 0x002B and current.get("stream"):  # MODULE terminator
            modules.append(current)
            current = {}
    return modules, codepage


def _ole_bytes(data: bytes, filename: str) -> Optional[bytes]:
    """The OLE file that holds the VBA project, or None when the file has no macros."""
    if data[:4] == b"PK\x03\x04":  # .xlsm / .xlsb / .xltm: a zip with xl/vbaProject.bin
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            name = next((n for n in z.namelist() if n.lower().endswith("vbaproject.bin")), None)
            return z.read(name) if name else None
    if data[:8] == bytes.fromhex("D0CF11E0A1B11AE1"):  # .xls: the workbook is the OLE file
        return data
    raise VbaError(f"{filename or 'This file'} isn't an Excel workbook.")


def extract_macros(data: bytes, filename: str = "") -> List[Dict[str, str]]:
    """[{module, kind, source}] for every VBA module in an Excel file ([] when it has none)."""
    import olefile

    ole_data = _ole_bytes(data, filename)
    if ole_data is None:
        return []
    ole = olefile.OleFileIO(io.BytesIO(ole_data))
    try:
        streams = ["/".join(s) for s in ole.listdir()]
        dir_path = next((s for s in streams if s.lower().endswith("vba/dir")), None)
        if dir_path is None:
            return []
        root = dir_path[: -len("dir")]
        modules, codepage = _modules(decompress(ole.openstream(dir_path).read()))
        out = []
        for mod in modules:
            path = root + str(mod["stream"])
            if not ole.exists(path):
                continue
            raw = ole.openstream(path).read()
            try:
                source = decompress(raw[int(mod.get("offset") or 0):]).decode(codepage, "replace")
            except VbaError:
                continue
            # Attribute lines are bookkeeping (VB_Name, VB_Exposed…), not logic.
            code = "\n".join(line for line in source.splitlines() if not line.startswith("Attribute VB_")).strip()
            if code:
                out.append({"module": str(mod.get("name") or mod["stream"]), "kind": str(mod.get("kind") or "module"),
                            "source": code[:MAX_SOURCE_CHARS]})
        return out
    finally:
        ole.close()
