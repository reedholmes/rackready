/**
 * RackReady repeatability eval.
 *
 * Runs the five BUILD_BRIEF.md questions against the agent N times, each
 * round in its own fresh agent instance (its own SQLite database, freshly
 * seeded, empty decisions log), and grades every answer automatically.
 *
 * It talks to the agent exactly the way the chat screen does: over the
 * agent's WebSocket, using the Agents SDK chat message types, and it clicks
 * Approve on the decision card the same way the Approve button does.
 *
 * Usage (with `npm run dev` running in another terminal):
 *   npm run eval                      10 rounds against http://localhost:5173
 *   npm run eval -- --rounds 3        fewer rounds
 *   npm run eval -- --url https://... another server (uses Workers AI quota)
 *
 * Writes a JSON file and a Markdown report to evals/results/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { grade, isToolPart, toolName, turnAfter } from "./grade.mjs";

// ── Settings ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ROUNDS = Number(arg("rounds", 10));
const BASE = arg("url", "http://localhost:5173").replace(/\/$/, "");
const WS_BASE = BASE.replace(/^http/, "ws");
const TURN_TIMEOUT_MS = 150_000;

const QUESTIONS = [
  { key: "Q1", text: "Which rack builds are at risk in the next six weeks?" },
  { key: "Q2", text: "What is short for the week 3 builds, and when does it recover?" },
  { key: "Q3", text: "What are my options for the switch shortage?" },
  { key: "Q4", text: "Log the decision to serve priority 1 builds first." },
  { key: "Q5", text: "What did we decide last time?", freshConnection: true }
];

// ── Talking to the agent ───────────────────────────────────────────────
const agentPath = (name) => `/agents/chat-agent/${name}`;

async function getMessages(name) {
  const res = await fetch(`${BASE}${agentPath(name)}/get-messages`);
  if (!res.ok) throw new Error(`get-messages ${res.status}`);
  return res.json();
}

/** Messages once they stop changing (the final save can lag the "done" signal). */
async function settledMessages(name) {
  let previous = JSON.stringify(await getMessages(name));
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const current = JSON.stringify(await getMessages(name));
    if (current === previous) return JSON.parse(current);
    previous = current;
  }
  return JSON.parse(previous);
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}${agentPath(name)}`);
    const timer = setTimeout(() => reject(new Error("WebSocket connect timeout")), 30_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener("error", () => reject(new Error("WebSocket error")));
  });
}

/** Resolve when a chat response with done:true arrives (optionally for one request id). */
function waitForDone(ws, requestId) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      resolve({ timedOut: true, error: false });
    }, TURN_TIMEOUT_MS);
    function onMessage(event) {
      let data;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (data.type !== "cf_agent_use_chat_response") return;
      if (requestId && data.id !== requestId) return;
      if (data.done || data.error) {
        clearTimeout(timer);
        ws.removeEventListener("message", onMessage);
        resolve({ timedOut: false, error: Boolean(data.error) });
      }
    }
    ws.addEventListener("message", onMessage);
  });
}

async function ask(ws, name, text) {
  const before = await getMessages(name);
  const requestId = randomUUID().slice(0, 8);
  const userMessage = {
    id: `eval-${randomUUID().slice(0, 12)}`,
    role: "user",
    parts: [{ type: "text", text }]
  };
  const done = waitForDone(ws, requestId);
  const started = Date.now();
  ws.send(
    JSON.stringify({
      type: "cf_agent_use_chat_request",
      id: requestId,
      init: {
        method: "POST",
        body: JSON.stringify({
          messages: [...before, userMessage],
          trigger: "submit-message"
        })
      }
    })
  );
  const status = await done;
  return { ...status, seconds: (Date.now() - started) / 1000 };
}

async function approve(ws, toolCallId) {
  const done = waitForDone(ws, null);
  const started = Date.now();
  ws.send(
    JSON.stringify({
      type: "cf_agent_tool_approval",
      toolCallId,
      approved: true,
      autoContinue: true
    })
  );
  const status = await done;
  return { ...status, seconds: (Date.now() - started) / 1000 };
}

// Reading turns and grading answers live in grade.mjs.

// ── One round ──────────────────────────────────────────────────────────
class InfraError extends Error {}
let consecutiveInfraErrors = 0;

async function runRound(round, runId) {
  const name = `eval-${runId}-r${round}`;
  let ws = await connect(name);
  const results = [];
  try {
    for (const q of QUESTIONS) {
      if (q.freshConnection) {
        // Simulate a page refresh: drop the connection and open a new one.
        ws.close();
        ws = await connect(name);
      }
      const status = await ask(ws, name, q.text);
      let messages = await settledMessages(name);
      let turn = turnAfter(messages, q.text);
      const extra = { approvalShown: false, decisionCount: 0, approvalSeconds: 0 };

      if (q.key === "Q4") {
        const card = turn.tools.find(
          (p) => toolName(p) === "logDecision" && p.state === "approval-requested"
        );
        extra.approvalShown = Boolean(card);
        if (card) {
          const approval = await approve(ws, card.toolCallId);
          extra.approvalSeconds = approval.seconds;
          messages = await settledMessages(name);
          turn = turnAfter(messages, q.text);
        }
        const savedCount = turn.tools.filter(
          (p) => toolName(p) === "logDecision" && p.output?.saved === true
        ).length;
        extra.decisionCount = savedCount;
      }

      const allToolOutputText = messages
        .flatMap((m) => m.parts ?? [])
        .filter((p) => isToolPart(p) && p.output !== undefined)
        .map((p) => JSON.stringify(p.output))
        .join(" ");

      const graded = grade(q, turn, allToolOutputText, extra);
      if (status.timedOut) graded.checks.push({ name: "finished in time", pass: false, detail: "timed out" });
      if (status.error) graded.checks.push({ name: "no stream error", pass: false, detail: "stream error" });
      graded.pass = graded.checks.every((c) => c.pass);
      graded.seconds = Math.round((status.seconds + extra.approvalSeconds) * 10) / 10;
      results.push({ round, question: q.key, ...graded });

      const mark = graded.pass ? "PASS" : "FAIL";
      const failed = graded.checks.filter((c) => !c.pass).map((c) => c.name + (c.detail ? ` (${c.detail})` : ""));
      console.log(
        `  round ${round} ${q.key} ${mark} ${graded.seconds}s tools=[${graded.tools.join(",")}]` +
          (failed.length ? `  failed: ${failed.join("; ")}` : "")
      );

      // An error with no answer and no tool calls means the agent could not
      // reach the model at all (seen when the Workers AI daily allowance ran
      // out). That measures the infrastructure, not the agent, so stop.
      if (status.error && !graded.answer && graded.tools.length === 0) {
        consecutiveInfraErrors++;
        if (consecutiveInfraErrors >= 3) {
          throw new InfraError(
            "Stopped: 3 replies in a row errored before the model answered. " +
              "Check the dev server log (for example, Workers AI daily allowance used up)."
          );
        }
      } else {
        consecutiveInfraErrors = 0;
      }
    }
  } finally {
    ws.close();
  }
  return results;
}

// ── Main ───────────────────────────────────────────────────────────────
const runId = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
console.log(`RackReady repeatability eval: ${ROUNDS} round(s) against ${BASE} (run ${runId})`);

const all = [];
for (let r = 1; r <= ROUNDS; r++) {
  try {
    all.push(...(await runRound(r, runId)));
  } catch (e) {
    if (e instanceof InfraError) {
      console.log(`\n${e.message}\nNo report written.`);
      process.exit(2);
    }
    console.log(`  round ${r} aborted: ${e.message}`);
    all.push({ round: r, question: "round", pass: false, checks: [{ name: "round completed", pass: false, detail: e.message }], tools: [], answer: "" });
  }
}

// ── Report ─────────────────────────────────────────────────────────────
const byQuestion = QUESTIONS.map((q) => {
  const rows = all.filter((x) => x.question === q.key);
  const passed = rows.filter((x) => x.pass).length;
  const secs = rows.map((x) => x.seconds).filter((s) => typeof s === "number").sort((a, b) => a - b);
  const median = secs.length ? secs[Math.floor(secs.length / 2)] : null;
  const failures = {};
  for (const row of rows)
    for (const c of row.checks.filter((c) => !c.pass)) failures[c.name] = (failures[c.name] ?? 0) + 1;
  const extraCalls = rows.reduce((s, x) => s + (x.extraToolCalls ?? 0), 0);
  return { key: q.key, text: q.text, passed, total: rows.length, median, failures, extraCalls };
});
const overall = all.filter((x) => x.question !== "round");
const roundsAllPass = [...new Set(all.map((x) => x.round))].filter((r) =>
  all.filter((x) => x.round === r).length === QUESTIONS.length && all.filter((x) => x.round === r).every((x) => x.pass)
).length;

const lines = [
  `# Repeatability eval ${runId}`,
  "",
  `- Server: ${BASE}`,
  `- Rounds: ${ROUNDS} (each in a fresh agent instance with freshly seeded data)`,
  `- Answers passing: ${overall.filter((x) => x.pass).length} of ${overall.length}`,
  `- Rounds where all five questions passed: ${roundsAllPass} of ${ROUNDS}`,
  "",
  "| Question | Pass rate | Median seconds | Extra tool calls | Failed checks |",
  "|---|---|---|---|---|",
  ...byQuestion.map(
    (b) =>
      `| ${b.key}: ${b.text} | ${b.passed}/${b.total} | ${b.median ?? "n/a"} | ${b.extraCalls} | ${
        Object.entries(b.failures).map(([k, v]) => `${k} (${v})`).join(", ") || "none"
      } |`
  ),
  "",
  "## Failed answers",
  "",
  ...(overall.filter((x) => !x.pass).length === 0
    ? ["None."]
    : overall
        .filter((x) => !x.pass)
        .flatMap((x) => [
          `**Round ${x.round}, ${x.question}** (tools: ${x.tools.join(", ") || "none"})`,
          "",
          `Failed: ${x.checks.filter((c) => !c.pass).map((c) => c.name + (c.detail ? ` (${c.detail})` : "")).join("; ")}`,
          "",
          "> " + (x.answer || "(no answer)").replace(/\n/g, "\n> "),
          ""
        ]))
];

mkdirSync("evals/results", { recursive: true });
writeFileSync(`evals/results/${runId}.json`, JSON.stringify({ runId, base: BASE, rounds: ROUNDS, results: all }, null, 2));
writeFileSync(`evals/results/${runId}.md`, lines.join("\n") + "\n");

console.log("\n" + lines.slice(0, 13 + QUESTIONS.length).join("\n"));
console.log(`\nReport: evals/results/${runId}.md`);
