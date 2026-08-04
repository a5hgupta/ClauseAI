"""
Splits a contract's extracted text into overlapping, position-tracked chunks
for embedding + retrieval.

Design notes:
- Character-based sliding window (not token-based) — keeps this dependency-
  free and fast; RAG_CHUNK_SIZE is sized conservatively so chunks stay well
  under any embedding model's token limit.
- Boundaries are pushed out to the next whitespace so we never split a word
  mid-token, which both helps embedding quality and keeps citation excerpts
  readable.
- Every chunk records char_start/char_end in the *original* raw_text, so a
  citation can be mapped back to an exact location in the source document
  instead of just "chunk 4 of contract X".
"""
from dataclasses import dataclass

from app.core.config import settings


@dataclass
class TextChunk:
    index: int
    content: str
    char_start: int
    char_end: int


def chunk_text(
    text: str,
    chunk_size: int | None = None,
    overlap: int | None = None,
) -> list[TextChunk]:
    chunk_size = chunk_size or settings.RAG_CHUNK_SIZE
    overlap = overlap if overlap is not None else settings.RAG_CHUNK_OVERLAP
    if overlap >= chunk_size:
        overlap = chunk_size // 4

    text = text or ""
    n = len(text)
    if n == 0:
        return []

    chunks: list[TextChunk] = []
    start = 0
    idx = 0

    while start < n:
        end = min(start + chunk_size, n)
        # Extend to the next whitespace so we don't cut a word in half,
        # unless we're already at the end of the document.
        while end < n and not text[end].isspace():
            end += 1

        raw = text[start:end]
        stripped = raw.strip()
        if stripped:
            # Recompute exact offsets after stripping leading/trailing whitespace
            lead = len(raw) - len(raw.lstrip())
            real_start = start + lead
            real_end = real_start + len(stripped)
            chunks.append(TextChunk(index=idx, content=stripped, char_start=real_start, char_end=real_end))
            idx += 1

        if end >= n:
            break
        start = max(end - overlap, start + 1)

    return chunks
