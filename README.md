# InviteMe — RSVP Server

The backend behind the InviteMe invitation sites. It receives guest RSVPs, stores them
in **MongoDB Atlas**, and serves the admin + per-event client dashboards.
**Node + Express + TypeScript.**

See **[PLAN.md](PLAN.md)** for the design and **[SECURITY.md](SECURITY.md)** for what's
protected and the go-live checklist.

## Setup

```bash
npm install
cp .env.example .env       # then fill in the values (see below)
npm run migrate:mongo      # optional: import an existing data/db.json into Atlas
npm run seed               # create the admin login from .env
npm run db:show            # confirm what's in the database (no secrets shown)
```

## Environment (`.env`)

| Key | What |
|---|---|
| `MONGODB_URI` | Atlas connection string — **secret** (contains the DB password) |
| `MONGODB_DB` | database name (default `inviteme`) |
| `JWT_SECRET` | long random string used to sign login cookies (32+ chars) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | the single admin login |
| `DASHBOARD_ORIGIN` | the dashboard's URL (CORS + cookie) |
| `INTAKE_ALLOWED_ORIGINS` | invitation-site origin(s) allowed to POST RSVPs (comma-separated, no trailing slash) |
| `NODE_ENV` | `development` or `production` (prod turns on Secure cookies + HSTS) |
| `CLIENT_DIST` | optional: path to the client's built `dist/` for single-origin hosting |

## Run

```bash
npm run dev      # tsx watch → http://localhost:4100
npm run build    # tsc → dist/
npm start        # node dist/index.js (production)
```

## API overview

| | |
|---|---|
| `GET /api/health` | liveness check |
| `POST /api/auth/login` · `/logout` · `GET /api/auth/me` | auth (httpOnly cookie) |
| `GET/POST/PATCH/DELETE /api/events…` | admin: events, answers, CSV, token rotation |
| `GET /api/my/…` | client portal (read-only, scoped to their event) |
| `POST /api/intake/:token` | **public** — invitation sites post guest RSVPs here |

`InviteMe.postman_collection.json` in this repo exercises the whole API.

> The **dashboard client** lives in its own repository.
