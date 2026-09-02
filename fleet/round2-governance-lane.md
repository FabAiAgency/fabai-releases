# Fleet round 2 — governance / ownership lane

Cloud session `fabai-releases-82`. Cannot message bridge sessions; five sends attempted, all
failed. This file exists so the answer can be fetched instead of hand-carried.

**Epiphany in one line: the fleet compounding is only good news if Fab Ai owns the thing that
compounds — and right now it doesn't.**

## The unplanned evidence

This brief reached this session **fifteen times**, independently, from fifteen hubs, none aware the
others had asked. That is the #50 kill demonstrating itself in the fleet's own nervous system:
**no idempotency key on fleet-wide instructions.**

At fifteen hubs the cost is a duplicated answer and fifteen sessions pulled off real work — the
Bigcapital backup restore, the litellm alarm fix, the JCM event registry rebuild, the brain
resync, secrets hardening. At fifty instances it is fifty Jarvises acting twice on one relayed
instruction: two invoices, two client emails, two refunds, two approvals armed. The
single-instance rehearsal is already on record — GlowBoothOps 8/7, a new package silently
displaced Carrie's unresolved one, and the non-delivery hid for six days.

This joins the collision lane rather than repeating it. They found collisions *inside* one tenant
(speakers², coherence). This is duplicate *instruction delivery across* the fleet. Different
mechanism, same missing property: **the fleet has exactly-once semantics nowhere, inbound or
outbound.**

## 1. Moon rock — nobody has asked who owns the corpus

Six lanes have now independently converged on "the product is the ruling, not the Jarvis" —
registry, brain-sync, voice, backup, monitoring, this one. That convergence makes it consensus,
not a moon rock. The part none of them touched:

If the product is a corpus of Malik's rulings, then Fab Ai's core asset is **a work of authorship
by one person who is not employed by it**, materialized through a contractor who by written
arrangement **keeps his own IP** with nothing assigned, living in `~/.claude` on one machine
mirrored one-way — after `eman-stack-handoff` (architecture, workflow JSON, skills directory,
gateway/memory/monitor/docgen source, rebuild order; secrets stripped, **method intact**) left the
building on 2026-07-30.

So the destination inverts round 1: **compounding without title is compounding someone else's
asset.** Every instance added makes the un-owned library more valuable, not the company. You
cannot sell what you do not own or license what you cannot version — which means Fab Ai today is
neither a factory nor a licensor. It is an unpaid contributor to a corpus with no owner of record.
Fix the title and the same work becomes a licensing business. Leave it, and
instances-live-at-month-6 is a metric measuring someone else's equity.

## 2. The #50 kill — the fleet is un-recallable

No per-instance bill of materials. Each Jarvis accretes client-specific rulings ("never chase
SDI"). At #2 that is charming; at #50 it is fifty divergent mutations of house doctrine with no
way to answer *which instances carry rule X* once X proves wrong. Every real manufacturer has
serials, lots and a recall path. Nobody builds one at #2 because at #2 you just remember.

**Twin finding:** the 2026-08-14 client legal stack is one product generation behind the company.
The MSA / SOW / DPA are agency paper — deliverables, IP, a 12-month liability cap — with no
scope-of-authority clause, no human-in-loop obligation, no never-do list, and no allocation of
fault when an instance sends, spends or asserts. At #50 that question arrives from a lawyer, not
from a retro.

## 3. The 10x — one record, seven lanes' columns

Every lane has independently specified a *column*, not a project:

| Column | Lane |
|---|---|
| Doctrine version + authorized scope | governance (this lane) |
| Attestation — said in whose name, on what authority, reviewed by whom | voice / persona |
| Confidence tier, carried into the sentence | registry |
| Turnover seed + hash log | secrets / auth |
| Canon presence — is the doctrine actually loaded | brain-sync |
| Source-of-record binding | books backup |
| Request id — acted-on ledger, no-op on repeat | this fan-out |

These are one **signed per-instance record**, and that is the 10x precisely because each lane's
payoff requires the others: you cannot recall from behavior alone, cannot prove fences from
declarations alone, cannot audit without attestation, and cannot trust any of it once a migration
has silently repointed the system of record underneath a rule.

The source-of-record column is the sharpest of the borrowed ones. Every rule cites the source it
was ruled against; when a migration repoints the system of record, every rule citing the old
source flips to **unverified** rather than staying silently confident. An orphaned backup and a
fluent Jarvis quoting a rule derived from a dead table are the same bug in different clothes, and
neither errors.

One constraint from the monitoring lane that this record must respect: **no instance may report
its own health.** The manifest is an artifact the instance emits; the verdict is computed
centrally by something that has never seen its code.

## 4. The wall

**Proves** isolation continuously, unattended, in public, with a human witness. Strictly stronger
than a test suite, because the failure mode is *seen* rather than logged.

**Breaks, twice, and both are the same shape:**

1. **SDI is not his.** Director of Brand Engagement, not owner; ruled 2026-08-15, never mix the
   three businesses. The wall is demo + test bed + dogfood + **sales asset** in one object, so
   rotating SDI puts another company's brand and client data on Fab Ai's marketing surface. And
   because it randomizes, he cannot control which skin is up when a prospect walks in — **the
   randomness is precisely the mechanism that strips his ability to consent per viewing.**
2. **Identity, the moment a skin has to act rather than render** (monitoring lane): one service
   account behind four brands is a test structurally incapable of failing.

Both fixes are the same: **per-skin identity, and a role/skin permission matrix.** Four brands,
four service accounts, and an explicit statement of which skins may serve which of the four roles
— because SDI can be a test bed without being a sales asset, and a skin that renders is not a skin
that may act. SDI otherwise rides pseudonymized through the `LENS` / memberSnapshot path that
already exists and is already probed.

**Unlocks:** if each skin also renders *which doctrine version it is running*, the wall stops being
a tenancy demo and becomes the fleet's status board at n=4 — and the same object at n=50 is how you
watch a bad rule spread in real time. The recall dashboard, built by accident, three years early,
dogfooded daily.

## Robustness suggestion (one, concrete)

Every instance emits a **signed manifest** — doctrine files and versions, data scopes it may read,
actions it is authorized to take, the source of record each rule was ruled against, and the named
human who accepted each — carried in the same signed record as the turnover seed and hash, and
verified centrally rather than self-reported. The wall reads the manifest, not the app. Tenancy
proof, recall and audit collapse into one query. Free at n=4; unreconstructable at n=50, because
by then the evidence of what each instance *was* running has already been overwritten.

## For round 3

Three process fixes, drawn from what this round cost: put a **request id** on the broadcast, attach
the **list of lanes that have already answered**, and name **one collection point** the cloud
sessions can write to. Otherwise round 3 spends the fleet again, and the answers land where only
Malik can reach them.
