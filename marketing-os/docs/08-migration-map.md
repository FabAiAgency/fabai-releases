# Migration map

Where every node of the original four canvases went, and what changed about it.

## 1 · Marketing Team Agent (Telegram)

| original node | now | what changed |
|---|---|---|
| Telegram Trigger | `sys.gateway` (telegram trigger) | joined by webhook, schedule and API triggers; all mint the same envelope |
| Switch (Voice / Text) | `intake.message.normalize` | source detection for Telegram, Slack, email, web form, CRM and schedule — not just two branches |
| Download Voice File | `intake.audio.transcribe` (fetch step) | folded into the transcribe terminal, so any channel's audio reuses it |
| Transcribe Audio | `intake.audio.transcribe` | unchanged in substance; now independently retryable and costed |
| Set 'Text' | `intake.message.normalize` | plus **PII redaction before any text reaches a model** |
| Marketing Team Agent (Tools Agent) | `sub.intake` → `plan.brief.synthesize` → `plan.campaign.compose` → `sys.orchestrator` | the biggest change: one agent deciding everything became understand → plan → dispatch, each auditable |
| GPT 4.1 (model) | `registry/models.json` role `reasoning.planner` | a role with a fallback chain, not a hard-coded vendor string |
| Think (tool) | `plan.campaign.compose` | reasoning is now a step with a recorded output, not a hidden scratchpad |
| Simple Memory | agent memory keyed `tenant:brand` | scoped per tenant and brand instead of globally |
| Video / LinkedIn Post / Blog Post (tools) | `sub.motion`, `sub.content`, `sub.distribution` | channel-specific tool-workflows became channel-neutral factories plus adapters |
| Create Image / Edit Image (tools) | `media.image.generate`, `media.image.edit` | prompt composition split out; provider fallback added |
| Search Images (tool) | `media.image.search` | promoted to a first-class terminal with a scored reuse-vs-generate decision |
| Telegram sendMessage | `dist.publish.telegram` | now gate-checked, idempotent and recorded |

## 2 · Video

| original node | now | what changed |
|---|---|---|
| Image Prompt Agent + 4 Parts + Split Out | `copy.script.generate` → `prompt.image.compose` | beat count derived from the vertical's `shot_grammar`, not fixed at four |
| GPT-4.1-mini, structured output | role `prompt.visual` | same model, now swappable and tier-capped |
| Generate Image → 90 Seconds → Get Images | `media.image.generate` | synchronous; no fixed wait |
| Generate Videos → 90 Seconds → Get Videos | `media.video.clip.generate` | **bounded polling with backoff and an absolute deadline**, replacing the fixed 90s sleep |
| Sound Agent + Generate Audio | `media.audio.vo.generate` | voice characteristics from the vertical profile; word-level timings extracted for caption sync |
| Upload to Drive / Share File | `asset.store.put` | plus checksum dedupe, embedding for semantic search, DAM registration and rights |
| Merge + Split Out Parts | `sub.motion` merge + `Fill Gaps with Stills` | a failed clip degrades to its keyframe instead of failing the render |
| Render Video → 25 Seconds | `media.video.render` (+3 vertical variants) | polling; timeline built as data; look chosen by vertical binding |
| Download Video / Send Video | `dist.publish.telegram` | one adapter, not an inline send |
| Title (message model) | part of the render/publish payload | — |
| Log Video (append sheet) | `asset.ledger.append` | one ledger schema for the whole estate, not per-workflow columns |

## 3 & 4 · LinkedIn Post and Blog Post

These two canvases were structurally identical. That duplication is the clearest argument for
the whole rebuild — and it is now impossible to reproduce, because the shared parts exist once.

| original node (both) | now | what changed |
|---|---|---|
| When Executed by Another Workflow | `executeWorkflow` trigger + envelope validation | rejects an unsupported contract version instead of half-running |
| Blog Post Agent + Tavily + GPT_4.1 | `copy.longform.generate` with `research.web.search` as a tool | research findings carry source URLs so copy can cite rather than assert; lexicon lint runs after generation |
| Image Prompt Agent + structured output | `prompt.image.compose` **or one of four vertical composers** | the routed decision that makes one pipeline serve every industry |
| Generate Image (OpenAI) | `media.image.generate` | provider fallback wired as a real error edge on the canvas |
| Convert to Binary | inside `media.image.generate` | handles both base64 and URL responses |
| Send Photo / Send Blog (Telegram) | `dist.publish.telegram` | gate-checked, idempotent |
| — | `dist.publish.linkedin`, `dist.publish.blog` | the actual destination channels, which the originals only previewed to Telegram |
| Upload (Drive) | `asset.store.put` | as above |
| Image Log (Sheets) | `asset.ledger.append` | as above |
| *(nothing)* | `sub.governance` | rights, compliance, brand and approval — the layer the originals had no equivalent of |
| *(nothing)* | `sub.measurement` | metrics back onto the asset, so the next run can prefer what worked |

## Net effect

| | before | after |
|---|---|---|
| workflows | 4 | 59 compiled from 59 specs |
| duplicated canvases | 2 identical | 0 — specialisations are ~15-line overlays |
| shared contract | none | 9 schemas |
| retry / timeout policy | per node, by hand | declared once per capability, injected |
| error path | none | every workflow, to a replayable DLQ |
| telemetry | ad-hoc Sheets rows | one event shape, one ledger, cost attributed per span |
| rollback | none | declared per side-effecting terminal, walked from provenance |
| governance gates | none | rights → compliance → brand → approval, non-bypassable |
| verticals supported | one, implicitly | 8 profiles, any number addable without touching a workflow |
| static checks | none | 0 errors required to build; 41 behavioural tests |

## What did not change

The parts that were right stay recognisable: an agent reading a voice note, a keyframe-then-
image-to-video pipeline, generate → store to Drive → log to Sheets, a Telegram reply to the
person who asked. The compiled canvases keep the coloured frames and left-to-right reading
order of the originals, because that grammar was good and people already know how to read it.
