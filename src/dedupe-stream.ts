/**
 * Workaround for doubled text with Llama 3.3 on Workers AI.
 *
 * Workers AI streams a reply as a series of "packets" (Server-Sent Events,
 * lines starting with "data: "). For Llama 3.3, each packet can carry the
 * same text twice: once in the native field `response` and once in the
 * OpenAI-style field `choices[0].delta.content`. workers-ai-provider 3.3.1
 * emits text from BOTH fields, so every word reaches the chat twice.
 *
 * The same happens with tool calls: the call and its arguments arrive in
 * both the native `tool_calls` field and `choices[0].delta.tool_calls`, so
 * the arguments get glued together twice and fail to parse.
 *
 * This filter removes the native copy only when a packet carries the same
 * thing in both places, always keeping the OpenAI-style copy. Packets with just one copy pass through untouched, so
 * if Cloudflare fixes the stream upstream, this filter simply does nothing.
 */

// Set to true to print the first few raw packets to the dev server log.
const LOG_RAW_PACKETS = false;
const RAW_PACKETS_TO_LOG = 3;

export function createDedupeStream(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let logged = 0;

  const fixLine = (line: string): string => {
    if (!line.startsWith("data:")) return line;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return line;

    if (LOG_RAW_PACKETS && logged < RAW_PACKETS_TO_LOG) {
      logged++;
      console.log(`[rackready] raw packet ${logged}: ${payload}`);
    }

    let packet: {
      response?: unknown;
      tool_calls?: unknown;
      choices?: Array<{ delta?: { content?: unknown; tool_calls?: unknown } }>;
    };
    try {
      packet = JSON.parse(payload);
    } catch {
      return line; // not JSON: leave it alone
    }

    const delta = packet.choices?.[0]?.delta;
    let changed = false;

    // 1. Text: keep the OpenAI-style copy and drop the native copy. The
    //    native copy is less faithful: a number token like " 19" arrives
    //    as the number 19, losing its leading space (seen in testing).
    const hasNativeText =
      packet.response != null && String(packet.response) !== "";
    const hasOpenAIText =
      typeof delta?.content === "string" && delta.content !== "";
    if (hasNativeText && hasOpenAIText) {
      packet.response = "";
      changed = true;
    }

    // 2. Tool calls: the same tool call (and its arguments) can arrive in
    //    both places too, which turns {"weeks":8} into {"weeks":8}{"weeks":8}.
    //    Keep the OpenAI-style copy (it carries the call id and index) and
    //    drop the native copy.
    const hasNativeTools =
      Array.isArray(packet.tool_calls) && packet.tool_calls.length > 0;
    const hasOpenAITools =
      Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0;
    if (hasNativeTools && hasOpenAITools) {
      packet.tool_calls = [];
      changed = true;
    }

    return changed ? `data: ${JSON.stringify(packet)}` : line;
  };

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep any partial line for the next chunk
      if (lines.length > 0) {
        controller.enqueue(
          encoder.encode(lines.map(fixLine).join("\n") + "\n")
        );
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) controller.enqueue(encoder.encode(fixLine(buffer)));
    }
  });
}

/**
 * Wraps the Workers AI binding so that:
 * 1. Every streamed reply passes through the dedupe filter above.
 * 2. An empty tool list is left out of the request. Workers AI rejects
 *    `tools: []` ("must not be an empty array... omit the field entirely"),
 *    which happens when the once-per-tool guardrail in server.ts has hidden
 *    every tool and the model must answer in plain text.
 * Everything else about the binding is unchanged.
 */
export function withDedupedStreams(ai: Ai): Ai {
  return new Proxy(ai, {
    get(target, prop, receiver) {
      if (prop === "run") {
        return async (...args: unknown[]) => {
          const run = target.run as unknown as (
            ...a: unknown[]
          ) => Promise<unknown>;
          const inputs = args[1] as Record<string, unknown> | undefined;
          if (
            inputs &&
            Array.isArray(inputs.tools) &&
            inputs.tools.length === 0
          ) {
            const { tools: _tools, tool_choice: _choice, ...rest } = inputs;
            args[1] = rest;
          }
          const out = await run.apply(target, args);
          return out instanceof ReadableStream
            ? out.pipeThrough(createDedupeStream())
            : out;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
