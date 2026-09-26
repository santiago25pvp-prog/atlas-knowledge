# mi-proyecto

`mi-proyecto` is a RAG (Retrieval-Augmented Generation) system that turns web content into a searchable knowledge base. It solves the problem of having documentation, manuals, or pages scattered across the web and needing traceable answers through an API and an authenticated web interface, with vector storage in Supabase and answer generation with Gemini.

## Main Features

### RAG Architecture

- Ingests a URL, cleans the HTML, and extracts only useful text.
- Splits content into 1000-character chunks with 200 overlap.
- Generates embeddings with `gemini-embedding-001` at `3072` dimensions.
- Stores content, metadata, and embeddings in Supabase using `pgvector`.
- Retrieves relevant documents through the SQL function `match_documents`.
- Supports hybrid retrieval v1 with feature flag (`vector` legacy mode or `hybrid` vector + FTS fusion).
- Supports deterministic post-retrieval reranking for hybrid precision experiments.
- Generates the final answer with `gemini-2.5-flash` using retrieved context.

### Unified API

- `POST /query` receives `query` and returns JSON in this format: `{ "requestId": string, "answer": string, "sources": [] }`.
- `POST /query/stream` returns Server-Sent Events (`text/event-stream`) with incremental `token` chunks, final `done`, and structured `error` events.
- `POST /query` and `POST /query/stream` accept optional `sessionId` to persist the user/assistant exchange in server-side chat history.
- `/chat/sessions` exposes authenticated conversation list, create, message history, and delete routes.
- Public backend errors can be localized with `Accept-Language: es` or `Accept-Language: en`; requests without a supported language keep legacy messages.
- During transient provider exhaustion, `POST /query` returns `503` with additive compatibility fields: `code`, `degraded`, `retryable`, `retryAfterMs`, while preserving `error` and `requestId`.
- `POST /ingest` queues document ingestion and `GET /ingest/:jobId` exposes job status.
- Administrative endpoints allow listing documents, deleting documents, and checking stats.

### Authentication and Authorization

- The API uses Supabase JWT in the `Authorization: Bearer <token>` header.
- `authMiddleware` validates the token against Supabase before allowing access to protected routes.
- `adminMiddleware` restricts `/admin/*` to users with `app_metadata.role === "admin"`.
- The frontend uses Supabase Auth for login, registration, and session handling.
- Persistent chat-session setup, environment variables, RLS, and verification are documented in [`docs/supabase-chat-sessions.md`](docs/supabase-chat-sessions.md)

### Tests

- The backend full suite runs with `node:test` and includes:
  `tests/admin-auth.test.ts`, `tests/api-routes.test.ts`, `tests/ai.test.ts`, `tests/rag.test.ts`, `tests/retrieval.test.ts`, `tests/embedding.test.ts`, and `tests/splitter.test.ts`.
- Backend coverage includes authentication, authorization, rate limiting, API route contracts, AI/RAG orchestration, retrieval behavior, embedding generation, and splitter logic.
- The frontend test suite currently includes helper and API/env behavior tests in:
  `frontend/tests/chat-storage.test.ts`, `frontend/tests/auth-session.test.ts`, `frontend/tests/chat-messages.test.ts`, `frontend/tests/backend.test.ts`, and `frontend/tests/env.test.ts`.
- The GitHub Actions workflow runs quality and build checks on pull requests to `main` and `develop`.

### Quality Gates

- Backend:
  - `npx tsc --noEmit`
  - `npm run test:backend`
  - `npm run observability:check:structural`
  - `npm run observability:check:operational` (`OBSERVABILITY_OPERATIONAL_MODE=advisory|soft-block|hard-block`)
  - `npm run observability:check:promotion`
  - `npm run observability:check:rollback-boundary`
- Frontend (inside `frontend`):
  - `npx tsc --noEmit`
  - `npm test`
  - `npm run test:e2e`

- TypeScript 6 compatibility spike report: [`docs/typescript-6-spike.md`](docs/typescript-6-spike.md)

### Troubleshooting

- For common ingestion, embedding, retrieval, frontend, and deployment issues, see [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

### Merge Policy / Required Checks

- Pull requests into `main` must pass these required checks:
  - `Backend Typecheck, Tests & Build`
  - `Frontend Build`
  - `Frontend E2E Smoke`
- These checks prevent merges with type errors, broken builds, or regressions in key user flows.
- Branch protection uses strict status checks (head branch must be up to date with `main` before merge).
- CI governance runbook: [`docs/ci-governance.md`](docs/ci-governance.md)
- Secrets rotation runbook: [`docs/security-secrets-rotation.md`](docs/security-secrets-rotation.md)
- Phase 0 baseline evidence: [`docs/phase0-baseline.md`](docs/phase0-baseline.md)

### RAG Evaluation (Metrics-Based)

- Run the evaluation harness with the bundled sample dataset:

```bash
npm run rag:eval
```

- Run deterministic reliability assertions (blocking lane candidate, no network):

```bash
npm run rag:eval:deterministic
```

- Use a custom dataset file:

```bash
npm run rag:eval -- --dataset=eval/fixtures/rag-eval.sample.json
```

- Optional env overrides:
  - `RAG_EVAL_DATASET`: dataset path (same behavior as `--dataset`).
  - `RAG_EVAL_MIN_PASS_RATE`: overall pass-rate threshold from `0` to `1`.
  - `RAG_EVAL_COMPARE_MODES`: comma-separated comparison variants. Supported values are `current`, `vector`, `hybrid`, `hybrid-rerank`, or `all`.

- Lane governance:
  - `rag:eval:deterministic`: deterministic and reproducible lane for contract/policy assertions.
  - `rag:eval`: live external lane, operational signal only (`live-non-blocking`).

### Observability Enforcement Evidence

- Phase B promotion gate evidence report: `observability-promotion-report.json`.
- Rollback boundary evidence report: `observability-rollback-report.json`.
- Operational gate report (mode + override metadata): `observability-operational-report.json`.
- Manual sign-off evidence:
  - `docs/observability/signoff-t11-policy-decisions.md`
  - `docs/observability/signoff-t12-drill-evidence.md`

### Observability Operational Override Policy

- CI required backend job runs operational checks in `soft-block` mode.
- `soft-block` blocks only `critical` findings.
- `hard-block` blocks both `warning` and `critical` findings.
- `advisory` never blocks and is used for signal-only lanes.
- `OBSERVABILITY_OPERATIONAL_MODE` is fail-closed for invalid non-empty values (must be `advisory|soft-block|hard-block`).
- Override can bypass only `critical` findings, and only when both conditions are met:
  - PR has label `ops-override-observability`.
  - PR body includes `## Observability Override` with all required fields:
    - `Reason`
    - `Risk`
    - `Owner`
    - `ExpiresAt` (ISO8601, not expired, max TTL 72h)
    - `RollbackPlan`
- If label is present but override section is invalid/incomplete, override is rejected and no bypass is applied.
- Operational report includes a `summary` split by `risk` and `guard` findings for clearer triage.

- Per-case heuristic checks:
  - `keyword coverage`: matched `expectedKeywords` in the answer divided by total expected keywords.
  - `sources count`: number of returned sources against `minimumSources`.
  - Case passes only if both thresholds pass.

- Summary metrics:
  - `total cases`, `passed`, `pass rate`, `retrieval hit rate` (cases with at least one source), and `average keyword coverage`.
  - The script exits with non-zero status when the best configured report lane is below the configured threshold.

### Operations and Robustness

- `server.ts` validates environment variables on startup and exposes a healthcheck with dependency verification.
- The backend uses structured logging with Winston and currently adds request IDs in the `ingest`, `query`, and `query/stream` API handlers.
- The scraper has timeout, redirect limits, and payload size limits to prevent trivial DoS cases.
- The frontend chat persists transcript and active selection per user in `sessionStorage`.
- Frontend authentication refreshes the session when the token is close to expiration.

## Installation

### 1. Select Node Version

This repo uses the version defined in `.nvmrc`.

```bash
nvm use
```

### 2. Configure Environment Variables

Create the `.env` file in the project root:

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
GEMINI_API_KEY=tu_gemini_api_key
SUPABASE_ANON_KEY=tu_supabase_anon_key
PORT=3001
```

Notes:

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `GEMINI_API_KEY` are required for the backend.
- `SUPABASE_ANON_KEY` is not listed in `.env.example`, but it is useful for auth scripts in `scripts/get-token.ts`.
- `PORT` is optional; by default the backend listens on `3001`.
- `RAG_RETRIEVAL_MODE` controls retrieval mode: `vector` (default, legacy) or `hybrid`.
- `RAG_VECTOR_WEIGHT` and `RAG_FTS_WEIGHT` control hybrid weighting (defaults `0.7` and `0.3`). Invalid/missing values log warnings and safely fallback to defaults.
- `RAG_RERANK_ENABLED` enables deterministic post-retrieval reranking when set to `true`, `1`, or `yes`.
- `RAG_RERANK_OVERLAP_WEIGHT`, `RAG_RERANK_SIMILARITY_WEIGHT`, and `RAG_RERANK_FRESHNESS_WEIGHT` control rerank scoring weights (defaults `0.5`, `0.4`, and `0.1`). Invalid values safely fallback to defaults.
- In `production`, `ALLOWED_ORIGIN` is required and backend startup fails if it is missing.

Hybrid retrieval v1 notes:

- Hybrid mode uses SQL RPC `match_documents_hybrid` with Reciprocal Rank Fusion over vector and FTS ranks.
- If hybrid RPC fails (missing function/index/runtime DB issue), backend degrades to vector-only retrieval and logs `retrieval_hybrid_fallback_vector`.
- Telemetry includes `retrieval_mode_selected` and `retrieval_hybrid_fallback_vector` events.
- v1 limitation: lexical matching uses English text search configuration (`websearch_to_tsquery('english', ...)`).

Rerank notes:

- Reranking runs after vector or hybrid retrieval and preserves the existing `SearchResult[]` contract.
- The deterministic score combines query-token overlap, original retrieval similarity, and freshness from `created_at`.
- To compare Phase 3 modes without changing code, run:

```bash
RAG_EVAL_COMPARE_MODES=all npm run rag:eval
```

Create the `frontend/.env.local` file:

```env
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_supabase_anon_key
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Frontend notes:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are required to initialize Supabase in the browser.
- `NEXT_PUBLIC_API_URL` falls back to `http://localhost:3001` only outside `production`.
- In `production`, `NEXT_PUBLIC_API_URL` is required and frontend config resolution fails if it is missing.
- In `NODE_ENV=test` (E2E smoke), frontend uses deterministic Supabase fallback values so startup does not fail due to missing env vars.

### 3. Install Dependencies

Install backend dependencies in the root:

```bash
npm install
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

### 4. Run Locally

Backend:

```bash
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

Default ports:

- Backend: `http://localhost:3001`
- Frontend: `http://localhost:3000`

## Repository Structure

```text
.
|-- controllers/
|-- middleware/
|-- migrations/
|-- routes/
|-- services/
|-- scripts/
|-- tests/
|-- frontend/
|-- server.ts
|-- package.json
|-- CHANGELOG.md
```

- `controllers/`
  Contains backend HTTP handlers.
  - `api.ts`: exposes `/ingest`, `/ingest/:jobId`, `/query`, and `/query/stream`.
  - `admin.ts`: exposes administrative operations for documents and stats.

- `services/`
  Implements RAG and admin domain logic.
  - `scraper.ts`: downloads and cleans HTML.
  - `splitter.ts`: splits text into chunks.
  - `embedding.ts`: creates Gemini embeddings, with LRU cache and batch support for ingestion.
  - `retrieval.ts`: delegates retrieval to the configured vector store adapter.
  - `retrieval-config.ts`: resolves retrieval mode and safe hybrid weights from env vars.
  - `ingestion.ts`: orchestrates scraping, splitting, embeddings, and insertions.
  - `vector-db.ts`: creates backend Supabase client.
  - `adminService.ts`: lists, deletes, and summarizes documents.

- `migrations/`
  Contains vector database definition.
  - `001_init_rag.sql`: creates `vector` extension and `documents` table.
  - `002_reconcile_document_embeddings.sql`: normalizes embeddings to `vector(3072)` and creates the `match_documents` function.
  - `003_hybrid_retrieval_v1.sql`: adds FTS generated column/index and creates `match_documents_hybrid` without changing legacy `match_documents`.

- `frontend/`
  Next.js app that consumes the API and Supabase Auth.
  - `app/`: `chat`, `admin`, `login`, and `register` pages.
  - `components/`: UI, auth, chat, admin, and providers.
  - `lib/backend.ts`: fetch client for backend API.
  - `lib/supabase-browser.ts`: browser Supabase client.
  - `lib/chat-storage.ts` and `lib/auth-session.ts`: local chat persistence and session refresh.
  - `tests/`: helper and API/env behavior tests.

- `middleware/`
  Authentication, admin authorization, and rate limiting middleware.

- `routes/`
  Express router for the admin area.

- `tests/`
  Backend test suite focused on auth, admin, JSON contracts, healthcheck, AI/RAG, retrieval, embeddings, and splitter behavior.

- `scripts/`
  Support utilities for admin, auth, and manual RAG flow testing.

## API Reference

### General Conventions

- Local backend base URL: `http://localhost:3001`
- Expected content type for requests with body: `application/json`
- Protected auth header: `Authorization: Bearer <supabase_jwt>`
- Auth error responses:

```json
{ "error": "Unauthorized: Missing or invalid token" }
```

```json
{ "error": "Unauthorized: Invalid token" }
```

- Admin error response:

```json
{ "error": "Forbidden: Admins only" }
```

- Rate limits use plain text messages, not JSON:
  - Public: `Demasiadas solicitudes, intenta de nuevo mas tarde.`
  - Authenticated: `Demasiadas solicitudes autenticadas, intenta de nuevo mas tarde.`

### GET /health

- Method: `GET`
- Auth: not required
- Query params: none
- Body: none
- `200 OK` response:

```json
{ "status": "ok", "dependencies": { "supabase": "ok" } }
```

### POST /query

- Method: `POST`
- Auth: required
- JSON body:

```json
{ "query": "consulta", "sessionId": "uuid-opcional" }
```

- Parameters:
  - `query` (string, required): query that will be answered with RAG.
  - `sessionId` (string, optional): existing chat session owned by the authenticated user. When present, the backend persists the user prompt and assistant answer after a successful response.
- `200 OK` response:

```json
{
  "answer": "Respuesta consolidada",
  "sources": [
    {
      "name": "Manual",
      "content": "Contenido"
    }
  ]
}
```

- `400 Bad Request` response:

```json
{ "error": "Query is required" }
```

- `500 Internal Server Error` response:

```json
{ "error": "Failed to process query" }
```

### POST /query/stream

- Method: `POST`
- Auth: required
- Content type: request body is `application/json`, response is `text/event-stream; charset=utf-8`
- JSON body:

```json
{ "query": "consulta", "sessionId": "uuid-opcional" }
```

- SSE event contract:
  - `event: token` with payload `{ "requestId": string, "delta": string }`
  - `event: done` with payload `{ "requestId": string, "answer": string, "sources": [], "timings": { "firstTokenMs": number | null, "totalMs": number } }`
  - `event: error` with payload `{ "requestId": string, "error": string, "status": number, "degraded": boolean, "retryable": boolean, "retryAfterMs"?: number, "code"?: string }`
- Keepalive behavior:
  - the backend emits periodic SSE comments (`: heartbeat`) to keep the connection open.
- Fallback behavior:
  - frontend first attempts `/query/stream` and automatically falls back to `POST /query` JSON when SSE is unavailable, unsupported, or returns `404/405/501`.
- Current limitation:
  - provider output is currently streamed through safe incremental chunking of the final generated answer. The contract is forward-compatible with true token streaming from the model provider.

### Chat Sessions

- Base path: `/chat/sessions`
- Auth: required
- `GET /chat/sessions`: returns `{ "sessions": [], "requestId": string }` ordered by most recently updated.
- `POST /chat/sessions`: accepts optional `{ "title": string }` and returns `{ "session": {}, "requestId": string }`.
- `GET /chat/sessions/:sessionId/messages`: returns `{ "messages": [], "requestId": string }`.
- `DELETE /chat/sessions/:sessionId`: deletes a user-owned conversation and returns `204 No Content`.
- Access control: the backend filters every operation by authenticated `user_id`, and the Supabase migration enables RLS policies scoped to `auth.uid()`.

### POST /ingest

- Method: `POST`
- Auth: required
- JSON body:

```json
{ "url": "https://example.com/docs" }
```

- Parameters:
  - `url` (string, required): URL to scrape and index.
- `202 Accepted` response when the job is queued:

```json
{
  "requestId": "6b0d4fd3-bb0a-40df-82d1-9a33d9c6bdc4",
  "jobId": "7c941c1d-6821-4f4e-a512-9b2cb54fd85f",
  "status": "queued"
}
```

- The backend processes the job asynchronously with in-memory status tracking and retries transient failures.
- If the same URL is already `queued` or `running`, the active `jobId` is reused.
- `400 Bad Request` response:

```json
{ "error": "Invalid request", "details": ["URL is required"] }
```

### GET /ingest/:jobId

- Method: `GET`
- Auth: required
- Parameters:
  - `jobId` (string, required): ID returned by `POST /ingest`.
- `200 OK` response while running:

```json
{
  "requestId": "87bb63d5-8cf8-45cf-84e7-3933ae7d8d9b",
  "jobId": "7c941c1d-6821-4f4e-a512-9b2cb54fd85f",
  "status": "running",
  "url": "https://example.com/docs",
  "attempts": 1,
  "maxAttempts": 3,
  "createdAt": "2026-05-17T23:20:00.000Z",
  "updatedAt": "2026-05-17T23:20:01.000Z",
  "startedAt": "2026-05-17T23:20:01.000Z"
}
```

- `200 OK` response when complete:

```json
{
  "requestId": "87bb63d5-8cf8-45cf-84e7-3933ae7d8d9b",
  "jobId": "7c941c1d-6821-4f4e-a512-9b2cb54fd85f",
  "status": "done",
  "url": "https://example.com/docs",
  "attempts": 1,
  "maxAttempts": 3,
  "createdAt": "2026-05-17T23:20:00.000Z",
  "updatedAt": "2026-05-17T23:20:08.000Z",
  "startedAt": "2026-05-17T23:20:01.000Z",
  "completedAt": "2026-05-17T23:20:08.000Z",
  "result": {
    "status": "success",
    "chunks_inserted": 2,
    "chunks_failed": 0
  }
}
```

### GET /admin/documents

- Method: `GET`
- Auth: required
- Admin role: required
- Query params:
  - `page` (number, optional, default `1`)
  - `pageSize` (number, optional, default `10`)
- Body: none
- `200 OK` response:

```json
{
  "data": [
    {
      "id": 1,
      "name": "Manual de prueba",
      "content": "Contenido indexado",
      "created_at": "2026-04-07T00:00:00.000Z",
      "metadata": {
        "url": "https://example.com"
      }
    }
  ],
  "count": 1
}
```

- `500 Internal Server Error` response:

```json
{ "error": "Failed to list documents" }
```

### DELETE /admin/documents/:id

- Method: `DELETE`
- Auth: required
- Admin role: required
- Path params:
  - `id` (number, required): document identifier in the `documents` table.
- Body: none
- `200 OK` response:

```json
{
  "message": "Document deleted successfully",
  "requestId": "req_1234567890"
}
```

- `500 Internal Server Error` response:

```json
{ "error": "Failed to delete document" }
```

### GET /admin/stats

- Method: `GET`
- Auth: required
- Admin role: required
- Query params: none
- Body: none
- `200 OK` response:

```json
{
  "docCount": 42,
  "requestCount": 0
}
```

- `500 Internal Server Error` response:

```json
{ "error": "Internal Server Error", "requestId": "req_1234567890" }
```

## Changelog

Project version and release history is in [`CHANGELOG.md`](./CHANGELOG.md).

## Release Automation

This repository uses Release Please to open release PRs from `main`.

To ensure CI required checks run on Release Please PRs, configure a repository secret named `RELEASE_PLEASE_TOKEN` (GitHub PAT) and keep the release workflow using that token.
