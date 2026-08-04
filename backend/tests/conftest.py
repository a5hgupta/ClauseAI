"""
Test fixtures.

This app leans on real Postgres/pgvector column types (postgresql.UUID,
postgresql.JSONB, pgvector.sqlalchemy.Vector) throughout the models, so an
in-memory SQLite DB will NOT work here — several models will fail to even
create their tables against SQLite. Tests must run against a real Postgres
instance with the pgvector extension available, same as the `db` service in
docker-compose.yml.

Run these:
  - Locally, against the dev stack's db container:
      docker compose exec api pytest
  - Or point TEST_DATABASE_URL at any scratch Postgres+pgvector database:
      TEST_DATABASE_URL=postgresql://clauseiq:clauseiq@localhost:5432/clauseiq_test pytest

Each test runs inside a transaction that is rolled back afterward, so tests
don't need to clean up after themselves and can run in any order.
"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-at-least-32-characters-long")
os.environ.setdefault(
    "DATABASE_URL",
    os.environ.get("TEST_DATABASE_URL", "postgresql://clauseiq:clauseiq@localhost:5432/clauseiq_test"),
)

from app.db.session import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import user, token, contract, analysis, chat, chunk, admin_log, subscription  # noqa: E402,F401

TEST_DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(TEST_DATABASE_URL, future=True)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)


@pytest.fixture(scope="session", autouse=True)
def _setup_database():
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db_session():
    """
    Standard SQLAlchemy "join a session into an external transaction" recipe:
    wrap each test in an outer transaction + a SAVEPOINT, and make routes'
    own session.commit() calls only close the SAVEPOINT (restarting a new
    one immediately) rather than the outer transaction — so no matter how
    many times application code commits during a test, everything is still
    rolled back in full when the test ends.
    """
    connection = engine.connect()
    outer_transaction = connection.begin()
    session = TestSessionLocal(bind=connection)
    session.begin_nested()

    from sqlalchemy import event

    @event.listens_for(session, "after_transaction_end")
    def _restart_savepoint(sess, trans):
        if trans.nested and not trans._parent.nested:
            sess.begin_nested()

    try:
        yield session
    finally:
        session.close()
        outer_transaction.rollback()
        connection.close()


@pytest.fixture()
def client(db_session):
    def _get_db_override():
        yield db_session

    app.dependency_overrides[get_db] = _get_db_override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def signup_and_login(client):
    """Creates a fresh user and returns (headers, user_email) ready to use
    against protected endpoints. Uses a random email so tests can run
    against a shared DB without colliding on the unique constraint."""

    def _make():
        email = f"test-{uuid.uuid4().hex[:10]}@example.com"
        res = client.post(
            "/api/v1/auth/signup",
            json={"email": email, "password": "correcthorsebattery1", "name": "Test User"},
        )
        assert res.status_code == 201, res.text
        token_data = res.json()
        headers = {"Authorization": f"Bearer {token_data['access_token']}"}
        return headers, email

    return _make
