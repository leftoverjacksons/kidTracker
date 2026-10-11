# kidTracker

A minimal shared baby tracker for two caregivers: sleep, nursing, bottle, diaper, pumping, medicine, temperature, growth, tummy time, and bath. The data is yours, in your own Postgres database.

- Design: [docs/DESIGN.md](docs/DESIGN.md)
- First-time setup (Supabase + GitHub Pages + phones): [SETUP.md](SETUP.md)

## Status

Phase 0 (app shell, sign-in, database schema) is complete. Logging screens arrive in Phase 1.

## Development

```bash
npm install
cp .env.example .env.local    # fill in Supabase URL + anon key
npm run dev                   # local dev server
npm test                      # unit tests
npm run build                 # production build → dist/
supabase/tests/run.sh         # database tests (needs a local Postgres)
```

Stack: React + Ionic + TypeScript (Vite, PWA) · Supabase (Postgres, Auth, Realtime) · GitHub Pages.
