
# vercat — realtime chat app

A modern, dark-themed chat app with username search, friend requests, real-time messaging, and online/offline presence. Built on Lovable Cloud (Supabase) with WebSocket-based realtime channels — same UX as socket.io, no separate server to host.

## Pages & routes

- `/` — public landing page (features, founder Nikhil section, Login / Sign Up CTAs). Auto-redirects to `/chat` if already signed in.
- `/auth` — sign up (email + password + unique username) and sign in tabs.
- `/_authenticated/chat` — main chat: sidebar (friends list with presence dots) + conversation pane + composer.
- `/_authenticated/friends` — search users by username, send/accept/decline friend requests, see incoming requests.

## Database schema (Lovable Cloud)

- `profiles` — `id` (FK auth.users), `username` (unique), `display_name`, `avatar_url`, `last_seen`. Auto-created on signup via trigger.
- `friend_requests` — `id`, `from_user`, `to_user`, `status` (pending/accepted/declined), `created_at`. Unique on (from, to).
- `friendships` — `user_a`, `user_b` (sorted so pair is unique), `created_at`.
- `messages` — `id`, `sender_id`, `recipient_id`, `content`, `created_at`, `read_at`.

RLS on every table, policies scoped to `auth.uid()`. Realtime enabled on `messages` and `friend_requests`. Service-role grants included per Cloud rules.

## Realtime

- **Messages**: Supabase Realtime subscription on `messages` filtered to current conversation → new rows appear instantly on both sides.
- **Friend requests**: subscription on `friend_requests` for `to_user = me` → toast + badge.
- **Presence (online/offline)**: Supabase Realtime Presence channel (`presence:global`). Each client tracks itself on mount; sidebar shows green dot for users currently in the channel. `last_seen` written on disconnect via a server function so offline users show "last seen X ago".

## Design

Dark neon direction (selected): bg `#0B0B0F`, surfaces `#16161D`, primary accent `#7C5CFF`, text `#E6E6F0`. Tokens defined in `src/styles.css` under `@theme`. Light-mode toggle in header (persisted to localStorage; both palettes themed via CSS vars). Fully responsive: mobile shows single-pane with back button, desktop shows sidebar + conversation.

Components from shadcn/ui (already installed). Smooth message-enter animation, typing-style empty states, gradient hero on landing.

## Founder section (landing)

Short card: "Built by Nikhil — passionate about realtime web apps." (Placeholder copy; user can edit later — they skipped the bio question.)

## Auth

Email + password with username chosen at signup. Email confirmation disabled in dev for fast testing. Username uniqueness enforced at DB level. Sign-out follows the canonical 4-step teardown (cancel queries → clear cache → signOut → replace-navigate to `/auth`).

## Technical notes

- TanStack Start file-based routes; protected routes under `src/routes/_authenticated/`.
- Friend search via a `createServerFn` that queries `profiles` by username prefix.
- Send-message via server fn (validates friendship) + optimistic UI; realtime sub reconciles.
- A single `onAuthStateChange` listener in `__root.tsx` for cache invalidation.
- Presence cleanup on unmount + `beforeunload`.

## Out of scope / honest limits

- **Not socket.io** — Lovable's serverless runtime can't host a long-lived socket.io server. Supabase Realtime provides the same WebSocket real-time UX and is production-ready.
- **"0 bugs / fully tested"** — I'll build a working, polished app and verify the main flows in the preview, but I won't write an automated test suite unless you ask for one. Realistic expectation: solid working product, edge cases iterated as you find them.
- Group chats, file/image attachments, message editing/deletion, push notifications, typing indicators, read receipts UI — not included unless you ask.

## Build order

1. Enable Lovable Cloud.
2. Migration: tables, RLS, grants, profile trigger, realtime publication.
3. Auth page + landing page + theme tokens + toggle.
4. Friends page (search, requests).
5. Chat page (list, conversation, realtime messages, presence).
6. Polish responsive layout, verify flows in preview with two accounts.
