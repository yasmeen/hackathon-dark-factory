# Project brief (the dispatched task — the only human input to this run)

Build a clean-room clone of a restaurant reservation product ("tablekeeper"):

- Guests can browse restaurants, check availability for a date/party size, and
  book a table. They can view and cancel their own reservations.
- The hard part: **a table must never be double-booked** — under concurrent
  requests, retried requests, and across time zones.
- Ship as a complete, buildable service in `stage-1/` (minimum for eligibility).
  If time permits, extend to `stage-2/` (admin dashboard, waitlist).
- Stack: whatever ships fastest reliably. Keep the UI clean, responsive, and
  presentation-ready.
- The service must build and serve from a clean container with no outbound
  network. Verify before finishing.

Constraints:
- Mandates stay generic (already in seats/). No track-specific detail in mandates.
- Public GitHub repo layout: stage-N/ folders, seats/, FACTORY.md, room export.
- Video must show the BAND Desktop room; if the desktop app cannot run here,
  produce the walkthrough script and flag the missing room recording.
