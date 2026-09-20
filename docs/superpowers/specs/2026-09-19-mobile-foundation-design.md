# Design: Mobile App Foundation — make the app the primary interface (sub-project A)

Date: 2026-09-19
Status: Approved, not yet implemented

## Context and decomposition

The goal is to move day-to-day use of the agent off WhatsApp and into the existing Expo app
(`mobile/`), with Android 16 home-screen widgets and actionable notifications. That is four
independent pieces of work, each with its own design → plan → implementation cycle:

| # | Sub-project | Depends on |
|---|---|---|
| **A** | **Foundation (this document)**: real app build, header auth, push registration, proactive messages delivered to the app with WhatsApp as fallback | — |
| C | Home-screen widgets: pending todos, next reminder, one-tap capture | A |
| B | Actionable notifications: Done / Snooze from a reminder notification | A |
| D | Capture polish: voice capture in-app, share-to-agent from other apps | A |

Agreed order: A, then C, then B. D is unscheduled.

After A, the agent's reminders and briefs reach the phone as app notifications instead of
WhatsApp. That is the actual move off WhatsApp; C and B make it pleasant.

## Findings that shaped this design

Verified against production on 2026-09-19, not inferred from docs:

- **The Express app is live on Vercel for every path outside `/api`.** `vercel.json` sets
  `"framework": "express"` and `package.json` `main` is `src/server.js`, so Vercel builds the
  Express app as one function. `GET /dashboard/api/status` and `/dashboard/api/todos` return
  Express's own `401 Unauthorized`. Only Express routes mounted under `/api` are unreachable —
  the `api/` directory's functions own that prefix — which is why `/api/llm-health` and
  `/api/push/register` return 404. CLAUDE.md's statement that the Express router "is not
  deployed" is wrong for everything outside `/api`.
- **Routes added to the `/dashboard` router cost zero Vercel function slots.** The project is at
  the Hobby plan's 12-function cap (11 files in `api/` + the Express function), so this is what
  makes the work possible without consolidating the crons or upgrading the plan.
- **The push *sending* side mostly exists; registration does not.** `src/push/push.js` sends via
  the Expo push service. `delivery.js` already pushes every todo and event reminder, the morning
  cron pushes a generic "Your day starts now. Tap to see context." with no content, and the
  nudge cron pushes the first 120 characters. Evening, goal, pulse and weekly are WhatsApp-only.
  None of it has ever reached a phone: the app's `POST /api/push/register` returns 404, so no
  device token has ever been stored.
- **Proactive messages are not persisted anywhere.** No cron calls `saveMessage`. Briefs exist
  only in WhatsApp's history, so routing them to the app requires storing them.
- **The app has never had a native build.** No `eas.json`, no `android/` directory, and the EAS
  `projectId` is the placeholder `blu-mobile-local`. A real push token and native widgets both
  require one.
- **The app bakes its credential into the bundle.** `mobile/api.js` reads
  `EXPO_PUBLIC_API_TOKEN`; `EXPO_PUBLIC_*` values are inlined at build time, so an APK would carry
  a long-lived token with full access to the owner's data.
- **Two auth implementations existed, and one was broken.** `api/todos.js` and `api/chat.js`
  compared against the retired `DASHBOARD_TOKEN`, letting anonymous requests through (fixed in
  `c08cebd`). The `/dashboard` router's `tokenMiddleware` was correct throughout. One API surface
  means one check to get right.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Where do the app's endpoints live? | The `/dashboard` Express router only | Zero function slots; one auth implementation; most needed routes already exist there |
| Consolidate the 7 cron functions? | **No** | Only needed if new endpoints needed new functions; they don't |
| Where do proactive messages go? | App first, WhatsApp as fallback | No duplicate notifications, and nothing lost if the app breaks |
| How is the app built? | EAS cloud builds | No Android toolchain on Windows; one-time setup |
| How is the token held? | Entered on first launch, stored with `expo-secure-store` | An `EXPO_PUBLIC_*` token ships inside the APK |
| Where are proactive messages stored? | New `inbox_messages` table, not `conversations` | The classifier reads the last 3 `conversations` rows; long briefs there would change how the next message is classified |
| Android package name | `com.tarunsitaraman.blumobile` | Permanent once Firebase is configured |

## Design

### 1. Server API: one surface, `/dashboard`

| Route | Status | Purpose |
|---|---|---|
| `POST /dashboard/api/push/register` | new | Store this device's Expo push token (`memory.savePushToken`) |
| `POST /dashboard/api/push/test` | new | Send a test notification to the caller's devices, to verify setup |
| `GET /dashboard/api/messages` | new | The chat thread, merged by time: user messages and replies (`conversations`) plus proactive messages (`inbox_messages`). `?before=<ISO>&limit=<n>`, default 50, max 200. Items: `{id, from: 'me'|'agent', kind, text, created_at}` |
| `POST /dashboard/chat` | exists | The app moves here from `/api/chat` |
| `GET /dashboard/api/todos`, `/events`, `/notes`, `/learnings`, `/status` | exist | Already used by the app |

`tokenMiddleware` (`src/routes/dashboard.js`) currently reads only `?token=`. It will accept
`Authorization: Bearer <token>` as well, with the header taking precedence. The web dashboard
keeps using `?token=`, because it navigates by URL. A missing token remains a 401 before any
lookup.

`api/chat.js` and `api/todos.js` are retired **only after** the new app is verified on the
device, as the final step of A, because an old app build still calls `/api/chat`. Retiring them
also removes `src/agent/dashboardAuth.js` and `test/api.auth.test.js`, which exist only for
those two files.

### 2. Delivery: app first, nothing lost

All proactive sends go through one function, `deliver(message)`, in `src/scheduler/delivery.js`
(the module is already the single source of truth for reminder delivery; this extends it):

```
message = { kind, title, text, whatsapp?: { text, buttons } }
kind    ∈ reminder | event | brief | evening | nudge | goal | pulse | weekly
```

1. If the user has registered push tokens, push to them. Push text is `text` with WhatsApp
   markup (`*bold*`, `_italic_`) stripped, cut to 180 characters on a word boundary. The full
   text lives in the inbox.
2. Expo tickets whose error is `DeviceNotRegistered` → `memory.removePushToken` for that token.
3. **Fall back to WhatsApp** when the user has no tokens, when every token came back dead, or when
   the Expo request itself failed. The WhatsApp message uses `whatsapp.text`/`whatsapp.buttons`
   when given (reminders keep their Done/Snooze buttons there), otherwise `text`.
4. **Always** insert the message into `inbox_messages` once the send outcome is known, with
   `channel` set to `push`, `whatsapp`, or `failed` when neither channel took it. This is the
   safety net: a notification that never displays, or a message both channels rejected, is still
   in the app. It is written after sending rather than before, because the channel isn't known
   until then, and so that a failed inbox write can never delay or block the notification.

The routing decision is a **pure function**, `chooseChannel({ tokenCount, pushResult })`, and is
unit-tested separately from any sending. `sendPush` changes from returning nothing to returning
`{ accepted, deadTokens, failed }`, so the caller can decide. It currently logs ticket errors and
discards them.

Call sites moved behind `deliver()`: `deliverTodoReminder` and `deliverEventReminder` in
`delivery.js`; the crons `morning`, `evening`, `nudge`, `goal`, `pulse`, `weekly`; and
`src/scheduler/briefs.js` on the Express path. The Express path is not the deployed one, but a
copy that bypasses `deliver()` is how the three reminder paths drifted before `delivery.js`
existed. The morning brief's push stops being the generic "Tap to see context" and carries the
start of the actual brief.

Inbound WhatsApp is unchanged: a message sent to the agent on WhatsApp is still answered on
WhatsApp.

### 3. Storage

Migration step **11c**, created before the `OWNED` loop for the same reason as step 11b
(`classifier_corrections`): that loop `ALTER`s every owned table to add `user_id`, so an owned
table must already exist when it runs.

```sql
CREATE TABLE IF NOT EXISTS inbox_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL,
  title      TEXT,
  body       TEXT NOT NULL,
  channel    TEXT NOT NULL,          -- 'push' | 'whatsapp' | 'failed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inbox_created ON inbox_messages (created_at DESC);
```

`inbox_messages` is added to `OWNED` in **both** `src/migrate_db.js` and
`test/schema.scoping.test.js`, which asserts the two lists are equal. New queries are covered by
the existing `schema.scoping` and `schema.params` guards.

### 4. App (`mobile/`)

- **Build.** `eas init` replaces the placeholder `projectId`. `app.json` gains
  `android.package: "com.tarunsitaraman.blumobile"`. Add `eas.json` with a `development` profile
  (`expo-dev-client`, for iterating) and a `preview` profile (an installable APK for daily use).
- **Auth.** On first launch, if no token is stored, show a token screen. Validate the token with
  `GET /dashboard/api/auth/verify` (exists), store it with `expo-secure-store`, and send it as
  `Authorization: Bearer` on every request. `EXPO_PUBLIC_API_TOKEN` is removed;
  `EXPO_PUBLIC_API_BASE` stays, since a base URL is not a secret.
- **Push registration.** After sign-in, request notification permission, call
  `getExpoPushTokenAsync({ projectId })`, and `POST /dashboard/api/push/register`. Re-register
  on each launch; `savePushToken` is idempotent.
- **Chat.** `chat()` moves from `/api/chat` to `/dashboard/chat`. The Chat screen loads history
  from `/dashboard/api/messages` on open, so briefs and reminders appear in the thread the way
  they do in WhatsApp today. Proactive messages render visually distinct from replies.
- **Notification tap.** Opens the Chat screen, scrolled to that message. Action buttons are B.
- **Android 16.** Confirm at build time that the build targets API 36, and that every screen
  handles edge-to-edge layout with `react-native-safe-area-context` (already a dependency).
  These are verification steps, not assumptions.

### 5. One-time setup by Tarun

1. Create a free Expo account (Google sign-in works), then in `mobile/`:
   - `eas login --browser` — opens expo.dev in the browser for sign-in, so no password is typed
     into the terminal. Run it in Tarun's own session (`!` prefix in the Claude Code prompt): the
     browser flow cannot be driven from a non-interactive agent shell.
   - `eas init` — creates the EAS project and writes the real `projectId`.
   - Optional: `npm install -g eas-cli` first. The installed version works but is behind 24.3.0.
2. Create a Firebase project, add an Android app with package `com.tarunsitaraman.blumobile`, and
   upload the FCM V1 service-account key via `eas credentials`. Expo's push service delivers to
   Android through FCM.
3. Install the `preview` APK and paste the dashboard token into the app's first screen.

## Error handling

- The inbox write happens after sending, so it cannot delay or block delivery. If it fails, log
  it: losing the in-app copy is recoverable, losing the notification itself is not.
- A push failure falls back to WhatsApp (step 3 above). If WhatsApp also fails, log both errors
  and still write the inbox row with `channel = 'failed'`, so the message is visible in the app.
  The cron's existing per-user `forEachUser` isolation keeps one user's failure from affecting
  others.
- Token entry: an invalid token shows an error on the setup screen and is not stored.
- A 401 from any request clears the stored token and returns the app to the token screen, so a
  rotated token doesn't leave the app silently broken.

## Testing

Server (`node --test`, no new dependencies):
- `chooseChannel`: no tokens → WhatsApp; tokens accepted → push; all tokens dead → WhatsApp;
  request failed → WhatsApp.
- `deliver()` with `sendPush` and the WhatsApp sender mocked: writes the inbox row with the channel
  that actually delivered (including `failed` when both channels fail); prunes dead tokens; the
  fallback uses the WhatsApp buttons; an inbox write failure does not throw out of `deliver()`;
  push text strips markup and truncates.
- `tokenMiddleware`: header token, query token, header taking precedence, missing token → 401.
- `/messages`: merge order, `before`/`limit` pagination, the limit cap, scoped to the caller.
- The existing schema guards cover the new table and queries.

App: `mobile/` has no test runner, and adding one is out of scope. Verification is the on-device
checklist below.

## Success criteria

- A reminder that comes due while the app is installed arrives as an **app notification and not
  on WhatsApp**, and its text is in the app's chat thread.
- The morning brief's full text is readable in the app, not just a "tap to see" stub.
- After the app is uninstalled, the next reminder arrives on **WhatsApp** and the dead token is
  gone from storage.
- The APK contains no credential: `EXPO_PUBLIC_API_TOKEN` is absent from the build.
- The Vercel function count does not go up. After `api/chat.js` and `api/todos.js` are retired
  it drops by two.
- `npm test` passes and `npm run eval` still reports 23/23; nothing in A touches classification.

## Out of scope for A

Done/Snooze notification actions (B). Home-screen widgets (C). Voice capture and share-to-agent
(D). Changes to how inbound WhatsApp messages are handled. Retiring WhatsApp.

## Open questions

- **Deferred to C:** the widget reads its data in a background task outside the app's UI. Whether
  `expo-secure-store` is readable from that context decides how the widget authenticates. It does
  not affect A.
- **Accepted risk:** Expo reports some delivery failures only in push *receipts*, fetched
  asynchronously, not in the immediate tickets. A has no receipt polling, so a push Expo accepted
  but FCM later dropped does not fall back to WhatsApp. The inbox row still exists, so the message
  is visible in the app, just not notified. Revisit if it happens in practice.
