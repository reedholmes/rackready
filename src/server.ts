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
      tools: {
        // MCP tools from connected servers (starter feature, left in place)
        ...mcpTools,

        // TEMPORARY (step 1 only): proves Llama 3.3 can make a real tool
        // call. Replaced by getBuildPlan in step 2.
        checkConnection: tool({
          description:
            "Check that the RackReady agent is connected. Use this when the user asks whether the agent is working, connected, or online.",
          inputSchema: z.object({}),
          execute: async () => ({
            status: "connected",
            agent: "RackReady",
            serverTime: new Date().toISOString()
          })
        })
      },
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
