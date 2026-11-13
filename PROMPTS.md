# RackReady prompt history

Note: the build brief (BUILD_BRIEF.md) and the kickoff prompt below were drafted with Claude's help. Every prompt sent to Claude Code during the build is recorded here word for word, in order.

---

## Prompt 1 (2026-11-11 17:33 ET)

```
I'm building a small demo app for a job application at Cloudflare. I'm a
supply chain operator, not a programmer, so explain things in plain English
as we go. I also want to learn how agents work.

This folder was created from Cloudflare's agents-starter template. The spec
is in BUILD_BRIEF.md. Read it fully before doing anything.

Ground rules:
1. Before writing code, read the starter's files and the current docs at
   https://developers.cloudflare.com/agents/. Trust the docs and the
   installed package versions over what you remember.
2. Keep a file called PROMPTS.md. Append every prompt I send you, word for
   word, with a timestamp, starting with this one. I have to submit my
   prompt history.
3. Work one step at a time. After each step, stop and tell me what you
   built, why, and exactly what to click or type in the browser to see it
   work. Wait for me to say "next".
4. Don't add anything that isn't in the brief without asking. If something
   in the brief won't work on the current SDK, tell me and propose the
   closest alternative.
5. The model must never do arithmetic. All quantities come from tool code.
6. Commit to git after each working step with a clear message.

Steps:
0. Orientation only, no code changes. Explain the starter to me: what each
   main file does, where the model is called, where tools are defined,
   where state is stored, and how the chat UI talks to the agent. Then show
   me your plan for steps 1 to 6 and flag any risks, especially tool
   calling with Llama 3.3 on Workers AI.
1. Switch the model to Llama 3.3 on Workers AI and replace the starter's
   system prompt and example tools with a bare RackReady agent. Confirm
   chat still works.
2. Add the mock data tables and seed them as the brief describes. Add
   getBuildPlan.
3. Add checkMaterialReadiness, with a small test that proves the week 3
   switch shortage and the week 5 recovery.
4. Add proposeAllocation, logDecision with approval in the chat, and
   listDecisions.
5. Add the weekly scheduled review and the "run review now" action.
6. Deploy to Cloudflare, then write README.md as the brief describes.

Start with step 0.
```

---

## Prompt 2 (2026-11-11 17:41 ET)

```
"C:\Users\reedh\rackready" it's actually in this folder where I started the app. Can you move the build brief and the other file into this folder?
```

---

## Prompt 3 (2026-11-11 17:44 ET)

```
Keep them
```

---

## Prompt 4 (2026-11-11 17:45 ET)

```
next
```

Answer given in a multiple-choice dialog during this step:

- Git identity for commits: "Name + private placeholder (Recommended)"

---

## Prompt 5 (2026-11-11 17:55 ET)

```
Logged in
```

---

## Prompt 6 (2026-11-11 17:57 ET)

```
yeah saw the doubling also
```

---

## Prompt 7 (2026-11-11 17:58 ET)

```
Filter the stream
```

---

## Prompt 8 (2026-11-11 19:09 ET)

```
next
```

---

## Prompt 9 (2026-11-11 19:22 ET)

```
Add the guardrails
```

---

## Prompt 10 (2026-11-11 19:25 ET)

```
add a short Model Notes section to the README. what failed, how you confirmed it was the model, and what each guardrail does.
```

---

## Prompt 11 (2026-11-11 19:31 ET)

```
why is the build count different from total racks?
```

---

## Prompt 12 (2026-11-11 19:32 ET)

```
thanks, next
```

---

## Prompt 13 (2026-11-11 20:00 ET)

```
move onto step 4 but keep an eye on the tool readiness call.
```

---

## Prompt 14 (2026-11-11 21:10 ET)

```
Yes, hide them
```

---

## Prompt 15 (2026-11-11 21:45 ET)

```
yes, and bring back the 5 questions to this window
```

---

## Prompt 16 (2026-11-11 21:50 ET)

```
Yes, replace them
```

---

## Prompt 17 (2026-11-11 21:52 ET)

```
Start step 5
```

---

## Prompt 18 (2026-11-11 22:23 ET)

```
Start step 6
```

Answers given in multiple-choice dialogs during this step:

- MCP panel before deploying: "Remove MCP, then deploy (Recommended)"
- Cost of public deployment: "Yes, deploy"
- How picking an option should work: "Offer the save on a pick (Recommended)"

---

## Prompt 19 (2026-11-11 22:52 ET)

```
are there any other evals we can do?
```

---

## Prompt 20 (2026-11-11 22:53 ET)

```
Repeatability eval
```

---

## Prompt 21 (2026-11-11 23:03 ET)

```
Yes, fix Q1
```

---

## Prompt 22 (2026-11-11 23:07 ET)

```
Wait for the reset
```

---

## Prompt 23 (2026-11-12 20:39 ET)

```
ok my limit should have reset by now, lets do it
```

---

## Prompt 24 (2026-11-12 20:42 ET)

```
I'll sign in
```

---

## Prompt 25 (2026-11-13 09:33 ET)

```
Retry now and add a line to the readme.
```

---

## Prompt 26 (2026-11-13 09:45 ET)

```
Yes, redeploy
```

---

## Prompt 27 (2026-11-13 14:00 ET)

```
push it to GitHub
```

Answers given in multiple-choice dialogs during this step:

- GitHub account: "Switch to reedholmes"
- Repo visibility: "Public (Recommended)"

---

## Prompt 28 (2026-11-13 14:03 ET)

```
I changed my username to reedholmes, same account
```

---

## Prompt 29 (2026-11-13 14:06 ET)

```
Yes, reformat
```
