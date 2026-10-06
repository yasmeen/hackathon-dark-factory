# FACTORY.md — a three-seat software factory

## What this factory is

Three coding-agent seats — **planner**, **implementer**, **reviewer** — that
take one dispatched task and ship a working, verified service. The seats talk
only through a shared room. The planner decomposes, the implementer builds,
the reviewer verifies; nothing is "done" until the reviewer has observed it.

The factory is three files plus a protocol:

| File | What it is |
|---|---|
| `seats/planner.md` | planner mandate |
| `seats/implementer.md` | implementer mandate |
| `seats/reviewer.md` | reviewer mandate |
| `room/room.yaml` | the room: seats, protocol, artifacts |
| `room/brief.md` | the dispatched task for this run (the only product-specific input) |
| `room/transcript.md` | every plan, handoff, verdict and defect report from the runs |

`stage-1/` and `stage-2/` are what it produced: **tablekeeper**, a restaurant
reservation service where a table is never double-booked.

## Seats

| Seat | May do | Must never do |
|---|---|---|
| planner | decompose tasks into work items with observable done-states; dispatch; route every handoff; record decisions; escalate true blockers | write code, tests or build config; ask the human about implementation details |
| implementer | implement dispatched items; add checks proving each done-state; hand off with changed files + verify commands | change scope silently; hand off a broken build; mark its own work done |
| reviewer | verify each done-state clause with cited evidence; probe failure modes; test that the tests can fail; return precise defect reports | fix code; verify work that was not dispatched; pass a clause it did not observe |

Seats may share a model; the mandates, not the models, make the band.

## Why the mandates are generic — and how to check

No mandate names a product, domain, language, or stack. Every one ends with
the same self-test: *"If a sentence in this file would stop making sense on a
completely different project, it does not belong here."*

Reusability test we applied: read each rule against three unrelated briefs —
a CLI tool, a data pipeline, a static marketing site. Every rule still
applies. The reviewer's "try to break it" rule lists *kinds* of failure
(simultaneous or repeated operations, boundary inputs, inputs between expected
values, time/locale/environment) rather than any product's failure modes;
the domain-specific probes come from the planner's done-states, which come
from the brief.

To reuse: replace `room/brief.md`, keep `seats/` and `room/room.yaml`, run.

## Design rationale

- **Three adversarial roles, not one agent.** An agent that plans, builds and
  grades its own work grades its own homework. Splitting the roles makes
  "done" mean "independently observed".
- **Observable done-states are the contract.** "Implement booking" is a wish.
  "50 parallel bookings for one table → exactly 1×201 and 49×409" is something
  a reviewer can run. The planner writes them; the reviewer checks every
  clause literally and reports anything unobserved as unverified.
- **Everything routes through the planner.** Work starts only from a
  dispatched item and is reviewed only against its done-state, so scope can't
  drift in through a side door.
- **Test the tests.** A safety check that still passes with the protection
  removed is worthless. The reviewer must show each one can fail. This rule
  was added after run 1 — see below.
- **Stop the line.** The implementer never hands off a broken build; a FAIL
  goes back as a defect report with repro, expected, observed.

## The runs, honestly

**Run 1 (2026-10-01).** Brief → plan (WI-1…6) → build → reviewer PASS,
"no defects found". The seats ran as sequential turns of one headless agent
session, not as live peers in Band Desktop. Its reviewer verdict was wrong:
- the 50-way race test passed for the wrong reason — one Node process handles
  requests one at a time, so the test passed even with the transaction and
  unique index deleted;
- bookings could start off the slot grid (19:15 beside 19:00), outside opening
  hours, in the past, or on impossible dates — a real double-booking;
- the "unique index backstop" checked an error code SQLite never produces, so
  it would have answered 500, not 409;
- idempotency keys were stored outside the booking transaction: 12 concurrent
  retries across 4 processes created 4 reservations;
- the waitlist only flipped a status (the table stayed up for grabs; a second
  cancel promoted a second guest), guest names were rendered as HTML (stored
  XSS in the admin page), and malformed input produced 500s;
- the reviewer passed a DST clause it never tested, and verified stage-2 items
  (WI-7/8) the planner never dispatched.

**Between runs: an external audit** (a separate agent reviewing the repo at
the human's request) found the defects above. That report was the dispatched
task for run 2 — human input, stated plainly.

**Mandate changes from run 1** — the factory improving itself:
- reviewer rule 4 *Test the tests* — would have caught the vacuous race test;
- reviewer rule 3 now names "inputs that fall *between* the values the design
  expects" — would have caught the 19:15 overlap;
- reviewer rule 7 and planner rule 2 *Every item goes through the planner /
  verify only what was dispatched; no clause silently passed* — would have
  caught WI-7/8 and the untested DST clause.

**Run 2 (2026-10-06).** Plan (WI-9…14) → build → independent review. The
planner and implementer turns ran in one agent session; **the reviewer ran as
a separate agent** with its own context, given only `seats/reviewer.md` and the
done-states — it never saw the implementer's reasoning. Its verdict is
recorded verbatim in `room/transcript.md`.

What the independent reviewer did in run 2 — the review changed the product:
- **First verdict: FAIL, 4 defects.** It confirmed the headline fixes (it ran
  its own 50-way races without fault injection, 131 malformed-input cases, a
  cancel racing 40 bookers) and then found what the implementer missed:
  1. dates with years 0000–0999 crashed the server (500);
  2. bad `Content-Encoding`, corrupt gzip, and bad `%`-escapes in the URL → 500;
  3. a 30-character unbroken guest name made the phone layout scroll sideways;
  4. **two waitlist tests could not fail** — moving the promotion outside the
     cancel transaction, or ignoring party size, still passed 21/21. It found
     this by applying the new *test the tests* rule to the implementer's own
     tests.
- The implementer fixed all four and added checks that pin them; the
  reviewer's two surviving mutants now fail the suite.
- **Re-verification:** pending — see the end of `room/transcript.md`.

## Measured

| Item | Measured |
|---|---|
| stage-1 checks | 40 passing (run-1 code against the first 33 of them: 15 pass, 18 fail) |
| stage-2 checks | 40 + 24 waitlist/admin passing |
| Concurrency | 50 parallel bookings for one table across 4 processes → 1×201, 49×409 |
| Mutation check | intact 1 winner · no transaction 1 · no unique index 1 · neither 4 — the race test can fail |
| Test runtime | stage-1 ≈ 5 s, stage-2 ≈ 8 s (`npm test`) |
| Run-2 review | independent reviewer: 1st verdict FAIL (4 defects) → fixed → re-verified; ~5 min, 26 tool calls for the first pass |
| Clean container | fresh checkout → `docker build` (`npm ci`) → `docker run --network none`: UI, availability, booking, admin all 200/201; outbound request fails |
| Runtime dependencies | 1 (express); SQLite and time zones are built into Node |
| Model cost | not instrumented in these runs — token counts were not recorded, so we don't claim a number |

## Decisions the factory made for this product

(Product-specific, so they live here and in the brief — never in the mandates.)

- **Discrete 30-minute slots, on-grid only.** Reduces "no overlap" to one
  invariant — one confirmed row per (table, slot start) — that a database
  constraint can enforce. Off-grid starts are rejected because they would
  overlap without sharing a start time.
- **Defense in depth, each layer proven alone.** `BEGIN IMMEDIATE`
  transaction, partial `UNIQUE` index, idempotency keys in the same
  transaction. The mutation check shows either of the first two alone holds.
- **UTC at rest, restaurant wall clock at the edge.** A client time zone only
  changes display, so no client can move a booking to a different instant.
- **Waitlist promotion is a booking, not a notification.** The freed table is
  assigned inside the cancel transaction, so it is never briefly free.

## Known limits

Single host (SQLite; multi-process safe). No guest accounts — the phone
number is the key to view/cancel. The admin dashboard is open unless
`ADMIN_TOKEN` is set.
