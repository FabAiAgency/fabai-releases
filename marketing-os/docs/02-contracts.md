# Contracts

Nine schemas in `contracts/`. They are the estate's API. Everything else is replaceable.

| contract | carried by | the rule that makes it work |
|---|---|---|
| `envelope` | every call between every unit | policy narrows, never widens; provenance is append-only |
| `brief` | intake → everything | vertical-agnostic; adding a vertical never adds a field |
| `creative-asset` | producers → DAM → distribution | rights are mandatory before publish; `derived_from` keeps lineage |
| `capability` | every unit declares one | you may not call a unit that has not declared one |
| `vertical-profile` | the registry | data, never code |
| `routing-policy` | the decision engine | deterministic layers before the model, always |
| `decision-record` | every choice | options *and* what eliminated them |
| `telemetry-event` | every span | one shape, so one dashboard covers the whole estate |
| `publish-request` | factories → adapters | channel-neutral; adapters re-verify rather than trust |

## Versioning

Contracts are semver. A unit rejects an envelope whose **major** differs from what it
implements — the generated preamble does this in every workflow:

```js
const SUPPORTED_MAJOR = 1;
const v = String(raw.envelope_version ?? '0.0.0');
if (Number(v.split('.')[0]) !== SUPPORTED_MAJOR) throw new Error('VALIDATION_FAILED: ...');
```

Half-processing a shape you do not understand is how a bad record reaches production looking
like a good one. Failing loudly at the boundary is cheaper every time.

Migration path for a breaking change:

1. Add the new field as optional; both majors accept it.
2. Update producers to emit it; consumers ignore what they do not know.
3. Update consumers to require it; bump major.
4. Run both majors in parallel, canary by tenant.
5. Retire the old major once `dist/capabilities.json` shows no unit still implementing it.

## The two that carry the most weight

**Envelope.** `deadline_at` is absolute: a unit that cannot finish before it fails fast rather
than starting. `idempotency_key` is `sha256(tenant_id + capability + canonical(payload))`, and
any side-effecting unit must no-op and return the prior result on a repeat — that is what makes
retry safe on a publish step. `budget.spent_minor_units` accumulates through provenance, so a
cap is enforced across an entire multi-workflow run rather than per workflow.

**Brief.** The abstraction that makes one system serve every industry is `offer.type`:
`product_physical | product_digital | subscription | service | marketplace_listing | event |
content | lead_magnet | bundle | membership`. A sofa and a consulting retainer differ in their
*values*, not their *shape*.

Two fields exist specifically so the system can decline to act:

- `confidence` — intake's honest estimate that it understood the request. Below 0.55 the
  system asks instead of guessing.
- `open_questions` — what intake could not resolve. Non-empty plus low confidence produces a
  clarifying question, never an invented campaign.

`message.key_claims[].risk` tags each claim `none | puffery | comparative | performance |
regulated`. A `regulated` tag routes the entire run to a human. Under-tagging is the most
expensive mistake available at this layer, which is why the brief synthesiser's prompt says so
explicitly and the validator in the same workflow raises the compliance profile when it sees
one.

## Asset rights

The field that keeps an autonomous system out of court:

```jsonc
"rights": {
  "license": "owned | generated | licensed_stock | ugc_permission | client_supplied | unknown",
  "expires_at": "...", "talent_release": false,
  "usage_scope": ["organic_social", "paid_social", "web", "print", "ooh"]
}
```

`verify.rights.check` is deterministic — no model judges a licence. It fails an asset whose
licence is unknown or expired, whose scope does not cover the intended usage, or which depicts
a person with no release on file. Hard rule HR-003 vetoes on the same condition, so the check
exists at two independent layers.

## Telemetry

One row per span, emitted by every unit. Because the shape is uniform, a single dashboard
covers every workflow in the estate — present and future — and cost attribution works without
per-workflow instrumentation:

```
trace_id · span_id · tenant_id · vertical · capability · layer · event · status
duration_ms · cost_minor_units · tokens · provider · model · error_code · decision_id
```

Events: `span_start`, `span_end`, `retry`, `fallback`, `circuit_open`, `gate_opened`,
`gate_blocked`, `approval_requested`, `approval_resolved`, `budget_warning`,
`budget_exceeded`, `compensated`, `dlq`, `published`, `measured`.
