# kidTracker

A minimal shared baby tracker for two caregivers: sleep, nursing, bottle, diaper, pumping, medicine, temperature, growth, tummy time, and bath. The data is yours, in your own Postgres database.

- Design: [docs/DESIGN.md](docs/DESIGN.md)
- First-time setup (Supabase + GitHub Pages + phones): [SETUP.md](SETUP.md)

## Status

Working: logging for all categories, shared timers (sleep, nursing, pumping, tummy time), History with edit/delete, live sync between phones, Reports (charts, WHO growth percentiles, CSV, printable pediatrician summary), and nightly backups to Google Drive with a Google Sheet mirror. Next: offline queue (Phase 3) and polish from real use.

## Development

```bash
npm install
cp .env.example .env.local    # fill in Supabase URL + anon key
npm run dev                   # local dev server
npm test                      # unit tests
npm run build                 # production build → dist/
supabase/tests/run.sh         # database tests (needs a local Postgres)
npm run e2e                   # two-phone end-to-end test (Postgres + PostgREST + Playwright)
backup/test/run.sh            # backup script + restore round trip
```

Stack: React + Ionic + TypeScript (Vite, PWA) · Supabase (Postgres, Auth, Realtime) · GitHub Pages.
