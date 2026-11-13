# RackReady

**Live demo:** https://rackready.reedholmes9.workers.dev

**Code:** https://github.com/reedholmes/rackready

RackReady is a chat agent for a supply chain program manager who owns data center rack integration. Ask it plain-English questions such as "Which rack builds are at risk in the next six weeks?" and it checks material readiness against the build plan, explains shortages, proposes allocation options, and keeps a log of the decisions you approve. Once a week it runs a shortage review on its own and leads the chat with the result.

It was built as a demo for a job application at Cloudflare (Supply Chain Program Manager, Rack Integration). **All data is mock data.**

## Try it

Open the live demo and click the suggested questions in order. Wait for each answer to finish before sending the next one.

1. Which rack builds are at risk in the next six weeks?
2. What is short for the week 3 builds, and when does it recover?
3. What are my options for the switch shortage?
4. Log the decision to serve priority 1 builds first. (an **Approve / Reject** card appears; nothing is saved until you click Approve)
5. What did we decide last time? (refresh the page first; the answer comes from the decisions log)

You can also click **Run review now** in the header to run the weekly shortage review on demand.

The demo has a single shared agent, so every visitor sees the same chat history and decisions log. Click **Clear** to start a fresh conversation (the decisions log is kept).

## How the four required components are met

| Requirement                 | How RackReady meets it                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **LLM**                     | Llama 3.3 70B on Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`), called through the Workers AI binding. The model decides which tool to call and explains the result. It never does arithmetic: every quantity, total, and recovery week is computed in TypeScript and returned by a tool. Llama 3.3 needed several guardrails to call tools reliably; see [Model Notes](#model-notes). |
| **Workflow / coordination** | The agent is an Agents SDK `AIChatAgent`, which runs as a Durable Object. Its built-in scheduler runs the shortage review every Monday at 13:00 UTC (`this.schedule("0 13 * * 1", "weeklyReview")`). The **Run review now** button calls the same method through a `@callable()` RPC.                                                                                                            |
| **User input via chat**     | The agents-starter chat UI, kept as is apart from the RackReady suggestion buttons and the Run review now button. Human-in-the-loop approval for logging decisions uses the AI SDK's `needsApproval` and the starter's Approve / Reject cards.                                                                                                                                                   |
| **Memory / state**          | Everything lives in the Durable Object's SQLite storage: chat history (persisted automatically by `AIChatAgent`), the mock planning tables, the decisions log, and a table of review runs. Chat history and decisions survive page refreshes.                                                                                                                                                    |

## How it works

```
Browser (React chat UI)  <-- WebSocket -->  ChatAgent (Durable Object on Cloudflare)
                                              |-- Llama 3.3 on Workers AI (picks tools, writes replies)
                                              |-- Tools (plain TypeScript, all the math)
                                              |-- SQLite: builds, bom, inventory, inbound,
                                              |           decisions, reviews, chat history
                                              '-- Scheduler: weekly review, Mondays 13:00 UTC
```

**Tools the model can call**

| Tool                                 | What it does                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getBuildPlan(weeks)`                | Planned builds for the horizon, with totals computed in code.                                                                                                                                                                                                                                                                             |
| `checkMaterialReadiness(weeks)`      | Walks the plan week by week: inbound orders land at the start of their week, builds compete for stock by priority, ready builds consume it, short builds wait and are retried until supply recovers. Returns each build as ready or short with the component, quantity short, and recovery week, plus a summary sentence written in code. |
| `proposeAllocation(component, site)` | Builds two or three options as "what if" scenarios (serve by priority, transfer spare stock from the other site, expedite the late purchase order), reruns the readiness calculation for each, and returns the effect on every affected build and the tradeoff.                                                                           |
| `logDecision(summary)`               | Saves a decision to the log after the user clicks **Approve**.                                                                                                                                                                                                                                                                            |
| `listDecisions()`                    | Returns past decisions, newest first.                                                                                                                                                                                                                                                                                                     |

**Weekly review.** `weeklyReview` runs `checkMaterialReadiness` for 6 weeks, stores the result, and posts the code-written summary into the chat history without calling the model, so the next time the chat is opened it leads with the review.

**Main files**

| File                                                     | Purpose                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/server.ts`                                          | The agent: system prompt, tools, guardrails, weekly review, run-now action.    |
| `src/data.ts`                                            | The mock data and the story it is seeded to tell.                              |
| `src/db.ts`                                              | Table setup, one-time seeding, and SQL helpers.                                |
| `src/readiness.ts`                                       | The readiness calculation (no database or AI, so it can be tested on its own). |
| `src/allocation.ts`                                      | The allocation options.                                                        |
| `src/dedupe-stream.ts`, `src/hide-invalid-tool-calls.ts` | Workarounds described in Model Notes.                                          |
| `src/app.tsx`                                            | The chat UI from the starter, with small RackReady changes.                    |
| `src/*.test.ts`                                          | Automated tests for the code.                                                  |
| `evals/`                                                 | Repeatability eval: runner, grader, grader tests, and results.                 |

## What is mock

Everything in the planning data is invented:

- **12 rack builds** over 8 weeks at two integrator sites (Texas and Malaysia), compute and network racks, priorities 1 to 3.
- **Bill of materials:** a compute rack needs 20 servers, 2 top-of-rack switches, 2 power units, and 1 cable kit; a network rack needs 4 spine switches, 2 power units, and 1 cable kit.
- **On-hand inventory** at each site and **5 inbound purchase orders** from fictional suppliers (Orbis Systems, Vela Networks).
- **Week numbers are relative:** week 1 is "this week".
- **Allocation assumptions:** a transfer between sites takes 1 week.

The data is seeded so the story is visible: servers are fine; top-of-rack switches run short at Texas in week 3 (build B-06 is short 4); a late shipment of 8 lands in week 5 and covers the gap; Malaysia has 6 spare switches, which makes a transfer possible. `src/readiness.test.ts` proves this story.

There is no real ERP, no authentication, and no multi-user separation.

## Run it locally

You need Node.js and a Cloudflare account (Workers AI has no local simulator, so local development calls Cloudflare).

```bash
npm install
npx wrangler login
npm run dev
```

Then open http://localhost:5173.

```bash
npm test
```

runs the 23 automated tests. With `npm run dev` running in another terminal,

```bash
npm run eval
```

runs the repeatability eval (see [Evals](#evals)).

```bash
npm run deploy
```

builds and deploys to your own Cloudflare account.

Note: in local development the weekly cron schedule followed the computer's time zone; on Cloudflare it runs in UTC (confirmed in the production logs: next run Monday 13:00 UTC).

## Evals

**Automated tests** (`npm test`, 23 tests) cover the code: the readiness calculation, the allocation options, the invalid tool call filter, and the eval grader itself.

**Repeatability eval** (`npm run eval`, needs `npm run dev` running) covers the model. It runs the five demo questions in 10 rounds, each in a fresh agent instance with freshly seeded data, clicks Approve on the decision card the same way the UI does, and grades every answer automatically:

- **Numbers come from tools:** every number in the reply must appear in a tool output or the question. This is a check on the "the model never does arithmetic" rule. It is lenient: a sum stated using numbers that already appear in tool output would pass.
- **No false save claim:** the reply may say "saved" only if `logDecision` actually saved.
- **Right tool, no Error cards, and the key facts** (B-06, short 4, recovers week 5; all three options; the approval card; recalling the decision).

| Question                           | First run (2026-11-12, 10 rounds) | After the Q1 fix (2026-11-13, 5 rounds) |
| ---------------------------------- | --------------------------------- | --------------------------------------- |
| Q1 At risk in six weeks?           | 8/10                              | 5/5                                     |
| Q2 Week 3 shortage and recovery?   | 9/10                              | 5/5                                     |
| Q3 Options?                        | 10/10                             | 4/5                                     |
| Q4 Log the decision (with Approve) | 10/10                             | 5/5                                     |
| Q5 What did we decide?             | 10/10                             | 5/5                                     |
| **All answers**                    | **47/50**                         | **24/25**                               |

No answer in either run contained an untraceable number, a false save claim, or an Error card.

**First run.** The three failures were real. Twice on Q1, Llama received the correct readiness result, made an extra `getBuildPlan` call, and then replied that it had no data. Once on Q2 it gave the switch and recovery week but left out B-06 and the quantity.

**The fix.** Once the readiness check has run for a question, `getBuildPlan` is no longer offered to the model, since the readiness result already lists every build. Q1 then passed 6 of 6 (the 5-round run plus a 1-round check).

**Still open.** In one round, Q3 listed all three options correctly but did not ask the user to pick one. Llama also sometimes called `proposeAllocation` after the readiness check on Q1 or Q2 (4 times in 25 answers); those answers still passed. Five rounds is a small sample, so treat the second run as "no sign of the Q1 failure," not proof it is gone. Full reports are in `evals/results/`.

**Cost:** the eval calls Workers AI about 60 times per 10 rounds. On the free plan (10,000 neurons per day), a day of building and testing plus one 10-round run used up the daily allowance, after which every request fails, including the deployed demo. The runner detects this (three errors in a row before the model answers) and stops without writing a report.

## Built with AI assistance

This project was built with AI assistance, and the full prompt history is in [PROMPTS.md](PROMPTS.md).

- **Claude** helped draft the build brief (`BUILD_BRIEF.md`) and the kickoff prompt (`CLAUDE_CODE_KICKOFF_PROMPT.md`).
- **Claude Code** wrote the code, tests, and this README, working one step at a time from the brief, reading the current Cloudflare Agents and Workers AI docs and the installed packages, and testing each step in a browser.
- **I** set the requirements, reviewed every step in the browser before moving on, and made the design calls: adding guardrails rather than switching models, hiding invalid tool calls, gating the save tool, replacing the starter's suggestion buttons, and removing the starter's MCP feature before deploying.

Starting point: Cloudflare's [agents-starter](https://github.com/cloudflare/agents-starter) template (`npx create-cloudflare@latest --template cloudflare/agents-starter`).

## Changes from the starter

- Model switched from the starter's default to Llama 3.3; system prompt and example tools replaced.
- Suggestion buttons replaced with the five RackReady questions; **Run review now** button added.
- **MCP removed.** The starter lets users connect outside MCP tool servers. Because every visitor shares one agent, any visitor could have added tools for the model to call, so the feature was removed before deploying.

## Known limits

- One shared agent for all visitors (by design for the demo; multiple users are out of scope).
- The header still says "Agent Starter", and the starter's image attachment button remains; Llama 3.3 cannot read images.
- Llama 3.3 can take 20 to 30 seconds to answer, and the chat ignores input while a reply is streaming.
- The live demo and the evals share the Workers AI free allowance (10,000 neurons per day). When it runs out, every reply fails until it resets, so after the demo link was shared I kept eval runs to 5 rounds. The reset was not instant either: on 2026-11-13 the dashboard showed the counter back at zero just after 00:00 UTC, but calls were still refused at 02:00 UTC, and they worked by 14:30 UTC.
- See the limits at the end of Model Notes.

## Model Notes

RackReady runs on Llama 3.3 70B on Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`), as the brief requires. Tool calling did not work reliably out of the box. Some problems came from the platform and some from the model itself, and each one has its own guardrail.

### What failed

| #   | Symptom                                                                                                                                                                                            | Source                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Every word of a reply appeared twice ("TheThe Rack RackReadyReady").                                                                                                                               | Platform: each streamed packet carries the text in two fields (`response` and `choices[0].delta.content`), and `workers-ai-provider` 3.3.1 emits both.                               |
| 2   | Tool inputs arrived glued together (`{"weeks":8}{"weeks": 8}`) and were rejected.                                                                                                                  | Platform: same cause. Tool calls also arrive in two fields (`tool_calls` and `choices[0].delta.tool_calls`).                                                                         |
| 3   | A number in a reply doubled ("totaling19 19 racks").                                                                                                                                               | Platform: the native copy turned the text `" 19"` into the number `19`, so the first dedupe filter missed it.                                                                        |
| 4   | Tool calls failed with `"weeks": "8"` (text instead of a number).                                                                                                                                  | Model: Llama 3.3 sometimes sends numbers as text.                                                                                                                                    |
| 5   | Llama called `getBuildPlan` 10 times with the same input and never answered.                                                                                                                       | Model: it repeats tool calls even after getting a correct result.                                                                                                                    |
| 6   | After the once-per-tool rule hid every tool, the request failed: "`tools` must not be an empty array".                                                                                             | Platform: Workers AI rejects an empty tool list.                                                                                                                                     |
| 7   | Answers would cut off around 190 words.                                                                                                                                                            | Platform default: Workers AI caps output at 256 tokens unless told otherwise.                                                                                                        |
| 8   | After the user clicked **Reject** on a decision, Llama asked to log the same decision again, then printed the tool call as plain text.                                                             | Model: it retries a rejected action.                                                                                                                                                 |
| 9   | After **Approve** or **Reject**, Llama replied that the tool "is not provided".                                                                                                                    | Guardrail side effect: the tool it had just used was hidden from it.                                                                                                                 |
| 10  | Allocation answers skipped each option's effect on the builds when the effect was a separate field.                                                                                                | Model: it reliably repeats some fields and skips others.                                                                                                                             |
| 11  | Occasionally Llama calls a tool it was not offered (a repeat of `checkMaterialReadiness`, or an invented `getDecision`). The chat showed a red Error card, but the final answer was still correct. | Model.                                                                                                                                                                               |
| 12  | Asked "What did we decide last time?", Llama read the log and then asked to log a decision again. Nothing was saved (the approval card held), but the question was never answered.                 | Model: it calls tools the question does not need.                                                                                                                                    |
| 13  | Asked which builds were at risk, Llama replied only "The decision was saved." although no decision tool ran.                                                                                       | Model, triggered by a prompt rule about confirming saved decisions, which it applied out of context. The rule was removed; the guardrails below cover Approve and Reject without it. |
| 14  | After the options question, the user replied "1" and Llama said "This decision has been saved." although no decision tool ran (it was not offered, because "1" does not ask to save).              | Model: it claims an action it did not take.                                                                                                                                          |

### How we confirmed the cause

- **Raw packets.** We logged the packets coming from Workers AI before the connector processed them. The same text was present in both fields (failures 1 to 3).
- **Debug view.** The chat's debug mode showed the exact tool input Llama produced (failures 2 and 4).
- **A log line inside the tool.** It never fired on the failing calls, so the failure happened before our code ran, when the input was checked.
- **The request sent to the model.** The server error log for failure 6 printed the full request. It contained the correct tool result as a `tool` message, so Llama had the data and still asked again (failure 5).
- **Re-running the same question** after each fix, until it produced one tool call and a correct answer.

### Guardrails

| Guardrail               | Where                                     | What it does                                                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stream filter           | `src/dedupe-stream.ts`                    | When a packet carries the same text or tool call in both fields, keeps the OpenAI-style copy and drops the native one. Packets with a single copy pass through untouched, so the filter does nothing if the platform is fixed.                                                 |
| Empty tool list removal | `src/dedupe-stream.ts`                    | Leaves `tools` out of the request when the list is empty, instead of sending `[]`.                                                                                                                                                                                             |
| Input coercion          | `src/server.ts` (`z.coerce`)              | Accepts `"8"` as `8` in tool inputs.                                                                                                                                                                                                                                           |
| Once-per-tool rule      | `src/server.ts` (`prepareStep`)           | Before each model step, hides the tools already called for the current question. Llama can call a different tool or answer, but cannot repeat one. Right after **Approve**, every tool stays visible but none can be called (`toolChoice: "none"`), so Llama answers in words. |
| Save only when asked    | `src/server.ts`                           | `logDecision` is offered to the model only when the user's message asks to log, record, or save something, or answers the allocation options question. Either way the Approve/Reject card still decides.                                                                       |
| Fixed reply on Reject   | `src/server.ts`                           | When the user rejects an approval, the code replies "OK, the decision was not saved." without calling the model.                                                                                                                                                               |
| Hide invalid tool calls | `src/hide-invalid-tool-calls.ts`          | Holds each tool call's chat card until the AI library decides whether the call is valid. Invalid calls (tools Llama was not offered) are dropped from the chat and logged on the server; the model still sees the error and recovers. Covered by an automated test.            |
| Ready-made option text  | `src/allocation.ts`                       | Each option's effect on the builds is written into the same sentence as the action, so Llama repeats it.                                                                                                                                                                       |
| Step cap                | `src/server.ts` (`stepCountIs(10)`)       | A backstop that ends any turn after 10 model steps.                                                                                                                                                                                                                            |
| Output limit            | `src/server.ts` (`maxOutputTokens: 1024`) | Raises the 256-token default so longer answers are not cut off.                                                                                                                                                                                                                |
| Prompt rules            | `src/server.ts` (system prompt)           | Never calculate, only repeat numbers a tool returned, and only call a tool when the question needs data.                                                                                                                                                                       |

**Known limits:** the once-per-tool rule means one question cannot call the same tool twice (for example, readiness for 3 weeks and then for 6). In early testing with a placeholder tool, Llama also called a tool on a simple greeting. The prompt rule reduced this but did not eliminate it.

## License

The agents-starter template is MIT licensed (see `LICENSE`).
