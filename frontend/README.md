# Atlas Knowledge Frontend

Next.js frontend for the Atlas Knowledge backend. It provides authenticated chat, persistent conversations, source-aware answers, and an administrative workspace for indexed documents.

## Scripts

```bash
npm install
npm run dev
npm test
npm run test:e2e
```

## Estado funcional

- La sesion de Supabase se refresca cuando el token esta por expirar.
- El chat carga conversaciones persistidas desde `/chat/sessions` y usa `sessionStorage` como fallback local.
- Las consultas envian `Accept-Language: es-CO` y `sessionId` cuando hay una conversacion activa.
- Los helpers de frontend tienen tests con `node:test`.
- Hay smoke E2E con Playwright para auth keyboard focus y redirects de guards.

## Variables de entorno

Usa `frontend/.env.local` con:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Notas:

- `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` son obligatorias.
- `NEXT_PUBLIC_API_URL` cae a `http://localhost:3001` solo en desarrollo/test.
- En `production`, `NEXT_PUBLIC_API_URL` es obligatorio.
- En `NODE_ENV=test` (smoke E2E) se permite fallback deterministico de Supabase para evitar crashes por config faltante.

## Persistent chat-session verification

See [`../docs/supabase-chat-sessions.md`](../docs/supabase-chat-sessions.md) for the database, backend, and environment setup. Verify the flow with this checklist:

- [ ] Sign in.
- [ ] Send a chat message and confirm the conversation is listed.
- [ ] Sign out.
- [ ] Sign in again with the same account.
- [ ] Confirm the previous conversation and its messages reappear.
