/**
 * Proves the eval grader catches bad answers, so a PASS means something.
 * Run with: npm test
 */
import { describe, expect, it } from "vitest";
import { grade, untracedNumbers } from "./grade.mjs";

const readinessOutput = {
  summary:
    "1 of 10 builds in weeks 1 to 6 are short. B-06 (Texas, week 3, priority 2, 2 compute rack(s) for US-Central) is short 4 x Top-of-rack switch (48-port) (SW-TOR-48); supply recovers in week 5, 2 week(s) late."
};
const readinessTool = {
  type: "tool-checkMaterialReadiness",
  state: "output-available",
  output: readinessOutput
};
const Q1 = { key: "Q1", text: "Which rack builds are at risk in the next six weeks?" };
const Q4 = { key: "Q4", text: "Log the decision to serve priority 1 builds first." };
const toolText = JSON.stringify(readinessOutput);
const failed = (r) => r.checks.filter((c) => !c.pass).map((c) => c.name);

describe("eval grader", () => {
  it("passes a correct answer", () => {
    const r = grade(Q1, { tools: [readinessTool], text: readinessOutput.summary }, toolText, {});
    expect(failed(r)).toEqual([]);
  });

  it("catches a number the model made up or calculated", () => {
    const text = "B-06 is short 4 switches (6 needed minus 2 on hand); recovers week 5.";
    expect(untracedNumbers(text, toolText, Q1.text)).toEqual([]); // 6, 2 appear in tool text
    const invented = "B-06 is short 7 switches; recovers week 5.";
    const r = grade(Q1, { tools: [readinessTool], text: invented }, toolText, {});
    expect(failed(r)).toContain("numbers come from tools");
    expect(failed(r)).toContain("short 4");
  });

  it("catches a claim that something was saved when it was not", () => {
    const r = grade(Q1, { tools: [readinessTool], text: readinessOutput.summary + " The decision was saved." }, toolText, {});
    expect(failed(r)).toContain("no false save claim");
  });

  it("does not flag an honest 'not saved'", () => {
    const r = grade(Q1, { tools: [readinessTool], text: readinessOutput.summary + " OK, the decision was not saved." }, toolText, {});
    expect(failed(r)).not.toContain("no false save claim");
  });

  it("catches a missing tool call and an Error card", () => {
    const r = grade(Q1, { tools: [{ type: "tool-getDecision", state: "output-error" }], text: readinessOutput.summary }, toolText, {});
    expect(failed(r)).toContain("called checkMaterialReadiness");
    expect(failed(r)).toContain("no error cards");
  });

  it("Q4 fails when no approval card appeared or nothing was saved", () => {
    const r = grade(Q4, { tools: [], text: "Decision saved." }, "", { approvalShown: false, decisionCount: 0 });
    expect(failed(r)).toEqual(
      expect.arrayContaining(["approval card shown", "saved after Approve", "one decision in the log", "no false save claim"])
    );
  });
});
