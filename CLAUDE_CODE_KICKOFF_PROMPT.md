# Claude Code kickoff prompt for RackReady

## Before you paste

1. Create the project: `npx create-cloudflare@latest --template cloudflare/agents-starter`
2. Save `RACKREADY_BUILD_BRIEF.md` into that folder and rename it `BUILD_BRIEF.md`.
3. Open Claude Code in that folder.
4. Paste everything in the block below as your first message.

## The prompt

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

## How to run it

- Say "next" only after you have seen the step work in your browser. If it does not work, paste the error back and ask what went wrong and why.
- Step 0 is the lesson. Ask follow-up questions there until you could explain the starter to someone else.
- Step 3 is the heart of the app. If you run short on time, finish through step 4, skip step 5, and deploy.
- Add a line at the top of `PROMPTS.md` saying the brief and this kickoff prompt were drafted with Claude's help.
