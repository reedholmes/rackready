import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  getToolName,
  isToolUIPart,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { z } from "zod";
import { withDedupedStreams } from "./dedupe-stream";
import { hideInvalidToolCalls } from "./hide-invalid-tool-calls";
import {
  getBuildPlan,
  listDecisions,
  loadPlanningData,
  logDecision,
  setupDatabase
} from "./db";
import { checkMaterialReadiness } from "./readiness";
import { proposeAllocation } from "./allocation";

// Llama 3.3 70B on Workers AI (model ID checked against the Workers AI
// model catalog and the installed type definitions in env.d.ts).
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// System prompt, taken from the "System prompt guidance" in BUILD_BRIEF.md.
const SYSTEM_PROMPT = `You are RackReady, a planning assistant for data center rack integration. You help a supply chain program manager check material readiness against the rack build plan.

Rules:
- Be brief and specific.
- Only call a tool when the question needs data from it. For greetings or general questions, answer directly without calling any tool.
- Always call a tool for numbers. Never estimate, calculate, add, or subtract quantities yourself. Only repeat numbers exactly as a tool returned them.
- If no tool can answer a question about builds, inventory, or shortages, say you do not have that data yet. Do not guess.
- Lead with the answer: what is at risk, by how much, and when it recovers.
- When supply is constrained, present the options and ask the user to choose. Do not choose for them.
- If asked where the data comes from, say clearly that all data in this demo is mock data.`;

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  chatRecovery = true;
  // Wait for MCP connections to be re-established after hibernation before
  // processing a message, so MCP tools aren't intermittently missing.
  waitForMcpConnections = true;

  onStart() {
    // Create the mock data tables and seed them on first run.
    setupDatabase(this.sql.bind(this));

    // Configure OAuth popup behavior for MCP servers that require authentication
    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        if (result.authSuccess) {
          return new Response("<script>window.close();</script>", {
            headers: { "content-type": "text/html" },
            status: 200
          });
        }
        return new Response(
          `Authentication Failed: ${result.authError || "Unknown error"}`,
          { headers: { "content-type": "text/plain" }, status: 400 }
        );
      }
    });
  }

  @callable()
  async addServer(name: string, url: string) {
    return await this.addMcpServer(name, url);
  }

  @callable()
  async removeServer(serverId: string) {
    await this.removeMcpServer(serverId);
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const mcpTools = this.mcp.getAITools();
    // The binding is wrapped to remove doubled text (see dedupe-stream.ts).
    const workersai = createWorkersAI({
      binding: withDedupedStreams(this.env.AI)
    });

    const tools = {
      // MCP tools from connected servers (starter feature, left in place)
      ...mcpTools,

      getBuildPlan: tool({
        description:
          "Get the planned rack builds for the next N weeks (week 1 is this week). Returns each build's id, week, integrator site, rack type, number of racks, destination region and priority, plus totals.",
        inputSchema: z.object({
          // Guardrail 1: z.coerce accepts "8" (text) as well as 8 (number),
          // because Llama 3.3 sometimes sends numbers as text.
          weeks: z.coerce
            .number()
            .int()
            .min(1)
            .max(8)
            .describe("How many weeks ahead to include, from 1 to 8")
        }),
        execute: async ({ weeks }) => {
          try {
            return getBuildPlan(this.sql.bind(this), weeks);
          } catch (error) {
            console.error("[rackready] getBuildPlan failed:", error);
            throw error;
          }
        }
      }),

      checkMaterialReadiness: tool({
        description:
          "Check whether each planned rack build has all its components on hand at its integrator site, week by week, including inbound shipments. Returns each build as ready or short, with the short component, quantity short, and the week supply recovers, plus a ready-made summary. Use this for any question about risk, shortages, readiness, or recovery.",
        inputSchema: z.object({
          // z.coerce: Llama 3.3 sometimes sends numbers as text.
          weeks: z.coerce
            .number()
            .int()
            .min(1)
            .max(8)
            .describe("How many weeks ahead to check, from 1 to 8")
        }),
        execute: async ({ weeks }) => {
          try {
            return checkMaterialReadiness(
              loadPlanningData(this.sql.bind(this)),
              weeks
            );
          } catch (error) {
            console.error("[rackready] checkMaterialReadiness failed:", error);
            throw error;
          }
        }
      }),

      proposeAllocation: tool({
        description:
          "When a component is short at a site, return two or three allocation options (for example serve by priority, transfer stock from the other site, expedite a shipment), each with its effect on the affected builds and its tradeoff. Use this when the user asks for options or what to do about a shortage. For each option, tell the user the action, the effect on each build, and the tradeoff, then ask them to choose.",
        inputSchema: z.object({
          component: z
            .string()
            .describe(
              "Component code such as SW-TOR-48, or its name such as top-of-rack switch"
            ),
          site: z.string().describe("Integrator site: Texas (TX) or Malaysia (MY)")
        }),
        execute: async ({ component, site }) => {
          try {
            return proposeAllocation(
              loadPlanningData(this.sql.bind(this)),
              component,
              site
            );
          } catch (error) {
            console.error("[rackready] proposeAllocation failed:", error);
            throw error;
          }
        }
      }),

      logDecision: tool({
        description:
          "Save a planning decision to the decisions log. Use this when the user asks to log, record, or save a decision. The user must approve in the chat before it is saved.",
        inputSchema: z.object({
          summary: z
            .string()
            .describe("One or two sentences describing the decision, in the user's words")
        }),
        // Human in the loop: the chat shows Approve / Reject first.
        needsApproval: true,
        execute: async ({ summary }) => logDecision(this.sql.bind(this), summary)
      }),

      listDecisions: tool({
        description:
          "List past planning decisions from the decisions log, newest first. Use this when the user asks what was decided before.",
        inputSchema: z.object({}),
        execute: async () => listDecisions(this.sql.bind(this))
      })
    };

    // Tool calls made since the user's last message. Non-empty only when
    // this run is a continuation after Approve / Reject (see guardrail 2).
    let lastUser = this.messages.length - 1;
    while (lastUser >= 0 && this.messages[lastUser].role !== "user") lastUser--;
    const toolPartsThisQuestion = this.messages
      .slice(lastUser + 1)
      .flatMap((m) => m.parts)
      .filter(isToolUIPart);
    const usedThisQuestion = toolPartsThisQuestion.map((part) => getToolName(part));

    // Guardrail 5: only offer logDecision when the user's message asks to
    // log, record, or save something. In testing, "What did we decide last
    // time?" made Llama 3.3 ask to log a decision nobody asked to save.
    const lastUserText =
      lastUser >= 0
        ? this.messages[lastUser].parts
            .map((p) => (p.type === "text" ? p.text : ""))
            .join(" ")
        : "";
    const askedToLog =
      /\b(log|logged|logging|record|recorded|save|saved|note down|write down)\b/i.test(
        lastUserText
      );

    // Guardrail 3: after the user clicks Reject, reply with fixed text and do
    // not call the model. In testing, Llama 3.3 kept trying to log the
    // rejected decision again (as a new approval request, or printed as text).
    const rejected = toolPartsThisQuestion.some(
      (p) =>
        p.state === "output-denied" ||
        (p.state === "approval-responded" && p.approval.approved === false)
    );
    const approvedWaiting = toolPartsThisQuestion.some(
      (p) => p.state === "approval-responded" && p.approval.approved === true
    );
    if (rejected && !approvedWaiting) {
      const stream = createUIMessageStream({
        execute: ({ writer }) => {
          const id = crypto.randomUUID();
          writer.write({ type: "text-start", id });
          writer.write({
            type: "text-delta",
            id,
            delta: "OK, the decision was not saved."
          });
          writer.write({ type: "text-end", id });
        }
      });
      return createUIMessageStreamResponse({ stream });
    }

    const result = streamText({
      model: workersai(MODEL_ID, {
        sessionAffinity: this.sessionAffinity
      }),
      system: SYSTEM_PROMPT,
      // Prune old tool calls to save tokens (Llama 3.3 has a 24k token window)
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools,
      // Guardrail 2: each tool can be called at most once per question.
      // a) After the user clicks Approve, a new run starts for the same
      //    question. In that run the model may not call any tool, it must
      //    answer in words. (Hiding the tools instead made Llama 3.3 say the
      //    function was "not provided". Reject is handled by guardrail 3.)
      // b) Otherwise, before every model step, hide the tools already called
      //    in this run, so Llama cannot call the same tool over and over.
      prepareStep: ({ steps }) => {
        if (usedThisQuestion.length > 0) {
          return { toolChoice: "none" as const };
        }
        const used = new Set(
          steps.flatMap((step) => step.toolCalls.map((call) => call.toolName))
        );
        const remaining = (Object.keys(tools) as (keyof typeof tools)[]).filter(
          (name) =>
            !used.has(name) && (name !== "logDecision" || askedToLog)
        );
        return { activeTools: remaining };
      },
      // Workers AI defaults to 256 output tokens, which cuts off longer
      // answers such as a full 8-week build list.
      maxOutputTokens: 1024,
      stopWhen: stepCountIs(10),
      abortSignal: options?.abortSignal
    });

    // Guardrail 4: hide invalid tool calls (tools Llama was not offered)
    // from the chat. See hide-invalid-tool-calls.ts.
    return createUIMessageStreamResponse({
      stream: result.toUIMessageStream().pipeThrough(hideInvalidToolCalls())
    });
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
