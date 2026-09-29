# Atlas Knowledge rename and documentation refresh

## Objective

Rename the product identity from `mi-proyecto` to **Atlas Knowledge** and refresh the README so it accurately describes the implemented RAG platform.

## Scope

- Update user-facing product naming.
- Update package metadata and operational service metadata.
- Update Release Please package identity.
- Refresh the root and frontend README documentation.
- Do not rewrite historical changelog entries or modify unrelated pre-existing untracked files.
- Rename the GitHub repository after explicit remote-operation authorization.

## Authorized scope

Local repository metadata, documentation, and product labels. Remote GitHub rename was authorized for `santiago25pvp-prog/atlas-knowledge` using the current authenticated GitHub session.

## Tasks

- [x] `rename-product-identity` — update tracked product-name references in metadata, logging, and UI.
- [x] `refresh-project-documentation` — update root/frontend README content and setup references.
- [x] `rename-github-repository` — rename the remote repository to `atlas-knowledge` and update local `origin`.

## Acceptance criteria

- No active product metadata or UI label identifies the product as `mi-proyecto`.
- README files describe the current RAG, ingestion, hybrid retrieval, chat-session, auth, admin, and observability capabilities.
- Historical changelog links remain intact.
- GitHub repository is available at `santiago25pvp-prog/atlas-knowledge`.
- Existing untracked files are not staged accidentally.
- TypeScript checks pass before the work-unit commit.

## Checks

- `npx tsc --noEmit` from the repository root.
- `npx tsc --noEmit` from `frontend`.

## Progress

- Route: delegated mapping followed by direct documentation/metadata edits.
- Forecast: under 100 authored changed lines.
- Remote verification: GitHub repository renamed successfully; local `origin` updated to `https://github.com/santiago25pvp-prog/atlas-knowledge.git`.
