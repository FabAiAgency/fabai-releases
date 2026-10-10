# FabAi Marketing OS

An enterprise marketing automation system, compiled rather than clicked.

The four n8n canvases this replaces — a Telegram agent with tool-workflows, a video
generator, a LinkedIn post builder and a blog post builder — each worked. The problem was
what they were *becoming*: four copies of the same retry logic, four different error paths,
four hard-coded model choices, no shared telemetry, no rollback, and marketing assumptions
(SaaS-shaped copy, one channel, one brand) welded into the node parameters. Adding a fifth
workflow meant reading the other four. Adding a fifth client meant forking all of them.

This repository decomposes that into **terminal processes → subsystems → a system**, where
every layer has a contract, every decision is recorded, and *no workflow knows what industry
it is serving*.

```
                   ┌──────────────────────────────────────────────┐
   Telegram ─┐     │  L3  SYSTEM        gateway · orchestrator     │
   Webhook  ─┼────▶│      understand → plan → produce → verify     │
   Schedule ─┘     │      → distribute → measure → learn           │
   CRM/API ─┘      └───────────────────┬──────────────────────────┘
                                       │ capability TAGS, never ids
                   ┌───────────────────▼──────────────────────────┐
                   │  L2  SUBSYSTEMS    intake · content · visual  │
                   │      motion · governance · distribution ·     │
                   │      measurement                              │
                   └───────────────────┬──────────────────────────┘
                                       │ late-bound by the router
                   ┌───────────────────▼──────────────────────────┐
                   │  L1  TERMINALS     50 single-purpose, idem-   │
                   │      potent, individually deployable units    │
                   └───────────────────┬──────────────────────────┘
                   ┌───────────────────▼──────────────────────────┐
                   │  L0  KERNEL    envelope · brief · asset ·     │
                   │      capability · policy · telemetry          │
                   └──────────────────────────────────────────────┘
```

## The one idea

**A marketing workflow should not know what it is marketing.**

Everything industry-specific lives in a *vertical profile* — a data file. A profile does
three things, and between them they answer "will this work for tech AND home goods AND
services AND e-commerce":

1. **Supplies defaults** that generic workflows read (proof types, objections, lexicon,
   shot grammar, channel weights, aspect ratios, compliance profile, KPIs). Same workflow,
   different behaviour. This is the "dynamic node" mechanism.
2. **Binds a capability tag to a specialised implementation** when defaults are not enough.
   `produce.image.prompt` becomes a product-studio composer for e-commerce, a room composer
   for furniture, an abstract composer for B2B software, a field-proof composer for a
   plumber. This is the "different workflow, called by reason" mechanism.
3. **Declares the plays** the planner may select — named campaign shapes with the conditions
   under which each is a good idea.

Adding a vertical is adding one JSON file. No workflow is edited. `npm run validate` proves
the new file's every reference resolves before it can ship.

## Layout

| path | what it is |
|---|---|
| `contracts/` | JSON Schemas for the envelope, brief, asset, capability, vertical, routing, decision, telemetry, publish request |
| `registry/` | Channels, model routing, routing/compliance/escalation policy, 8 vertical profiles, roadmap |
| `specs/` | **Source of truth.** 59 declarative unit specs (50 terminal, 7 subsystem, 2 system) |
| `compiler/` | Spec → n8n workflow JSON. Injects envelope validation, telemetry, budget guards, retries, error paths, layout |
| `tools/` | `validate.mjs` (estate integrity), `graph.mjs` (dependency graph) |
| `tests/` | 41 behavioural tests that execute the generated code |
| `dist/` | Compiled output — importable n8n workflows plus derived registries |
| `docs/` | Architecture, contracts, vertical adaptation, routing, operations, governance, extending, migration |

## Use it

```bash
npm run build      # specs -> dist/n8n/**  (59 workflows, ~1200 nodes)
npm run validate   # estate integrity: dangling refs, missing rollbacks, cycles, bad regexes
npm test           # 41 behavioural tests against the generated code
npm run check      # all three
npm run graph media.image.generate   # what depends on this, and what it depends on
```

Import `dist/n8n/**/*.json` into n8n, load `dist/runtime-env.json` into the environment, and
point the credential placeholders at real accounts. Nothing in `dist/` is hand-edited — a
canvas edit is overwritten by the next build, on purpose.

## Why compile instead of clicking

Every compiled workflow gets, without its spec asking:

- envelope validation that rejects an unsupported contract version instead of half-running
- `span_start` / `span_end` telemetry with `trace_id` propagation into one run ledger
- a budget guard before any billable step, with tier downgrade at the soft limit
- retry, backoff and timeout taken from the capability manifest
- an append-only provenance entry, which is what makes saga rollback possible
- an error path to a DLQ that preserves the full envelope for byte-identical replay
- a laid-out, frame-annotated canvas that reads like the hand-drawn originals

Twenty workflows written by hand drift into twenty different versions of that list. Twenty
compiled workflows cannot.

## What is deliberately not built

`registry/roadmap.json` names every capability the policies reference but that has no spec
yet — six publish adapters, a strategy subsystem, a first-class DLQ. The validator
downgrades those from errors to tracked warnings, so a gap is visible in CI rather than
discovered at 3am. Delete an entry without adding its spec and the build turns red.

Start at [`docs/00-overview.md`](docs/00-overview.md), or
[`docs/08-migration-map.md`](docs/08-migration-map.md) to see exactly where each node of the
original four canvases ended up.
