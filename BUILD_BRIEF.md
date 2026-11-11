# RackReady: build brief

A brief for Claude Code. Paste it as your first build prompt, or save it in the repo as `BUILD_BRIEF.md` and tell Claude Code to follow it.

## What we are building

RackReady is a chat agent for a supply chain program manager who owns data center rack integration. The user asks plain-English questions such as "Which rack builds are at risk in the next six weeks?" and the agent checks material readiness against the build plan, explains the shortages, proposes allocation options, and remembers the decisions made.

It is a demo for a job application at Cloudflare (Supply Chain Program Manager, Rack Integration). All data is mock data. The goal is a small, working, honest app, built in one evening.

## Requirements from the assignment

The app must include all four:

1. An LLM. Use Llama 3.3 on Workers AI. Look up the current model ID in the Workers AI docs. If tool calling is unreliable with it, say so and suggest another Workers AI model that supports function calling.
2. Workflow or coordination. Use the Agents SDK agent (a Durable Object) plus its built-in scheduling for a weekly shortage review.
3. User input through chat. Keep the starter's chat UI.
4. Memory or state. Chat history plus a decisions log, both persisted in the agent's SQLite storage.

## Starting point

The project was created from Cloudflare's starter:

```
npx create-cloudflare@latest --template cloudflare/agents-starter
```

Before writing code, read the current docs at https://developers.cloudflare.com/agents/ and the starter's own files. The SDK changes often. Use what the docs and the installed package say over anything you remember.

## Domain in one paragraph

Servers are built at a manufacturer (called L10, server level). An integration partner then assembles servers, switches, power units, and cables into complete racks (called L11, rack level) and ships them to data centers. A rack build can only start if every component on its bill of materials is on hand at the integrator. The program manager's weekly job is to compare the build plan against inventory and inbound shipments, find shortages early, and decide who gets constrained supply.

## Mock data (seed on first run)

Keep it small enough to read in one screen.

- `builds`: about 12 rack builds over the next 8 weeks. Fields: id, week, integrator site (two sites, for example Texas and Malaysia), rack type (compute or network), quantity, destination region, priority (1 to 3).
- `bom`: components per rack for each rack type. For example a compute rack needs 20 servers, 2 switches, 2 power units, 1 cable kit.
- `inventory`: on-hand quantity by component and integrator site.
- `inbound`: purchase orders in transit. Fields: component, site, quantity, expected week, supplier.

Seed it so the story is interesting: servers are fine, one switch model runs short in week 3 at one site, and a late inbound shipment fixes it in week 5.

## Tools the agent can call

The model must not do arithmetic. Code computes; the model decides which tool to call and explains the result.

1. `getBuildPlan(weeks)`: returns planned builds for the horizon.
2. `checkMaterialReadiness(weeks)`: walks the plan week by week, consumes inventory, adds inbound shipments when they land, and returns each build as ready or short, with the component, quantity short, and the week supply recovers.
3. `proposeAllocation(component, site)`: when supply is constrained, returns two or three options with the tradeoff for each. For example: serve builds by priority, split supply across regions, or transfer stock from the other site.
4. `logDecision(summary)`: saves a decision to the decisions log. Require the user's approval in the chat before it is saved (human in the loop).
5. `listDecisions()`: returns past decisions so the agent can refer back to them.

## Scheduled review

Once a week (and on demand through a "run review now" action), the agent runs `checkMaterialReadiness` for 6 weeks and stores a short summary. The next time the user opens the chat, the agent leads with that summary.

## System prompt guidance

- You are a planning assistant for rack integration. Be brief and specific.
- Always call a tool for numbers. Never estimate quantities.
- Lead with the answer: what is at risk, by how much, and when it recovers.
- When supply is constrained, present options and ask the user to choose. Do not choose for them.
- State clearly that the data is mock data if asked where it comes from.

## Interface

Keep the starter's chat. Add a small side panel with two lists: builds at risk and the decisions log. If that takes more than 30 minutes, skip it.

## Out of scope

Authentication, real ERP connections, file uploads, voice, multiple users, and styling beyond the starter.

## Done means

- These five questions work in the deployed app:
  1. Which rack builds are at risk in the next six weeks?
  2. What is short for the week 3 builds, and when does it recover?
  3. What are my options for the switch shortage?
  4. Log the decision to serve priority 1 builds first. (asks for approval, then saves)
  5. What did we decide last time? (answers from the decisions log after a page refresh)
- The app is deployed to Cloudflare and the URL is in the README.
- `README.md` covers: what it does, how the four required components are met, how to run it locally, what is mock, and what was built with AI assistance.
- `PROMPTS.md` holds the full prompt history in order.

## How to work with me

I am not a programmer. After each step, tell me in plain English what you built and why, and what to try in the browser to see it working. Stop and ask before adding anything not in this brief.
