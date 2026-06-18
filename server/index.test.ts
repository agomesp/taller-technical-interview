// Happy-path smoke tests for the booking server.
// These tests currently pass. That doesn't mean the service is correct.
//
// Run after `npm run dev:server` is up:
//   npx tsx server/index.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

test("GET /api/slots returns a list", async () => {
  const r = await fetch(`${BASE}/api/slots`);
  assert.equal(r.status, 200);
  const body = await r.json() as { slots: unknown[] };
  assert.ok(Array.isArray(body.slots));
});

test("POST /api/bookings on a free slot returns 201", async () => {
  // Find a slot id from the list
  const slotsResp = await fetch(`${BASE}/api/slots`);
  const { slots } = await slotsResp.json() as { slots: { id: string; taken: boolean }[] };
  const free = slots.find((s) => !s.taken);
  assert.ok(free, "expected at least one free slot to test against");

  const r = await fetch(`${BASE}/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slotId: free.id,
      customerName: "Test User",
      customerEmail: "happy@example.com",
      customerPhone: "+1 555 0100",
    }),
  });
  assert.equal(r.status, 201);
  const booking = await r.json();
  assert.ok(booking.id);
  assert.equal(booking.slotId, free.id);
});

test("POST /api/bookings rejects concurrent double-booking of the same slot", async () => {
  // Pick a slot that is still free at the moment this test runs.
  const slotsResp = await fetch(`${BASE}/api/slots`);
  const { slots } = await slotsResp.json() as { slots: { id: string; taken: boolean }[] };
  const free = slots.find((s) => !s.taken);
  assert.ok(free, "expected at least one free slot to test against");

  const book = () =>
    fetch(`${BASE}/api/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slotId: free.id,
        customerName: "Race User",
        customerEmail: "race@example.com",
        customerPhone: "+1 555 0199",
      }),
    });

  // Fire two bookings for the SAME slot concurrently. Exactly one must win
  // (201) and the other must be rejected as already booked (409). The buggy
  // server lets both through (two 201s == double-booked == two emails).
  const [a, b] = await Promise.all([book(), book()]);
  const statuses = [a.status, b.status].sort();

  assert.deepEqual(
    statuses,
    [201, 409],
    `expected one 201 and one 409, got [${statuses.join(", ")}]`,
  );
});

test("GET /api/slots never returns slots that start in the past", async () => {
  // Capture "now" just before the request so the boundary is unambiguous.
  // Compares absolute instants (UTC), so this assertion is timezone-agnostic.
  const now = Date.now();

  const r = await fetch(`${BASE}/api/slots`);
  assert.equal(r.status, 200);
  const { slots } = await r.json() as { slots: { id: string; startsAt: string }[] };

  const past = slots.filter((s) => new Date(s.startsAt).getTime() < now);
  assert.deepEqual(
    past.map((s) => s.startsAt),
    [],
    `expected only current/future slots, but got ${past.length} starting in the past`,
  );
});
