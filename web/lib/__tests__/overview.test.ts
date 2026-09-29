import { describe, expect, it } from "vitest";

import {
  ESCALATION_DELTA,
  bucketByWeek,
  densityPer100,
  distinctRules,
  isEscalating,
  isoWeek,
  tallyRules,
  weekStartMonday,
  windowStartMonday,
} from "@/lib/overview";

/* A fixed anchor: Sunday 2026-09-27 → its ISO week starts Mon 2026-09-21. */
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

describe("ISO week math", () => {
  it("maps a Sunday to the preceding Monday", () => {
    expect(weekStartMonday("2026-09-27")).toBe("2026-09-21");
  });
  it("maps a Monday to itself", () => {
    expect(weekStartMonday("2026-09-21")).toBe("2026-09-21");
  });
  it("handles ISO year boundaries (2021-01-01 is in ISO week 53 of 2020)", () => {
    expect(isoWeek("2021-01-01")).toEqual({ year: 2020, week: 53 });
    expect(isoWeek("2021-01-04")).toEqual({ year: 2021, week: 1 });
  });
  it("window of N weeks starts on the Monday N-1 weeks back", () => {
    expect(windowStartMonday(NOW, 4)).toBe("2026-08-31");
    expect(windowStartMonday(NOW, 1)).toBe("2026-09-21");
  });
});

describe("bucketByWeek", () => {
  const mk = (occ: string | null, tier: string) => ({ occurredAt: occ, tier });

  it("creates a contiguous run of buckets including empty weeks", () => {
    const buckets = bucketByWeek([mk("2026-09-25", "psif")], 4, NOW);
    expect(buckets.map((b) => b.key)).toEqual(["2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"]);
    expect(buckets[0].total).toBe(0);
    expect(buckets[3].sif).toBe(1);
  });
  it("separates SIF from recordable and ignores undated rows", () => {
    const buckets = bucketByWeek(
      [mk("2026-09-22", "asif"), mk("2026-09-23", "recordable"), mk("2026-09-24", "near_miss"), mk(null, "psif")],
      4,
      NOW
    );
    const last = buckets[3];
    expect(last.sif).toBe(1);
    expect(last.recordable).toBe(1);
    expect(last.total).toBe(3); // the null-dated psif is dropped
  });
  it("drops reports before the window", () => {
    const buckets = bucketByWeek([mk("2026-08-30", "psif")], 4, NOW);
    expect(buckets.reduce((s, b) => s + b.total, 0)).toBe(0);
  });
  it("computes a trailing 4-week moving average, null until 4 buckets exist", () => {
    // NOW = Sun 2026-09-27 → 5-week window = buckets 08-24 … 09-21.
    const buckets = bucketByWeek(
      [
        mk("2026-08-25", "psif"),
        mk("2026-09-01", "psif"),
        mk("2026-09-08", "psif"),
        mk("2026-09-15", "psif"),
        mk("2026-09-21", "psif"),
        mk("2026-09-22", "asif"),
      ],
      5,
      NOW
    );
    expect(buckets.map((b) => b.sif)).toEqual([1, 1, 1, 1, 2]);
    expect(buckets[0].sifMa).toBeNull();
    expect(buckets[2].sifMa).toBeNull();
    expect(buckets[3].sifMa).toBe(1); // buckets 0-3 → 1,1,1,1
    expect(buckets[4].sifMa).toBe(1.25); // buckets 1-4 → 1,1,1,2
  });
});

describe("multi-label rule counting", () => {
  it("dedupes repeated rules on one report", () => {
    expect(distinctRules(JSON.stringify([{ rule: "Hot Work" }, { rule: "Hot Work" }, { rule: "Line of Fire" }]))).toEqual([
      "Hot Work",
      "Line of Fire",
    ]);
  });
  it("tolerates broken JSON and non-arrays", () => {
    expect(distinctRules("{oops")).toEqual([]);
    expect(distinctRules(null)).toEqual([]);
    expect(distinctRules([{ nope: 1 }])).toEqual([]);
  });
  it("counts a multi-label report toward every distinct rule", () => {
    const counts = tallyRules([
      { ruleTags: JSON.stringify([{ rule: "Hot Work" }, { rule: "Energy Isolation" }]) },
      { ruleTags: JSON.stringify([{ rule: "Hot Work" }]) },
    ]);
    expect(counts.get("Hot Work")).toBe(2);
    expect(counts.get("Energy Isolation")).toBe(1);
    expect(counts.size).toBe(2);
  });
});

describe("density + escalation", () => {
  it("normalises per 100 and never divides by zero", () => {
    expect(densityPer100(3, 12)).toBe(25);
    expect(densityPer100(3, 0)).toBe(0);
  });
  it("escalates only at the named threshold", () => {
    expect(isEscalating(30, 22)).toBe(true); // exactly +8
    expect(isEscalating(29.9, 22)).toBe(false);
    expect(ESCALATION_DELTA).toBe(8);
  });
});
