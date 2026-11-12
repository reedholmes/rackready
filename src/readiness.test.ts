/**
 * Proves the story the mock data is built to tell (BUILD_BRIEF.md):
 * servers are fine, top-of-rack switches run short at Texas in week 3,
 * and a late inbound shipment fixes it in week 5.
 *
 * Run with: npm test
 */
import { describe, expect, it } from "vitest";
import { SEED_BOM, SEED_BUILDS, SEED_INBOUND, SEED_INVENTORY } from "./data";
import { checkMaterialReadiness } from "./readiness";

const seed = {
  builds: SEED_BUILDS,
  bom: SEED_BOM,
  inventory: SEED_INVENTORY,
  inbound: SEED_INBOUND
};

describe("checkMaterialReadiness on the seed data", () => {
  const result = checkMaterialReadiness(seed, 6);

  it("finds exactly one short build in the next 6 weeks", () => {
    expect(result.buildsChecked).toBe(10);
    expect(result.shortCount).toBe(1);
    expect(result.readyCount).toBe(9);
  });

  it("week 3: B-06 at Texas is short 4 top-of-rack switches", () => {
    const b06 = result.builds.find((b) => b.id === "B-06")!;
    expect(b06.status).toBe("short");
    expect(b06.week).toBe(3);
    expect(b06.site).toBe("Texas");
    expect(b06.shortages).toEqual([
      {
        component: "SW-TOR-48",
        componentName: "Top-of-rack switch (48-port)",
        needed: 4,
        available: 0,
        shortBy: 4
      }
    ]);
  });

  it("week 5: supply recovers when the late switch shipment lands", () => {
    const b06 = result.builds.find((b) => b.id === "B-06")!;
    expect(b06.recoveryWeek).toBe(5);
    expect(b06.weeksLate).toBe(2);
  });

  it("priority 1 build B-05 gets the last 2 switches in week 3", () => {
    const b05 = result.builds.find((b) => b.id === "B-05")!;
    expect(b05.status).toBe("ready");
  });

  it("servers are never the constraint", () => {
    const serverShort = result.builds.some((b) =>
      b.shortages.some((s) => s.component === "SRV-C1")
    );
    expect(serverShort).toBe(false);
  });

  it("the week 5 build B-09 is still ready after B-06 catches up", () => {
    const b09 = result.builds.find((b) => b.id === "B-09")!;
    expect(b09.status).toBe("ready");
  });

  it("writes the summary sentence in code, with the numbers filled in", () => {
    expect(result.summary).toContain("1 of 10 builds");
    expect(result.summary).toContain("B-06");
    expect(result.summary).toContain("short 4 x Top-of-rack switch");
    expect(result.summary).toContain("recovers in week 5");
  });
});

describe("checkMaterialReadiness without the late shipment", () => {
  it("B-06 recovers in week 6 instead, from the next switch order", () => {
    const withoutPO102 = {
      ...seed,
      inbound: SEED_INBOUND.filter((p) => p.id !== "PO-102")
    };
    const result = checkMaterialReadiness(withoutPO102, 6);
    const b06 = result.builds.find((b) => b.id === "B-06")!;
    expect(b06.status).toBe("short");
    expect(b06.recoveryWeek).toBe(6);
  });
});
