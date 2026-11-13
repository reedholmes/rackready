/**
 * Grading rules for the RackReady repeatability eval (repeatability.mjs).
 * Kept separate so grade.test.mjs can prove the grader catches bad answers.
 */

// ── Reading a turn ─────────────────────────────────────────────────────
export const isToolPart = (p) =>
  typeof p.type === "string" && p.type.startsWith("tool-");
export const toolName = (p) => p.type.slice("tool-".length);

/** Everything the agent produced since the given user message. */
export function turnAfter(messages, userText) {
  let i = messages.length - 1;
  while (
    i >= 0 &&
    !(messages[i].role === "user" && textOf(messages[i]) === userText)
  )
    i--;
  const after = messages.slice(i + 1);
  const parts = after.flatMap((m) => m.parts ?? []);
  return {
    parts,
    tools: parts.filter(isToolPart),
    text: parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim()
  };
}

export function textOf(message) {
  return (message.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

// ── Grading ────────────────────────────────────────────────────────────
// Numbers in an answer must appear in some tool output (or the question).
// A number that cannot be traced to a tool suggests the model calculated or
// invented it, which breaks the "model never does arithmetic" rule.
export const numberTokens = (s) => s.match(/\d+(?:\.\d+)?/g) ?? [];

export function untracedNumbers(answer, allToolOutputText, questionText) {
  const known = new Set([
    ...numberTokens(allToolOutputText),
    ...numberTokens(questionText)
  ]);
  return [...new Set(numberTokens(answer))].filter((n) => !known.has(n));
}

export const SAVE_CLAIM = /\b(saved|logged|recorded)\b/i;

export function grade(q, turn, allToolOutputText, extra) {
  const checks = [];
  const add = (name, pass, detail = "") => checks.push({ name, pass, detail });
  const names = turn.tools.map(toolName);
  const errorParts = turn.tools.filter((p) => p.state === "output-error");
  const savedOk = turn.tools.some(
    (p) =>
      toolName(p) === "logDecision" &&
      p.state === "output-available" &&
      p.output?.saved === true
  );

  add("answered", turn.text.length > 0, turn.text ? "" : "no text reply");
  add(
    "no error cards",
    errorParts.length === 0,
    errorParts.map(toolName).join(", ")
  );
  const untraced = untracedNumbers(turn.text, allToolOutputText, q.text);
  add("numbers come from tools", untraced.length === 0, untraced.join(", "));
  add(
    "no false save claim",
    !SAVE_CLAIM.test(turn.text) ||
      savedOk ||
      /not saved|wasn't saved|was not saved/i.test(turn.text),
    SAVE_CLAIM.test(turn.text) && !savedOk
      ? `says "${turn.text.match(SAVE_CLAIM)[0]}" but nothing was saved`
      : ""
  );

  const need = (tool) =>
    add(`called ${tool}`, names.includes(tool), names.join(", ") || "no tools");
  const says = (label, re) => add(label, re.test(turn.text), "");

  switch (q.key) {
    case "Q1":
    case "Q2":
      need("checkMaterialReadiness");
      says("names B-06", /B-06/);
      says("short 4", /\b4\b/);
      says("recovers week 5", /week 5/i);
      add("no save requested", !names.includes("logDecision"), "");
      break;
    case "Q3":
      need("proposeAllocation");
      says("option: priority", /priority/i);
      says("option: transfer from Malaysia", /Malaysia/i);
      says("option: expedite PO-102", /PO-102|expedite/i);
      says(
        "asks the user to choose",
        /choose|prefer|which option|would you like/i
      );
      add("no save requested", !names.includes("logDecision"), "");
      break;
    case "Q4":
      add("approval card shown", extra.approvalShown, "");
      add("saved after Approve", savedOk, "");
      add(
        "one decision in the log",
        extra.decisionCount === 1,
        `log has ${extra.decisionCount}`
      );
      break;
    case "Q5":
      need("listDecisions");
      says("recalls priority 1 decision", /priority 1/i);
      add("no save requested", !names.includes("logDecision"), "");
      break;
  }

  return {
    pass: checks.every((c) => c.pass),
    checks,
    tools: names,
    extraToolCalls: Math.max(0, names.length - 1),
    answer: turn.text
  };
}
