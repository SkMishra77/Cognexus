import re


def _estimate_tokens(text: str) -> int:
    """Rough token count: ~4 characters per token for English text."""
    return len(text) // 4


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences using regex."""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    return [s.strip() for s in sentences if s.strip()]


def chunk_text(
    text: str,
    target_tokens: int = 1000,
    overlap_tokens: int = 200,
) -> list[str]:
    """Split text into overlapping chunks targeting ~target_tokens each.

    Uses sentence boundaries to avoid cutting mid-sentence.
    Returns a list of text chunks with approximate token overlap.
    """
    sentences = _split_sentences(text)
    if not sentences:
        return []

    chunks: list[str] = []
    current_sentences: list[str] = []
    current_tokens = 0

    for sentence in sentences:
        sentence_tokens = _estimate_tokens(sentence)

        if current_tokens + sentence_tokens > target_tokens and current_sentences:
            chunk_text_str = " ".join(current_sentences)
            chunks.append(chunk_text_str)

            overlap_sentences: list[str] = []
            overlap_count = 0
            for s in reversed(current_sentences):
                s_tokens = _estimate_tokens(s)
                if overlap_count + s_tokens > overlap_tokens:
                    break
                overlap_sentences.insert(0, s)
                overlap_count += s_tokens

            current_sentences = overlap_sentences
            current_tokens = overlap_count

        current_sentences.append(sentence)
        current_tokens += sentence_tokens

    if current_sentences:
        chunks.append(" ".join(current_sentences))

    return chunks
