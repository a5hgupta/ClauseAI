import logging
import uuid

from app.celery_app import celery_app
from app.core.config import settings
from app.db.session import SessionLocal
from app.models.contract import Contract
from app.models.analysis import Analysis, Clause
from app.services import extraction, ai_service, retrieval
from app.services.storage import get_storage

logger = logging.getLogger("clauseiq.tasks")


@celery_app.task(name="process_contract", bind=True, max_retries=2, default_retry_delay=30)
def process_contract(self, contract_id: str) -> None:
    """
    Runs OCR/extraction then AI analysis for a contract, updating its status
    at each stage so the frontend can poll (or a future websocket can push)
    progress. Failures are recorded on the row with a real error message
    instead of leaving the contract stuck at "uploaded" silently.
    """
    db = SessionLocal()
    try:
        contract = db.get(Contract, uuid.UUID(contract_id))
        if not contract:
            logger.error("process_contract: contract %s not found", contract_id)
            return

        try:
            contract.status = "extracting"
            contract.status_detail = None
            db.commit()

            storage = get_storage()
            file_bytes = storage.read(contract.storage_key)
            raw_text = extraction.extract_text(file_bytes, contract.file_type)

            contract.raw_text = raw_text
            contract.status = "analyzing"
            db.commit()

            # RAG indexing runs alongside analysis, not gating it: chat/search
            # citation quality matters, but a chunking/embedding hiccup should
            # never block the core summary the user is waiting on. Failures
            # here are logged and swallowed; the contract can be re-indexed
            # later via reanalyze without re-running the (costlier) AI call.
            try:
                chunk_count = retrieval.index_contract(db, contract.id, raw_text)
                db.commit()
                logger.info("Indexed %d chunks for contract %s", chunk_count, contract_id)
            except Exception:  # noqa: BLE001
                db.rollback()
                logger.exception("RAG indexing failed for contract %s (non-fatal)", contract_id)

            result = ai_service.analyze_contract(raw_text)

            def _level_text(v) -> dict:
                # Tolerate the model returning a plain string despite instructions.
                if isinstance(v, dict):
                    return {"simple": v.get("simple", ""), "intermediate": v.get("intermediate", ""), "lawStudent": v.get("lawStudent", "")}
                s = str(v or "")
                return {"simple": s, "intermediate": s, "lawStudent": s}

            analysis = Analysis(
                contract_id=contract.id,
                doc_type=(result.get("doc_type") or None),
                risk_score=int(result.get("risk_score", 0)),
                summary=_level_text(result.get("summary", "")),
                categories=result.get("categories", {}),
                missing_clauses=result.get("missing_clauses", []),
                obligations=result.get("obligations", []),
                key_dates=result.get("key_dates", []),
                model_used=settings.ANTHROPIC_MODEL,
            )
            db.add(analysis)
            db.flush()  # get analysis.id before creating clauses

            for i, c in enumerate(result.get("clauses", [])):
                db.add(Clause(
                    analysis_id=analysis.id,
                    title=c.get("title", "Untitled clause")[:255],
                    category=c.get("category", "general")[:100],
                    risk_level=c.get("risk_level", "low")[:10],
                    excerpt=c.get("excerpt", ""),
                    explanation=_level_text(c.get("explanation", "")),
                    dispute_likelihood=(c.get("dispute_likelihood") or None),
                    dispute_reason=c.get("dispute_reason"),
                    position=i,
                ))

            contract.status = "ready"
            contract.status_detail = None
            db.commit()

        except extraction.ExtractionError as exc:
            contract.status = "failed"
            contract.status_detail = f"Extraction failed: {exc}"
            db.commit()
        except Exception as exc:  # noqa: BLE001
            logger.exception("process_contract failed for %s", contract_id)
            contract.status = "failed"
            contract.status_detail = f"Analysis failed: {exc}"
            db.commit()
            raise self.retry(exc=exc)
    finally:
        db.close()
