# Overview

## What was there before

Four n8n canvases, reconstructed from the screenshots:

1. **Marketing Team Agent** — Telegram trigger → switch on voice/text → download + transcribe →
   a tools-agent with GPT-4.1, a Think tool and simple memory, wired to five tool-workflows
   (Video, LinkedIn Post, Blog Post, Create Image, Edit Image, Search Images) → Telegram reply.
2. **Video** — image prompts → images → videos → audio → merge → render → download → send → log.
3. **LinkedIn Post** — blog agent (Tavily + GPT-4.1) → image prompt agent (structured output) →
   generate image → convert to binary → send to Telegram + upload to Drive + log to Sheets.
4. **Blog Post** — structurally identical to (3).

Each one works. Together they have six problems that get worse with every workflow added:

| problem | how it shows up |
|---|---|
| **Duplication** | (3) and (4) are the same canvas twice. A fix to one silently misses the other. |
| **No contract** | Every tool-workflow invents its own input shape. Adding a sixth means reading the other five. |
| **Coupled cost** | Prompt composition and image generation are fused, so you cannot review a prompt without paying for an image, or reuse an asset instead of generating one. |
| **Fixed waits** | `90 Seconds` after submitting a video job: too slow for a short clip, too short for a queued one, and silently truncating either way. |
| **No governance** | Nothing sits between "the model wrote it" and "the public can read it". No brand check, no claims check, no rights check, no approval, no rollback. |
| **One industry** | The prompts, channels, formats and proof types encode one kind of client. A plumber and a semiconductor distributor need different creative grammar, different channels and different compliance — not different *code*. |

## What replaces it

The same capabilities, decomposed into four layers with contracts between them.

**L0 — Kernel.** One envelope every unit speaks. One canonical Brief that all intake compiles
down to and all production compiles up from. One asset shape. One capability manifest format.
One decision record. One telemetry event. Adding a vertical never adds a field to any of them.

**L1 — Terminal processes (50).** Single responsibility, stateless, idempotent, individually
versioned and deployable. `media.image.generate` generates one image and stores it durably.
It does not know what a campaign is, which channel the image is for, or what industry the
client is in.

**L2 — Subsystems (7).** Bounded contexts that compose terminals and own an SLO: Intake,
Content Factory, Visual Factory, Motion Factory, Governance, Distribution, Measurement. A
subsystem knows about capability *tags*; it does not know which implementation will run.

**L3 — System (2).** The Gateway mints envelopes from any inbound channel. The Orchestrator
runs the loop: understand → plan → produce → verify → distribute → measure → learn. It names
no provider, no platform and no vertical anywhere in its graph.

## The run, end to end

```
voice note ─▶ normalise ─▶ redact PII ─▶ transcribe ─▶ classify intent
                                                            │
                                            synthesise Brief (vertical profile + brand)
                                                            │
                                     confidence < 0.55? ─── yes ─▶ ask a question, park
                                                            │ no
                                              select a play from the vertical's declared set
                                                            │
                                              expand to a DAG of capability TAGS
                                                            │
                                              estimate cost ─▶ over budget? re-scope, say so
                                                            │
                  ┌─────────────────────────────────────────┼─────────────────────────────┐
                  ▼                                         ▼                             ▼
            Content Factory                          Visual Factory                Motion Factory
     research → long-form → shards            search DAM first → route the      script → keyframes →
     → localise                               prompt composer by vertical        clips ∥ VO ∥ captions
                                              → generate → brand-score           → render (routed)
                  └─────────────────────────────────────────┼─────────────────────────────┘
                                                            ▼
                                   Governance: rights → compliance → brand → approval?
                                                            │
                                        blocked ─▶ park with findings, replayable
                                                            │ cleared
                                   Distribution: one PublishRequest per slot, paced,
                                   routed to an adapter, re-verified at the boundary
                                                            │
                                   Measurement: collect → normalise → score → propose
```

Every branch in that diagram is a recorded decision with a rationale, an inputs hash and the
layer that decided. Months later, "why did it post that?" has an answer.

## What makes it enterprise-grade rather than merely large

- **Multi-tenant by construction.** `tenant_id` is established once, at the gateway, and is
  the isolation boundary for secrets, budgets, storage, ledgers and the DAM.
- **Reversible.** Every side-effecting terminal declares a compensation, or is explicitly
  declared irreversible with a written rationale. The validator enforces the choice.
- **Bounded.** A cost governor prices a plan before it runs and caps it while it runs.
- **Auditable.** Append-only provenance, a decision ledger, a run ledger, and replay from
  DLQ using the preserved envelope.
- **Governed.** Nothing reaches the public without passing rights, compliance and brand
  gates, and an approval policy the caller cannot widen.
- **Statically checked.** Dangling routes, missing rollbacks, dependency cycles, invalid
  compliance regexes and unexecutable plays are build failures, not incidents.
- **Earned autonomy.** A tenant moves from drafting to autonomous publishing on measured
  behaviour, and drops a level the moment it misbehaves.

Next: [`01-layers.md`](01-layers.md).
