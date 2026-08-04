"""
Embedding provider for RAG.

Uses a local sentence-transformers model rather than a hosted embeddings API:
no extra API key to provision, no per-call cost, no added network round trip
in the hot path (contract indexing happens in the Celery worker; chat/search
only embed one short query string per request). Model is loaded lazily and
cached process-wide so the API/worker startup path stays fast and memory
isn't spent unless RAG is actually used.

To swap in a hosted provider later (e.g. Voyage AI, which Anthropic
recommends pairing with Claude for RAG): implement a class with the same
embed_texts(list[str]) -> list[list[float]] signature, gate it behind an
EMBEDDING_PROVIDER setting, and update get_embedder() below. Nothing else in
the RAG pipeline (chunking, storage, retrieval) needs to change — they only
depend on this module's public functions.
"""
import logging
import threading

from app.core.config import settings

logger = logging.getLogger("clauseiq.embeddings")

_model = None
_model_lock = threading.Lock()


class EmbeddingError(Exception):
    pass


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                try:
                    from sentence_transformers import SentenceTransformer
                except ImportError as exc:  # pragma: no cover
                    raise EmbeddingError(
                        "sentence-transformers is not installed — check requirements.txt"
                    ) from exc
                logger.info("Loading embedding model %s", settings.EMBEDDING_MODEL_NAME)
                _model = SentenceTransformer(settings.EMBEDDING_MODEL_NAME)
                actual_dim = _model.get_sentence_embedding_dimension()
                if actual_dim != settings.EMBEDDING_DIM:
                    raise EmbeddingError(
                        f"EMBEDDING_DIM={settings.EMBEDDING_DIM} does not match the loaded model's "
                        f"actual dimension ({actual_dim}). Update EMBEDDING_DIM and run a new migration "
                        f"+ full re-index if you changed EMBEDDING_MODEL_NAME."
                    )
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batch-embeds a list of strings. Returns L2-normalized vectors so
    cosine distance and dot-product similarity agree, which keeps pgvector
    queries numerically well-behaved regardless of which distance operator
    is used."""
    if not texts:
        return []
    model = _get_model()
    vectors = model.encode(
        texts,
        batch_size=32,
        show_progress_bar=False,
        normalize_embeddings=True,
        convert_to_numpy=True,
    )
    return vectors.tolist()


def embed_query(text: str) -> list[float]:
    text = (text or "")[: settings.RAG_MAX_QUERY_CHARS]
    return embed_texts([text])[0]
