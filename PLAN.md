# RSVP Answer-Control System — Phase 0 Plan

> Status: **awaiting your "next"**. No app code written yet.
>
> Decisions locked in Phase 0:
> - **Storage:** plain JSON file on disk (no external database, no Prisma)
> - **Intake:** answers posted **straight from the guest's browser**

---

## 1. What this app is (and is not)

**Is:** the back office behind your existing invitation website.
- Receives guest answers sent in by your invitation site → saves them.
- Admin (you) logs in → sees/manages every event and every answer.
- Client (one per event) logs in → sees only their own event's answers, read-only.

**Is not:** it never shows invitations, and guests never open it or have accounts.

```
  Guest fills RSVP on                   This app (SystemUI)
  your invitation site                  ┌────────────────────────────┐
         │                              │                            │
         └────── POST (direct) ───────▶ │  /api/intake/:intakeToken  │
                                        │           ↓ saves Answer   │
                                        │  ┌──────────────────────┐  │
   You (admin) ─────── login ─────────▶ │  │  server/data/db.json │  │
                                        │  └──────────────────────┘  │
   Client ──────────── login ─────────▶ │  read-only, own event only │
                                        └────────────────────────────┘
```

---

## 2. Folder layout

```
D:\Wedding\SystemUI\
├─ PLAN.md                      ← this file
├─ README.md                    ← written in Phase 9
├─ .gitignore
│
├─ server/                      ← the backend (Node + Express + TypeScript)
│  ├─ data/
│  │  ├─ db.json                ← THE DATABASE. One file. Readable in Notepad.
│  │  ├─ db.json.bak            ← last known-good copy, kept automatically
│  │  └─ .gitignore             ← never commit real guest data
│  ├─ src/
│  │  ├─ index.ts               ← starts the server
│  │  ├─ env.ts                 ← reads + validates .env, fails loudly if missing
│  │  ├─ store/
│  │  │  ├─ file.ts             ← safe load/save of db.json (section 4)
│  │  │  ├─ types.ts            ← the shape of the data (section 3)
│  │  │  └─ index.ts            ← THE ONLY module that touches data (section 5)
│  │  ├─ seed.ts                ← creates the one admin from .env
│  │  ├─ auth/
│  │  │  ├─ jwt.ts              ← sign/verify the login token
│  │  │  ├─ middleware.ts       ← requireAdmin / requireClient guards
│  │  │  └─ routes.ts           ← POST /login, POST /logout, GET /me
│  │  ├─ events/
│  │  │  ├─ routes.ts           ← admin CRUD + rotate intake token
│  │  │  └─ fieldSchema.ts      ← Zod rules for the custom-field definitions
│  │  ├─ answers/
│  │  │  ├─ routes.ts           ← list + summary + CSV (admin and client)
│  │  │  └─ csv.ts
│  │  ├─ intake/
│  │  │  ├─ routes.ts           ← POST /api/intake/:intakeToken  (flexible)
│  │  │  └─ captcha.ts          ← stub, ready for a real captcha later
│  │  └─ lib/
│  │     ├─ sanitize.ts         ← trims/caps/strips incoming values
│  │     └─ errors.ts           ← generic error responses, no internals leaked
│  ├─ .env.example
│  ├─ package.json
│  └─ tsconfig.json
│
└─ client/                      ← the dashboard UI (React + Vite)
   ├─ src/
   │  ├─ main.tsx
   │  ├─ App.tsx                ← routes + role-based redirects
   │  ├─ api.ts                 ← fetch wrapper, always sends the cookie
   │  ├─ auth.tsx               ← "who am I" context
   │  ├─ pages/
   │  │  ├─ Login.tsx
   │  │  ├─ AdminEvents.tsx         ← list of all events
   │  │  ├─ AdminEventEdit.tsx      ← create/edit event + FORM BUILDER
   │  │  ├─ AdminEventAnswers.tsx   ← answers table, dynamic columns
   │  │  └─ ClientDashboard.tsx     ← read-only version of the above
   │  └─ components/
   │     ├─ FieldBuilder.tsx    ← add/remove/reorder custom fields
   │     ├─ AnswersTable.tsx    ← builds its columns from the field schema
   │     ├─ Summary.tsx         ← counts per field type
   │     └─ TokenBox.tsx        ← copyable intake token + rotate button
   ├─ .env.example
   ├─ package.json
   ├─ vite.config.ts
   └─ tsconfig.json
```

Two separate npm projects, started in two terminals.

### Ports — important

`D:\Wedding\DataBUI` is your existing **invitation platform**, and it already uses
ports 4000 and 5173. Both projects need to run at the same time (that is how RSVPs
reach this app), so SystemUI deliberately sits out of its way:

| | DataBUI (invitation site) | SystemUI (this app) |
|---|---|---|
| Backend / API | `http://localhost:4000` | `http://localhost:4100` |
| Frontend | `http://localhost:5173` | `http://localhost:5273` |

That is also why `INTAKE_ALLOWED_ORIGINS` is set to `http://localhost:5173` — the
invitation site is the one thing allowed to post RSVPs here.

---

## 3. The data — what `db.json` looks like

One file holds everything. Here is a realistic example with one event, its client
login, and one answer:

```json
{
  "version": 1,
  "users": [
    {
      "id": "u_8f3k2m",
      "username": "admin",
      "passwordHash": "$2b$12$Xq...",
      "role": "admin",
      "eventId": null,
      "createdAt": "2026-07-22T10:00:00.000Z"
    },
    {
      "id": "u_p91xd4",
      "username": "beridze_wedding",
      "passwordHash": "$2b$12$Lm...",
      "role": "client",
      "eventId": "e_a7c4n2",
      "createdAt": "2026-07-22T10:05:00.000Z"
    }
  ],
  "events": [
    {
      "id": "e_a7c4n2",
      "name": "Nino & Giorgi Wedding",
      "type": "wedding",
      "eventDate": "2026-09-12T00:00:00.000Z",
      "intakeToken": "itk_9Kd2mZ7qR4pL8vX1nB6tW3sY5hJ0gF",
      "fieldSchema": [
        { "key": "full_name",   "label": "Full name",       "type": "text",     "required": true },
        { "key": "attending",   "label": "Attending?",      "type": "yesno",    "required": true },
        { "key": "guest_count", "label": "How many guests", "type": "number",   "required": false },
        { "key": "meal_choice", "label": "Meal choice",     "type": "dropdown", "required": true,
          "options": ["Chicken", "Fish", "Vegetarian"] }
      ],
      "createdAt": "2026-07-22T10:05:00.000Z"
    }
  ],
  "answers": [
    {
      "id": "a_3nq8wz",
      "eventId": "e_a7c4n2",
      "values": {
        "full_name": "Nino Beridze",
        "attending": "yes",
        "guest_count": 2,
        "meal_choice": "Fish",
        "preferred_song": "Suliko"
      },
      "submittedAt": "2026-07-22T11:14:33.000Z"
    }
  ]
}
```

In TypeScript (`src/store/types.ts`):

```ts
export type Role      = 'admin' | 'client';
export type EventType = 'birthday' | 'wedding' | 'corporate' | 'other';
export type FieldType = 'text' | 'yesno' | 'number' | 'dropdown';

export interface FieldDef {
  key: string;          // auto-made from label: "Meal choice" -> "meal_choice"
  label: string;        // what you type, and what the column header shows
  type: FieldType;
  required: boolean;
  options?: string[];   // dropdown only
}

export interface User {
  id: string;
  username: string;
  passwordHash: string; // bcrypt — never a plain password
  role: Role;
  eventId: string | null;  // set for clients only; exactly one client per event
  createdAt: string;       // ISO date string
}

export interface EventRecord {
  id: string;
  name: string;
  type: EventType;
  eventDate: string;
  intakeToken: string;     // long random secret; your invitation site sends this
  fieldSchema: FieldDef[]; // the custom form for THIS event
  createdAt: string;
}

export interface Answer {
  id: string;
  eventId: string;
  values: Record<string, unknown>; // whatever arrived — defined fields AND extras
  submittedAt: string;
}

export interface Database {
  version: number;
  users: User[];
  events: EventRecord[];
  answers: Answer[];
}
```

**Deliberately NOT here:** any per-event table or per-event file. There is one
`answers` array for all events, forever. See section 6.

---

## 4. How the JSON file stays safe

You picked the JSON file knowing I'd flagged corruption risk. Here's how that gets
handled, and what limits genuinely remain.

**Handled:**

| Risk | Fix |
|------|-----|
| Two answers arrive at the same instant and interleave their writes | All writes go through a **write queue** — one at a time, in order. Node runs one thread, so this is airtight within one server process. |
| Power cut / crash halfway through writing → half a file | Write to `db.json.tmp`, flush it to disk, then **rename** it over `db.json`. Renaming is a single instant operation — the file is either fully old or fully new, never half. |
| File somehow ends up unreadable | The previous good copy is kept as `db.json.bak` before each write. On startup, if `db.json` won't parse, the server **refuses to start** and tells you to restore the `.bak` — it will never quietly start with an empty database and lose your answers. |
| Accidentally committing guest data to git | `server/data/.gitignore` ignores everything in that folder. |

**Genuinely remaining limits (accept these knowingly):**

1. The whole database is held in memory and rewritten on every change. Comfortable to
   a few thousand answers; noticeably slow in the tens of thousands.
2. Only **one** server process may run at a time. Two would overwrite each other.
3. No migration history. If the shape changes later, the `version` number triggers a
   small upgrade function — manual, but simple.
4. **Backup = copy `db.json` somewhere else.** Nothing does this for you. I'll put it
   in the README.

---

## 5. The one-file swap promise

Every piece of data access in the whole app goes through `src/store/index.ts`, and
every function there is `async` even though the JSON file doesn't need it:

```ts
// src/store/index.ts — the ONLY module that knows data lives in a JSON file
export async function getUserByUsername(username: string): Promise<User | null>
export async function getEventByToken(token: string):     Promise<EventRecord | null>
export async function listEvents():                       Promise<EventRecord[]>
export async function createAnswer(eventId, values):      Promise<Answer>
export async function listAnswers(eventId: string):       Promise<Answer[]>
// ...etc
```

Routes call `store.listAnswers(id)` and know nothing about files. When you're ready
for SQLite or PostgreSQL, that one file is rewritten to talk to a real database and
**no other file changes**. Making them `async` now is what buys that.

---

## 6. How custom fields work, end to end

### Step 1 — You define the fields (admin, Phase 4)

In the form builder you add rows. Each row = one question on the RSVP form. Saved into
`event.fieldSchema` (see the JSON in section 3).

`key` is generated automatically from `label` ("Meal choice" → `meal_choice`) so your
invitation site has a stable, predictable name to send. You type the label; the key is
made for you.

### Step 2 — An answer arrives (intake, Phase 5)

Your invitation site's page POSTs whatever it collected:

```json
{
  "full_name": "Nino Beridze",
  "attending": "yes",
  "guest_count": 2,
  "meal_choice": "Fish",
  "preferred_song": "Suliko"      ← NOT in the schema above
}
```

The whole object is sanitized and saved into `answer.values` **as-is**.
`preferred_song` is kept, not thrown away. Nothing is ever rejected for being
unexpected — that's the "flexible intake" rule.

Flexible still has hard limits: max payload size, max number of fields, max length per
value, rate limits per token and per IP.

### Step 3 — The dashboard displays it (Phases 6 & 7)

The table asks the event *"what are your fields?"* and builds one column per entry in
`fieldSchema`, in your chosen order, using your labels:

| Full name     | Attending? | How many guests | Meal choice | Extra |
|---------------|-----------|-----------------|-------------|-------|
| Nino Beridze  | yes       | 2               | Fish        | 1 ▸   |

Clicking **Extra** shows `preferred_song: Suliko`. Anything that arrived outside the
schema lands there. CSV export includes both the defined columns and the extras.

Summaries adapt to the field type automatically:
- `yesno` → yes / no / maybe totals
- `number` → sum and average
- `dropdown` → count per option
- `text` → response count only

### Why this instead of a file or table per event

To you and your clients it *looks* like every event has its own custom database. But
one shared list means one query path and one single place to enforce "clients only see
their own event." A structure-per-event design would mean building storage shapes out
of user-typed input, and would break every time you edited a field. Same result, far
less risk.

---

## 7. Intake security — because the token is public

You chose **browser-direct** intake. That means the `intakeToken` has to sit in your
invitation site's page source, where anyone can view-source and copy it. That is a real
exposure, so the intake endpoint is built defensively:

| Defence | What it does |
|---------|--------------|
| **CORS allow-list** | Only pages served from domains you list in `INTAKE_ALLOWED_ORIGINS` can post from a browser. Not bulletproof (CORS is enforced by browsers, not by curl) but it stops casual embedding. |
| **Honeypot field** | A field bots fill in but humans never see. If it's filled, the server replies `200 OK` and silently discards — so bots never learn they were caught. |
| **Rate limit per token** | Caps how many answers one event can receive per minute. |
| **Rate limit per IP** | Caps how many one visitor can send per minute. |
| **Payload size cap** | Request body limited (e.g. 32 KB). Oversized = rejected. |
| **Field count + length caps** | Max number of fields and max characters per value. |
| **Token rotation** | One click on the event page issues a new token and instantly kills the old one. If you ever get spammed, rotate and update your invitation site. |
| **Captcha slot** | `intake/captcha.ts` is a stub that always passes today. Dropping in Cloudflare Turnstile or hCaptcha later means editing that one file. |
| **Generic rejections** | An unknown or rotated token gets the same bland response as a valid one. No confirming which tokens exist. |

**Two separate CORS policies**, which is the important part:

- `/api/intake/*` → open to your invitation site's domains, **no cookies allowed**.
- everything else → locked to the dashboard origin only, **cookies allowed**.

This means a hostile page can post an RSVP, but can never reach admin endpoints or
ride along on your login session.

---

## 8. Rules held for the whole build

- Secrets only in `.env`; `.env.example` stays current; real `.env` never committed.
- Passwords: bcrypt hashes only, never plain text, never reversible.
- The logged-in user's event is read from the server-side session, never from anything
  the browser sends.
- Errors are generic: "Invalid credentials", "Not found". No stack traces, no hints
  about whether a username or event exists.
- All data access goes through `src/store/index.ts`. Nothing else touches the file.
- Custom fields = schema on the event + JSON values on each answer. Never per-event
  storage structures.
- No guest-facing pages and no invitation-creation features in this app.

---

## 9. Phase checklist

| Phase | What | Status |
|-------|------|--------|
| 0 | Setup & confirm the plan | ✅ done |
| 1 | Project skeleton, both apps start | ✅ done |
| 2 | JSON store + admin account | ✅ done |
| 3 | Login system | ✅ done |
| 4 | Events + custom form builder | ✅ done |
| 5 | Intake endpoint (browser-direct) | ✅ done |
| 6 | Admin answers dashboard | ✅ done |
| 7 | Client dashboard (read-only, scoped) | ✅ done |
| 8 | Security hardening pass | ✅ done |
| 9 | README & handoff | ✅ done |
