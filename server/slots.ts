export type Slot = {
  id: string;
  // ISO datetime (UTC) when the slot starts
  startsAt: string;
  durationMinutes: number;
};

export function generateSlots(): Slot[] {
  // 24 hourly slots covering the office's LOCAL day, 00:00 -> 23:00 local time.
  //
  // We anchor to local midnight (setHours) rather than UTC midnight so the
  // booking window matches the office's wall clock. Each startsAt is still
  // serialised as a UTC instant via toISOString, so a 23:00 local slot in a
  // UTC-3 office is stored as 02:00Z the next day. Clients convert that instant
  // back to each viewer's own local time in formatSlot (issue #3).
  //
  // "Local" here means the timezone the server process runs in (the office).
  // Note: stepping by fixed UTC hours means a DST transition in the office zone
  // would skip/repeat one local hour on that day — acceptable for this widget,
  // and matches the original stepping approach.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const out: Slot[] = [];
  for (let i = 0; i < 24; i++) {
    const dt = new Date(start.getTime() + i * 60 * 60 * 1000);
    out.push({
      id: "s" + (i + 1),
      startsAt: dt.toISOString(),
      durationMinutes: 60,
    });
  }
  return out;
}
