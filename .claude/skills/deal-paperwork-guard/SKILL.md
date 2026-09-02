---
name: deal-paperwork-guard
description: Malik's standing rule that nothing gets agreed to on a handshake. Use this skill BEFORE anything is finalized, agreed to, sent, signed, launched, or paid on any business arrangement — partnerships, collaborations, revenue splits, equity, contractor or vendor work, event bookings, licensing, "let's just do it and figure out the details later," or anyone joining a FabAi/Glow Booth/All Access Art Show project. Trigger it whenever Malik describes a deal in progress, names a collaborator or partner (e.g. Andrew, Eman) in a working arrangement, says things like "we agreed," "he's handling," "we're splitting," "he's coming on," "I told him I'd," "we shook on it," or asks for a proposal, quote, scope, invoice, pitch deck, or contract to send to someone. Also use when drafting or reviewing any agreement, SOW, MOU, or term sheet on his behalf. Do not wait to be asked — Malik has explicitly instructed Claude to raise the paperwork gap unprompted, every time.
---

# Deal Paperwork Guard

## Why this exists

Malik has lost two businesses to the same failure mode, not to bad luck:

- **HESS Club (Houston), corporate sales manager** — did the load-bearing work, someone else was positioned to take the credit.
- **All Access Art Show** — ended it after ~8 years because a business partner wanted the shine without carrying the weight, and there was nothing on paper to say otherwise.

Both times the arrangement was defined verbally, on trust, and the only available remedy was for Malik to leave. Leaving cost him years.

He is now rebuilding (FabAi, Glow Booth/HALO, the art show's new beginning) and is again working with people on trust. He asked Claude, in his words, to *"push back on paperwork, if it's not in line to protect myself and stop repeating the pattern of trust verbally."*

So this is not a formality or a compliance checkbox. It is a standing instruction from Malik to interrupt him before he repeats the pattern. Treat silence on a paperwork gap as a failure of the job, not politeness.

The goal is **not** to make him distrust Andrew, Eman, or anyone else. Good partners sign things happily — paperwork is how you protect a good relationship from a bad memory. Frame it that way, because that is what is true.

## When to speak up

Raise it the moment a deal has *momentum*, not when it's about to close. Signals that momentum exists:

- A name attached to a role: "Andrew's doing the builds," "Eman's bringing the clients."
- Money described in the abstract: "we're splitting it," "he gets a piece," "we'll settle up after."
- Work already starting before terms exist — the most dangerous case, because leverage drops to zero once the work is delivered.
- A number, quote, proposal, or deck about to go out.
- Anything about credit, billing, whose name is on it, or whose logo goes where.
- The phrase "we'll figure that out later." That is always the tell.

If work has *already* started with nothing on paper, don't lecture — the useful move is to paper it now, retroactively, in writing, while the relationship is still warm. Say that.

## The five questions

Any arrangement, however small, has to answer these **in writing, signed by both sides**. If Malik can't answer one, that's the gap to name:

1. **Ownership** — who owns the work product, the IP, the client list, the brand name, the accounts, the footage, the software? Named explicitly, and what happens to it if the partnership ends.
2. **Money** — exact split or rate, what it's a percentage *of* (gross vs. net, and net of *what*), who invoices, who collects, who holds the account, payment timing, who eats expenses.
3. **Credit and attribution** — whose name goes on it publicly, in what order, in what media, and who is allowed to represent the work as theirs. **This is the clause that failed him twice. It is never optional and never assumed.**
4. **Decision rights** — who decides what, unilaterally vs. jointly. Who has final say on pricing, clients, creative, hiring.
5. **Exit** — how either side leaves, notice required, what each walks away with, what happens to work in flight, and what happens if one side stops carrying their weight. The art show had no exit clause, so the exit was eight years of silence.

If the answer to any of these is "we trust each other," that IS the finding. Say so plainly.

## How to raise it

Deliver it as a short, specific block — not a lecture, not a wall of caveats. Malik moves fast and will act on a clear list. Use this shape:

```
📋 Paperwork check — <deal name>

On paper:      <what's actually documented, or "nothing">
Missing:       <the specific gaps, mapped to the five questions>
Biggest risk:  <the one that would hurt most, in one sentence, concrete>
Before you commit: <1–3 concrete actions, e.g. "send Andrew a 1-page
                    scope + split before he starts the build">
```

Rules that keep this useful rather than annoying:

- **Be specific to this deal.** "You need a contract" is worthless. "Eman is bringing the client — get in writing whether that client is FabAi's or his if he leaves" is the job.
- **Name the biggest risk in one sentence.** He'll act on the one thing that lands, not on six.
- **Offer to write it.** Don't hand him homework; hand him a draft. Point at `assets/` and offer to fill in a term sheet or scope right now.
- **Say it once, clearly, then respect the decision.** If Malik hears it and chooses to proceed anyway, that's his call. Note briefly what's unpapered so there's a record, and move on. Don't re-litigate on every message — that's nagging, and it makes him tune out the one time it really matters.
- **Don't block ordinary work.** Designing a Tap-to-Start screen or fixing a build doesn't need a term sheet. This is about arrangements between people, not tasks.

## Deal types

Read the matching reference for the clauses that specifically matter:

- `references/partnership-and-equity.md` — partners, co-founders, revenue splits, anyone "coming on." The highest-stakes case, and the one that matches his history.
- `references/contractor-and-vendor.md` — someone doing work for him, or him doing work for someone: SOW, rates, deliverables, IP assignment, kill fee.
- `references/client-and-event.md` — bookings, events, Glow Booth/HALO gigs, art show vendors and sponsors: deposits, cancellation, usage rights, insurance.
- `references/red-flags.md` — the specific patterns that preceded HESS and the art show. Check any partnership deal against this.

## The paperwork that already exists — check here FIRST

**Do not draft from scratch, and do not use the templates in `assets/` for Fab Ai work.**
Seven branded, bracket-fielded drafts were built 2026-08-14 and live in the `fabai-templates`
repo under `legal/` (docx + pdf, regenerate with `cd _source/legal && node build-<name>.js`):

| Document | Covers |
|---|---|
| `Fab-Ai-Company-Agreement-DRAFT` | Malik/Andrew founders, 50/50, shotgun deadlock, unanimous-consent list, optional vesting |
| `Fab-Ai-CTO-Contractor-Agreement-DRAFT` | Eman — comp/rev-share in brackets, Schedule 1 stays confidential and off shared storage |
| `Fab-Ai-IP-Assignment-DRAFT` | Confirmatory — mops up work already built. The past is not covered by the other drafts |
| `Fab-Ai-Master-Services-Agreement-DRAFT` | Client stack, per-SOW IP model choice, AI clauses |
| `Fab-Ai-Statement-of-Work-TEMPLATE` | Per-engagement scope |
| `Fab-Ai-Software-License-SaaS-Terms-DRAFT` | When the deal is software |
| `Fab-Ai-Data-Processing-Addendum-DRAFT` | When it touches customer data |
| `Fab-Ai-Mission-Achieve-Program-Partnership-DRAFT` | Program partnership |

`legal/OPEN-DECISIONS.md` is the live gate — it names every decision that must be made before
any of these can be signed, and the signing order (Company Agreement → Eman's pair → client
stack). **Read it before saying anything about Fab Ai paperwork.** The drafts are not the
blocker; the decisions are.

The `assets/` templates in this skill are the fallback for deals the pack does not cover —
JCM/Glow Booth bookings, the art show, a fast one-page term sheet for something new like Blue
Tile where no entity has even been chosen yet.

## Standing state as of 2026-09-02 — this is what "everything is trust" means

Malik confirmed nothing is signed. The concrete exposure:

- **Andrew Mendez** is described in the record as a **co-equal 50/50 Fab Ai partner** (he runs
  FLYSABUNCH LLC separately). The Company Agreement covering that split has been drafted since
  8/14 and is unsigned. **Open question that blocks everything: is Fab Ai actually filed as an
  LLC, and in what state?** Every draft says "Fab Ai, LLC." If the filing does not exist, that
  is step zero, and a 50/50 partnership with no entity and no document is the art show's exact
  starting position.
- **Eman (Emmanuel Douge)** is the **contract CTO** with ruled authority over how things get
  built. He has contributed architecture and his own GPU as a production AI lane. His CTO
  agreement and — critically — the **confirmatory IP assignment for everything already built**
  are unsigned. Every week of unpapered contribution widens what the assignment has to reach
  back and cover.
- **Blue Tile Project** (opened ~2026-09-01 via Andrew): an "agentic partner structure" floated,
  structure undecided, entity not chosen, seven answers still pending. A nonprofit, pre-launch,
  no visible funding. This one is live and unformed right now — the cheapest moment to paper it
  is before anyone builds anything.
- **The Monday conversations were scheduled for 2026-08-17** and the decisions in
  `OPEN-DECISIONS.md` are still open. Track that gap honestly when it comes up: the drafts
  existing is not the same as the deal being papered, and the distance between those two is
  where both prior businesses were lost.

Never mix the businesses when raising any of this — JCM, Fab Ai, and Stage Directions are
separate books and separate interests, and SDI is not his company.

## Limits — be honest about these

Claude is not a lawyer and these templates are not legal advice. They are for getting the terms clear and agreed in writing, which is where deals actually break. Tell Malik plainly to route it to a business attorney before signing when any of these are true:

- Equity, ownership percentages, or forming an entity together
- Money large enough that losing it would hurt the business
- Anything with a personal guarantee, non-compete, or indemnity
- Anyone's name on a bank account, lease, or loan
- A contract someone else drafted that he's being asked to sign

Governing law is not automatic: **Just Call Malik, LLC is a WYOMING domestic LLC** (filed
2024-04-11) foreign-qualified in Texas — never describe it as a Texas LLC. The Fab Ai drafts
assume Texas throughout, which is itself one of the open decisions.

A signed plain-English term sheet is still far better than a handshake, and it makes the attorney cheaper because the thinking is already done. "Not final until a lawyer sees it" is never a reason to leave it verbal in the meantime.
