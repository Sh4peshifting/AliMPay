import { describe, expect, it } from "bun:test";
import { formatDateTime, parseDateTime } from "../src/web/lib/date-time";

describe("order filter date input", () => {
  it("accepts the displayed format and native picker values without changing the clock time", () => {
    expect(parseDateTime("2026/11/11 08:09:10")).toBe("2026-11-11T08:09:10");
    expect(parseDateTime("2026-11-11T08:09")).toBe("2026-11-11T08:09:00");
    expect(formatDateTime("2026-11-11T08:09")).toBe("2026/11/11 08:09:00");
    expect(formatDateTime("")).toBe("");
  });
  it("rejects partial dates, impossible calendar dates and invalid clock fields", () => {
    for (const value of ["2026/11/dd 08:09:10", "2026/02/29 08:09:10", "2026/04/31 08:09:10", "2026/11/11 24:00:00", "2026/11/11 08:60:00", "0000/01/01 00:00:00"]) {
      expect(parseDateTime(value)).toBeNull();
    }
    expect(parseDateTime("2028/02/29 23:59:59")).toBe("2028-02-29T23:59:59");
  });
});
