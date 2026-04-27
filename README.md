# Brielle's Loop

Local-first learning app scaffold for Brielle's Loop.

## Current stack

- Monorepo with npm workspaces: `frontend` + `backend`
- Frontend: Vite + React 18 (`http://localhost:5173`)
- Backend: Node.js + Express (`http://localhost:3001`)
- Database: Supabase local Postgres (`localhost:54322`)
- Data flow reference: `DATA_FLOW_DIAGRAM.md`

## Prerequisites

- Node.js 20+
- npm 10+
- Docker (required for local Supabase services)
- Supabase CLI

## Environment setup

The backend reads environment variables from the **root** `.env` file.

1. Create your env file:
   - `cp .env.example .env`
2. Add required values:
   - `DATABASE_URL`
   - `ANTHROPIC_API_KEY`
   - `ANTHROPIC_MODEL` (optional, defaults exist in code)
3. Optional backend values:
   - `PORT` (defaults to `3001`)
   - `ANTHROPIC_TIMEOUT_MS`

Do not commit `.env` files or API keys.

## Install dependencies

From the repository root:

- `npm install`

## Run locally

Start each service in its own terminal from the repository root:

1. Frontend:
   - `npm run dev:frontend`
2. Backend:
   - `npm run dev:backend`
3. Supabase (for DB + auth + local API):
   - `supabase start`

## Useful scripts

From repo root:

- `npm run dev:frontend` - start frontend dev server
- `npm run dev:backend` - start backend dev server
- `npm run build` - build frontend

From `backend`:

- `npm run test` - run backend tests (Vitest)

## Quick health checks

- Backend health endpoint: `GET http://localhost:3001/api/health`
- Supabase API: `http://localhost:54321`
- Supabase Studio: `http://localhost:54323`

## Project structure

- `frontend` - React app and route UI
- `backend` - Express API, queue builder, AI + export routes
- `supabase` - local Supabase config + SQL migrations
- `docs` - product and implementation documentation

## API route groups (backend)

- `/api/session/*`
- `/api/items/*`
- `/api/ai/*`
- `/api/dashboard/*`
- `/api/agents/*`
- `/api/export/*`
