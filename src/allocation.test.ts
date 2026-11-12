/**
 * Checks proposeAllocation on the seed data: the Texas top-of-rack switch
 * shortage gets three options, each with outcomes computed in code.
 *
 * Run with: npm test
 */
import { describe, expect, it } from "vitest";
import { SEED_BOM, SEED_BUILDS, SEED_INBOUND, SEED_INVENTORY } from "./data";
import { proposeAllocation } from "./allocation";

const seed = {
  builds: SEED_BUILDS,
  bom: SEED_BOM,
  inventory: SEED_INVENTORY,
  inbound: SEED_INBOUND
};

describe("proposeAllocation for the Texas switch shortage", () => {
  const result = proposeAllocation(seed, "SW-TOR-48", "TX");
  if (!result.constrained) throw new Error("expected a constrained result");

  const results = (option: number) =>
    Object.fromEntries(
      result.options[option - 1].outcomes.map((o) => [o.id, o.result])
    );

  it("offers three options for B-06", () => {
    expect(result.shortBuilds).toEqual(["B-06"]);
    expect(result.options.map((o) => o.name)).toEqual([
      "Serve builds by priority",
      "Transfer stock from Malaysia",
      "Expedite PO-102 from Vela Networks"
    ]);
  });

  it("option 1 (priority): B-05 on time, B-06 two weeks late", () => {
    expect(results(1)).toEqual({
      "B-05": "on time (week 3)",
      "B-06": "week 5 (2 week(s) late)",
      "B-09": "on time (week 5)"
    });
  });

  it("option 2 (transfer 4 from Malaysia): everything on time, Malaysia unaffected", () => {
    expect(result.options[1].action).toContain("Ship 4");
    expect(result.options[1].tradeoff).toContain("spare drops from 6 to 2");
    expect(result.options[1].tradeoff).toContain("all stay ready");
    expect(results(2)).toEqual({
      "B-05": "on time (week 3)",
      "B-06": "on time (week 3)",
      "B-09": "on time (week 5)"
    });
  });

  it("option 3 (expedite PO-102 to week 3): everything on time", () => {
    expect(results(3)).toEqual({
      "B-05": "on time (week 3)",
      "B-06": "on time (week 3)",
      "B-09": "on time (week 5)"
    });
  });
});

describe("proposeAllocation input handling", () => {
  it("understands plain words for the component and site", () => {
    const r = proposeAllocation(seed, "top-of-rack switch", "Texas");
    expect(r.constrained).toBe(true);
  });

  it("picks the short switch when the model just says 'switch'", () => {
    const r = proposeAllocation(seed, "switch", "texas");
    expect(r.constrained && r.component).toBe("SW-TOR-48");
  });

  it("says no decision is needed when nothing is short", () => {
    const r = proposeAllocation(seed, "SRV-C1", "TX");
    expect(r.constrained).toBe(false);
  });
});
