# CallLog

Admin-only app for logging client phone calls and tracking each client through a sales/service pipeline.

- **API**: Cloudflare Workers + Hono + D1 (`apps/api`)
- **Web**: React + Vite + Tailwind on Cloudflare Pages (`apps/web`)
- **Shared**: status enum, zod schemas, phone normalization (`packages/shared`)

The browser only talks to the Pages domain. A Pages Function (`apps/web/functions/api/[[path]].ts`)
forwards `/api/*` to the Worker through a service binding, so the session cookie is first-party and
no CORS is needed.

Requires Node 20+ (developed on Node 22/23).

## Local development

```bash
npm install
npm run db:migrate:local -w @calllog/api                 # create the local D1 tables
npm run create-admin -w @calllog/api -- --email you@example.com --password 'at-least-10-chars' --name 'Your Name'
npm run seed -w @calllog/api                             # optional: 18 demo clients
npm run dev                                              # Worker on :8787 + Vite on :5173
```

Open http://localhost:5173. Vite proxies `/api` to the Worker.

Local data lives in `apps/api/.wrangler/`. To reset: delete that folder and rerun the steps above.

## Creating admins

There is no sign-up page. Create admins from the command line:

```bash
# local D1
npm run create-admin -w @calllog/api -- --email a@b.com --password '...' --name 'Name'
# production D1
npm run create-admin -w @calllog/api -- --email a@b.com --password '...' --name 'Name' --remote
```

Admins can change their own password at `/change-password`.

## Checks

```bash
npm run lint
npm run typecheck
npm test            # shared + API (Vitest + workers pool) + web (Vitest + Testing Library)
npm run build       # production build of the web app
```

## Deploying to Cloudflare

Everything runs on Cloudflare: the API as a **Worker**, the frontend on **Pages**.
Do steps 1-5 once; after that, pushing to `main` deploys automatically (step 6).

### 1. Log in to Cloudflare

```bash
npx wrangler login
```

### 2. Create the production database

```bash
npx wrangler d1 create calllog-db
```

Copy the printed `database_id` into `apps/api/wrangler.toml` (replace the all-zero placeholder)
and commit it. The id is an identifier, not a secret.

### 3. Apply migrations and create the first admin (remote)

```bash
npm run db:migrate:remote -w @calllog/api
npm run create-admin -w @calllog/api -- --email you@example.com --password '...' --name 'Your Name' --remote
```

### 4. Deploy the API Worker first

```bash
npm run deploy:api
```

The Pages project binds to this Worker (`calllog-api`), so it must exist before Pages is deployed.

### 5. Create and deploy the Pages project

```bash
npx wrangler pages project create calllog-web --production-branch main   # once
npm run deploy:web
```

The service binding (`API` -> `calllog-api`) is read from `apps/web/wrangler.toml`.
Your app is then live at `https://calllog-web.pages.dev`.

### 6. Automatic deploys (GitHub Actions)

Add two repository secrets (Settings -> Secrets and variables -> Actions):

| Secret                  | Where to get it                                                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard -> Workers & Pages -> right sidebar                                                                                                       |
| `CLOUDFLARE_API_TOKEN`  | My Profile -> API Tokens -> Create Token -> "Edit Cloudflare Workers" template, then add **Account -> D1 -> Edit** and **Account -> Cloudflare Pages -> Edit** |

- `.github/workflows/ci.yml`: lint, typecheck, tests and build on every pull request.
- `.github/workflows/deploy.yml`: on push to `main`, runs tests, applies remote migrations, deploys the
  Worker, then deploys Pages. Migrations run first so new code never meets an old schema.

### Notes

- Nothing secret is committed. `apps/api/.dev.vars.example` is a template for local-only variables.
- **Password hashing** uses PBKDF2-SHA256 at 100,000 iterations, the maximum Cloudflare Workers allows.
- **Cookies** are `HttpOnly; SameSite=Strict`, and `Secure` on every host except localhost.
- **wrangler** is pinned to 3.x because `@cloudflare/vitest-pool-workers` 0.8.x targets it.
- **Custom domain**: attach it to the Pages project (Workers & Pages -> calllog-web -> Custom domains).
  The Worker needs no public route of its own; it is only reached through the service binding.
