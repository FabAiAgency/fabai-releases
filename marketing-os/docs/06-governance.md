# Governance

The layer that separates an automation estate from a liability. Nothing reaches the public
without passing through `sub.governance`, and there is no path from production to distribution
that bypasses it.

## Gate order

Cheapest and most absolute first:

```
rights ──▶ compliance ──▶ brand ──▶ approval?
  │            │             │          │
 fail        block          fail     rejected / expired
  └────────────┴─────────────┴──────────┴──▶ park with findings, replayable
```

**Rights** is deterministic — no model judges a licence. Unknown licence, expired licence,
usage scope not covered, or a person depicted with no release: fail. Hard rule HR-003 vetoes on
the same condition, so the check exists at two independent layers.

**Compliance** runs deterministic lexicon and pattern rules first, and calls a model only for
what a list cannot judge: implication, context, and whether an image and its caption *together*
create a claim neither makes alone. A deterministic block short-circuits the model call — there
is no point paying for a model to agree.

**Brand** scores voice, visual, claim alignment and audience fit. Overall is the **minimum** of
the four, not the mean: a piece that is perfect except for an off-brand palette is still
off-brand, and averaging hides exactly the failure a reviewer needs to see.

<a id="compliance-screen"></a>
## Compliance profiles

`registry/policies/compliance.json`. A vertical names a profile; the screen loads it. Regulated
industries get real gates without every other vertical paying for them.

| profile | review mode | autonomy ceiling | example rules |
|---|---|---|---|
| `standard` | sampled 10% | — | absolute claims, disparagement, fake scarcity, impersonation |
| `regulated_health` | always | publish_with_approval | disease claims, outcome guarantees, before/after without disclaimer, patient testimonial without release |
| `regulated_finance` | always | **draft** | return projections, risk omission, past performance without disclaimer |
| `regulated_housing_credit_employment` | always | — | protected-class targeting, exclusionary language |
| `local_services` | sampled | — | licence number required, pricing without conditions, service-area mismatch |
| `alcohol_age_restricted` | always | — | underage depiction, consumption incentive, missing age gate |

Enforcement order is `deterministic_lexicon → pattern_rules → model_screen → human_review`. A
`block` finding is terminal: no downstream unit may proceed, and the run parks for a human with
the finding attached.

Verified in the test suite: `regulated_health` catches both a disease claim and a missing
mandatory disclaimer, both as blocking; `standard` passes clean trade copy without a false
positive.

## Approval

The decision is policy arithmetic, never the caller's preference:

```js
if (autonomy === 'suggest' || autonomy === 'draft')            required, 'autonomy_level'
else if (channel.requires_gates.includes('human_approval'))     required, 'channel_requires_approval'
else if (mode === 'always')                                     required, 'approval_mode_always'
else if (mode === 'channel_conditional' && kind is paid|owned)  required, 'high_blast_radius_channel'
else if (brand === 'warn' || compliance has a warn)             required, 'gate_warning'
else if (mode === 'sampled' && sample hits)                     required, 'sampled'
```

Paid and owned-list channels are always held: paid spends money per impression, and an email
cannot be unsent. Organic social is sampled. Internal drafts are never held.

**An unanswered approval expires into the parked state.** It escalates to the tenant owner
first, then expires. It does not fall through into a post. Silence is never consent — that is
the single most important line in this layer.

## Earned autonomy

`registry/policies/escalation.json` defines a trust ladder that is mechanical, observable and
reversible:

| level | criteria | autonomy |
|---|---|---|
| 0 warmup | fewer than 5 completed runs | draft |
| 1 supervised | 5+ runs, approval rate ≥ 0.80 | publish with approval |
| 2 sampled | 25+ runs, ≥ 0.90, zero compliance blocks in 30d | publish with approval, sampled |
| 3 autonomous organic | 100+ runs, ≥ 0.95, zero blocks in 90d, unregulated vertical | autonomous, organic and owned blog only |

Any compliance block, any rejection for a factual error, or any published-then-deleted item
drops the tenant one level immediately.

Hard rule HR-007 enforces level 0 regardless of configuration: a brand-new tenant cannot be
configured into autonomous publishing on day one.

## Learning cannot touch governance

`learn.playbook.update` may propose changes to channel weights, angle preferences and reuse
bias. It may **not** propose changes to compliance settings, autonomy ceilings, banned lexicon,
required disclaimers or capability bindings — and a deterministic filter rejects any such
proposal even if the model produces one. Verified in the test suite.

Accepted proposals are versioned and require human approval. An autonomous system that
silently rewrites its own strategy cannot be reasoned about; one that files a diff can.

## Provenance and audit

For any published item you can reconstruct: the originating message, the Brief it compiled to,
every decision and the layer that made it, every model and provider invoked with cost, every
gate result with rule ids, who approved it and when, and the full derivation tree of every
asset used.

That is the append-only `provenance` array, the decision ledger, the run ledger and
`derived_from` on each asset — four independent records, written by construction rather than by
remembering to.
