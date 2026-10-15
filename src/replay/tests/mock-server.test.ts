import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFixture } from "../../shared/types.js";
import { listenMockServer } from "../mock-server.js";

const booking = () => parseFixture(JSON.parse(readFileSync("fixtures/booking-unavailable.json", "utf8")));

describe("mock webhook server", () => {
  it("serves the recorded body on the path derived from the tool endpoint", async () => {
    const mock = await listenMockServer(booking(), 0);
    try {
      const health = await fetch(`${mock.url}/health`);
      expect(health.ok).toBe(true);

      const res = await fetch(`${mock.url}/book-appointment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: "2026-10-16", time: "15:00", name: "Jordan" }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: false, booking_id: null, message: "Slot unavailable" });

      const generic = await fetch(`${mock.url}/tools/book_appointment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: "other" }),
      });
      expect(generic.status).toBe(404);
      const unmatched = (await generic.json()) as { unmatched?: boolean };
      expect(unmatched.unmatched).toBe(true);
      expect(mock.log.map((e) => e.matched)).toEqual([true, false]);
    } finally {
      await mock.close();
    }
  });
});
