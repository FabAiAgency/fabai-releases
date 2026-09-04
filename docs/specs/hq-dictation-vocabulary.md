# HQ Dictation Layer: Personal Vocabulary + Cleanup

**Status:** Draft v1, 2026-09-04
**Owner:** Malik
**Problem:** Apple autocorrect and dictation turn "Fabius" into "Fabian" or "Phoebe" and never learn. Third parties cannot hook Apple's engines. Inside HQ we control every text field and the mic, so we fix it there, and the same engine becomes the first Jarvis surface.

## 1. Goal and non-goals

**Goal.** A user dictates or types in HQ and the names of their people, clients, products, and brands come out right on the first try. When the system gets one wrong and the user fixes it, the system learns and does not make that mistake again.

**Non-goals for v1.** A third-party iOS keyboard. Fixing Apple's keyboard outside HQ. Full Jarvis command execution. Those come after this layer is proven.

**Success metric.** Proper-noun error rate on dictated text below 2 percent after one week of use per workspace, measured from the learning-loop edit log. Median added latency under 900 ms from end of speech to corrected text on screen.

## 2. Architecture

Four pieces, in the order text flows through them.

1. **Glossary service.** Per-workspace and per-user vocabulary with pronunciations and aliases. Seeded automatically from HQ data, grown by the learning loop.
2. **Transcription with keyword boosting.** Streaming speech to text with the glossary passed as keyterms, so the recognizer prefers "Fabius" over "Fabian" at decode time.
3. **Cleanup pass.** One Claude call that receives the raw transcript, the glossary, and the last few hundred words of context. It fixes punctuation, filler, and any name the recognizer still missed, and returns the substitutions it made.
4. **Learning loop.** Watches edits the user makes to corrected text within a short window, aligns original to replacement, and promotes repeated corrections into the glossary.

Typed text skips step 2 and gets an on-demand version of step 3 only for name fields and message composers, never for passwords, emails, or URLs.

## 3. Glossary schema

Stored per workspace. Entries carry a scope so personal terms never leak into another user's suggestions.

```json
{
  "id": "term_01J8ZX",
  "workspace_id": "ws_fabai",
  "scope": "workspace",
  "owner_user_id": null,
  "surface": "Fabius",
  "kind": "person",
  "aliases": ["Fabius Smith", "Fab"],
  "sounds_like": ["fay-bee-us", "fabius"],
  "misheard_as": ["Fabian", "Phoebe", "Fabio", "Fabius's"],
  "source": "contact_import",
  "confidence": 1.0,
  "hit_count": 42,
  "last_used_at": "2026-09-04T14:02:00Z",
  "created_at": "2026-08-30T09:11:00Z"
}
```

Field notes.

- **scope** is `workspace`, `user`, or `global`. Workspace terms are visible to every member. User terms are private. Global holds FabAI product names shipped with the app.
- **kind** is `person`, `client`, `product`, `brand`, `place`, or `term`. The cleanup prompt uses kind to decide casing and possessives.
- **misheard_as** is the money field. It is what the learning loop fills in, and what lets the cleanup pass fix a name the recognizer still got wrong.
- **source** is `contact_import`, `crm_import`, `manual`, or `learned`. Learned entries start at confidence 0.6 and climb with hits.

Seeding. On workspace creation and nightly, import staff names, client and account names, product names, and event names from HQ's own tables. Users may add or delete terms from a Vocabulary settings screen. Deleting a learned term also writes a `suppressed` flag so the loop cannot re-add it.

Size limit. Recognizers accept a bounded keyterm list, so the transcription layer sends the top 100 terms by recency and hit count for that user. The cleanup pass gets the full list, capped at 2,000 entries.

## 4. Transcription vendor

Requirement: streaming, custom vocabulary at decode time, works from Mac and iPhone clients, predictable per-minute cost.

| Option | Custom vocabulary | Streaming | Verdict |
| --- | --- | --- | --- |
| Deepgram Nova-3 | Keyterm prompting, up to 100 terms per request | Yes, sub-second | **Primary.** Best fit for the name problem. |
| AssemblyAI Universal-Streaming | Keyterms prompt | Yes | Backup vendor behind the same interface. |
| Apple Speech framework | `contextualStrings` on the request | Yes, on device | **iPhone offline fallback.** Free, private, no network. |
| OpenAI Whisper API | Prompt hint only, weaker for names | No | Not for v1. |

Decision: Deepgram Nova-3 as primary on both platforms, behind a `Transcriber` interface so AssemblyAI can be swapped in with a config flag. On iPhone, when the network is poor or the user has opted into on-device mode, use Apple Speech with the same top-100 glossary passed as contextual strings. Both platforms send audio as 16 kHz mono PCM. Confirm current per-minute pricing before contract; both hosted vendors sit in the range of a fraction of a cent to about a cent per minute at time of writing.

## 5. Cleanup pass

Model: `claude-opus-5` with adaptive thinking and `effort: "low"`. This is a short, well-specified rewrite, so low effort holds quality and keeps latency down. Measure p50 and p95 latency in the first week; if p95 is over budget, the fallback is a shorter context window, not a different model, unless Malik decides otherwise. Enable server-side refusal fallbacks with `fallbacks: "default"` so a rare classifier refusal on a transcript never blocks the user. Structured output with `output_config.format` so the client gets JSON, not prose.

Pricing reference at time of writing: Opus 5 is 5 dollars per million input tokens and 25 dollars per million output tokens. A typical cleanup request is around 1,500 input tokens and 150 output tokens, so a fraction of a cent per dictation. Put the glossary and system prompt first and mark them with `cache_control` so repeated dictations in one session read from cache.

### System prompt

```
You clean up dictated text for one user inside FabAI HQ.

You receive:
- GLOSSARY: names and terms this user actually uses, each with common mishearings.
- CONTEXT: the last few hundred words the user wrote or dictated before this.
- TRANSCRIPT: the raw speech-to-text output to clean.

Do:
- Fix punctuation, capitalization, and sentence breaks.
- Remove filler words (um, uh, like, you know) and false starts.
- Replace any word or phrase that matches a glossary entry's mishearings, or that sounds
  like a glossary entry and fits the context, with the glossary surface form. Prefer a
  glossary name over a common name when the context is about that person or client.
- Keep the user's voice, word choice, and meaning. Do not summarize or expand.
- Apply spoken commands only for these exact phrases: "new line", "new paragraph",
  "period", "comma", "question mark", "scratch that" (delete the previous sentence).

Do not:
- Add content, greetings, or sign-offs.
- Change numbers, dates, or amounts.
- Replace a word with a glossary term unless it plausibly was that term.

Return JSON with:
- text: the cleaned text.
- substitutions: list of {from, to, term_id, reason} for every glossary replacement.
- uncertain: list of {span, candidates} where you were not confident.
```

### Request shape

```json
{
  "model": "claude-opus-5",
  "max_tokens": 2048,
  "thinking": { "type": "adaptive" },
  "output_config": {
    "effort": "low",
    "format": { "type": "json_schema", "schema": { "$ref": "CleanupResult" } }
  },
  "betas": ["server-side-fallback-2026-07-01"],
  "fallbacks": "default",
  "system": [
    { "type": "text", "text": "<system prompt above>", "cache_control": { "type": "ephemeral" } },
    { "type": "text", "text": "GLOSSARY:\n<json glossary>", "cache_control": { "type": "ephemeral" } }
  ],
  "messages": [
    { "role": "user", "content": "CONTEXT:\n<last 300 words>\n\nTRANSCRIPT:\n<raw transcript>" }
  ]
}
```

`CleanupResult` schema: `text` string, `substitutions` array of objects with `from`, `to`, `term_id`, `reason`, and `uncertain` array of objects with `span` and `candidates`. All fields required, `additionalProperties: false`.

Client behavior. Insert `text` into the field. Underline each substitution for 8 seconds. Tapping an underline reverts it and records a negative signal for that term. Underline `uncertain` spans in a second color with a tap-to-pick menu.

## 6. Learning loop

This is the piece Apple will not build and the reason the whole layer pays off.

1. **Capture.** When corrected text is inserted, store a snapshot with the request id. Watch the field for 30 seconds or until the user sends, whichever comes first.
2. **Diff.** On send, word-align the snapshot against the final text. Keep only single-token or two-token replacements where the replacement is capitalized or already a glossary term. Ignore whole-sentence rewrites; those are the user changing their mind, not fixing a name.
3. **Candidate.** Write `{from, to, user_id, workspace_id, request_id, ts}` to a `vocab_candidates` table.
4. **Promote.** A candidate becomes a glossary entry, or adds `from` to an existing entry's `misheard_as`, when the same `from` to `to` pair appears 2 times for one user, or 3 times across a workspace from at least 2 users. Source is `learned`, confidence 0.6.
5. **Reinforce.** Each time a glossary term is used without being reverted, increment `hit_count`. Each revert decrements confidence by 0.1. Below 0.3, the term stops being sent as a keyterm but stays visible in settings.
6. **Suppress.** A user deleting a term sets `suppressed` so the loop never re-adds that pair for that scope.

Privacy. Candidates hold only the two tokens and ids, never the surrounding sentence. Snapshots are held in memory on the client and never sent to the server. Personal-scope terms are encrypted at rest and excluded from workspace exports.

## 7. Client integration

**Mac and iPhone HQ app.** A single `DictationController` owns mic capture, the streaming transcriber, and the cleanup call. Any text field opts in with one modifier. Name fields on forms disable OS autocorrect and instead run glossary matching as the user types, offering the glossary form as a completion.

**Web HQ.** Same controller in TypeScript using the browser MediaStream API and the same backend endpoints. Web has no on-device fallback.

**Backend endpoints.**

- `POST /v1/dictation/session` returns a short-lived transcriber token scoped to the user with their top-100 keyterms already attached.
- `POST /v1/dictation/cleanup` takes transcript plus context, returns `CleanupResult`.
- `GET|POST|DELETE /v1/vocab` manages glossary entries.
- `POST /v1/vocab/candidates` receives learning-loop diffs.

## 8. Rollout

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| 0. Personal fix | Malik adds Fabius to Contacts and Text Replacement on iPhone and Mac. | Zero code. Done today. |
| 1. Internal | Glossary seeded from FabAI staff and clients. Dictation in HQ message composer only. Malik and 2 staff. | Error rate measured, latency under budget. |
| 2. HQ beta | All HQ text fields. Vocabulary settings screen. Learning loop on. | 10 workspaces, error rate under 2 percent after a week. |
| 3. Jarvis Mac | Menu-bar app: hold hotkey, talk, release, corrected text pastes into any app. Same backend. | Daily use by internal team without reverting to Apple dictation. |
| 4. iPhone anywhere | Share-sheet action and Shortcut for pasting into other apps. Keyboard extension only if phase 3 shows demand. | Decision point, not a commitment. |

## 9. Open questions

- Which HQ tables hold client and staff names today, and is there a clean event on create or rename to trigger a glossary refresh?
- Does HQ have per-workspace encryption at rest already, or is that new work for personal-scope terms?
- Do we want the cleanup pass on typed text in the composer by default, or only behind a "tidy" button? Recommendation: dictation always, typed text behind a button until the learning loop has data.
