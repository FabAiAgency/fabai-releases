# Backcast — Fabius as someone you talk to about the business

**Date:** 2026-09-16 · **Owner:** Malik McGhie · **Status:** design, nothing built yet

> "I want to converse to find out more about my biz. Fabius does nightly teases and I
> want to pick his brain. I don't want to read it — I want to talk to him."

A backcast starts at the finish and walks backwards, asking at each step: *what had to
already be true for this to work?* The build order at the end is that chain, reversed.

---

## 0. The destination

One scene, specific enough to test:

> It's 7:10am. Malik is driving. He says *"Fabius, the brief said two leads went quiet —
> who?"* Two seconds later Fabius answers out loud: *"Aubrey Purdom, eleven days, last
> touch was the Methodist quote. And Dana Reyes, nine days."* Malik says *"what was the
> Aubrey number?"* — no name repeated, no context re-established — and Fabius answers.
> Then *"draft her a follow-up."* He never opens HQ. He never reads anything.

Three properties are doing all the work in that scene, and today the system has none of them:

| Property | Today |
|---|---|
| **Answers arrive as speech** | Business answers are posted to HQ as text; the voice says "it'll land in your HQ" |
| **Answers arrive fast** | Round-trip is a Claude-bridge job, not a lookup — seconds to minutes, and async |
| **Follow-ups keep context** | Every session is a cold start; the transcript is written but never read back |

Everything below is the chain of things that must become true, walked backwards from that scene.

---

## 1. What I found in the code

Grounding first, because the gap is not what it looks like. **Fabius is not slow at
answering business questions. He is architecturally built not to answer them at all.**

### 1.1 The voice is wired to defer, on purpose

`fabius-live/relay.mjs:160-163` states the design in its own comment:

> "BOTH endpoints are async: they return a jobId and post the result into HQ Discuss
> (ch 17), so the voice confirms 'on it / it'll post to HQ' rather than speaking a
> result the bridge never hands back."

So `fabius_recall` (`relay.mjs:216`) returns the literal string *"Looking into it now;
the answer posts to your HQ shortly."* And the system prompt (`relay.mjs:75-81`) makes
that a persona law:

> "You do NOT know his business data from memory... The instant he asks about one you
> MUST call `fabius_recall`... tell him: 'Pulling that now, it'll land in your HQ.'"

That law is *correct* — it's what stops him confabulating client facts. But its
destination is wrong for this goal. Every question about the business is converted into
something to read. **The thing you want to stop doing is the thing the code is designed
to do.** No amount of latency tuning fixes this; it's a routing decision.

### 1.2 The fast answer path already exists and is not connected

`fabius-memory` exposes `POST /recall` on `127.0.0.1:8790`. From its README:

> "Zero-LLM ranking: exact email/name frontmatter match → FTS5 BM25 → 1-hop wikilink
> expansion. `context_block` is hard-capped at `budget` chars."

It returns `{hit, context_block, citations, entities, took_ms}`, budget-capped at 1200
chars by default (`service/main.py:62`), tenant-scoped, and it already measures its own
latency. There is no model call in the path — it's SQLite FTS5 (`service/recall.py`).
This is a tens-of-milliseconds lookup.

**Nothing in `fabius-live` calls it.** The two systems were built by different hands and
never met. This is the single highest-leverage fact in the whole review: the hard part
(fast, grounded, cited business recall) is built, tested, and running — it is simply not
plugged into the mouth.

### 1.3 The nightly brief throws away everything worth asking about

`fabius-stack/workflows/morning-brief.json` fires at 08:00 and assembles calendar +
receivables + pipeline-by-stage + stale leads + attention items. The `Build Brief` node
computes genuinely rich structure — open lead counts per stage, summed revenue, days-quiet
per lead — and then **renders it to an HTML string and discards the structure.** Only the
prose reaches Discuss.

That is exactly why "the brief said two leads went quiet — who?" cannot be answered. The
brief *knew*. It didn't keep it. The tease is write-only.

### 1.4 Free tier is the reliability ceiling — and the phone has no soft landing

`relay.mjs:39` runs `gemini-3.1-flash-live-preview` on a free key. `relay.mjs:117`:
`CEILING_V1 = 20` — the observed count of sessions before the first `1011` close (quota
exhausted). `brakeState()` brakes at 80% of that.

But the brake is deliberately kiosk-only (`relay.mjs:251-253`): *"Malik's phone is NEVER
braked."* Kind intent, bad failure mode. When the quota is gone, the phone doesn't get a
graceful "we're out for today" — it gets a socket that dies at `1011` mid-sentence, and
`live.html` has no handler that explains it. **"It was buggy yesterday" is, with high
probability, this.** At ~20 sessions/day, conversational use — which means many short
sessions, not a few long ones — burns the budget in a morning.

### 1.5 Vision is a tax you're paying on a conversation that doesn't need it

`live.html:354-359` ships a JPEG every second, unconditionally, while the camera is on:

```js
frameTimer = setInterval(() => {
  cv.getContext('2d').drawImage(videoEl, 0, 0, cv.width, cv.height);
  ws.send(JSON.stringify({ frame: cv.toDataURL('image/jpeg', 0.6).split(',')[1] }));
}, 1000);
```

`toDataURL` is a synchronous main-thread encode, base64 inflates it ~33%, and every frame
enters the model's context. For "tell me about my pipeline," this is pure cost — latency,
tokens, and quota (see 1.4) — for zero benefit. Fabius Live was built camera-first
("eyes through the phone"). What you're asking for now is **ears-first**, and that is a
different, much cheaper session shape.

### 1.6 Every session is a cold start

A new phone connection opens a fresh Gemini socket (`relay.mjs:276`) and resends the full
~4KB system prompt. `contextWindowCompression: { slidingWindow: {} }` (`relay.mjs:292`)
deliberately drops the stale tail to stop long-session confabulation — a good fix for the
problem it was aimed at, but it means depth is actively pruned.

Meanwhile the relay *does* write every turn to `~/.local/state/fabai/fabius-live-docket.jsonl`
(`relay.mjs:334-336`) — honest capture, added after "7 of 8 'noted' claims vanished on
2026-09-05." **That file is never read back in.** You have a complete conversational
history with Fabius that Fabius cannot see.

### 1.7 Two smaller real bugs

- **Timezone.** `fabius-stack/CLAUDE.md:13` is unambiguous: *"Timezone everywhere:
  America/Chicago. Not Denver."* `morning-brief.json`'s `Build Brief` formats event times
  with `timeZone: 'America/Denver'`, and `discuss-hub.json`, `crm-router` and
  `bc-router-ecc.json` all carry `"timezone": "America/Denver"` from the inherited stack.
  **Your nightly tease is showing you times an hour off.** Cheap fix, corrodes trust fast.
- **No jitter buffer on playback.** `live.html:270`:
  `t0 = Math.max(t0, out.currentTime); s.start(t0)`. The first chunk of every reply is
  scheduled at *exactly* the current time, so any network jitter smaller than one buffer
  produces a gap or click. A ~120ms lead-in removes a whole class of "it sounded broken."

---

## 2. The backcast

Walking back from the 7:10am scene. Each layer is a *precondition* for the one above it.

### Layer 5 — the scene works
**"The brief said two leads went quiet — who?"** answered out loud, with a follow-up that
doesn't repeat the name.

*What had to be true first?* Fabius must be able to reach **both** last night's brief
**and** this morning's conversation. Which needs layers 4 and 3.

### Layer 4 — the nightly tease is a conversation opener, not a wall
The brief writes a **structured briefing pack** alongside the prose — the same arrays
`Build Brief` already has in hand, dropped to JSON (or into the vault as a dated note).
The voice session preloads *today's pack* at connect.

*Why this layer exists:* without it, "who went quiet?" requires recomputing the pipeline
live, which is slow and can disagree with what the brief actually said. The pack makes
the brief **quotable**. This is a ~20-line change to a node that already computes the data.

*What had to be true first?* Something has to be able to speak an answer at all — layer 3.

### Layer 3 — business answers come back as speech
`fabius_recall` stops calling the async Claude bridge and calls `fabius-memory`
`POST /recall` synchronously, returning the `context_block` **into the tool response**, so
Gemini speaks it in the same turn. Citations ride along; the HQ post becomes a *receipt*,
not the delivery mechanism.

The persona law changes shape but not spirit: *"Answer only from the context block you
were given. If `hit` is false, say you don't have it — never guess."* Grounding is
preserved (that law was right); only the destination moves from HQ to his ear.

`fabius_do` **stays async and stays parked.** Doing things and knowing things are
different risks. This whole plan touches the knowing lane only.

*What had to be true first?* The session has to survive long enough and respond fast
enough to be worth talking to — layer 2.

### Layer 2 — a reliability and latency floor
- A **voice-only session mode** (no `frameTimer`) as the default for "talk to me" — camera
  becomes opt-in, per 1.5. Biggest single latency and quota win, and it's a one-line guard.
- The brake applies to the phone too, but as a **spoken warning**, not a dead socket:
  "that's my last few sessions today." Plus a `1011` handler in `live.html` that *says*
  what happened instead of going silent (1.4).
- Consider whether the free key is still the right call. Conversational use is many short
  sessions; ~20/day is roughly one morning. A paid key may be the cheapest fix on this
  entire list — but that's your call, and the meter in `relay.mjs` already gives you the
  real number to decide on, which is why it's a decision and not a task.
- Playback lead-in + the timezone fix (1.7).

*What had to be true first?* You need to know what's actually slow — layer 1.

### Layer 1 — measure the turn
Today `relay.mjs` meters **sessions** (duration, tokens, quota) but not **turns**. "Fabius
is slow" currently has no number attached, and four different things could own it: mic →
relay, relay → Gemini first-token, tool round-trip, first-audio-out → speaker.

Log four timestamps per turn into the existing usage JSONL. One evening's data tells you
whether layer 2 is a five-minute fix or the real work. **Do not skip this** — it's the
difference between fixing the slowness and redecorating around it.

---

## 3. Build order (layer 1 → 5)

| # | Step | Touches | Size | Unlocks |
|---|---|---|---|---|
| 1 | Per-turn latency timestamps | `relay.mjs` | S | Knowing what "slow" means |
| 2 | Voice-only mode (camera opt-in) | `live.html`, `relay.mjs` | S | Latency + quota headroom |
| 3 | Graceful quota: spoken warning + `1011` handler | `relay.mjs`, `live.html` | S | Kills the "buggy" feeling |
| 4 | Timezone → America/Chicago; playback lead-in | `morning-brief.json`, `live.html` | XS | Trust in the numbers |
| 5 | **`fabius_recall` → `fabius-memory:8790/recall`, synchronous** | `relay.mjs` | **M** | **Fabius speaks about the business** |
| 6 | Rewrite the recall persona law (ground on `context_block`) | `relay.mjs` SYSTEM | S | Answers without confabulation |
| 7 | Brief emits a structured pack; session preloads today's | `morning-brief.json`, `relay.mjs` | M | "The brief said…" works |
| 8 | Replay last N docket turns at connect | `relay.mjs` | M | Continuity across sessions |

Steps 1–4 are one evening and make the current thing feel fixed. **Step 5 is the one that
changes what Fabius is** — it's the moment he stops being a dispatcher and starts being
someone you can ask. Steps 7–8 are what make it feel like a relationship rather than a
query box.

---

## 4. What I'd flag before you commit

- **The honesty law is not the problem — don't let anyone "fix" it.** It was earned
  (7 of 8 false "noted" claims, 2026-09-05). Layer 3 moves *where* the answer goes; it
  must not loosen *whether* Fabius is allowed to make things up. Grounding on
  `context_block` keeps the law and moves the destination.
- **Recall quality is the real unknown.** `/recall` is zero-LLM BM25. It will be excellent
  on "tell me about Aubrey Purdom" (exact frontmatter match) and weak on "how did Q3 feel"
  (no term overlap). Before building step 7, throw twenty questions you'd actually ask at
  `/recall` and read the `context_block`s. If it hits on most, this plan is sound. If it
  misses, the bottleneck is vault coverage, not the voice — and that's a different project
  with a different shape. **This is the cheapest test on the list and the one I'd run first.**
- **`fabius_do` stays parked.** Nothing here touches the money or outward lane.
- **Everything above is read-only work against running services.** Step 5 points the relay
  at a service that already exists; nothing here requires new infrastructure.
