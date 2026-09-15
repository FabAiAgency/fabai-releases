# Routing and decisions

An autonomous system is only useful if you can answer, later, why it did what it did. That
requires deciding as *deterministically as possible*, and recording the rest.

## Precedence

Declared in `registry/policies/routing.json`, compiled into every `route` step:

```
hard_rule  →  vertical_binding  →  policy_table  →  model  →  default
```

First layer that returns a binding wins. A hard rule can also **veto**, which stops evaluation
entirely. The model is consulted *last* and only inside an explicitly declared gray zone.

| layer | cost | when it decides |
|---|---|---|
| hard rule | free | compliance, safety, rights, budget, residency — non-negotiable |
| vertical binding | free | the profile named a specialised implementation |
| policy table | free | the boring 90% — a lookup beats a model call: instant, testable, diffable |
| model | ~$0.001 | genuine judgement: which play, which angle, how to split a fuzzy request |
| default | free | nothing matched |

## The matcher

`when` is a conjunction of `path: {op: value}`. Paths resolve against `{envelope, brief, context}`.
`a.b[].c` collects across an array. A value prefixed `@` dereferences another path.

Operators: `eq`, `neq`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `exists`, `matches`, `any_of`.

```jsonc
{ "id": "HR-001-regulated-claim-requires-human",
  "when": { "brief.message.key_claims[].risk": { "any_of": ["regulated"] } },
  "then": { "action": "require_approval", "reason_code": "REGULATED_CLAIM" },
  "severity": "block" }
```

`matches` accepts PCRE-style inline flags (`(?i)...`) which JS rejects natively; the generated
resolver translates them. **The validator compiles every pattern at build time** — a compliance
rule whose regex does not compile would silently never fire, which is the worst failure mode
available to a governance layer, so it is a build error instead.

## Hard rules currently in force

| id | fires when | effect |
|---|---|---|
| HR-001 | any claim tagged `regulated` | require human approval |
| HR-002 | channel kind is `paid` | require human approval |
| HR-003 | asset rights unknown or expired | **veto** |
| HR-004 | spend ≥ cap | **veto** (`BUDGET_EXCEEDED`) |
| HR-005 | residency is EU/UK | force in-region provider |
| HR-006 | brief confidence < 0.55 | bind to the clarification capability |
| HR-007 | tenant has fewer than 5 completed runs | downgrade autonomy |
| HR-008 | audience text matches child/patient/diagnosis | require human approval |

HR-007 is deliberate: a brand-new tenant never publishes autonomously regardless of its
settings. Trust is earned by observed output, not configured on day one.

Note that `require_approval`, `downgrade_autonomy` and `force_provider` do **not** bind — they
emit a *constraint* carried forward on the envelope. A regulated claim still gets its copy
written; it just cannot reach the public without a human.

## The gray zone

Where judgement genuinely helps, and nowhere else:

```jsonc
"gray_zone": {
  "decisions": ["play_selection", "angle_selection", "channel_mix",
                "asset_reuse_vs_generate", "variant_winner", "clarification"],
  "model_role": "reasoning.router",
  "confidence_floor": 0.6,
  "on_low_confidence": "ask_human",
  "max_options": 5
}
```

The contract: the model receives an **enumerated option list already filtered by hard rules
and the policy table**, plus the brief and the profile. It returns `{chosen, confidence,
rationale}`. It cannot invent an option, cannot call a capability, and never sees a choice a
hard rule already removed.

Below the confidence floor the system asks a human. A low-confidence answer is a correct
answer, not a failure.

## Decision records

Every choice writes one (`contracts/decision-record.schema.json`): the question, the options
*including the eliminated ones and what eliminated them*, the choice, the deciding layer, the
rule id, the confidence, a one-or-two-sentence rationale, an inputs hash, the cost, and
whether it was reversible.

The inputs hash is what makes a policy change auditable: replay a decision after editing a
rule and diff the outcome.

## Verified behaviour

From `tests/run.mjs`, executing the generated resolver:

```
routing: a vertical binding beats the policy table
routing: home_goods inherits its parent vertical binding
routing: with no vertical binding, the policy table decides on offer type
routing: an unmatched tag falls back to its declared default
routing: an exhausted budget vetoes before anything binds
routing: a regulated claim raises an approval constraint without blocking the bind
routing: a sensitive-audience regex rule fires (inline (?i) flag supported)
routing: every decision carries an auditable record
```

## Adding a rule

Edit `registry/policies/routing.json`, then `npm run check`. The validator proves the bound
capability exists, the tag has a default, and every regex compiles. Nothing else is touched —
the resolver is regenerated identically into all 59 workflows, which is the reason the
precedence order cannot drift between them.
