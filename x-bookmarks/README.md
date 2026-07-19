# X Bookmarks Reader

A small local web app that reads your X (Twitter) bookmarks. It logs you in
with your own X account via OAuth 2.0, syncs all your bookmarks through the
official X API, caches them on your machine, and gives you a fast reader UI
with search, author filtering, and sorting.

- **Zero dependencies** — just Node.js 18+ (no `npm install`).
- **Local & private** — bookmarks and tokens are stored only in `x-bookmarks/data/`
  on your machine (git-ignored).
- **Import/Export** — export your bookmarks to JSON, or import a previously
  exported file / raw X API responses without connecting an account.

## Why an X developer app is required

X only exposes bookmarks through its official API v2 (`bookmark.read` OAuth
scope) — there is no public feed or archive export for bookmarks. So you need
a (free to create) X developer app to authorize against. Note that X's API
tiers change often: reading bookmarks requires a tier that includes read
access to the bookmarks endpoints, and the free tier's read limits are very
restrictive. Check the current limits at https://developer.x.com/en/portal/products.

## Setup

1. **Create an X developer app** at https://developer.x.com/en/portal/dashboard
   (create a Project + App if you don't have one).
2. In the app's **User authentication settings**, enable OAuth 2.0:
   - Type of App: **Web App, Automated App or Bot** (confidential client) or
     **Native App** (public client) — both work.
   - **Callback URI**: `http://localhost:8787/auth/callback`
   - **Website URL**: anything (e.g. your GitHub profile).
3. Copy the **OAuth 2.0 Client ID** (and the Client Secret, if you chose the
   confidential client type).
4. Create `x-bookmarks/.env`:

   ```ini
   X_CLIENT_ID=your_client_id_here
   # Only needed for confidential ("Web App") clients:
   # X_CLIENT_SECRET=your_client_secret_here
   # PORT=8787
   ```

## Run

```sh
cd x-bookmarks
node server.mjs
```

Open http://localhost:8787, click **Connect X account**, authorize, then hit
**Sync**. Bookmarks are fetched 100 at a time and merged into the local cache,
so re-syncing only adds new ones. If you hit an API rate limit mid-sync, the
app keeps what it got — just press Sync again later for the rest.

## Using it without API access

If you can't (or don't want to) use the X API, the **Import** button accepts:

- a JSON file previously exported from this app (**Export** button), or
- raw X API v2 bookmark responses (a single `{ "data": [...], "includes": ... }`
  page, or an array of pages) captured by any other means you have access to.

## Data & privacy

- `data/tokens.json` — your OAuth tokens (file mode 600). Delete it or use
  logout to disconnect.
- `data/bookmarks.json` — your cached bookmarks.

Both live only on your machine and are excluded from git.
