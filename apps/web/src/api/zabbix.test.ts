import { describe, expect, it } from "vitest";
import { formatAge, formatValue, severityColor } from "./zabbix";

describe("formatValue", () => {
  it("scales bytes", () => {
    expect(formatValue("1073741824", "B")).toBe("1.00 GB");
    expect(formatValue(512, "B")).toBe("512.0 B");
  });
  it("renders durations and plain units", () => {
    expect(formatValue("7281", "uptime")).toBe("2h 1m");
    expect(formatValue("12.3456", "%")).toBe("12.3 %");
    expect(formatValue("3", "")).toBe("3");
  });
  it("handles missing and non-numeric values", () => {
    expect(formatValue(null, "%")).toBe("—");
    expect(formatValue("Linux 6.1", "")).toBe("Linux 6.1");
  });
});

describe("formatAge", () => {
  it("picks a readable unit", () => {
    expect(formatAge(45)).toBe("45s");
    expect(formatAge(125)).toBe("2m");
    expect(formatAge(3 * 86400 + 3600)).toBe("3d 1h");
  });
});

describe("severityColor", () => {
  it("maps Zabbix severities 0..5", () => {
    expect([0, 1, 2, 3, 4, 5].map(severityColor)).toEqual([
      "default",
      "info",
      "warning",
      "warning",
      "error",
      "error",
    ]);
  });
});
