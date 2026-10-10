"""Prompts for concept extraction via map-reduce over paper chunks."""

SYSTEM = """\
You are an expert academic concept extractor. Given a chunk of a research paper, \
identify the prerequisite concepts a reader must understand before they can fully \
comprehend this section.

For each concept, provide:
- **name**: A concise canonical name (e.g., "Transformer Attention", "Gradient Descent").
- **description**: A 1-2 sentence plain-language description of what the concept is.
- **difficulty**: One of "beginner", "intermediate", or "advanced".
- **related_concepts**: Up to 3 other concept names this one relates to (may be empty).

Return ONLY a JSON array of objects. No commentary, no markdown fences. Example:
[
  {
    "name": "Backpropagation",
    "description": "An algorithm for computing gradients of a loss function with respect to network weights by applying the chain rule layer by layer.",
    "difficulty": "intermediate",
    "related_concepts": ["Chain Rule", "Gradient Descent"]
  }
]
"""

RANKING_SYSTEM = """\
You are an expert academic concept curator. You will receive a JSON array of concepts \
extracted from different chunks of the same research paper. Many concepts will be \
duplicated or near-duplicates (e.g., "Self-Attention" vs "Self Attention Mechanism").

Your job:
1. Merge near-duplicate concepts — keep the best name and description.
2. Rank the merged concepts by how essential they are for understanding the paper.
3. Select the top 8 to 20 concepts (aim for ~12 if there are enough unique concepts).

Return ONLY a JSON array of the selected concepts (same schema: name, description, \
difficulty, related_concepts). Ordered from most essential to least essential. \
No commentary, no markdown fences.
"""


def build_user(chunk_text: str, chunk_index: int, total_chunks: int) -> str:
    """Build the user prompt for extracting concepts from a single chunk."""
    return (
        f"Paper chunk {chunk_index + 1} of {total_chunks}:\n\n"
        f"{chunk_text}\n\n"
        "Extract all prerequisite concepts from the above chunk."
    )


def build_ranking_user(all_concepts_json: str) -> str:
    """Build the user prompt for merging and ranking all extracted concepts."""
    return (
        "Below is a JSON array of concepts extracted from all chunks of a paper. "
        "Merge duplicates, rank by importance, and return the top 8-20:\n\n"
        f"{all_concepts_json}"
    )
