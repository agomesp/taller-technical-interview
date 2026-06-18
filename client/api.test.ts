// Unit tests for client-side date rendering.
//
// formatSlot is the single place the UI turns a stored UTC slot time into text
// — App.tsx uses it for BOTH the slot list and the booking confirmation — so
// exercising it here covers both surfaces that issue #3 is about.
//
// We pin a fixed, non-UTC timezone so the bug (rendering the office's UTC
// wall-clock as if it were the user's local time) is observable and the result
// is deterministic no matter where the test runs. Set before any Date is used.
process.env.TZ = "America/New_York"; // EDT (UTC-4) in June

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSlot } from "./api";

test("formatSlot renders a slot's true UTC instant in the user's local timezone", () => {
  const iso = "2026-06-18T19:00:00.000Z"; // 19:00 UTC == 15:00 in New York (EDT)

  // This assertion is only meaningful away from UTC, where the bug actually bites.
  assert.notEqual(
    new Date(iso).getTimezoneOffset(),
    0,
    "expected the test process to run in a non-UTC timezone",
  );

  // Correct output: the true instant, rendered in the local zone.
  const expected = new Date(iso).toLocaleString();
  assert.equal(formatSlot(iso), expected);

  // It must NOT be the UTC wall-clock relabeled as local — the old behaviour of
  // slicing off the trailing "Z" before parsing.
  const utcWallClockAsLocal = new Date(iso.slice(0, 19)).toLocaleString();
  assert.notEqual(
    formatSlot(iso),
    utcWallClockAsLocal,
    "formatSlot must convert UTC to local time, not relabel the UTC wall-clock",
  );
});
