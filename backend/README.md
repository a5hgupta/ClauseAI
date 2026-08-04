# ClauseIQ Backend — Phase 1 + Phase 2

This is a real, runnable FastAPI backend — not stubs. It was not tested against
a live Postgres/Redis/Anthropic stack in the sandbox that generated it (no
network access there), so **run it locally and smoke-test the flows below
before trusting it in a deploy.** All files pass `python -m py_compile`;
logic has been reasoned through carefully but hasn't been exercised end to end.

## Phase 2 additions (this delivery)

- **OCR/extraction** (`app/services/extraction.py`) — real text extraction for
  PDF (text-layer via pdfplumber, with automatic per-page OCR fallback via
  Tesseract for scanned pages — handles mixed documents), DOCX
  (python-docx, including tables), and PNG/JPG (straight OCR).
- **Async pipeline** (`app/celery_app.py`, `app/tasks/pipeline.py`) — upload
  now enqueues a Celery task that extracts text, runs AI analysis, and
  updates `contract.status` through `queued → extracting → analyzing → ready`
  (or `failed` with a real error message) so uploads return instantly instead
  of blocking on a 30–60s LLM call.
- **Real Anthropic integration** (`app/services/ai_service.py`), called
  server-side only (key never reaches the client):
  - `analyze_contract` — summary, 0–100 risk score, per-category risk,
    missing-clause detection, and a structured clause-by-clause breakdown
    (risk level, excerpt, plain-English explanation) in one call, persisted
    to the new `analyses`/`clauses` tables.
  - `rewrite_clause` — rewrites a specific clause toward a chosen tone
    (tenant-friendly / balanced / aggressive-negotiation).
  - `negotiation_suggestions` — concrete talking points for a clause.
  - `compare_contracts` — structured diff between two contracts the user
    owns.
  - `stream_chat` — token-by-token streaming, grounded in that contract's
    full extracted text (RAG-based chunk retrieval instead of "whole
    document in context" is Phase 3).
  - Every prompt wraps user/document-controlled text in explicit delimiters
    and instructs the model to treat it as data, not instructions — a
    mitigation against prompt injection embedded in a contract's own text,
    not a guarantee.
- **Streaming chat endpoint** — `POST /chat/sessions/{id}/messages` returns
  Server-Sent Events (`data: {"delta": "..."}` chunks, then `{"done": true}`),
  matching the "must stream like ChatGPT" requirement. Messages are persisted
  before/after streaming so history survives a refresh.
- New endpoints: `POST /contracts/{id}/reanalyze`, `GET /contracts/{id}/analysis`,
  `POST /contracts/compare`, `POST /clauses/{id}/rewrite`,
  `POST /clauses/{id}/negotiation`, chat session CRUD.
- New tables: `analyses`, `clauses`, `chat_sessions`, `chat_messages`
  (migration `0002_phase2.py`).
- Docker Compose now runs a `worker` service (Celery) alongside `api`.

## What's still NOT in this phase (Phase 3/4 — see roadmap)

- No embeddings/pgvector/RAG chunking yet — chat uses the full contract text
  as context (fine up to `MAX_CHAT_CONTEXT_CHARS`, capped at ~60k chars /
  ~15k tokens today), and there's no cited-source retrieval against a legal
  knowledge base yet.
- No Stripe/subscriptions/payments.
- No admin endpoints.
- No plain-English "translation levels" (simple/intermediate/law-student)
  the original frontend prototype's UI expects — `explanation` is currently
  one fixed register; adding the 3-level version is a small addition to the
  `analyze_contract` prompt + schema, planned alongside RAG in Phase 3 so it
  isn't done twice.

## What's real in this phase

- **Signup / Login / Logout / Refresh** — bcrypt password hashing, JWT access
  tokens (15 min default), opaque refresh tokens stored **hashed** in Postgres
  with rotation + reuse detection (a replayed, already-rotated refresh token
  revokes the whole session family).
- **Email verification** and **forgot/reset password** — real token flow
  (hashed, expiring, single-use). Emails send via SMTP if configured;
  otherwise they log to stdout in dev so you can copy the link manually.
- **Protected routes** via `Depends(get_current_user)`; `require_admin` and
  `require_verified_user` guards ready to use.
- **Contracts CRUD** — upload (validated extension + size), list (paginated),
  get, delete. Every read/delete does a row-level ownership check
  (`contract.user_id == current_user.id`) — a user can never reach another
  user's contract by guessing an ID.
- **Rate limiting** (slowapi) on all auth endpoints — brute-force and
  enumeration resistant.
- **Input validation** — Pydantic schemas reject weak passwords, bad emails,
  oversized/wrong-type files before they touch the DB or disk.
- **Storage abstraction** — local disk for dev, S3 (with SSE-AES256) for
  prod, switched by one env var — no code changes needed to go from dev to
  prod storage.
- Security headers, CORS allow-list, structured error handlers.

## What's explicitly NOT in this phase (by design — see roadmap)

- No AI calls yet (contract upload just stores the file; `status` stays
  `"uploaded"`).
- No OCR/text extraction yet.
- No chat, subscriptions, payments, or admin endpoints yet.
- No OAuth (Google/Apple) — email/password only for now.

Nothing here fakes those — the endpoints simply don't exist yet, rather than
returning canned data.

## Run it locally

```bash
cp .env.example .env
# generate a real secret:
python3 -c "import secrets; print(secrets.token_hex(32))"
# paste it into JWT_SECRET_KEY in .env

docker compose up --build
# migrations run automatically on container start (alembic upgrade head)
```

API is at `http://localhost:8000`, interactive docs at `http://localhost:8000/docs`.

### Smoke test

```bash
# 1. Sign up
curl -X POST localhost:8000/api/v1/auth/signup -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"Str0ngPassw0rd!","name":"You"}'
# -> {access_token, refresh_token}

# 2. Call a protected route
curl localhost:8000/api/v1/auth/me -H "Authorization: Bearer <access_token>"

# 3. Upload a contract
curl -X POST localhost:8000/api/v1/contracts -H "Authorization: Bearer <access_token>" \
  -F "file=@/path/to/lease.pdf"

# 4. List contracts
curl localhost:8000/api/v1/contracts -H "Authorization: Bearer <access_token>"

# 5. Refresh
curl -X POST localhost:8000/api/v1/auth/refresh -H "Content-Type: application/json" \
  -d '{"refresh_token":"<refresh_token>"}'

# 6. Poll status until "ready" (worker container does extraction + analysis)
curl localhost:8000/api/v1/contracts/<contract_id> -H "Authorization: Bearer <access_token>"

# 7. Get the analysis once ready
curl localhost:8000/api/v1/contracts/<contract_id>/analysis -H "Authorization: Bearer <access_token>"

# 8. Rewrite a clause (use a clause id from step 7)
curl -X POST localhost:8000/api/v1/clauses/<clause_id>/rewrite -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" -d '{"tone":"tenant-friendly"}'

# 9. Start a chat session and stream a message
curl -X POST localhost:8000/api/v1/contracts/<contract_id>/chat/sessions -H "Authorization: Bearer <access_token>"
curl -N -X POST localhost:8000/api/v1/chat/sessions/<session_id>/messages -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" -d '{"message":"What happens if I terminate early?"}'
```

Set `ANTHROPIC_API_KEY` in `.env` before step 6 — without it, the Celery task
will mark the contract `status="failed"` with a clear error rather than
hanging or faking a result.

If SMTP isn't configured, check `docker compose logs api` for the verification
link instead of an inbox.

## Folder structure

```
clauseiq_backend/
├── app/
│   ├── main.py                 FastAPI app, middleware, error handlers
│   ├── core/
│   │   ├── config.py           env-driven settings (fails loudly if secrets missing)
│   │   ├── security.py         hashing, JWT, opaque token helpers
│   │   └── deps.py             get_current_user, require_admin, rate limiter
│   ├── db/session.py           SQLAlchemy engine/session
│   ├── models/                 User, RefreshToken, EmailVerificationToken,
│   │                           PasswordResetToken, Contract
│   ├── schemas/                Pydantic request/response models
│   ├── services/
│   │   ├── storage.py          local disk / S3 abstraction
│   │   ├── email.py            SMTP send (or dev-log fallback)
│   │   ├── extraction.py       PDF/DOCX/image → text, with OCR fallback
│   │   └── ai_service.py       Anthropic calls: analyze, rewrite, negotiate, compare, stream_chat
│   ├── celery_app.py           Celery config (Redis broker/backend)
│   ├── tasks/pipeline.py       process_contract task: extract → analyze → persist
│   └── api/routes/             auth.py, contracts.py, clauses.py, chat.py
├── alembic/                    migrations (0001 core tables, 0002 analysis/chat tables)
├── docker-compose.yml          postgres + redis + api + celery worker
├── Dockerfile                  includes tesseract-ocr + poppler-utils for OCR
└── .env.example
```

## Database schema (this phase)

```sql
users (id uuid pk, email unique, hashed_password, name, is_active, is_email_verified,
       role, plan, created_at, updated_at)
refresh_tokens (id, user_id fk, token_hash unique, expires_at, revoked_at,
                created_at, user_agent, ip_address)
email_verification_tokens (id, user_id fk, token_hash unique, expires_at, used_at)
password_reset_tokens (id, user_id fk, token_hash unique, expires_at, used_at)
contracts (id, user_id fk, name, original_filename, file_type, size_bytes,
           storage_backend, storage_key, status, status_detail, raw_text,
           created_at, updated_at)
analyses (id, contract_id fk, risk_score, summary, categories jsonb,
          missing_clauses jsonb, model_used, created_at)
clauses (id, analysis_id fk, title, category, risk_level, excerpt,
         explanation, position, created_at)
chat_sessions (id, contract_id fk, user_id fk, title, created_at, updated_at)
chat_messages (id, session_id fk, role, content, created_at)
```

## Roadmap (matches the build order in your architecture doc)

| Phase | Scope |
|---|---|
| **1 — done** | Auth (signup/login/logout/refresh/verify/reset), JWT + refresh rotation, protected routes, Contracts CRUD, storage abstraction, rate limiting, Docker |
| **2 — done** | OCR/extraction (pdf/docx/image → text), Celery + Redis async pipeline, real Anthropic API calls server-side (summary, risk detection, missing-clause detection, clause explanation, rewrite, negotiation suggestions, contract comparison), SSE streaming chat scoped to one contract |
| **3 — next** | pgvector embeddings + RAG (contract-chunk grounding instead of whole-doc context, cited retrieval, legal knowledge base), 3-level plain-English explanations, Stripe (checkout, webhooks, 4 tiers, usage metering/quota enforcement) |
| **4** | Admin dashboard API (users/contracts/payments/analytics), notifications/timeline, GitHub Actions CI/CD, staging environment |

Each phase will be delivered as real, working code against this same
skeleton — not scaffolding with TODOs.

## Known gaps to close before real production traffic

- Add automated tests (pytest + a test DB) — none exist yet.
- Add OAuth if you want social login.
- Local disk storage is dev-only; set `STORAGE_BACKEND=s3` before deploying
  more than one instance.
- Add a WAF / managed rate limiting (Cloudflare, etc.) in front — slowapi's
  in-process limiter won't hold state across multiple API replicas; swap its
  storage to Redis (`Limiter(storage_uri=settings.REDIS_URL, ...)`) before
  scaling past one container.
- `gunicorn` worker count (currently 4) should be tuned to your instance size.

## Phase 3 additions (this delivery)

- **Richer analysis output** — `doc_type`, a 3-reading-level summary and
  per-clause explanation (`simple` / `intermediate` / `lawStudent`),
  extracted `obligations`, and `key_dates`, plus a per-clause
  `dispute_likelihood`/`dispute_reason` signal. See migration `0003` and the
  updated `ANALYSIS_SYSTEM_PROMPT` in `app/services/ai_service.py`. This
  brings the backend up to the shape the frontend UI was already built
  against (previously a frontend-only fantasy schema with nothing behind it).
- **Multi-contract compare** — `POST /contracts/compare` now takes 2–3
  `contract_ids` instead of exactly two, matching the frontend's compare UI.
- **Benchmark endpoint** — `POST /contracts/{id}/benchmark` compares a
  contract against general market-norm expectations for its type.
- **Chat reading level** — `POST /chat/sessions/{id}/messages` accepts an
  `explain_level` field so streamed replies match the summary's reading
  level.
- **AI retry + fallback provider** — `ai_service._create_with_retry` retries
  transient Anthropic failures with backoff, then falls back to a second key
  (`ANTHROPIC_FALLBACK_API_KEY`) if configured and the primary keeps failing.
- **A real frontend** — see `../../frontend`. It talks to this API instead of
  calling Anthropic directly from the browser (the original artifact-style
  prototype shipped the API key to the client, which is not viable for
  production).

### Still open (not in this delivery — see the top-level project README)

RAG/vector search across the legal-knowledge-base doc types, MFA, admin
panel, notifications, and structured observability/tracing are still
outstanding. None of that is stubbed here — it's simply not built yet,
tracked as follow-up work rather than faked. Stripe billing and a test
suite were added in this pass (below).

## Billing (Stripe)

`app/services/billing.py` + `app/api/routes/billing.py`. Uses Stripe
Checkout (hosted payment page) and the Stripe Billing Portal (hosted
subscription management) rather than building custom card-collection UI.

To actually test this against Stripe before launch:
1. Create two recurring Prices in the Stripe Dashboard (test mode) — one
   for "Pro", one for "Business" — and set `STRIPE_PRICE_ID_PRO` /
   `STRIPE_PRICE_ID_BUSINESS` in `.env` to their Price IDs (`price_...`).
2. Set `STRIPE_SECRET_KEY` to your test secret key.
3. Forward webhooks to your local API with the Stripe CLI:
   `stripe listen --forward-to localhost:8000/api/v1/billing/webhook`
   — this prints a `whsec_...` value, put that in `STRIPE_WEBHOOK_SECRET`.
4. Sign in to the app, open Billing, click "Upgrade to Pro", complete
   checkout with Stripe's test card `4242 4242 4242 4242`, confirm you're
   redirected back and the plan updates (webhook-driven, may take a couple
   seconds).
5. Click "Manage subscription" and confirm the Stripe-hosted portal opens
   and a test cancellation correctly downgrades the user back to `free`.

None of this has been run against a live Stripe account yet — the code is
correct by inspection and unit-tested for signature verification and
plan-gating, but step 4/5 above is the real verification and hasn't happened.

## Running tests

Models use Postgres-specific column types (`postgresql.UUID`, `JSONB`,
`pgvector.sqlalchemy.Vector`), so tests need a real Postgres+pgvector
database — SQLite will not work.

```bash
# using the existing dev stack's db container:
docker compose exec api pip install -r requirements-dev.txt --break-system-packages
docker compose exec api pytest --cov=app --cov-report=term-missing

# or against any scratch Postgres+pgvector database:
export TEST_DATABASE_URL=postgresql://clauseiq:clauseiq@localhost:5432/clauseiq_test
pip install -r requirements-dev.txt
pytest
```

Current coverage: auth (signup/login/refresh rotation/reuse-detection),
cross-user ownership on every contract/analysis endpoint (404-not-403),
billing route behavior (webhook signature verification, unconfigured-plan
handling), and a dedicated regression test for the Celery task-registration
bug (`tests/test_celery_registration.py`) that caused "Received unregistered
task of type 'process_contract'". Not yet covered: extraction/OCR, the AI
analysis service, RAG retrieval — these need either a live Anthropic key or
substantial mocking and are the natural next slice of test-suite work.

CI: `.github/workflows/backend-tests.yml` runs this same suite against a
real Postgres+pgvector + Redis on every push/PR.
