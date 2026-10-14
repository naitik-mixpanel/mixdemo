# MixDemo shopping assistant — Worker

Cloudflare Worker behind the floating chat widget (`assets/agent.js`). It holds the
model key, pins the system prompt and the 7 allowed tools (`src/agent.js`), validates
every request, calls Claude, and sends OpenTelemetry spans to Mixpanel Agent
Intelligence (`src/telemetry.js`).

Requires Node 22+ (`nvm use` picks it up from `.nvmrc`).

## Configure

| Setting | Where | Notes |
|---|---|---|
| `LLM_API_KEY` | secret: `npx wrangler secret put LLM_API_KEY` | Anthropic key or LiteLLM virtual key. Never commit it. |
| `LLM_BASE_URL` | `wrangler.toml` | Empty = Anthropic directly. LiteLLM base URL to route through the gateway (must be reachable from the public internet). |
| `MODEL` | `wrangler.toml` | `claude-haiku-5-5` |
| `ALLOWED_ORIGINS` | `wrangler.toml` | Sites allowed to call the Worker. |
| `MIXPANEL_TOKEN`, `MIXPANEL_OTEL_URL` | `wrangler.toml` | US ingestion endpoint. |

## Run locally

```bash
cp .dev.vars.example .dev.vars   # then put the key in .dev.vars
npm install
npm run dev                      # http://localhost:8787/chat
```

The site on `http://localhost:8765` talks to `localhost:8787` automatically.

## Deploy

```bash
npm run deploy
```

Then put the printed URL (plus `/chat`) in `AGENT_PROD_URL` in `assets/agent.js`.
Until that's set, the widget stays hidden on the live site.

## Guardrails

- Tools are defined here only; history naming any other tool is rejected.
- No `system` messages from the browser; only text/tool blocks pass validation.
- 20 typed messages per conversation, 1,000 characters each, 6 model calls per turn.
- 20 requests per minute per IP (`RATE_LIMITER`), CORS allowlist, 4,096 max output tokens.
- No tools to place orders, enter payment or apply coupons.
