# Runtime integration

What has to exist outside n8n for the estate to run, and what the compiler hands you.

## Compiler output

| file | purpose |
|---|---|
| `dist/n8n/{terminal,subsystems,system}/*.json` | 59 importable workflows |
| `dist/capabilities.json` | the capability registry, **derived** from specs — never hand-maintained |
| `dist/verticals.resolved.json` | vertical profiles with `extends` chains already merged |
| `dist/runtime-env.json` | `MOS_CHANNELS` and `MOS_CAPABILITY_REGISTRY`, loaded into the n8n environment |

Workflows read platform limits from `MOS_CHANNELS` and side-effect metadata from
`MOS_CAPABILITY_REGISTRY` rather than embedding either. A platform changing a character limit
is a registry edit and a rebuild, not a sweep through every canvas.

## Environment variables

| variable | used for |
|---|---|
| `MOS_STATE_URL`, `MOS_STATE_TOKEN` | the state service (below) |
| `MOS_TELEMETRY_URL` | telemetry sink |
| `MOS_TENANT_MAP` | source identity → tenant, resolved at the gateway and nowhere else |
| `MOS_CHANNELS`, `MOS_CAPABILITY_REGISTRY` | from `dist/runtime-env.json` |
| `MOS_LEDGER_SHEET_ID`, `MOS_DRIVE_FOLDER` | run ledger and durable storage |
| `MOS_REVIEW_CHAT_ID`, `MOS_OPS_CHAT_ID`, `MOS_DEFAULT_CHAT_ID` | approval, incident and reply surfaces |
| provider keys | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `HIGGSFIELD_API_KEY`, `ELEVENLABS_API_KEY`, `CREATOMATE_API_KEY`, `TELEGRAM_BOT_TOKEN`, `LINKEDIN_OAUTH`, `CMS_WEBHOOK_URL`, `ESP_API_KEY`, Google OAuth |

Every one of these is declared in some capability's `requires.secrets`, so
`dist/capabilities.json` is the authoritative list for a given deployment.

## The state service

A small HTTP service the workflows call. It is deliberately outside n8n: these are
transactional concerns that a workflow engine is the wrong place to implement.

| endpoint | purpose |
|---|---|
| `POST /budget/reserve`, `/budget/release` | per-tenant spend reservation |
| `GET /dam/by-checksum/:sha`, `POST /dam/assets`, `POST /dam/search` | asset dedupe, registration, vector + filter search |
| `POST /dam/rights`, `PATCH /dam/assets/performance`, `POST /dam/assets/scores` | rights lookup, performance write-back |
| `GET /publish/:idempotency_key`, `POST /publish`, `POST /publish/reverse` | publication idempotency and reversal |
| `POST /schedule`, `DELETE /schedule/:key` | pacing queue with per-channel gaps and daily caps |
| `POST /approvals`, `DELETE /approvals/:id` | approval registry with resume URLs and expiry |
| `POST /runs/park`, `GET /runs/by-idempotency/:key`, `GET /runs/recent` | parked runs and replay |
| `POST /dlq` | dead letters with the full envelope preserved |
| `POST /decisions` | the decision ledger |
| `GET /registry/verticals/:id?resolved=true`, `/registry/compliance/:id?resolved=true` | serve `dist/*.resolved.json` |
| `POST /registry/proposals`, `POST /registry/verticals/:id/revert` | versioned learning proposals |
| `GET /tenants/:id/brands/:id` | brand configuration |
| `POST /planner/estimate` | price a plan from the capability registry before it runs |
| `/connectors/*` | catalogue, reviews, CRM, usage, ESP, per-channel metrics |

Backing store: any transactional database plus a vector index. Nothing about the design
depends on which.

## Import order

1. `npm run check` — build, validate, test.
2. Load `dist/runtime-env.json` values into the n8n environment.
3. Import `dist/n8n/terminal/*.json` first — subsystems reference them by id.
4. Then `dist/n8n/subsystems/*.json`, then `dist/n8n/system/*.json`.
5. Map credential placeholders to real credentials.
6. Smoke-test with `dry_run: true` on a real tenant: full validation, zero external effect.
7. Activate `sys.gateway` last.

## Workflow ids

`executeWorkflow` nodes reference capabilities **by id** (`media.image.generate`), not by
n8n's internal numeric id. Either name the imported workflows with those ids, or run
`dist/capabilities.json` through a small mapping pass on import. Referencing by capability id
is what keeps the compiled output portable between n8n instances.

## CI

```yaml
- run: npm run build
- run: npm run validate   # fails on dangling routes, missing rollbacks, cycles, bad regexes
- run: npm test           # 41 behavioural tests against generated code
- run: git diff --exit-code dist/   # dist must be rebuilt and committed with the spec change
```

That last line is what stops `dist/` drifting from `specs/`.
