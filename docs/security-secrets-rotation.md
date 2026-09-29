# Security Secrets Rotation Runbook

## Scope

This runbook defines the minimum operational policy to rotate critical secrets used by Atlas Knowledge:

- `GEMINI_API_KEY`
- Supabase keys (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

## Owner and Responsibility

- Primary owner: Backend/API owner (repository maintainers).
- Secondary owner: DevOps/Platform owner for deployment and CI secret stores.
- Approver: Technical lead or designated maintainer with production access.

The owner executes rotation and records evidence. The approver validates and signs off.

## Rotation Frequency

- Scheduled rotation: every 90 days.
- Emergency rotation: immediately when a trigger event occurs.

## Rotation Triggers

Rotate secrets immediately when any of the following occurs:

- Suspected or confirmed key leakage (logs, screenshots, chat paste, accidental commit).
- Access revocation for a team member with secret access.
- Third-party provider security advisory requiring key invalidation.
- Unauthorized API usage spike or billing anomaly.

## Procedure (Step by Step)

### 1) Preparation

1. Open a tracking ticket with timestamp, scope, owner, and approver.
2. Identify every environment to update (`dev`, `staging`, `prod`, CI).
3. Identify all secret locations:
   - Local env templates (`.env.example`, `frontend/.env.local` references only).
   - CI/CD secret stores (GitHub Actions secrets/variables).
   - Hosting/runtime secret managers.
4. Define a maintenance window if production restart is required.

### 2) Generate New Secrets

1. Create a new `GEMINI_API_KEY` from Google AI/Gemini console.
2. Rotate Supabase keys from Supabase project settings:
   - Regenerate `service_role` key.
   - Regenerate `anon`/publishable key as required by policy.
3. Store new values in secure secret manager only (never in repository files).

### 3) Apply New Secrets

1. Update backend runtime secrets:
   - `GEMINI_API_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_ANON_KEY` (if used by scripts/runtime)
2. Update frontend runtime secrets:
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL` only if Supabase project changed.
3. Update CI secrets for workflows that require those keys.
4. Redeploy/restart affected services to pick up new values.

### 4) Revoke Old Secrets

1. Confirm all environments are running with the new values.
2. Revoke old Gemini and Supabase keys.
3. Verify no workload still references revoked keys.

## Post-Rotation Validation

Run validation checks without build steps:

1. Backend health and auth smoke:
   - `npx tsc --noEmit`
   - `npm run test:backend`
2. Frontend smoke/type safety:
   - `(cd frontend) npx tsc --noEmit`
   - `(cd frontend) npm test`
3. RAG/observability sanity (as applicable):
   - `npm run rag:eval:deterministic`
   - `npm run observability:check:structural`

Acceptance criteria:

- No authentication failures due to invalid keys.
- No unauthorized or forbidden errors caused by missing key permissions.
- Required checks continue passing in CI.

## Evidence and Audit Trail

For every rotation, capture and store:

- Tracking ticket link and approver name.
- Timestamp of generation, deployment, and revocation.
- Environment list updated.
- Command outputs for validation checks (or CI run links).
- Incident reference if emergency rotation.

Store only non-sensitive evidence in `docs/`, such as masked key prefixes, validation check outputs, CI run links, timestamps, environment lists, and ticket/approval references.
Do not include secret values, full tokens/keys, secret-manager exports, or screenshots that reveal secret material in repository-tracked evidence.
Any sensitive evidence must live only in the external operational tracker linked from the ticket.

## Fallback / Rollback

If post-rotation validation fails:

1. Stop rollout to remaining environments.
2. Restore last known-good secret set from secret manager history.
3. Redeploy impacted services.
4. Re-run validation checks.
5. Open incident follow-up to fix root cause before attempting rotation again.

Important: rollback is temporary. After stabilization, perform a clean re-rotation to ensure compromised keys are not reused.
