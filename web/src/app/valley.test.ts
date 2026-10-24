import { expect, test } from "vitest";
import { daypartName, transitPhrase } from "./valley.ts";

test("the status line names what's moving", () => {
  expect(transitPhrase({ buses: 248, trains: 31 }, "running")).toBe("248 buses and 31 trains running");
  expect(transitPhrase({ buses: 1, trains: 1 }, "running")).toBe("1 bus and 1 train running");
  expect(transitPhrase({ buses: 0, trains: 2 }, "in service")).toBe("2 trains in service");
  expect(transitPhrase({ buses: 1204, trains: 0 }, "running")).toBe("1,204 buses running");
  expect(transitPhrase({ buses: 0, trains: 0 }, "running")).toBe("");
});

test("weekends have days and evenings, not working days and rushes", () => {
  expect(daypartName(Date.parse("2026-10-23T23:42:00Z"))).toBe("Evening rush"); // Friday 5:42 PM
  expect(daypartName(Date.parse("2026-10-24T15:21:00Z"))).toBe("The day"); // Saturday 9:21 AM
  expect(daypartName(Date.parse("2026-10-24T23:42:00Z"))).toBe("Evening"); // Saturday 5:42 PM
  expect(daypartName(Date.parse("2026-10-25T03:00:00Z"))).toBe("Last trains"); // Saturday 9 PM
  expect(daypartName(Date.parse("2026-10-26T15:00:00Z"))).toBe("Working day"); // Monday 9 AM
});
