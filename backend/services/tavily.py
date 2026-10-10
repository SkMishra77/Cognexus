"""Async Tavily web search client for research discovery."""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

TAVILY_API_URL = "https://api.tavily.com/search"


def _get_api_key() -> str | None:
    """Read TAVILY_API_KEY from environment. Returns None if not set."""
    return os.getenv("TAVILY_API_KEY")


async def search(query: str, max_results: int = 3) -> list[dict]:
    """Search Tavily and return a list of {title, url, content}.

    Args:
        query: The search query string.
        max_results: Maximum number of results to return.

    Returns:
        List of dicts with keys: title, url, content.
        Returns an empty list if TAVILY_API_KEY is not configured.
    """
    api_key = _get_api_key()
    if not api_key:
        logger.warning("TAVILY_API_KEY not set — skipping web search for: %s", query)
        return []

    payload = {
        "api_key": api_key,
        "query": query,
        "max_results": max_results,
        "search_depth": "basic",
        "include_answer": False,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(TAVILY_API_URL, json=payload)
            response.raise_for_status()
            data = response.json()

        results = []
        for item in data.get("results", [])[:max_results]:
            results.append(
                {
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "content": item.get("content", ""),
                }
            )
        return results

    except httpx.HTTPStatusError as e:
        logger.error("Tavily API HTTP error %s for query '%s': %s", e.response.status_code, query, e)
        return []
    except httpx.RequestError as e:
        logger.error("Tavily API request error for query '%s': %s", query, e)
        return []
    except Exception as e:
        logger.error("Unexpected error during Tavily search for '%s': %s", query, e)
        return []
