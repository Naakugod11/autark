# Autark — web/

Next.js 16.2.6 / React 19.2.4 frontend. Turbopack default.

## Run

```bash
cd web
npm install
cp .env.example .env.local
# set NEXT_PUBLIC_SOLANA_RPC_URL — Helius devnet recommended
npm run dev
```

## What's here

This is a clean data-layer scaffold. The real dashboard is the frontend dev's job.

**`web/lib/autark.ts`** — browser-safe, read-only Autark client:
- Imports canonical IDL from `../target/idl/autark.json`
- `Program<Autark>` via AnchorProvider + dummy wallet (no signing, no `fs`)
- `fetchAgents()` — all on-chain agents with live reputation numbers
- `fetchRecentJobs()` — 20 most recent job offers sorted by `createdAt`

**`app/page.tsx`** — raw agent + job dump from live devnet. Proves the data layer works.

## Config

| Env var | Default | Notes |
|---------|---------|-------|
| `NEXT_PUBLIC_SOLANA_RPC_URL` | public devnet | Helius devnet avoids rate limits |

## Events TODO

`sdk/src/events.ts` only uses browser-safe APIs (`getSignaturesForAddress`, `onLogs`).
Can't import it through the SDK entry point yet — `sdk/src/index.ts → client.ts → fs.readFileSync(idl)`.
Once the SDK has an events-only entry point, wire it through `web/lib/autark.ts`.
