# Layers

## L0 — Kernel

Six contracts, in `contracts/`. Nothing crosses a layer boundary that is not one of them.

**Envelope** (`envelope.schema.json`) — the only message format in the estate. A unit reads
`payload` for business data; everything else is control plane: identity (`tenant_id`,
`brand_id`, `vertical`, `locale`), tracing (`trace_id`, `span_id`), safety (`idempotency_key`,
`deadline_at`, `attempt`), policy (autonomy ceiling, compliance profile, residency, model tier
cap), budget, routing, provenance, error.

Two rules make it work:

- **Policy narrows, never widens.** A downstream unit may lower an autonomy level or a model
  tier. It may not raise one. The gateway sets the ceiling for the whole run.
- **Provenance is append-only.** Every unit pushes exactly one entry and rewrites none. That
  array is what an audit reads and what saga rollback walks backwards.

**Brief** (`brief.schema.json`) — the vertical-agnostic intermediate representation of intent.
A SaaS trial, a sofa, an HVAC tune-up and a consulting retainer are all `offer`. Intake
compiles *down* to a Brief; production compiles *up* from one. Adding a vertical never adds a
field here; it only changes how the fields get filled.

**Creative Asset** (`creative-asset.schema.json`) — every artefact in one shape, with rights,
review status, taxonomy, `derived_from` lineage and a `performance` block that measurement
writes back. That write-back is what closes the loop: tomorrow's asset search can filter on
what actually worked.

**Capability manifest** (`capability.schema.json`) — what a unit declares about itself:
tags, side effects, idempotency, compensation, providers, SLA, retry, circuit breaker,
required secrets, verticals, cost model. Nothing may call a unit that has not declared one.
That single rule is what keeps "add a workflow" from meaning "read every other workflow".

**Vertical profile** (`vertical-profile.schema.json`) — see [`03-vertical-adaptation.md`](03-vertical-adaptation.md).

**Decision record / telemetry / publish request** — the audit trail, the observability row,
and the channel-neutral instruction handed to distribution adapters.

## L1 — Terminal processes

Fifty units. The rules they all obey:

- one responsibility, expressible in a sentence without "and"
- stateless between invocations
- idempotent — a repeat with the same `idempotency_key` returns the prior result
- no knowledge of any other terminal except through a declared `requires.capabilities`
- no vertical, channel or brand hard-coded anywhere

Grouped by domain: intake (4), planning (2), research (2), copy (4), visual (7 incl. 4
vertical prompt composers), motion (7 incl. 3 render variants), asset (2), governance (5),
distribution (5), measurement (3), platform (2) and compensations (7).

Splitting `prompt.image.compose` from `media.image.generate` is the clearest example of why
granularity pays: prompts are cheap to review, iterate and cache; generations are not. The
originals fused them, so every prompt tweak cost an image.

## L2 — Subsystems

Seven bounded contexts, each owning an SLO and an escalation posture:

| subsystem | owns | the interesting decision it makes |
|---|---|---|
| `sub.intake` | modality, redaction, classification, the clarification loop | ask a question rather than guess |
| `sub.content` | research, long-form, shards, localisation | produce one anchor and shard it, so a campaign says one consistent thing |
| `sub.visual` | reuse-vs-generate, prompt routing, generation, brand scoring | search the DAM before spending a credit |
| `sub.motion` | script, keyframes, clips, VO, captions, render | degrade a missing clip to a still rather than fail the render |
| `sub.governance` | rights, compliance, brand, approval | whether a human sees this before the public does |
| `sub.distribution` | request building, pacing, adapter routing, partial outcomes | publish what is green, park what is not |
| `sub.measurement` | collection, normalisation, scoring, learning proposals | refuse to learn from an underpowered sample |

A subsystem calls terminals by **tag** and lets the router bind. That is the seam that makes
one Visual Factory serve every industry.

## L3 — System

**`sys.gateway`** — every inbound path in one place: Telegram, webhook (CRM, commerce,
forms), schedule, API. It authenticates the source against a tenant map, mints the envelope,
de-duplicates, hands off. It contains no marketing logic at all, which is why adding an
intake channel can never break a production pipeline.

**`sys.orchestrator`** — the loop. Understand → plan → produce (three factories in parallel)
→ verify → distribute → measure, with two recovery paths: saga compensation walked backwards
over provenance, and a park-for-human that keeps the `trace_id` and the produced assets so a
compliance fix costs a review rather than a re-run.

## Why these boundaries and not others

The boundaries follow **rate of change** and **blast radius**, not subject matter.

- Providers change monthly → isolated in terminals and `registry/models.json`.
- Platform limits change quarterly → isolated in `registry/channels.json`.
- Industry strategy changes per client → isolated in vertical profiles.
- The loop itself changes rarely → that is the orchestrator, and it is the thinnest layer.

Anything that can hurt the public — publishing, spending, emailing — is pushed to a terminal
with a declared side effect, so the governance layer has exactly one place to stand.
