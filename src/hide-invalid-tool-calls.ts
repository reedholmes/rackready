/**
 * Hides invalid tool calls from the chat.
 *
 * Llama 3.3 sometimes asks for a tool it was not offered: a repeat of a tool
 * the once-per-tool rule has hidden, or an invented one (seen in testing:
 * "getDecision"). The AI library rejects the call, tells the model, and the
 * model recovers with a correct answer, but the chat showed a red Error card.
 *
 * A tool call's card starts streaming before the library knows whether the
 * call is valid. So this filter holds each tool call's chunks until the
 * verdict arrives:
 * - "tool-input-available": valid, so release the held chunks and carry on.
 * - "tool-input-error": invalid, so drop the held chunks and every later
 *   chunk for that call, and log it on the server instead.
 * Everything else (text, valid tool calls, approvals) passes straight through.
 */
import type { UIMessageChunk } from "ai";

export function hideInvalidToolCalls(): TransformStream<
  UIMessageChunk,
  UIMessageChunk
> {
  const held = new Map<string, UIMessageChunk[]>(); // waiting for a verdict
  const dropped = new Set<string>(); // invalid calls

  return new TransformStream({
    transform(chunk, controller) {
      const id =
        "toolCallId" in chunk && typeof chunk.toolCallId === "string"
          ? chunk.toolCallId
          : null;
      if (id === null) {
        controller.enqueue(chunk);
        return;
      }
      if (dropped.has(id)) return;

      switch (chunk.type) {
        case "tool-input-start":
        case "tool-input-delta":
          held.set(id, [...(held.get(id) ?? []), chunk]);
          return;
        case "tool-input-error":
          held.delete(id);
          dropped.add(id);
          console.warn(
            `[rackready] hid invalid tool call "${chunk.toolName}": ${chunk.errorText}`
          );
          return;
        case "tool-input-available":
          for (const c of held.get(id) ?? []) controller.enqueue(c);
          held.delete(id);
          controller.enqueue(chunk);
          return;
        default:
          controller.enqueue(chunk);
      }
    },
    flush(controller) {
      // Anything still held never got a verdict; release it unchanged.
      for (const chunks of held.values()) {
        for (const c of chunks) controller.enqueue(c);
      }
    }
  });
}
