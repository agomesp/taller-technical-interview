// Unit tests for slot generation.
//
// Pin a fixed, DST-free UTC-3 office timezone so the local-vs-UTC anchoring is
// observable and the result is deterministic wherever the test runs. Etc/GMT+3
// is POSIX-signed: "+3" means UTC-03:00. Set before any Date is used.
process.env.TZ = "Etc/GMT+3";

import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSlots } from "./slots";

test("generateSlots anchors the booking day to local midnight (00:00–23:00 local)", () => {
  const slots = generateSlots();
  assert.equal(slots.length, 24);

  // Expressed in the office's local timezone, the slots are exactly the 24
  // hours of one local day, in order — not shifted by the UTC offset.
  const localHours = slots.map((s) => new Date(s.startsAt).getHours());
  assert.deepEqual(localHours, Array.from({ length: 24 }, (_, i) => i));

  const localMinutes = slots.map((s) => new Date(s.startsAt).getMinutes());
  assert.deepEqual(localMinutes, new Array(24).fill(0));

  // The last slot is 23:00 local. In a UTC-3 office that instant is stored as
  // 02:00Z the next day — the case from the issue: "23:00 here == 2 AM UTC".
  const last = slots[slots.length - 1];
  assert.equal(new Date(last.startsAt).getHours(), 23);
  assert.equal(new Date(last.startsAt).getUTCHours(), 2);
});
