// ============================================================
// MixDemo shopping assistant — Cloudflare Worker
// ============================================================
// POST /chat  { conversation_id, trace_id, user_id, page_type,
//               messages, tool_executions }
//   -> { content, stop_reason, model }
//
// The browser owns the conversation history and runs the tools (they act
// on its cart and pages). This Worker holds the API key, pins the system
// prompt and tool list, validates everything the browser sends, makes one
// Messages API call per request, and exports spans to Mixpanel.

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, TOOLS } from "./agent.js";
import { buildChatSpan, buildToolSpan, exportSpans, newInputMessages } from "./telemetry.js";

// ---------- Guardrail limits ----------
const MAX_USER_TURNS = 20;           // typed messages per conversation
const MAX_USER_TEXT_CHARS = 1000;    // per typed message
const MAX_MESSAGES = 120;            // history entries (incl. tool results)
const MAX_BODY_CHARS = 200000;
const MAX_OUTPUT_TOKENS = 4096;

// Only these block types may appear in history the browser sends back.
// Notably no `role: "system"` messages — those would carry operator authority.
const ALLOWED_BLOCKS = {
  user: new Set(["text", "tool_result"]),
  assistant: new Set(["text", "tool_use", "thinking", "redacted_thinking"])
};

class BadRequest extends Error {}

function corsHeaders(env, origin) {
  const allowed = env.ALLOWED_ORIGINS.split(",").map(s => s.trim());
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" }
  });
}

function isTypedUserMessage(message) {
  return message.role === "user" && message.content.some(b => b.type === "text");
}

function validate(body) {
  const { conversation_id, trace_id, user_id, page_type, messages, tool_executions = [] } = body;

  if (typeof conversation_id !== "string" || !/^conv_[A-Za-z0-9]{8,40}$/.test(conversation_id)) throw new BadRequest("bad conversation_id");
  if (typeof trace_id !== "string" || !/^[0-9a-f]{32}$/.test(trace_id)) throw new BadRequest("bad trace_id");
  if (typeof user_id !== "string" || !user_id || user_id.length > 200) throw new BadRequest("bad user_id");
  if (typeof page_type !== "string" || page_type.length > 40) throw new BadRequest("bad page_type");
  if (!Array.isArray(tool_executions) || tool_executions.length > 10) throw new BadRequest("bad tool_executions");

  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) throw new BadRequest("bad messages");
  for (const m of messages) {
    if (!ALLOWED_BLOCKS[m.role] || !Array.isArray(m.content) || m.content.length === 0) throw new BadRequest("bad message");
    for (const block of m.content) {
      if (!block || !ALLOWED_BLOCKS[m.role].has(block.type)) throw new BadRequest(`block type not allowed: ${block?.type}`);
      // Tool calls may only name tools this Worker defines.
      if (block.type === "tool_use" && !TOOLS.some(t => t.name === block.name)) throw new BadRequest("unknown tool");
    }
  }
  const last = messages[messages.length - 1];
  if (last.role !== "user") throw new BadRequest("last message must be from the user");

  const typed = messages.filter(isTypedUserMessage);
  if (typed.length > MAX_USER_TURNS) return { limitReached: true };
  if (isTypedUserMessage(last)) {
    const chars = last.content.filter(b => b.type === "text").reduce((n, b) => n + String(b.text).length, 0);
    // +500 leaves room for the <page_context> block the widget attaches.
    if (chars > MAX_USER_TEXT_CHARS + 500) throw new BadRequest("message too long");
  }
  return { conversation_id, trace_id, user_id, page_type, messages, tool_executions };
}

async function handleChat(request, env, ctx, headers) {
  if (env.RATE_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) return json({ error: "rate_limited" }, 429, headers);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return json({ error: "too_large" }, 413, headers);

  let input;
  try {
    input = validate(JSON.parse(raw));
  } catch (err) {
    return json({ error: "bad_request", detail: err instanceof BadRequest ? err.message : "invalid JSON" }, 400, headers);
  }
  if (input.limitReached) return json({ error: "conversation_limit" }, 429, headers);

  const meta = {
    userId: input.user_id,
    conversationId: input.conversation_id,
    traceId: input.trace_id,
    pageType: input.page_type
  };
  const spans = input.tool_executions.map(execution => buildToolSpan(meta, execution));

  // Direct to Anthropic, or through an Anthropic-compatible gateway (e.g. the
  // company LiteLLM proxy), which takes its virtual key as a Bearer token.
  const client = env.LLM_BASE_URL
    ? new Anthropic({ baseURL: env.LLM_BASE_URL, apiKey: null, authToken: env.LLM_API_KEY })
    : new Anthropic({ apiKey: env.LLM_API_KEY });
  const startMs = Date.now();
  let response;
  let error;
  try {
    response = await client.messages.create({
      model: env.MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      // A short chat turn doesn't need deep reasoning.
      output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      tool_choice: { type: "auto" },
      // Caches the growing conversation prefix between calls.
      cache_control: { type: "ephemeral" },
      messages: input.messages
    });
  } catch (err) {
    error = {
      type: err instanceof Anthropic.RateLimitError ? "rate_limit"
        : err instanceof Anthropic.AuthenticationError ? "authentication"
        : err instanceof Anthropic.BadRequestError ? "bad_request"
        : err instanceof Anthropic.APIConnectionError ? "connection"
        : err instanceof Anthropic.APIError ? "api_error"
        : "unknown",
      message: String(err.message || err).slice(0, 500)
    };
    console.error("Claude call failed", error);
  }

  spans.push(buildChatSpan(meta, {
    model: env.MODEL,
    startMs,
    endMs: Date.now(),
    inputMessages: newInputMessages(input.messages),
    response,
    error
  }));
  // Don't make the shopper wait for telemetry.
  ctx.waitUntil(exportSpans(env, spans).catch(err => console.error("span export error", err)));

  if (error) return json({ error: "model_error", type: error.type }, 502, headers);
  return json({ content: response.content, stop_reason: response.stop_reason, model: response.model }, 200, headers);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(env, origin);

    if (url.pathname !== "/chat") return new Response("Not found", { status: 404 });
    if (!headers) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers });

    return handleChat(request, env, ctx, headers);
  }
};
