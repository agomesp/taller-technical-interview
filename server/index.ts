import express from "express";
import type { Request, Response } from "express";
import { generateSlots, type Slot } from "./slots";

// ============================================================
//  Booking service — tiny appointment scheduler
// ============================================================
//  GET  /api/slots                — list all slots (with availability)
//  POST /api/bookings             — book a slot
//  GET  /api/bookings/:id         — fetch a booking
// ============================================================

type Booking = {
  id: string;
  slotId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  createdAt: string;
};

// In-memory data ---------------------------------------------------------

const slots: Slot[] = generateSlots();
const bookings: Booking[] = [];

// Routes -----------------------------------------------------------------

const app = express();
app.use(express.json());

app.get("/api/slots", (_req: Request, res: Response) => {
  const taken = new Set(bookings.map((b) => b.slotId));

  // Only surface slots from now into the future — never ones that have already
  // started. We compare absolute instants: `startsAt` and `now` are both points
  // in time (UTC epoch ms), so an instant is the same instant no matter which
  // timezone it's displayed in. This is why the filter is timezone-independent.
  //
  // The previous version compared the full ISO string `startsAt` against a
  // date-only prefix ("2026-06-18"), which is lexicographically greater for
  // every time-of-day on that date — so all of today's slots passed and past
  // ones leaked through.
  //
  // NOTE for fix #3 (timezone display): keep this comparison on UTC instants.
  // When #3 changes how slots are *rendered* for the office/user timezone, do
  // NOT switch this to local wall-clock strings, or past slots will reappear.
  // The timezone-sensitive piece to revisit in #3 is slot *generation*
  // (see generateSlots — it anchors the day to UTC midnight), not this filter.
  const now = Date.now();
  const available = slots
    .filter((s) => new Date(s.startsAt).getTime() >= now)
    .map((s) => ({ ...s, taken: taken.has(s.id) }));
  res.json({ slots: available });
});

app.post("/api/bookings", (req: Request, res: Response) => {
  const { slotId, customerName, customerEmail, customerPhone } = req.body ?? {};

  console.log("[bookings] new booking request:", JSON.stringify(req.body));

  if (!slotId || !customerEmail) {
    return res.status(400).json({ error: "slotId and customerEmail are required" });
  }

  const slot = slots.find((s) => s.id === slotId);
  if (!slot) return res.status(404).json({ error: "slot not found" });

  // Atomic check-and-reserve. The check and the write must happen in the same
  // synchronous tick: Node is single-threaded, so as long as we don't yield to
  // the event loop between them, no concurrent request can slip in and book the
  // same slot. The previous code checked here but deferred the push into the
  // setTimeout below, leaving a window where two requests both saw the slot as
  // free and both got a 201 (double-booked, two confirmation emails).
  const alreadyBooked = bookings.some((b) => b.slotId === slotId);
  if (alreadyBooked) {
    return res.status(409).json({ error: "slot already booked" });
  }

  const booking: Booking = {
    id: "b" + (bookings.length + 1),
    slotId,
    customerName: customerName ?? "",
    customerEmail,
    customerPhone: customerPhone ?? "",
    createdAt: new Date().toISOString(),
  };
  bookings.push(booking);

  // Simulate the latency of writing to a database. The slot is already
  // reserved above, so this only delays the response — it can't double-book.
  setTimeout(() => {
    res.status(201).json(booking);
  }, 200);
});

app.get("/api/bookings/:id", (req: Request, res: Response) => {
  const b = bookings.find((x) => x.id === req.params.id);
  return b ? res.json(b) : res.status(404).end();
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`booking server listening on :${PORT}`));
