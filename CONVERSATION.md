# Session log — Booking widget bug-fixing

A working session pairing on the **Booking widget** (Express + React, TypeScript).
The owner (navigator) brought the *what/why*; Claude (driver) brought the *how*,
working test-first (TDD) with small, always-green steps.

- **Repo:** taller-technical-interview
- **Date:** 2026-06-18
- **Workflow:** TDD (failing test → minimal fix → green), one focused agent, isolated test server on `:3100` so the owner's dev server on `:3000` was never disturbed.

The README reported three known issues:

1. The same time slot sometimes ends up double-booked (two confirmation emails for the same slot).
2. The list of available slots sometimes shows times that are clearly in the past.
3. The booking confirmation shows the wrong time for users in different timezones than the office.

---

## Turn 1 — Identify & propose a fix for issue #1 (double-booking)

> **Prompt:** Help me identify and propose a fix for the 1# problem pointed in readme.md, check how it fetches the booked events on the same slot and how it deals with double-booking, at the moment is showing two at the same time on the same slot

**Findings — root cause: a TOCTOU (time-of-check to time-of-use) race.**

In `POST /api/bookings` the "already booked?" check ran synchronously, but the
actual write was deferred into a `setTimeout(…, 200)`:

```js
const alreadyBooked = bookings.some((b) => b.slotId === slotId);   // check
if (alreadyBooked) return res.status(409)...

setTimeout(() => {
  bookings.push(booking);          // write happens 200ms LATER
  res.status(201).json(booking);
}, 200);
```

`setTimeout` yields the event loop, so two concurrent requests for the same slot
both pass the check before either writes → both get `201` → double-booked.

**Proposed fix:** make check-and-reserve atomic — `push` synchronously in the
same tick as the check, before the latency sim. In a real DB this maps to a
unique constraint on `slotId` / `INSERT … ON CONFLICT` / `SELECT … FOR UPDATE`.

---

## Turn 2 — Fix #1 with TDD

> **Prompt:** Write the test for the fix using TDD approach and fix it as proposed. Fix just #1 for now

**RED:** added a test firing two concurrent bookings for the same slot, asserting
exactly one `201` + one `409`. Against the buggy server it returned `[201, 201]`.

**Fix** (`server/index.ts`):

```js
const alreadyBooked = bookings.some((b) => b.slotId === slotId);
if (alreadyBooked) return res.status(409).json({ error: "slot already booked" });

const booking: Booking = { /* ... */ };
bookings.push(booking);                 // reserve NOW — atomic with the check

setTimeout(() => res.status(201).json(booking), 200);  // latency sim only
```

**GREEN:** all tests pass; `tsc --noEmit` clean.
Supporting change: `const PORT = Number(process.env.PORT) || 3000;` to run an
isolated test server on `:3100` without touching the owner's `:3000`.

---

## Turn 3 — Fix #2 with TDD (past slots in availability)

> **Prompt:** Let's focus on #2 problem now. You should check how the available slots are being checked or generated. Fix it using TDD and the available slots should only show times from now to future, without ones before. Keep in mind that the timezones will be handled on fix #3 …

**Root cause:** the availability filter compared a **full ISO datetime** against a
**date-only prefix**:

```js
const today = new Date().toISOString().slice(0, 10);   // "2026-06-18"
slots.filter((s) => s.startsAt > today)   // "2026-06-18T19:00..." > "2026-06-18" is ALWAYS true
```

Every slot dated today is lexicographically greater than the bare date, so the
time-of-day was never checked — past slots leaked through (19 of them at 18:32 UTC).

**RED → Fix → GREEN** (`server/index.ts`): compare absolute UTC instants.

```js
const now = Date.now();
const available = slots
  .filter((s) => new Date(s.startsAt).getTime() >= now)
  .map((s) => ({ ...s, taken: taken.has(s.id) }));
```

Left flag comments for #3: this filter must stay on UTC instants (timezone-
independent); the timezone-sensitive piece to revisit is slot *generation*.

---

## Turn 4 — Fix #3 with TDD (timezone display)

> **Prompt:** Now let's handle the #3 item … check firstly the timezone displayed on the UI so that the slots properly match the user timezone … Then, check how the booking confirmation display and renders the date regarding the user timezone …

**Root cause** (`client/api.ts`): `formatSlot` sliced off the trailing `Z`:

```js
const d = new Date(startsAtIso.slice(0, 19));   // "2026-06-18T19:00:00" — no Z
return d.toLocaleString();
```

A datetime string **without** an offset is parsed as **local** time, so the
office's UTC wall-clock was relabeled as the viewer's clock (19:00 UTC shown as
7 PM everywhere instead of 4 PM in UTC-3).

**RED:** a client unit test pinned to `America/New_York` expected `3:00:00 PM`
and got `7:00:00 PM`.

**Fix:** parse the full ISO instant, render local.

```js
const d = new Date(startsAtIso);
return d.toLocaleString();
```

`formatSlot` is the single render path for both the slot list and the
confirmation, so one fix corrected both surfaces. Added the client test to `npm test`.

---

## Turn 5 — "Why does the list stop at 8 PM?"

> **Prompt:** I see in UI that the last time displayed is 8PM, is that a cut already present in the code or it was something introduced by our fixes?

**Answer:** pre-existing **generation cap**, not introduced by our fixes.
`generateSlots()` always made 24 hourly slots for one UTC day (`00:00–23:00 UTC`).
The last slot `23:00 UTC`, correctly converted to the viewer's `-03` zone by the
#3 fix, is **8 PM**. Before #3 it wrongly showed 11 PM (UTC relabeled as local).
#2 only trims the *front* (past slots); the end is fixed by generation. Flagged
the consequence: a negative-offset viewer's local window looks shifted earlier.

---

## Turn 6 — Make the day run fully local until 23:00

> **Prompt:** Make it display fully local until 23:00, so that if something is scheduled at this time, in this timezone, on UTC-0 it will be 2 AM fine

**Approach:** anchor slot generation to the **office's local midnight** instead of
UTC midnight, so the booking day runs `00:00–23:00` local (a 23:00 local slot in a
UTC-3 office is stored as `02:00Z` next day).

1. **Safe refactor first:** extracted `Slot` + `generateSlots` into
   `server/slots.ts` (it sat next to `app.listen()` and couldn't be unit-tested
   without booting the server). Re-ran suite: unchanged, green.
2. **RED:** `server/slots.test.ts` pinned to `Etc/GMT+3` (DST-free UTC-3) asserted
   local hours `[0..23]` and that the 23:00 slot is `02:00Z`. UTC-anchored code
   produced `[21,22,23,0,…,20]`.
3. **Fix** (one line): `setUTCHours(0,0,0,0)` → `setHours(0,0,0,0)`.

**GREEN:** 6 tests pass; server now serves the local day through 11 PM.

---

## Turn 7 — Commit the three fixes

> **Prompt:** Do a commit of these 3 fixes, write a message explaining the changes and a commit title using a pattern of fix(where-changed): what this commit fixes …

Committed on branch `fix/booking-widget-issues` (off `main`). Note: only
`README.md` + `.gitignore` were previously tracked, so this commit also imported
the app scaffold into git for the first time.

**Title:** `fix(booking): prevent double-booking, hide past slots, and show local times`

The body explained each fix + root cause (race/TOCTOU, lexicographic prefix
compare, stripped `Z`), the local-midnight generation refinement, the
`server/slots.ts` extraction, and the regression tests.

---

## Turn 8 — Full review for remaining bugs

> **Prompt:** Now, check the whole client and server and see if there's any missing bugs to be fixed. … the app should properly book the time, display the booked time disabled when it's already booked, properly return the available slots, properly handle the different timezones …

### 🔴 High

1. **Past-slot booking** (`server/index.ts`) — *confirmed empirically*: `GET /api/slots`
   hides past slots, but `POST /api/bookings {"slotId":"s1"}` (a past slot) still
   returns **201**. Booking validation diverged from availability. Fix: reject in
   POST when `new Date(slot.startsAt).getTime() < Date.now()`.
2. **Failed bookings leave the slot stuck as "Booked"** (`client/App.tsx`) — the
   optimistic update mutates state (`selected.taken = true; setSlots(slots)` with
   the same array ref) and is **never rolled back in `catch`**. A `409`/network
   error leaves the slot visually disabled though this user didn't book it. Fix:
   immutable update + rollback (or `refresh()` from server on success and error).

### 🟡 Medium

3. **No refresh after booking; `refresh()` is dead code** (`client/App.tsx`) — other
   users' bookings go stale until a full reload. Wire `refresh()` after booking.
4. **Booking record can't render the appointment time** (`server/index.ts`,
   `types.ts`) — `GET /api/bookings/:id` returns no `startsAt`, so a standalone /
   shareable confirmation for *other users* has no time to display. Include the
   slot's UTC `startsAt` in the booking record.

### 🟢 Low / robustness

- `fetchSlots` doesn't check `r.ok` → a server error makes `data.slots` undefined
  → `slots.map` throws → blank page.
- Fragile booking IDs `"b" + (bookings.length + 1)` (only unique because bookings
  are never deleted).
- No timezone label in the display (`toLocaleString()` shows a local time with no
  zone); `{ timeZoneName: "short" }` would disambiguate.

### ✅ Verified correct
Double-booking race (fixed/tested), availability filter (UTC-instant compare with
`taken` flag), `formatSlot` timezone rendering (per-viewer local), Vite proxy
anchored as `^/api/`.

---

## Turn 9 — Save & ship

> **Prompt:** Save our whole conversation and prompts to a .md, commit it. After it, push the code to https://github.com/agomesp/taller-technical-interview

This document, committed, and the branch pushed to the GitHub remote.

---

## Final state

**Tests (6, all green):**
- concurrent double-booking → one `201` + one `409`
- `GET /api/slots` never returns past slots
- `formatSlot` renders the true UTC instant in the viewer's local timezone
- `generateSlots` anchors the booking day to local midnight (00:00–23:00 local)
- plus the original happy-path smoke tests

**Files changed/added:** `server/index.ts`, `server/slots.ts` (new),
`server/index.test.ts`, `server/slots.test.ts` (new), `client/api.ts`,
`client/api.test.ts` (new), `package.json`.

**Still open (reported in Turn 8, not yet fixed):** past-slot booking,
optimistic-update rollback, refresh-after-booking, `startsAt` in booking record,
and the low-severity robustness items.
