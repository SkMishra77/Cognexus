"""arXiv paper fetching service.

Provides utilities to parse arXiv IDs from URLs and concurrently fetch
metadata (Atom API) + PDF bytes.
"""

import asyncio
import re
import xml.etree.ElementTree as ET

import httpx

_ARXIV_ID_RE = re.compile(r"(?:abs|pdf)/(\d{4}\.\d{4,5}(?:v\d+)?)")

ATOM_NS = "{http://www.w3.org/2005/Atom}"


def parse_arxiv_id(url: str) -> str:
    """Extract arXiv ID from an abs/ or pdf/ URL.

    Supports:
        https://arxiv.org/abs/2301.12345
        https://arxiv.org/pdf/2301.12345v2
        http://arxiv.org/abs/2301.12345

    Raises:
        ValueError: If no arXiv ID can be extracted.
    """
    m = _ARXIV_ID_RE.search(url)
    if not m:
        raise ValueError(f"Cannot extract arXiv ID from URL: {url}")
    return m.group(1)


def _parse_atom_entry(xml_text: str) -> dict:
    """Parse an arXiv Atom API response into a metadata dict."""
    root = ET.fromstring(xml_text)
    entry = root.find(f"{ATOM_NS}entry")
    if entry is None:
        raise ValueError("No entry found in arXiv API response")

    title = (entry.findtext(f"{ATOM_NS}title") or "").strip().replace("\n", " ")
    summary = (entry.findtext(f"{ATOM_NS}summary") or "").strip()

    authors = []
    for author_el in entry.findall(f"{ATOM_NS}author"):
        name = author_el.findtext(f"{ATOM_NS}name")
        if name:
            authors.append(name.strip())

    published = entry.findtext(f"{ATOM_NS}published") or ""
    year = None
    if published:
        try:
            year = int(published[:4])
        except (ValueError, IndexError):
            pass

    doi = None
    for link in entry.findall(f"{ATOM_NS}link"):
        if link.get("title") == "doi":
            doi = link.get("href")

    return {
        "title": title,
        "authors": authors,
        "abstract": summary,
        "year": year,
        "doi": doi,
    }


async def _fetch_metadata(client: httpx.AsyncClient, arxiv_id: str) -> dict:
    """Fetch metadata from the arXiv Atom API."""
    url = f"http://export.arxiv.org/api/query?id_list={arxiv_id}"
    resp = await client.get(url, follow_redirects=True)
    resp.raise_for_status()
    return _parse_atom_entry(resp.text)


async def _fetch_pdf(client: httpx.AsyncClient, arxiv_id: str) -> bytes:
    """Download the PDF from arXiv."""
    url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
    resp = await client.get(url, follow_redirects=True)
    resp.raise_for_status()
    return resp.content


async def fetch_arxiv_paper(url: str) -> tuple[dict, bytes]:
    """Concurrently fetch arXiv metadata and PDF.

    Args:
        url: An arXiv abs or pdf URL.

    Returns:
        (metadata_dict, pdf_bytes) where metadata_dict contains
        title, authors, abstract, year, doi.

    Raises:
        ValueError: If the URL is not a valid arXiv URL.
        httpx.HTTPStatusError: On HTTP errors.
    """
    arxiv_id = parse_arxiv_id(url)
    async with httpx.AsyncClient(timeout=60.0) as client:
        metadata, pdf_bytes = await asyncio.gather(
            _fetch_metadata(client, arxiv_id),
            _fetch_pdf(client, arxiv_id),
        )
    return metadata, pdf_bytes
