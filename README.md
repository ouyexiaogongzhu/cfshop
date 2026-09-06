# cfshop

Cloudflare-native commerce monorepo: Workers + Hono API (`worker/`), Next.js storefront (`apps/storefront/`), D1 + R2 + KV + Queues + Durable Objects. Runs fully locally on the Cloudflare free tier via `wrangler dev`; no cloud resources are required for development.

## Worker

```sh
pnpm install
pnpm db:migrate:local   # apply D1 migrations (local Miniflare state)
pnpm db:seed            # load seed.sql
pnpm --filter @cfshop/worker dev     # http://localhost:8787/api/health
pnpm --filter @cfshop/worker test    # vitest + @cloudflare/vitest-pool-workers (real workerd, local bindings)
pnpm --filter @cfshop/worker typecheck
```
