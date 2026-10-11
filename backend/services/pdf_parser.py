"""PDF parsing service using PyMuPDF (fitz).

Extracts text, sections (via heading heuristics), and DOI from PDF bytes.
Designed to run in a thread executor to avoid blocking the async event loop.
"""

import asyncio
import re
from concurrent.futures import ThreadPoolExecutor

import pymupdf

_executor = ThreadPoolExecutor(max_workers=4)

_DOI_RE = re.compile(r"10\.\d{4,}/[^\s]+")


def _is_heading(line: str, block_flags: int | None = None) -> bool:
    """Heuristic: treat bold lines, numbered headings, or ALL CAPS lines as section titles."""
    stripped = line.strip()
    if not stripped:
        return False
    if block_flags is not None and (block_flags & 2**4):  # bit 4 = bold
        return True
    if re.match(r"^\d+(\.\d+)*\s+[A-Z]", stripped):
        return True
    words = stripped.split()
    if len(words) >= 2 and stripped == stripped.upper() and stripped != stripped.lower():
        return True
    return False


def _extract_doi(doc: pymupdf.Document, first_page_text: str) -> str | None:
    """Try metadata first, then regex on first-page text."""
    meta = doc.metadata or {}
    for key in ("doi", "subject", "keywords"):
        val = meta.get(key, "") or ""
        m = _DOI_RE.search(val)
        if m:
            return m.group(0).rstrip(".,;)")
    m = _DOI_RE.search(first_page_text)
    if m:
        return m.group(0).rstrip(".,;)")
    return None


def _parse_pdf_sync(file_bytes: bytes) -> dict:
    """Synchronous PDF parsing — called via run_in_executor."""
    doc = pymupdf.open(stream=file_bytes, filetype="pdf")

    full_lines: list[str] = []
    block_data: list[tuple[str, bool]] = []

    for page in doc:
        blocks = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE)["blocks"]
        for block in blocks:
            if block.get("type") != 0:  # skip images
                continue
            for line_obj in block.get("lines", []):
                spans = line_obj.get("spans", [])
                line_text = "".join(s["text"] for s in spans)
                is_bold = any(
                    ("bold" in (s.get("font", "").lower()))
                    or (s.get("flags", 0) & 2**4)
                    for s in spans
                )
                full_lines.append(line_text)
                block_data.append((line_text, is_bold))

    full_text = "\n".join(full_lines)
    first_page_text = ""
    if doc.page_count > 0:
        first_page_text = doc[0].get_text()

    doi = _extract_doi(doc, first_page_text)
    doc.close()

    sections: list[dict] = []
    current_title: str | None = None
    current_lines: list[str] = []
    section_idx = 0

    for line_text, is_bold in block_data:
        stripped = line_text.strip()
        if not stripped:
            current_lines.append("")
            continue

        heading = False
        if is_bold and len(stripped) < 200:
            heading = True
        elif re.match(r"^\d+(\.\d+)*\s+[A-Z]", stripped):
            heading = True
        elif len(stripped.split()) >= 2 and stripped == stripped.upper() and stripped != stripped.lower():
            heading = True

        if heading:
            if current_lines:
                sections.append(
                    {
                        "index": section_idx,
                        "title": current_title,
                        "raw_text": "\n".join(current_lines).strip(),
                    }
                )
                section_idx += 1
            current_title = stripped
            current_lines = []
        else:
            current_lines.append(line_text)

    if current_lines or current_title:
        sections.append(
            {
                "index": section_idx,
                "title": current_title,
                "raw_text": "\n".join(current_lines).strip(),
            }
        )

    if not sections:
        sections.append({"index": 0, "title": None, "raw_text": full_text})

    return {
        "sections": sections,
        "full_text": full_text,
        "doi": doi,
    }


async def parse_pdf(file_bytes: bytes) -> dict:
    """Parse PDF bytes asynchronously (runs in thread executor).

    Returns:
        {
            sections: [{index, title, raw_text}, ...],
            full_text: str,
            doi: str | None,
        }
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_executor, _parse_pdf_sync, file_bytes)
