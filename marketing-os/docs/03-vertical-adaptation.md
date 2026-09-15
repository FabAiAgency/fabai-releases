# Vertical adaptation

The requirement: one system that works for tech, physical home goods, services, e-commerce —
*whatever it may be* — either by a node behaving dynamically, or by routing to a different
workflow through a reasoned, automated decision.

Both mechanisms are here. Neither requires editing a workflow.

## Mechanism A — data-driven defaults (the dynamic node)

A vertical profile supplies values that generic workflows read at runtime. The workflow graph
is identical; the behaviour is not.

Same `copy.short.generate` terminal, three profiles:

| | `b2b_saas` | `ecommerce_dtc` | `local_services` |
|---|---|---|---|
| lead proof | case study, ROI stat, logo roster | review score, before/after, press | licence, review count, neighbourhood |
| reading level | 10 | 6 | 6 |
| banned | "guaranteed ROI", "10x your revenue" | "clinically proven", "lowest price anywhere" | (jurisdictional, via compliance profile) |
| first objection | "we can build this internally" | "will it look like the photo" | "are they licensed and insured" |
| channel weights | LinkedIn .35, blog .25, email .20 | Instagram .30, TikTok .25, email .20 | **Google Business .30**, Instagram .20 |
| CTA at problem-aware | "See how it works" | "See it in use" | "Check availability today" |

The third column is the interesting one: for a plumber the highest-ROI channel is the map
listing, which generic marketing tooling forgets entirely. That is a weight in a data file,
not a branch in a workflow.

The same lever drives visual grammar (`creative.image_style`, `image_negative`,
`shot_grammar`, `aspect_ratios`, `asset_reuse_bias`) and voice
(`prompt_fragments.voice`, `.proof_instruction`, `.visual_instruction`).

## Mechanism B — capability bindings (a different workflow, chosen by reason)

When defaults are not enough, a profile binds a capability *tag* to a specialised
implementation:

```jsonc
// registry/verticals/ecommerce_dtc.json
"capability_bindings": {
  "produce.image.prompt": "prompt.image.compose.product_studio",
  "assemble.video":       "media.video.render.ugc_vertical"
}
```

No subsystem contains a branch naming a vertical. `sub.visual` has a `route` step for the tag
`produce.image.prompt`; the router consults the profile and returns the implementation.

The four prompt composers show why this is not over-engineering — the failure modes are
genuinely different:

| implementation | bound by | the failure it is built to prevent |
|---|---|---|
| `product_studio` | ecommerce, home_goods | wrong colour, impossible geometry, misspelt packaging text |
| `lifestyle_room` | home_goods | furniture floating off the floor, shadows disagreeing with the window |
| `ui_abstract` | b2b_saas, professional_services | unreadable at thumbnail size; glowing-brain stock clichés |
| `field_proof` | local_services, b2b_industrial | missing PPE, a spotless site that reads as staged |

A specialisation is a ~15-line overlay, not a fork:

```jsonc
{
  "extends": "prompt.image.compose",
  "capability": { "id": "prompt.image.compose.product_studio", "verticals": ["ecommerce_dtc", "home_goods"], ... },
  "overrides": { "compose": { "system_append": "\n\nPRODUCT DISCIPLINE\n- One product per frame...",
                              "extra_prompt_fields": { "shot_type": { "type": "string", "enum": [...] } } } }
}
```

The compiler resolves `extends`, applies the overlay to the parent's node graph, and emits a
complete standalone workflow. Fixing a bug in the parent fixes all four children; no copy can
drift.

## Mechanism C — plays (the shape of a campaign)

A profile declares the campaign shapes its planner may choose from. A play is a DAG of tags
plus the conditions under which it is a good idea:

```jsonc
{ "id": "job_of_the_week", "objective": "demand_gen",
  "when": "A completed job produced usable before/after evidence.",
  "steps": [ {"tag": "plan.brief"}, {"tag": "asset.search", "with": {"filter": "job_photos_last_7d"}},
             {"tag": "produce.copy.short", "with": {"include": "town name, problem, fix, timeframe"}},
             {"tag": "produce.image.edit", "with": {"op": "before_after_pair"}},
             {"tag": "verify.compliance", "with": {"check": "licence number present, service area accurate"}},
             {"tag": "distribute.publish", "with": {"fan_out": ["google_business", "instagram"]}} ] }
```

The planner selects from this enumerated set. It cannot invent a pipeline; if nothing fits it
returns `no_fit` and the system asks a human. An improvised pipeline is one nobody agreed to
pay for, so the model is not permitted to build one.

Note `weather_trigger` in `local_services`: a play that fires from a forecast threshold rather
than a human request. The same orchestrator runs it — the difference is only which gateway
trigger minted the envelope.

## Inheritance

Profiles use single inheritance, deep-merged at build time. Objects merge key-wise; arrays
replace (a child listing three channels means three, not three plus the parent's); a key
ending `_add` concatenates instead.

```
generic
├── b2b_saas ──────── b2b_industrial     (committee mechanics, different aesthetic & proof economy)
├── ecommerce_dtc ─── home_goods         (e-commerce plumbing, considered-purchase psychology)
├── local_services
├── professional_services
└── health_wellness                      (regulated: strict screen, capped autonomy)
```

`home_goods` is the clearest case for inheritance: it is an e-commerce vertical mechanically —
catalogue, PDP, reviews, gallery — and nothing like one psychologically. It inherits the
plumbing and overrides the psychology: buying cycle 3 days → 45, seasonality from BFCM to
the sale weekends that actually move furniture, and `saves_and_shares` as a primary KPI
because in a 45-day cycle saves predict revenue better than clicks do.

`health_wellness` is the case for governance: it binds `verify.compliance` to the strict
screen, caps autonomy below whatever the tenant has configured, and tracks
`compliance_block_rate` as a KPI on purpose — a rising block rate means the content engine
is drifting toward claims it cannot support.

## Adding a vertical

1. Write `registry/verticals/<id>.json` with `extends` set to the closest existing profile.
2. Fill taxonomy, proof types, objections, lexicon, channel weights, creative grammar,
   compliance profile, KPIs, plays.
3. Add `capability_bindings` only where a default genuinely cannot work.
4. `npm run check`.

The validator proves every channel exists, every format exists on that channel, every
compliance profile is defined, every binding resolves, and every play's every tag is
executable. A profile that would fail at runtime cannot be committed.

Zero workflows are touched. That is the whole point.
