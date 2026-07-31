# Zerro L10n

AI-first localization TMS for [Zerro AI](https://github.com/Benjamin5607/zero_ai).  
Lokalise/Crowdin-style CAT with TM, glossary, QA, and Swarm-powered translate/review via the **ZeroAI plugin** contract (same pattern as [KR_AI_Legal](https://github.com/Benjamin5607/KR_AI_Legal)).

| | |
|--|--|
| **ZeroAI menu** | 🌐 L10n (`viewMode: localization`) |
| **This repo** | TMS API + CAT UI + workers |
| **ZeroAI OS** | Sidebar shell, BFF proxy, `/api/l10n/llm` Swarm bridge, SDK |

## Quick start

```bash
git clone https://github.com/Benjamin5607/zerro_l10n.git
cd zerro_l10n
npm install
npm run dev
```

- CAT UI: http://localhost:4310/embed  
- Health: http://localhost:4310/api/health  
- Plugin: http://localhost:4310/api/zeroai/plugin  

Point ZeroAI at this service:

```bash
# in zero_ai
ZERRO_L10N_BASE_URL=http://127.0.0.1:4310
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev server on port **4310** |
| `npm run build` | Production build |
| `npm run start` | Production server on port 4310 |
| `npm run cli` | CLI (`pull`, `push`, `translate`, `qa`, `export`) |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `./data` | JSON store directory (`store.json`) |
| `ZERRO_L10N_BASE_URL` | `http://127.0.0.1:4310` | Public base (CLI / docs) |

## Plugin contract

```http
GET  /api/zeroai/plugin
POST /api/zeroai/workspace/l10n   # { action, projectId?, locale?, llm?, … }
GET  /api/ota/{locale}?projectId=
GET  /api/v1/projects
POST /api/auth/dev
GET  /api/health
```

LLM bind from ZeroAI Swarm (Translator / Reviewer / QA):

```json
{
  "provider": "groq",
  "model": "…",
  "base_url": "https://<zeroai>/api/l10n/llm?translator_provider=…",
  "api_key": "zerroai-bridge",
  "source": "zeroai"
}
```

Embed UI listens for `postMessage` `{ type: "zerroai:llm-bind", llm, agents }`.

## Deploy

- `Dockerfile` — container image  
- `render.yaml` — Render blueprint  

After deploy, set `ZERRO_L10N_BASE_URL` (and `NEXT_PUBLIC_ZERRO_L10N_BASE_URL`) on ZeroAI.

## Docs

ZeroAI wiring: [zero_ai/docs/LOCALIZATION.md](https://github.com/Benjamin5607/zero_ai/blob/main/docs/LOCALIZATION.md)

## License

MIT (aligned with Zerro AI)
