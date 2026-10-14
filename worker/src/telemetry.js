// ============================================================
// Mixpanel Agent Intelligence — OTLP/JSON span export
// ============================================================
// Every model call and every tool the browser executed becomes one span,
// and every span becomes one `$mp_ai_span` event in Mixpanel. All spans for
// one user prompt share a trace id (= one "turn"); gen_ai.conversation.id
// groups turns into a conversation.
//
// Attribute names follow the OpenTelemetry GenAI semantic conventions.
// Note: the ingestion endpoint expects traceId/spanId as base64-encoded
// bytes (OTLP's protobuf JSON mapping); hex ids are rejected.

import { AGENT_NAME, PROMPT_VERSION } from "./agent.js";

const SPAN_KIND_INTERNAL = 1;
const SPAN_KIND_CLIENT = 3;
const STATUS_ERROR = 2;
// Keeps each span far below Mixpanel's 1MB-per-span limit.
const MAX_ATTR_CHARS = 8000;

function hexToBase64(hex) {
  const bytes = hex.match(/../g).map(h => parseInt(h, 16));
  return btoa(String.fromCharCode(...bytes));
}

function randomBase64(byteLength) {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(byteLength))));
}

function toNanos(ms) {
  return (BigInt(Math.round(ms)) * 1000000n).toString();
}

function truncate(str) {
  return str.length > MAX_ATTR_CHARS ? str.slice(0, MAX_ATTR_CHARS) + "…[truncated]" : str;
}

function toAttributes(obj) {
  const attributes = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    let otelValue;
    if (typeof value === "boolean") otelValue = { boolValue: value };
    else if (typeof value === "number" && Number.isInteger(value)) otelValue = { intValue: String(value) };
    else if (typeof value === "number") otelValue = { doubleValue: value };
    // Lists of plain strings (finish_reasons) stay arrays; message lists are
    // sent as JSON strings, which is what the GenAI conventions expect.
    else if (Array.isArray(value) && value.every(v => typeof v === "string")) otelValue = { arrayValue: { values: value.map(v => ({ stringValue: v })) } };
    else otelValue = { stringValue: truncate(typeof value === "string" ? value : JSON.stringify(value)) };
    attributes.push({ key, value: otelValue });
  }
  return attributes;
}

// ---------- Anthropic content -> GenAI message format ----------
// Thinking blocks are skipped; they're internal and not useful in transcripts.
function toParts(content) {
  if (typeof content === "string") return [{ type: "text", content }];
  const parts = [];
  for (const block of content) {
    if (block.type === "text") parts.push({ type: "text", content: block.text });
    else if (block.type === "tool_use") parts.push({ type: "tool_call", id: block.id, name: block.name, arguments: block.input });
    else if (block.type === "tool_result") parts.push({ type: "tool_call_response", id: block.tool_use_id, response: block.content });
  }
  return parts;
}

// Only the messages new to this call (everything after the last assistant
// turn), so the conversation view reads as a transcript instead of
// repeating the whole history on every span.
export function newInputMessages(messages) {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") { start = i + 1; break; }
  }
  return messages.slice(start).map(m => ({ role: m.role, parts: toParts(m.content) }));
}

// ---------- Span builders ----------
function commonAttributes(meta) {
  return {
    "user.id": meta.userId,
    "gen_ai.conversation.id": meta.conversationId,
    "gen_ai.agent.name": AGENT_NAME,
    "gen_ai.provider.name": "anthropic",
    // Custom dimensions for breakdowns in Mixpanel.
    "agent.prompt_version": PROMPT_VERSION,
    "agent.surface": "floating_widget",
    "page.type": meta.pageType
  };
}

// One span per call to the Messages API.
export function buildChatSpan(meta, { model, startMs, endMs, inputMessages, response, error }) {
  const usage = response?.usage;
  const cacheRead = usage?.cache_read_input_tokens || 0;
  const cacheWrite = usage?.cache_creation_input_tokens || 0;

  const span = {
    traceId: hexToBase64(meta.traceId),
    spanId: randomBase64(8),
    name: `chat ${model}`,
    kind: SPAN_KIND_CLIENT,
    startTimeUnixNano: toNanos(startMs),
    endTimeUnixNano: toNanos(endMs),
    attributes: toAttributes({
      ...commonAttributes(meta),
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": model,
      "gen_ai.response.model": response?.model,
      "gen_ai.response.id": response?.id,
      "gen_ai.response.finish_reasons": response ? [response.stop_reason] : undefined,
      // Mixpanel expects input_tokens to include cache reads and writes.
      "gen_ai.usage.input_tokens": usage ? usage.input_tokens + cacheRead + cacheWrite : undefined,
      "gen_ai.usage.output_tokens": usage?.output_tokens,
      "gen_ai.usage.cache_read.input_tokens": usage ? cacheRead : undefined,
      "gen_ai.usage.cache_write.input_tokens": usage ? cacheWrite : undefined,
      "gen_ai.input.messages": inputMessages,
      "gen_ai.output.messages": response
        ? [{ role: "assistant", parts: toParts(response.content), finish_reason: response.stop_reason }]
        : undefined,
      "error.type": error?.type
    })
  };
  if (error) span.status = { code: STATUS_ERROR, message: error.message };
  return span;
}

// One span per tool the browser ran for the previous model call.
export function buildToolSpan(meta, execution) {
  const span = {
    traceId: hexToBase64(meta.traceId),
    spanId: randomBase64(8),
    name: `execute_tool ${execution.name}`,
    kind: SPAN_KIND_INTERNAL,
    startTimeUnixNano: toNanos(execution.start_ms),
    endTimeUnixNano: toNanos(execution.end_ms),
    attributes: toAttributes({
      ...commonAttributes(meta),
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": execution.name,
      "gen_ai.tool.type": "function",
      "gen_ai.tool.call.id": execution.call_id,
      "gen_ai.tool.call.arguments": execution.arguments,
      "gen_ai.tool.call.result": execution.result,
      "error.type": execution.is_error ? "tool_error" : undefined
    })
  };
  if (execution.is_error) span.status = { code: STATUS_ERROR, message: String(execution.result) };
  return span;
}

export async function exportSpans(env, spans) {
  if (!spans.length) return;
  const res = await fetch(env.MIXPANEL_OTEL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${btoa(`${env.MIXPANEL_TOKEN}:`)}`
    },
    body: JSON.stringify({
      resourceSpans: [{
        resource: { attributes: toAttributes({ "service.name": AGENT_NAME }) },
        scopeSpans: [{ scope: { name: "mixdemo-agent-worker" }, spans }]
      }]
    })
  });
  if (!res.ok) console.error("Mixpanel span export failed", res.status, await res.text());
}
