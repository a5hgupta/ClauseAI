import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.db.session import get_db, SessionLocal
from app.core.deps import get_current_user, limiter
from app.core.config import settings
from app.models.user import User
from app.models.contract import Contract
from app.models.analysis import Analysis
from app.models.chat import ChatSession, ChatMessage
from app.schemas.chat import ChatSessionOut, ChatMessageOut, SendMessageRequest
from app.services import ai_service, retrieval

router = APIRouter(tags=["chat"])


def _get_owned_contract(db: Session, contract_id: uuid.UUID, user: User) -> Contract:
    contract = db.get(Contract, contract_id)
    if not contract or contract.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")
    return contract


def _get_owned_session(db: Session, session_id: uuid.UUID, user: User) -> ChatSession:
    chat_session = db.get(ChatSession, session_id)
    if not chat_session or chat_session.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")
    return chat_session


@router.post("/contracts/{contract_id}/chat/sessions", response_model=ChatSessionOut, status_code=status.HTTP_201_CREATED)
def create_chat_session(
    contract_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    contract = _get_owned_contract(db, contract_id, user)
    if contract.status != "ready":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Contract analysis must finish before starting a chat",
        )
    chat_session = ChatSession(contract_id=contract.id, user_id=user.id, title=f"Chat about {contract.name}"[:255])
    db.add(chat_session)
    db.commit()
    db.refresh(chat_session)
    return chat_session


@router.get("/contracts/{contract_id}/chat/sessions", response_model=list[ChatSessionOut])
def list_chat_sessions(contract_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    contract = _get_owned_contract(db, contract_id, user)
    return db.scalars(
        select(ChatSession).where(ChatSession.contract_id == contract.id).order_by(ChatSession.updated_at.desc())
    ).all()


@router.get("/chat/sessions/{session_id}/messages", response_model=list[ChatMessageOut])
def list_messages(session_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    chat_session = _get_owned_session(db, session_id, user)
    return db.scalars(
        select(ChatMessage).where(ChatMessage.session_id == chat_session.id).order_by(ChatMessage.created_at)
    ).all()


@router.post("/chat/sessions/{session_id}/messages")
@limiter.limit("30/minute")
def send_message(
    request: Request,
    session_id: uuid.UUID,
    body: SendMessageRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    chat_session = _get_owned_session(db, session_id, user)
    contract = db.get(Contract, chat_session.contract_id)
    if not contract or not contract.raw_text:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Contract text is not available")

    # Persist the user's message immediately, before streaming starts.
    db.add(ChatMessage(session_id=chat_session.id, role="user", content=body.message))
    db.commit()

    history_rows = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.session_id == chat_session.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(settings.MAX_CHAT_HISTORY_MESSAGES)
    ).all()
    history = [{"role": m.role, "content": m.content} for m in reversed(history_rows[1:])]  # exclude the just-added message, oldest first

    latest_analysis = db.scalar(
        select(Analysis).where(Analysis.contract_id == contract.id).order_by(Analysis.created_at.desc())
    )
    doc_type = latest_analysis.doc_type if latest_analysis else None

    # Retrieve the chunks most relevant to *this* message (RAG) instead of
    # dumping the whole contract in every turn. Falls back to truncated raw
    # text if the contract predates indexing or indexing failed — chat
    # should never hard-fail just because citations aren't available.
    try:
        retrieved = retrieval.retrieve_for_contract(db, contract.id, body.message)
    except Exception:  # noqa: BLE001
        retrieved = []

    sources = [
        {"id": f"S{i + 1}", "content": r.content}
        for i, r in enumerate(retrieved)
    ]
    source_meta = [
        {
            "id": f"S{i + 1}",
            "chunk_id": str(r.chunk_id),
            "excerpt": r.content[:280],
            "char_start": r.char_start,
            "char_end": r.char_end,
            "score": r.score,
        }
        for i, r in enumerate(retrieved)
    ]

    contract_text = contract.raw_text
    user_message = body.message
    explain_level = body.explain_level
    session_id_val = chat_session.id

    def event_stream():
        if source_meta:
            yield f"data: {json.dumps({'sources': source_meta})}\n\n"

        full_response = ""
        try:
            for delta in ai_service.stream_chat(
                history,
                user_message,
                doc_type,
                explain_level,
                sources=sources,
                fallback_text=contract_text,
            ):
                full_response += delta
                yield f"data: {json.dumps({'delta': delta})}\n\n"
        except Exception as exc:  # noqa: BLE001
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            return
        finally:
            # Use a fresh session — the request-scoped one may be closed by
            # the time this generator finishes draining in some ASGI setups.
            if full_response:
                bg_db = SessionLocal()
                try:
                    bg_db.add(ChatMessage(session_id=session_id_val, role="assistant", content=full_response))
                    bg_db.commit()
                finally:
                    bg_db.close()
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
