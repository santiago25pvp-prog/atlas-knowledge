# Supabase Chat Sessions

This document records the completed implementation and verification of persistent, user-scoped chat sessions.

## Database implementation

Migration `migrations/004_chat_sessions.sql` was applied directly to the Supabase database through the Session Pooler. It is **not recorded in Supabase CLI migration history**.

The migration creates:

- `chat_sessions`
  - `id uuid` primary key, generated with `gen_random_uuid()`
  - `user_id uuid` referencing `auth.users(id)` with cascade delete
  - `title text`, defaulting to `Nueva conversacion`
  - `created_at timestamptz`, defaulting to `now()`
  - `updated_at timestamptz`, defaulting to `now()`
- `chat_messages`
  - `id uuid` primary key, generated with `gen_random_uuid()`
  - `session_id uuid` referencing `chat_sessions(id)` with cascade delete
  - `user_id uuid` referencing `auth.users(id)` with cascade delete
  - `role text`, restricted to `user` or `assistant`
  - `content text`
  - `sources jsonb`
  - `sequence integer`
  - `created_at timestamptz`, defaulting to `now()`
  - unique `(session_id, sequence)`

Indexes support the primary access paths:

- `idx_chat_sessions_user_updated` on `(user_id, updated_at desc)`
- `idx_chat_messages_session_sequence` on `(session_id, sequence)`
- `idx_chat_messages_user_session` on `(user_id, session_id)`

Both tables have Row Level Security enabled. The migration's policies are defined for the `public` role but require `auth.uid()` to match `user_id`, so anonymous requests cannot access rows; `chat_messages` has select, insert, and delete policies, while `chat_sessions` has select, insert, update, and delete policies. The backend also scopes every session operation to the authenticated user.

The `chat_sessions_set_updated_at` trigger runs before updates and calls `update_chat_sessions_updated_at()` so `updated_at` always reflects the latest session change.

## Connection and application variables

Use the Session Pooler connection variables for the backend database connection:

```text
SUPABASE_DB_HOST=
SUPABASE_DB_PORT=
SUPABASE_DB_NAME=
SUPABASE_DB_USER=
SUPABASE_DB_PASSWORD=
```

Never commit secrets. Keep passwords, keys, and local environment files out of source control.

The frontend uses:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Because `NEXT_PUBLIC_*` variables are exposed to the browser, use only the public Supabase URL and anon key there; never expose a service-role key.

## API and persistence

The authenticated backend exposes:

- `GET /chat/sessions` — list the current user's sessions, ordered by most recently updated.
- `POST /chat/sessions` — create a session, optionally with a title.
- `GET /chat/sessions/:sessionId/messages` — load message history.
- `DELETE /chat/sessions/:sessionId` — delete a user-owned session.

`POST /query` and `POST /query/stream` accept an optional `sessionId`. The frontend creates or selects a session, sends that ID with each chat request, and reloads the persisted session list and messages after authentication. Signing out clears the authenticated view; signing back in loads the user's server-side sessions again.

## Manual verification flow

1. Start the backend and frontend with the required environment variables.
2. Sign in through the frontend.
3. Open the chat and send a message.
4. Confirm the response appears and the conversation is listed in the session history.
5. Sign out.
6. Sign in again with the same account.
7. Confirm the previous conversation reappears and its messages can be opened.

## Automated and endpoint verification

The completed implementation was verified with:

- Frontend focused tests: **18/18 passing**.
- Backend session and authentication tests passing.
- `GET /health` returned `200`.
- The Supabase Auth endpoint returned `200`.
- Protected session routes returned `401` without a token.
- REST requests for the chat session tables returned `200`.
