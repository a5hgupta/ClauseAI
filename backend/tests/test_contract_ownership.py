import uuid

from app.models.contract import Contract
from app.models.user import User


def _make_contract_for(db_session, email_prefix="owner") -> tuple[Contract, User]:
    """Creates a user + a contract owned by them directly at the DB layer —
    bypasses upload/OCR/Celery entirely since ownership checks don't depend
    on any of that, only on user_id matching."""
    owner = User(
        email=f"{email_prefix}-{uuid.uuid4().hex[:8]}@example.com",
        hashed_password="x",
        name="Owner",
    )
    db_session.add(owner)
    db_session.flush()

    contract = Contract(
        user_id=owner.id,
        name="Test Contract",
        original_filename="test.pdf",
        file_type="pdf",
        size_bytes=1234,
        storage_backend="local",
        storage_key="owner/test.pdf",
        status="ready",
        raw_text="This agreement is between Party A and Party B.",
    )
    db_session.add(contract)
    db_session.commit()
    db_session.refresh(contract)
    return contract, owner


def test_owner_can_fetch_own_contract(client, db_session, signup_and_login):
    headers, _ = signup_and_login()
    # Attach the contract to the logged-in user instead of a throwaway one,
    # so the "happy path" uses the same auth session as the negative tests below.
    from app.core.security import decode_token

    token = headers["Authorization"].split(" ")[1]
    user_id = decode_token(token)["sub"]
    user = db_session.get(User, uuid.UUID(user_id))

    contract = Contract(
        user_id=user.id,
        name="My Contract",
        original_filename="mine.pdf",
        file_type="pdf",
        size_bytes=100,
        storage_backend="local",
        storage_key="mine.pdf",
        status="ready",
    )
    db_session.add(contract)
    db_session.commit()

    res = client.get(f"/api/v1/contracts/{contract.id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["id"] == str(contract.id)


def test_cannot_fetch_other_users_contract(client, db_session, signup_and_login):
    other_contract, _ = _make_contract_for(db_session, "victim")
    headers, _ = signup_and_login()  # a different, unrelated user

    res = client.get(f"/api/v1/contracts/{other_contract.id}", headers=headers)
    # 404, not 403 — must not confirm the contract exists at all.
    assert res.status_code == 404


def test_cannot_delete_other_users_contract(client, db_session, signup_and_login):
    other_contract, _ = _make_contract_for(db_session, "victim2")
    headers, _ = signup_and_login()

    res = client.delete(f"/api/v1/contracts/{other_contract.id}", headers=headers)
    assert res.status_code == 404


def test_cannot_fetch_analysis_for_other_users_contract(client, db_session, signup_and_login):
    other_contract, _ = _make_contract_for(db_session, "victim3")
    headers, _ = signup_and_login()

    res = client.get(f"/api/v1/contracts/{other_contract.id}/analysis", headers=headers)
    assert res.status_code == 404


def test_nonexistent_contract_returns_404(client, signup_and_login):
    headers, _ = signup_and_login()
    fake_id = uuid.uuid4()
    res = client.get(f"/api/v1/contracts/{fake_id}", headers=headers)
    assert res.status_code == 404


def test_contract_endpoints_require_auth(client, db_session):
    contract, _ = _make_contract_for(db_session, "noauth")
    res = client.get(f"/api/v1/contracts/{contract.id}")
    assert res.status_code in (401, 403)
