import type { Slot, Booking } from "./types";

export async function fetchSlots(): Promise<Slot[]> {
  const r = await fetch("/api/slots");
  const data = await r.json();
  return data.slots;
}

export async function createBooking(input: {
  slotId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}): Promise<Booking> {
  const r = await fetch("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error ?? "booking failed");
  }
  return r.json();
}

export function formatSlot(startsAtIso: string): string {
  // The server stores slot times as full UTC ISO strings (e.g.
  // "2026-06-18T19:00:00.000Z"). Parse the WHOLE string so the trailing "Z" is
  // honoured and we get the correct absolute instant, then render it in the
  // user's local timezone with toLocaleString().
  //
  // The previous version sliced off the "Z" (`.slice(0, 19)`); a datetime
  // string without an offset is parsed as LOCAL time, so the office's UTC
  // wall-clock was relabeled as the user's local clock — wrong for anyone not
  // in UTC.
  //
  // Relation to issue #2: slot availability is filtered server-side on absolute
  // UTC instants, so a slot that is "future" there is always future in local
  // time too. This conversion only changes how that instant is *displayed*; it
  // can't bring a past slot back into the list.
  const d = new Date(startsAtIso);
  return d.toLocaleString();
}
