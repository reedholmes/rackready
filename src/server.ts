import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { z } from "zod";
import { withDedupedStreams } from "./dedupe-stream";
import { getBuildPlan, setupDatabase } from "./db";

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
      })
    };

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
      // Before every model step, hide the tools already called in this turn.
      // This stops Llama 3.3 from calling the same tool over and over instead
      // of answering. Once every useful tool is used, it has to answer.
      prepareStep: ({ steps }) => {
        const used = new Set(
          steps.flatMap((step) => step.toolCalls.map((call) => call.toolName))
        );
        const remaining = (Object.keys(tools) as (keyof typeof tools)[]).filter(
          (name) => !used.has(name)
        );
        return { activeTools: remaining };
      },
      // Workers AI defaults to 256 output tokens, which cuts off longer
      // answers such as a full 8-week build list.
      maxOutputTokens: 1024,
      stopWhen: stepCountIs(10),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
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
