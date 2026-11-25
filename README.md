# Wishly

Gift ideas and wish lists. Static site plus a JSON API, all on one Cloudflare Worker with D1.

## Structure
- `public/` static site (index.html, app.js, styles.css), served by Workers Assets with SPA fallback
- `src/index.js` the Worker: all `/api/*` routes
- `schema.sql` D1 tables
- `wrangler.toml` config

## Run locally
    npm install
    npx wrangler d1 create wishly      # copy the database_id into wrangler.toml
    npm run db:local
    npm run dev

## Deploy
    npm run db:remote
    npm run deploy

## API
POST /api/signup, /api/login, /api/logout · GET /api/me
GET, POST /api/lists · GET /api/lists/:slug · POST /api/lists/:slug/items
DELETE /api/items/:id · POST, DELETE /api/items/:id/claim

Owners never see which items are claimed. Anyone can claim without an account (tracked by an anonymous cookie).
