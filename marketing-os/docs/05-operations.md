# Operations

## Failure ladder

Defined once in `registry/policies/escalation.json` so no workflow invents its own unhappy path.

1. **Retry same provider** — retryable error, attempts remaining, exponential backoff with jitter.
2. **Advance the provider chain** — from `registry/models.json`; records a `fallback` event and
   increments `fallback_depth`.
3. **Degrade gracefully** — a lower-fidelity output that still satisfies the brief: a still
   instead of a generated clip, a DAM asset instead of a generation, fewer variants, text-only.
4. **Partial deliver** — never discard completed work because a sibling failed. Publish what is
   green, park what is not.
5. **Park to DLQ** — full envelope and provenance preserved, so the run replays byte-identically
   after a fix.
6. **Notify a human** — with `trace_id`, the failing capability, the last error and a replay command.

<a id="orchestrator"></a>
## Saga compensation

Every terminal with `side_effects` of `external_write` or `publish` declares a compensation, or
appears in `registry/roadmap.json` under `uncompensable` with a written rationale. The validator
enforces the choice; there is no third option.

On a hard downstream failure the orchestrator walks `provenance` **backwards** and invokes each
declared compensation in reverse order. Entries with no compensation are reported as
*irreversible* rather than silently skipped — an operator needs to know what is still out there.

Currently irreversible, by nature:

| capability | why | mitigation |
|---|---|---|
| `dist.publish.telegram` | a delivered message cannot be recalled | gates re-checked inside the adapter; idempotency record |
| `dist.publish.email` | a sent broadcast cannot be recalled | mandatory approval, suppression list, deliverability preflight |
| `asset.ledger.append` | the ledger is append-only by design | deleting a row would destroy the audit trail everything else depends on |
| `intake.clarification.request` | a question already read | harmless: no public artefact, no spend |

Those four are exactly the capabilities carrying the strictest approval gates. That is not a
coincidence — irreversibility is what the gates are for.

<a id="publish-adapters"></a>
## Publish adapters

Every adapter, without exception:

1. **Re-verifies its own gates.** `sub.governance` just ran; the adapter checks again. Cheap,
   and it makes a mis-wired caller fail closed. A check that was never evaluated counts as a
   failure, not a pass — verified in the test suite.
2. **Checks idempotency** against the publish record before doing anything external.
3. **Enforces its own platform limits** from `registry/channels.json`, so no factory upstream
   has to know that LinkedIn truncates at 3000 characters.
4. **Honours `dry_run`** — full validation, zero external effect. This is how the estate is
   smoke-tested against production credentials without posting.
5. **Records the publication** with its external id, so measurement can find it later.

## Budget governance

`ops.budget.check` plus a guard injected into every billable workflow by the compiler.

- The planner prices a plan from the registry's `cost_model` entries **before** executing it.
  Over budget, the plan is re-scoped — lowest-priority channels dropped, variant counts
  halved — and the run *says what it dropped*. A silently truncated campaign is
  indistinguishable from a broken one.
- At the soft limit (default 80%) the model tier downgrades. `reasoning.planner` and
  `vision.critic` are exempt: cheap planning produces expensive mistakes, and cheap QA lets
  them through. Volume production is what degrades.
- At the hard cap, the span fails with `BUDGET_EXCEEDED`. It never silently half-runs.

## Async jobs

The originals used a fixed `90 Seconds` wait after submitting a video job. That is wrong in
both directions: it stalls a 12-second clip and silently truncates a queued one.

Replaced with bounded polling: exponential backoff (`min(60, 8 × 1.5^attempt)`), an absolute
deadline on the envelope, and an explicit failure path that degrades the beat to a still rather
than failing the whole render.

## Circuit breakers

Declared per capability, walked per provider chain. Default: 5 failures in 300s opens the
breaker for 120s, then one half-open probe. Publish adapters are stricter — 3 failures in 600s,
900s cooldown — because a flapping publish adapter risks the account itself.

<a id="brief-synthesis"></a>
## Runbooks

**Brief synthesis returning low confidence repeatedly.** Expected for thin inbound messages;
the system asks a question and parks. Investigate only if it happens on messages a human would
consider clear: check the vertical profile resolved correctly (`dist/verticals.resolved.json`)
and that the tenant's brand config loads — the brand fetch is `onError: continue`, so a broken
brand endpoint degrades quietly into lower confidence.

**A compliance block rate above 5% in an hour.** Pages. Almost always means content generation
has drifted toward claims it cannot support — check whether a recent `learn.playbook.update`
proposal was accepted, and whether the brief synthesiser is under-tagging `regulated` claims.
It is a content problem, not a screening problem; do not loosen the screen.

**DLQ depth above 25.** Pages. Group by capability first: one provider outage produces a spike
in one capability. Replay with `mos replay <execution_id>` once the provider recovers; the
preserved envelope makes the replay identical.

**Approval timeouts.** An unanswered approval expires into the parked state after 24 hours and
escalates to the tenant owner first. Silence is never consent. If timeouts are common, the
review packet is probably too slow to act on — it should answer what, where, what the gates
said and what it cost, in one screen.

## SLOs

| unit | target |
|---|---|
| `sys.orchestrator` | 95% of runs reach a terminal state within their deadline |
| `sub.intake` | 98% of inbound messages reach a Brief or a clarification within 60s |
| `sub.motion` | 95% of renders complete within 8 minutes |
| `sub.governance` | 100% of publish-bound items pass through it |
| compensations | 99.9% — a failed rollback leaves the system inconsistent, which is worse than the original failure |
