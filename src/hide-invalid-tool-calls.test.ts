import { describe, expect, it } from "vitest";
import type { UIMessageChunk } from "ai";
import { hideInvalidToolCalls } from "./hide-invalid-tool-calls";

async function run(chunks: UIMessageChunk[]) {
  const out: UIMessageChunk[] = [];
  const stream = new ReadableStream<UIMessageChunk>({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    }
  }).pipeThrough(hideInvalidToolCalls());
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe("hideInvalidToolCalls", () => {
  it("passes a valid call through and drops an invalid one entirely", async () => {
    const out = await run([
      { type: "tool-input-start", toolCallId: "good", toolName: "listDecisions" },
      { type: "tool-input-delta", toolCallId: "good", inputTextDelta: "{}" },
      { type: "tool-input-available", toolCallId: "good", toolName: "listDecisions", input: {} },
      { type: "tool-output-available", toolCallId: "good", output: { decisionCount: 1 } },
      { type: "tool-input-start", toolCallId: "bad", toolName: "getDecision" },
      { type: "tool-input-delta", toolCallId: "bad", inputTextDelta: "{}" },
      { type: "tool-input-error", toolCallId: "bad", toolName: "getDecision", input: {}, errorText: "An error occurred." },
      { type: "tool-output-error", toolCallId: "bad", errorText: "An error occurred." },
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Last time we decided..." },
      { type: "text-end", id: "t" }
    ]);

    const ids = out.map((c) => ("toolCallId" in c ? c.toolCallId : c.type));
    expect(ids).not.toContain("bad");
    expect(ids.filter((x) => x === "good")).toHaveLength(4);
    expect(out.map((c) => c.type)).toContain("text-delta");
  });

  it("keeps the order of a valid call's chunks", async () => {
    const out = await run([
      { type: "tool-input-start", toolCallId: "a", toolName: "getBuildPlan" },
      { type: "tool-input-delta", toolCallId: "a", inputTextDelta: '{"weeks":' },
      { type: "tool-input-delta", toolCallId: "a", inputTextDelta: "8}" },
      { type: "tool-input-available", toolCallId: "a", toolName: "getBuildPlan", input: { weeks: 8 } }
    ]);
    expect(out.map((c) => c.type)).toEqual([
      "tool-input-start",
      "tool-input-delta",
      "tool-input-delta",
      "tool-input-available"
    ]);
  });
});
