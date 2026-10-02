# Video walkthrough — script & shot list
# STATUS: script ready. The BAND Desktop room recording is NOT yet captured —
# it must be recorded on a machine running Band Desktop (see shot 1 note).

Total target: under 3 minutes. Record at 1080p, system audio off, voiceover on.

## Shot 1 — the room (0:00–0:45) ⚠️ NEEDS BAND DESKTOP
**What to capture:** screen recording of the Band Desktop app showing the
`dark-factory-tablekeeper` room: the three connected seats (planner,
implementer, reviewer), the message thread with the plan dispatch, handoffs,
and the reviewer's PASS verdicts, plus the work board/swim lanes.
**Voiceover:** "This is our software factory — three coding-agent seats in
Band Desktop. The planner broke the brief into six work items with
observable done-states. The implementer built each one and handed off with
verify commands. The reviewer verified independently — including a 50-way
booking race — before anything was marked done. The task brief was the only
human input."
**How to capture:** on your machine, open Band Desktop, create the room per
`room/room.yaml`, attach the mandate files from `seats/`, and screen-record
while scrolling the transcript. `room/transcript.md` is the full message
log to narrate from.

## Shot 2 — the product (0:45–1:30)
**What to capture:** browser at the tablekeeper UI. Book a table end to end:
pick Casa Verde → tomorrow → party of 2 → 7:00 PM → enter details →
confirmation screen.
**Voiceover:** "And this is what the factory shipped: tablekeeper, a
restaurant reservation system. Clean, responsive, and it works on mobile."

## Shot 3 — the hard part (1:30–2:20)
**What to capture:** terminal running `npm test` — show the 13 PASS lines,
lingering on the concurrency section. Then the My reservations tab, cancel
a booking, and the admin dashboard showing the waitlist promotion.
**Voiceover:** "The hard part was never double-booking. Fifty parallel
requests for one table: exactly one wins, forty-nine get a clean rejection.
Retries replay instead of duplicating. Times are stored as UTC and rendered
in any timezone. Cancel, and the freed table goes to the waitlist. Three
independent layers guard the invariant — transaction, database constraint,
idempotency keys."

## Shot 4 — the factory close (2:20–2:50)
**What to capture:** `FACTORY.md` open in an editor, then the repo file tree
(seats/, room/, stage-1/, stage-2/, FACTORY.md).
**Voiceover:** "But the real submission is the factory itself — generic
mandates, a run protocol, and a transcript of every decision. Point it at
any brief and it builds the same way. The mandates never mention
restaurants; they'd work on any product."

## Capture checklist
- [ ] Shot 1: Band Desktop room recording (REQUIRES desktop app + account)
- [ ] Shots 2–4: capturable now — service runs via `npm start` in stage-1/
- [ ] Export under 3 minutes; upload unlisted to YouTube for the submission form
