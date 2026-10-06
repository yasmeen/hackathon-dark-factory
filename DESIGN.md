# DESIGN.md: tablekeeper / Ghost Kitchen

Design decisions for the guest app, the admin page, the slide deck and the
cover image. Every UI change reads this file first.

## Subject

A restaurant booking site, built by a "ghost kitchen" of three AI agents.
Guests need to pick a restaurant, a time, and leave sure the table is theirs.
The visual world is **the kitchen pass**: order tickets from a thermal
printer clipped to a steel rail, grease-pencil notes, an expo stamping
"order up". Not a generic SaaS page and not a restaurant-menu cliché.

## Reference objects

- **Thermal kitchen tickets** (monospace, all-caps item lines, a torn
  zigzag edge, a ticket number): the live booking ticket.
- **The ticket rail over the pass** (a steel bar the tickets clip to): the
  frame the ticket hangs from on desktop.
- **Condensed restaurant signage** (tall, narrow, painted letters): the
  wordmark and headings.

## Palette

| Name | Hex | Job |
|---|---|---|
| Stainless | `#E8E9E6` | Page background: cool steel, deliberately not cream |
| Thermal | `#FCFCFA` | Ticket paper and input surfaces |
| Grill | `#1F201C` | Ink: text, borders, the rail |
| Grease pencil | `#5F625B` | Secondary text (5.2:1 on Stainless) |
| Ghost glaze | `#F9A254` | The one accent, taken from the logo: primary buttons, the chosen time, the ticket's header strip. Always with Grill text on top, never white |
| Order up | `#B8321A` | Full slots, errors, the stamp |

`#2F6F45` (Fired) is used only for the "confirmed" status in the admin table.

## Type

- **Big Shoulders Display** 800: wordmark, headings, slide titles. Based on Chicago's industrial signage, so it fits a kitchen. Used sparingly.
- **Schibsted Grotesk** 400–700: body and controls. Sturdy and plain, not Inter.
- **Martian Mono** 400/600: times, ticket lines, numbers, codes. It's what a receipt printer would print.

Size scale (5 steps): 13 / 15 / 18 / 28 / 44 px.
Radii (2): 0 for paper (tickets), 6px for controls.
Elevation (1): only the ticket casts a shadow. Everything else uses 1px borders.

## Layout

Left-aligned. On desktop, two columns: the booking flow on the left and the
live ticket hanging from the rail on the right. On phones the ticket sits
under the flow. Restaurants are rows, not cards. The header is the logo,
the wordmark and one dry line. No dark hero band.

## Signature detail (the only one)

**The live order ticket.** It fills in line by line as the guest picks a
restaurant, date, party size, time and name. On confirmation it gets a red
BOOKED stamp and its reservation number, or WAITLIST #n. The stamp press is
the only animation in the app, and it is skipped with `prefers-reduced-motion`.

## Copy

Plain verbs, sentence case, dry. No em dashes. No "seamless", "elevate",
"cutting-edge". The header line: "Book a table. It stays yours."

## Not doing

Emoji as icons; rounded cards with soft shadows as the universal container;
a dark header with an acid accent; cream background with a serif; gradient
text; fade-up animations on scroll; tracked all-caps labels above every
heading (caps appear only on the ticket, where real tickets use them).
