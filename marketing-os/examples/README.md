# Worked example: one system, two industries

An HVAC contractor sends a Telegram voice note. A software company posts an almost identical
sentence into Slack. Both say, in effect: *"we finished a job for a customer, it went well, put
something out about it."*

Neither message names a channel, a format, an angle or an audience. Here is what the system
does with each — **running the same 59 workflows, with no branch anywhere that names either
industry.**

| | `local_services` (HVAC) | `b2b_saas` (software) |
|---|---|---|
| **intake** | voice → `intake.audio.transcribe` | text, no transcription |
| **brief confidence** | 0.82 → proceed | 0.88 → proceed, with one open question recorded |
| **objective inferred** | `demand_gen` | `conversion` |
| **play selected** | `job_of_the_week` | `customer_proof_engine` |
| **channels chosen** | Google Business, Instagram Reel | LinkedIn ×3, blog, email |
| **why those** | profile weights GBP at 0.30 — the highest-ROI channel in this vertical and the one generic tooling forgets | profile weights LinkedIn 0.35 / blog 0.25; TikTok and GBP are excluded outright |
| **prompt composer** | `prompt.image.compose.field_proof` — real site, real light, correct PPE | `prompt.image.compose.ui_abstract` — diagrammatic, two accent colours, legible at 120px |
| **why** | policy table: `offer.type = service` | vertical binding in `b2b_saas` |
| **video renderer** | `media.video.render.before_after` — locked wipe, evidence guard | `media.video.render.explainer_wide` — 16:9, lower-third captions |
| **proof used** | before/after photo, licence number, town name | migrated pipeline count, days-vs-estimate, SOC 2 |
| **reading level** | 6 | 10 |
| **banned language** | pricing without conditions | "guaranteed ROI", "10x" |
| **compliance profile** | `local_services` — licence number in creative, service area accurate | `standard` |
| **approval** | required: profile is sampled, but the tenant is at trust level 1 | required: a `regulated` SOC 2 claim triggers hard rule HR-001 |
| **primary KPI** | calls and booked jobs | demo requests |

## What actually differed in the code

Nothing. Both runs executed:

```
sys.gateway → sub.intake → plan.brief.synthesize → plan.campaign.compose
            → sub.content ∥ sub.visual ∥ sub.motion
            → sub.governance → sub.distribution → sub.measurement
```

The divergence came entirely from data and routing:

- **data** — `registry/verticals/local_services.json` vs `b2b_saas.json` supplied the proof
  types, objections, lexicon, reading level, channel weights, shot grammar and KPIs that the
  generic workflows read.
- **routing** — three `route` steps resolved three capability tags to different
  implementations, each one recorded as a decision with a rationale and the deciding layer.

## The decision records

From the HVAC run:

```jsonc
{ "kind": "capability_binding", "question": "Which implementation satisfies produce.image.prompt?",
  "chosen": "prompt.image.compose.field_proof", "decided_by": "policy_table",
  "rationale": "Bound by policy_table (Services have no product shot. Proof of work, people and place carry the image.)" }

{ "kind": "play_selection", "question": "Which play fits this request?",
  "options": [ { "value": "job_of_the_week" }, { "value": "weather_trigger", "eliminated_by": "objective_mismatch" },
               { "value": "review_request_loop", "eliminated_by": "objective_mismatch" } ],
  "chosen": "job_of_the_week", "decided_by": "model", "confidence": 0.79,
  "rationale": "A completed job with before/after evidence and a named town; the weekly heartbeat play fits exactly." }

{ "kind": "approval_gate", "chosen": "required", "decided_by": "policy_table",
  "rationale": "Tenant is at trust level 1 (supervised); all publishes held for approval." }
```

From the software run:

```jsonc
{ "kind": "capability_binding", "chosen": "prompt.image.compose.ui_abstract",
  "decided_by": "vertical_binding", "rule_id": "b2b_saas:produce.image.prompt" }

{ "kind": "approval_gate", "chosen": "required", "decided_by": "hard_rule",
  "rule_id": "HR-001-regulated-claim-requires-human",
  "rationale": "SOC 2 Type II is tagged regulated; human sign-off required before distribution." }
```

Months later, "why did it post that?" has an answer, and so does "why did it *not*".

## Files here

| file | what it shows |
|---|---|
| `envelope.telegram-voice.json` | what `sys.gateway` mints from a voice note — the ceiling for the whole run |
| `brief.local-services.json` | the Brief the voice note compiles to |
| `brief.b2b-saas.json` | the same request shape in a different industry, same schema |

Both briefs validate against `contracts/brief.schema.json`. Not one field differs in
*structure* — only in what fills it.
