# Brielle's Loop

Local-first learning app scaffold for Brielle's Loop.

## Prerequisites

- Node.js 20 or newer
- Docker (for local Supabase services)
- Supabase CLI

## Getting Started

1. Copy environment variables:
   - `cp .env.example .env`
2. Install dependencies from the monorepo root:
   - `npm install`
3. Start frontend development server:
   - `npm run dev --workspace frontend`
4. Start backend development server:
   - `npm run dev --workspace backend`
5. (Optional, when ready for database work) start local Supabase stack:
   - `supabase start`

## Workspaces

- `frontend` — Vite + React 18 app
- `backend` — Node.js + Express API server
