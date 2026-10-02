# FACTORY.md — the tablekeeper software factory

## What this factory is

A band of three coding-agent seats that takes a single dispatched task and
ships a working service with zero further human input. The seats communicate
through a shared room; the planner decomposes, the implementer builds, the
reviewer verifies. This file, the seat mandates in `seats/`, and the run
transcript in `room/transcript.md` are the factory. The `stage-1/` and
`stage-2/` services are what it produced.

## Seat setup

| Seat | Mandate | May do | Must never do |
|---|---|---|---|
| planner | `seats/planner.md` | decompose tasks into work items with observable done-states; dispatch; record decisions; escalate true blockers | write production code; ask about implementation details |
| implementer | `seats/implementer.md` | implement dispatched items; add checks proving each done-state; hand off with changed files + verify commands | change scope silently; mark own work done |
| reviewer | `seats/reviewer.md` | verify against done-states with cited evidence; probe failure modes; return precise defect reports | fix code (that would make it an implementer) |

Seats may share a runtime and model — the mandates, not the models, are what
make the band. In Band Desktop each seat is a peer with its mandate file
attached; in this headless environment the same seats ran as directed turns
and every message was logged to `room/transcript.md` (the room export
equivalent). Mandates are deliberately generic: nothing in them names this
track, product, or stack, so the same three files drive any future build.

## Design rationale

- **Why three seats and not one.** Planning, building, and verifying are
  adversarial roles. One agent doing all three grades its own homework; the
  reviewer seat exists so "done" means "independently observed", not "felt
  complete". The planner's done-states are the contract between the seats.
- **Why observable done-states.** "Implement the booking endpoint" is a wish;
  "50 parallel bookings for one slot produce exactly 1×201 and 49×409" is a
  contract a reviewer can execute. Every work item in the transcript carries
  one.
- **Why discrete 30-minute slots.** The track's hard part is double-booking
  under concurrency, retries, and time zones. Discrete slots reduce overlap
  arithmetic to a single invariant — one confirmed row per (table, slot) —
  enforceable by a database constraint, which no amount of application logic
  can wriggle out of.
- **Why defense in depth on booking.** Three independent layers: (1) a
  `BEGIN IMMEDIATE` transaction makes check-and-insert atomic; (2) a partial
  `UNIQUE` index is the backstop for races the transaction cannot see;
  (3) idempotency keys make retried requests replay instead of duplicate.
  Any one layer failing still leaves the invariant intact.
- **Why UTC at rest, IANA zones at the edge.** Storing instants and
  converting only for display/input removes an entire class of DST bugs;
  the Node `Intl` API needs no external tz database, which keeps the
  no-outbound-network container honest.

## Measured costs

This run (stage-1 + stage-2, both verified):

| Item | Measured |
|---|---|
| Implementer turns (plan → code → tests) | single continuous session per stage |
| Reviewer checks | 13 automated checks, all passing (stage-1 suite); waitlist promotion flow verified live (stage-2) |
| Concurrency probe | 50 parallel same-slot bookings → exactly 1 winner, 49×409 |
| Clean-container check | fresh checkout → `npm ci` → service runs with no external network (only loopback); availability, booking, and UI all 200/201; outbound attempt blocked |
| External API spend | $0 — no model APIs, no paid services; SQLite + Node stdlib |

The factory's own cost is dominated by the implementer's build turns; the
reviewer's checks are cheap and re-runnable (`npm test`).

## How the factory catches and recovers from bad work

1. **The reviewer cannot be skipped.** The planner declares an item done only
   on a reviewer PASS with cited evidence. In this run the reviewer caught a
   real defect before it mattered: the test harness spawned the server with
   the wrong working directory. It was fixed, re-run, and re-verified —
   the transcript shows the loop.
2. **Defect reports are precise, not vibes.** Repro steps, expected vs
   observed, smallest sufficient context. The implementer fixes; the
   reviewer re-verifies. No "looks good to me" passes.
3. **Broken tree stops the line.** The implementer mandate requires the
   service to build and start after every item; a broken build is fixed
   before the next item begins, never handed off.
4. **Adversarial probing is scheduled, not optional.** The reviewer mandate
   requires concurrency, retry, malformed-input, and edge-case probes on
   every run — the exact failure modes this track grades.
5. **Recovery is transactional.** Booking and waitlist promotion run inside
   single transactions with rollback on any error, so a half-finished write
   can never leave the database in a state the UI cannot explain.

## Reusing this factory

Point the planner at any new brief. The seats, the protocol in
`room/room.yaml`, and this file transfer unchanged — only the brief and the
stage folders are new. That reusability is the 50%: the factory is the
product as much as the app is.
