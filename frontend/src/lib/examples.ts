/**
 * Human-readable titles for the bundled example call logs. The IDs stay the
 * source of truth (shown small, in mono); these are only display copy. An
 * unknown log falls back to a tidied version of its name.
 */
export interface ExampleCopy {
  title: string;
  description: string;
  /** A control is a call the agent handled correctly: nothing to test. */
  control?: boolean;
}

export const EXAMPLE_COPY: Record<string, ExampleCopy> = {
  "booking-false-confirmation": {
    title: "Booking confirmed after the slot was unavailable",
    description: "The booking API returned 200 with success: false. The agent told the caller the appointment was confirmed.",
  },
  "address-update-http-500": {
    title: "Address “updated” after a server error",
    description: "The CRM returned HTTP 500. The agent said the address had been changed.",
  },
  "reservation-openai-format": {
    title: "Reservation confirmed with an invented number",
    description: "The reservation API reported failure. The agent confirmed anyway and read out a confirmation number the API never returned.",
  },
  "refund-without-tool-call": {
    title: "Refund promised without calling the refund tool",
    description: "The workflow requires issue_refund. The agent said the refund was issued without ever calling it.",
  },
  "order-status-timeout": {
    title: "Shipping lookup timed out, agent answered anyway",
    description: "The shipping API timed out. The agent gave a delivery estimate instead of saying it couldn't check.",
  },
  "reschedule-timeout-event-log": {
    title: "Reschedule timed out, agent said it was moved",
    description: "The reschedule API timed out with the outcome unknown. The agent told the caller the appointment was moved. (Event-log format.)",
  },
  "booking-handled-correctly": {
    title: "Unavailable slot, handled correctly",
    description: "Same failed booking, but the agent told the caller and offered another time.",
    control: true,
  },
  "booking-retry-succeeds": {
    title: "First slot taken, retry booked",
    description: "The first booking failed, the agent retried another time, and confirmed only the booking that succeeded.",
    control: true,
  },
  "multi-turn-success": {
    title: "Longer call, booking succeeded",
    description: "A chatty multi-turn call with an availability check and a successful booking.",
    control: true,
  },
};

export function exampleCopy(name: string, fallbackHasFailure?: boolean): ExampleCopy {
  const known = EXAMPLE_COPY[name.replace(/^imported:/, "")];
  if (known && !name.startsWith("imported:")) return known;
  const pretty = name
    .replace(/^imported:/, "")
    .replace(/^synthetic-/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b(http|api|id|url)\b/gi, (m) => m.toUpperCase())
    .replace(/^\w/, (c) => c.toUpperCase());
  return {
    title: name.startsWith("imported:") ? `Imported: ${pretty}` : pretty,
    description: "",
    control: fallbackHasFailure === false,
  };
}
