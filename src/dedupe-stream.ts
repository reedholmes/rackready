/**
 * Workaround for doubled text with Llama 3.3 on Workers AI.
 *
 * Workers AI streams a reply as a series of "packets" (Server-Sent Events,
 * lines starting with "data: "). For Llama 3.3, each packet can carry the
 * same text twice: once in the native field `response` and once in the
 * OpenAI-style field `choices[0].delta.content`. workers-ai-provider 3.3.1
 * emits text from BOTH fields, so every word reaches the chat twice.
 *
 * This filter removes the OpenAI-style copy only when a packet carries the
 * text in both places. Packets with just one copy pass through untouched, so
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
      choices?: Array<{ delta?: { content?: unknown } }>;
    };
    try {
      packet = JSON.parse(payload);
    } catch {
      return line; // not JSON: leave it alone
    }

    const delta = packet.choices?.[0]?.delta;
    const hasNative =
      typeof packet.response === "string" && packet.response !== "";
    const hasOpenAI = typeof delta?.content === "string" && delta.content !== "";
    if (!(hasNative && hasOpenAI)) return line;

    delete delta!.content;
    return `data: ${JSON.stringify(packet)}`;
  };

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep any partial line for the next chunk
      if (lines.length > 0) {
        controller.enqueue(encoder.encode(lines.map(fixLine).join("\n") + "\n"));
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) controller.enqueue(encoder.encode(fixLine(buffer)));
    }
  });
}

/**
 * Wraps the Workers AI binding so every streamed reply passes through the
 * dedupe filter. Everything else about the binding is unchanged.
 */
export function withDedupedStreams(ai: Ai): Ai {
  return new Proxy(ai, {
    get(target, prop, receiver) {
      if (prop === "run") {
        return async (...args: unknown[]) => {
          const run = target.run as unknown as (
            ...a: unknown[]
          ) => Promise<unknown>;
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
