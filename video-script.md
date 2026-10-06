# Video walkthrough — script & shot list

Target: under 3 minutes, 1080p, voiceover. Everything said here is backed by a
check or a transcript entry. Don't add claims that aren't.

## Before you record (10 min)

```sh
cd stage-2 && npm ci && node db.js && npm start      # guest UI :3000, admin /admin
```
In a second terminal: `cd stage-2` (for `npm test` in shot 3).
To show a waitlist on camera, fill a slot first. Juniper & Rye has one table
for 10. Before recording, book it in the UI (party of 10, 7:00 PM, phone A).
On camera in shot 2 that time then shows as **waitlist**; join it with phone B.

## Shot 1 — the room (0:00–0:40) ⚠️ REQUIRED: real Band Desktop recording

The rules require the BAND Desktop room recording. Record a **real, live**
run. Don't stage it, and don't scroll a pasted transcript in an empty room.

1. In Band Desktop, create room `dark-factory-tablekeeper`; add three seats
   (planner, implementer, reviewer) and attach `seats/planner.md`,
   `seats/implementer.md`, `seats/reviewer.md` as their mandates.
2. Start recording. Dispatch this one task to the planner:
   > Verify `stage-2/` of this repo from a clean checkout against the run-2
   > done-states in `room/transcript.md` (WI-9…WI-14). Report PASS/FAIL per
   > item with evidence.
3. Let the seats run: planner dispatches → reviewer runs `npm ci && npm test`
   and probes → verdicts post in the room. Capture the seats, the thread, and
   the verdicts.

**Voiceover (accurate for this shot):** "This is our factory: three
coding-agent seats in Band, each with a generic mandate: plan, build, review.
These are the same three mandates that built tablekeeper. Here they're live,
re-verifying what they shipped. The task is the only human input."

## Shot 2 — the product (0:40–1:20)

Guest UI: Casa Verde → tomorrow → party of 2 → 7:00 PM → name/phone →
confirmation. Narrow the window to phone width briefly. Then the Juniper & Rye
7:00 PM slot for 10 → dashed **waitlist** → join → "#1 in line".

**Voiceover:** "What the factory shipped: tablekeeper. Book in four steps,
on any screen size. When a slot is full you can join its waitlist."

## Shot 3 — the hard part (1:20–2:15)

Terminal: `npm test` in stage-2. Linger on:
- `exactly 1 of 50 parallel bookings wins` (4 processes, one database)
- `off-grid start (19:15) is rejected`
- the **mutation check** table at the end (`both removed → winners=4`)

Then UI: My reservations → look up phone A → cancel the 10-top booking →
admin shows phone B's guest **booked from the waitlist** onto that table.

**Voiceover:** "The hard part: never double-book. Fifty parallel bookings
across four server processes, exactly one wins. A test like that is only
evidence if it can fail, so we delete the protections and run it again:
remove both and four bookings get through, so the test catches it. Remove
either one alone and the other still holds. Cancel a booking and the next
guest in line is booked onto that table in the same transaction. Nobody can
grab it in between."

## Shot 4 — the factory improving itself (2:15–2:50)

Show `FACTORY.md` → section "The runs, honestly", then `seats/reviewer.md`
rule 4.

**Voiceover:** "Run one's reviewer passed work it shouldn't have: its race
test couldn't fail, and a 7:15 booking could overlap 7:00. An audit caught
it. We fixed the code and fixed the mandates: the reviewer now has to prove
every safety test can fail. In run two the reviewer is an independent agent,
and its verdict is in the transcript. The mandates never mention
restaurants. Swap the brief and they build something else."

## Capture checklist
- [ ] Shot 1: live Band Desktop room run (requires the desktop app + account)
- [ ] Shots 2–4: screen capture of the local service + terminal + editor
- [ ] Under 3 minutes; upload (unlisted is fine) and paste the link into lablab
