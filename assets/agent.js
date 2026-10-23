// ============================================================
// SHOPPING ASSISTANT — floating chat widget (every page)
// ============================================================
// The Worker (worker/) holds the API key, the system prompt and the tool
// list; this file owns the conversation and *runs* the tools, because they
// act on this shopper's cart and pages. Tools that change page end the
// current request; the turn resumes on the new page so the assistant can
// say where the shopper landed.
//
// Depends on mixpanel-setup.js (store, KEYS, PAGE_TYPE, currentUser) and
// app.js (catalog, cart, addToCart, startCheckout, afterMixpanel).

// Local dev talks to `wrangler dev`. Set the production URL after
// `wrangler deploy`; while it's empty the widget stays hidden on the live site.
const AGENT_PROD_URL = "https://mixdemo-agent.naitik-soni.workers.dev/chat";
const AGENT_API_URL = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "http://localhost:8787/chat"
  : AGENT_PROD_URL;

const MAX_MODEL_CALLS_PER_TURN = 6;
const MAX_TYPED_TURNS = 20;           // mirrors the Worker's limit
const MAX_MESSAGE_CHARS = 1000;
const NAV_TOOLS = new Set(["browse_category", "open_product", "view_cart", "go_to_checkout"]);
const SUGGESTIONS = ["Show me headphones", "Gift ideas under $50", "What's in my cart?", "Take me to checkout"];

function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, "0")).join("");
}

function newConversation(open = false) {
  return {
    id: "conv_" + randomHex(10),
    messages: [],      // Messages API history, append-only (thinking blocks included)
    transcript: [],    // what the widget shows: { role: user|assistant|action|error, text }
    turn: 0,
    open,
    pending: null      // a turn that changed page and continues on this one
  };
}

let agent = store.get(KEYS.agent) || newConversation();
let busy = false;

function saveAgent() {
  store.set(KEYS.agent, agent);
}

// ---------- Tracking ----------
// Regular Mixpanel events for product analytics. Model calls and tool
// timings go to Agent Intelligence as spans from the Worker.
let trackingQueue = [];

function trackAgent(eventName, props = {}) {
  trackingQueue.push(afterMixpanel(cb => mixpanel.track(eventName, {
    "conversation_id": agent.id,
    "turn_number": agent.turn,
    ...props
  }, cb)));
}

function flushTracking() {
  const pending = trackingQueue;
  trackingQueue = [];
  return Promise.all(pending);
}

// ---------- Tools (executed here, validated again here) ----------
function productSummary(p) {
  return { product_id: p.slug, name: p.name, price: p.price, category: p.category, description: p.description };
}

function cartSummary() {
  const totals = cartTotals();
  return {
    items: cartItems().map(i => ({ product_id: i.slug, name: i.name, price: i.price, quantity: i.qty })),
    item_count: cartSize(),
    subtotal: totals.subtotal,
    discount: totals.discount,
    shipping: totals.shipping,
    total: totals.total
  };
}

function goTo(url) {
  return () => flushTracking().then(() => { window.location.href = url; });
}

// Returns { result } or { error }, plus `navigate` for page-changing tools
// and `label` for the action line shown in the chat.
function executeTool(name, input) {
  switch (name) {
    case "search_products": {
      const category = String(input.category || "all");
      const words = String(input.query || "").toLowerCase().split(/\W+/).filter(w => w.length > 1);
      const matches = PRODUCTS.filter(p => {
        if (category !== "all" && p.category !== category) return false;
        if (!words.length) return true;
        const haystack = `${p.name} ${p.description} ${p.category}`.toLowerCase();
        return words.some(w => haystack.includes(w));
      });
      return { result: { count: matches.length, products: matches.map(productSummary) } };
    }
    case "browse_category": {
      const category = String(input.category);
      if (category !== "all" && !CATEGORY_LABELS[category]) return { error: `Unknown category "${category}".` };
      const label = category === "all" ? "all products" : CATEGORY_LABELS[category];
      return {
        result: { status: `Showing ${label} on the store homepage.` },
        navigate: goTo(category === "all" ? "index.html" : categoryUrl(category)),
        label: `Opening ${label}`
      };
    }
    case "open_product": {
      const p = findProduct(String(input.product_id));
      if (!p) return { error: `Unknown product_id "${input.product_id}". Use search_products to find valid ids.` };
      return {
        result: { status: `Showing the ${p.name} product page.`, product: productSummary(p) },
        navigate: goTo(productUrl(p)),
        label: `Opening ${p.name}`,
        productId: p.id
      };
    }
    case "add_to_cart": {
      const p = findProduct(String(input.product_id));
      const qty = Number(input.quantity);
      if (!p) return { error: `Unknown product_id "${input.product_id}". Use search_products to find valid ids.` };
      if (!Number.isInteger(qty) || qty < 1 || qty > 5) return { error: "quantity must be a whole number from 1 to 5." };
      addToCart(p.id, { qty, agentConversationId: agent.id });
      return {
        result: { status: `Added ${qty} × ${p.name}.`, cart: cartSummary() },
        label: `Added ${qty} × ${p.name} to cart`,
        productId: p.id
      };
    }
    case "get_cart":
      return { result: cartSummary() };
    case "view_cart":
      return { result: { status: "Showing the cart page.", cart: cartSummary() }, navigate: goTo("cart.html"), label: "Opening your cart" };
    case "go_to_checkout": {
      if (cartSize() === 0) return { error: "The cart is empty, so checkout isn't available yet." };
      return {
        result: { status: "Showing the checkout page. The shopper enters shipping and payment details and places the order.", cart: cartSummary() },
        navigate: () => flushTracking().then(() => startCheckout(agent.id)),
        label: "Opening checkout"
      };
    }
    default:
      return { error: `Tool "${name}" isn't available.` };
  }
}

function runTools(toolUses) {
  const results = [];
  const executions = [];
  let navigate = null;

  for (const block of toolUses) {
    const start = Date.now();
    let outcome;
    try {
      outcome = NAV_TOOLS.has(block.name) && navigate
        ? { error: "Only one page change per reply; this one was skipped." }
        : executeTool(block.name, block.input || {});
    } catch (err) {
      outcome = { error: "The store couldn't complete that action." };
    }
    if (outcome.navigate) navigate = outcome.navigate;

    const content = JSON.stringify(outcome.error ? { error: outcome.error } : outcome.result);
    results.push({ type: "tool_result", tool_use_id: block.id, content, ...(outcome.error ? { is_error: true } : {}) });
    executions.push({
      name: block.name, call_id: block.id, arguments: block.input,
      result: content, start_ms: start, end_ms: Date.now(), is_error: !!outcome.error
    });
    if (outcome.label && !outcome.error) addToTranscript("action", outcome.label);
    trackAgent("Agent Action Taken", {
      "tool_name": block.name,
      "success": !outcome.error,
      "product_id": outcome.productId || null
    });
  }
  return { results, executions, navigate };
}

// ---------- Talking to the Worker ----------
function pageContext() {
  const lines = [`page: ${PAGE_TYPE}`];
  if (PAGE_TYPE === "productDetail") {
    const p = findProduct(new URLSearchParams(window.location.search).get("id") || "");
    if (p) lines.push(`viewing product: ${p.slug} (${p.name}, $${p.price})`);
  }
  lines.push(`cart: ${cartSize()} item(s), subtotal $${cartSubtotal()}`);
  return `<page_context>\n${lines.join("\n")}\n</page_context>`;
}

async function callWorker(turn) {
  const res = await fetch(AGENT_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversation_id: agent.id,
      trace_id: turn.traceId,
      user_id: currentUser.email,       // same as the Mixpanel distinct_id
      page_type: PAGE_TYPE,
      messages: agent.messages,
      tool_executions: turn.toolExecutions
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `http_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

const ERROR_MESSAGES = {
  conversation_limit: "This conversation has reached its limit. Start a new chat to keep going.",
  rate_limited: "You're sending messages quickly. Please wait a moment and try again.",
  model_error: "I couldn't reach the assistant just now. Please try again."
};

// Runs model calls and tool executions until the assistant finishes,
// a tool changes page (the turn resumes there), or the call budget runs out.
async function runTurn(turn) {
  setBusy(true);
  try {
    while (turn.modelCalls < MAX_MODEL_CALLS_PER_TURN) {
      const response = await callWorker(turn);
      turn.modelCalls += 1;
      turn.toolExecutions = [];

      // Appended unchanged — thinking blocks must be passed back as-is.
      agent.messages.push({ role: "assistant", content: response.content });
      for (const block of response.content) {
        if (block.type === "text" && block.text.trim()) addToTranscript("assistant", block.text.trim());
      }
      if (response.stop_reason === "refusal") addToTranscript("assistant", "Sorry, I can't help with that. I can help you find products or manage your cart.");

      const toolUses = response.content.filter(b => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || !toolUses.length) {
        finishTurn(turn, response.stop_reason);
        return;
      }

      const { results, executions, navigate } = runTools(toolUses);
      turn.toolsUsed.push(...toolUses.map(b => b.name));
      turn.toolExecutions = executions;
      agent.messages.push({ role: "user", content: results });

      if (navigate) {
        agent.pending = turn;
        saveAgent();
        await navigate();
        return;
      }
      saveAgent();
    }
    finishTurn(turn, "max_model_calls");
  } catch (err) {
    agent.pending = null;
    addToTranscript("error", ERROR_MESSAGES[err.message] || "Something went wrong. Please try again.");
    trackAgent("Agent Error", { "error_type": err.message, "http_status": err.status || null });
  } finally {
    saveAgent();
    setBusy(false);
  }
}

function finishTurn(turn, stopReason) {
  agent.pending = null;
  trackAgent("Agent Response Received", {
    "latency_ms": Date.now() - turn.startedMs,
    "model_calls": turn.modelCalls,
    "tools_used": [...new Set(turn.toolsUsed)],
    "stop_reason": stopReason
  });
}

function sendMessage(text, fromSuggestion = false) {
  text = text.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!text || busy) return;
  const typedTurns = agent.transcript.filter(e => e.role === "user").length;
  if (typedTurns >= MAX_TYPED_TURNS) {
    addToTranscript("error", ERROR_MESSAGES.conversation_limit);
    return;
  }

  agent.turn += 1;
  agent.messages.push({
    role: "user",
    content: [{ type: "text", text: pageContext() }, { type: "text", text }]
  });
  addToTranscript("user", text);
  trackAgent("Agent Message Sent", { "message_length": text.length, "from_suggestion": fromSuggestion });

  runTurn({
    traceId: randomHex(16),            // one trace per user prompt = one Agent Intelligence turn
    startedMs: Date.now(),
    modelCalls: 0,
    toolsUsed: [],
    toolExecutions: []
  });
}

// ---------- UI ----------
const ui = {};

function buildWidget() {
  const root = document.createElement("div");
  root.className = "agent-widget";
  root.innerHTML = `
    <section class="agent-panel" id="agentPanel" role="dialog" aria-label="Shopping assistant" hidden>
      <div class="agent-header">
        <div>
          <div class="agent-title">MixDemo assistant</div>
          <div class="agent-subtitle">Finds products, fills your cart, gets you to checkout</div>
        </div>
        <div class="agent-header-actions">
          <button type="button" class="agent-icon-btn" data-agent="reset" title="Start a new chat" aria-label="Start a new chat">↺</button>
          <button type="button" class="agent-icon-btn" data-agent="close" title="Close" aria-label="Close assistant">✕</button>
        </div>
      </div>
      <div class="agent-messages" id="agentMessages" aria-live="polite"></div>
      <div class="agent-suggestions" id="agentSuggestions"></div>
      <form class="agent-input" id="agentForm">
        <input type="text" id="agentInput" maxlength="${MAX_MESSAGE_CHARS}" placeholder="Ask about products…" autocomplete="off" aria-label="Message the shopping assistant" />
        <button type="submit" class="btn-primary" id="agentSend">Send</button>
      </form>
      <div class="agent-footnote">AI assistant · can't place orders or take payment</div>
    </section>
    <button type="button" class="agent-launcher" id="agentLauncher" aria-controls="agentPanel" aria-expanded="false">
      <span aria-hidden="true">💬</span> Ask MixDemo
    </button>
  `;
  document.body.appendChild(root);

  ui.panel = root.querySelector("#agentPanel");
  ui.launcher = root.querySelector("#agentLauncher");
  ui.messages = root.querySelector("#agentMessages");
  ui.suggestions = root.querySelector("#agentSuggestions");
  ui.form = root.querySelector("#agentForm");
  ui.input = root.querySelector("#agentInput");
  ui.send = root.querySelector("#agentSend");

  ui.launcher.addEventListener("click", () => setOpen(!agent.open));
  root.querySelector('[data-agent="close"]').addEventListener("click", () => setOpen(false));
  root.querySelector('[data-agent="reset"]').addEventListener("click", () => {
    if (busy) return;
    trackAgent("Agent Conversation Reset");
    agent = newConversation(true);
    saveAgent();
    renderTranscript();
  });
  ui.form.addEventListener("submit", e => {
    e.preventDefault();
    const text = ui.input.value;
    ui.input.value = "";
    sendMessage(text);
  });
  ui.suggestions.addEventListener("click", e => {
    const chip = e.target.closest("button");
    if (chip) sendMessage(chip.textContent, true);
  });
}

function setOpen(open) {
  agent.open = open;
  saveAgent();
  ui.panel.hidden = !open;
  ui.launcher.setAttribute("aria-expanded", String(open));
  ui.launcher.classList.toggle("is-open", open);
  trackAgent(open ? "Agent Opened" : "Agent Closed");
  if (open) {
    ui.messages.scrollTop = ui.messages.scrollHeight;
    ui.input.focus();
  }
}

function addToTranscript(role, text) {
  agent.transcript.push({ role, text });
  saveAgent();
  renderTranscript();
}

function renderTranscript() {
  ui.messages.textContent = "";
  const entries = agent.transcript.length
    ? agent.transcript
    : [{ role: "assistant", text: "Hi! I can help you find products, add them to your cart and take you to checkout. What are you looking for?" }];
  for (const entry of entries) {
    const el = document.createElement("div");
    el.className = `agent-msg agent-msg-${entry.role}`;
    el.textContent = entry.role === "action" ? `✓ ${entry.text}` : entry.text;
    ui.messages.appendChild(el);
  }
  if (busy) {
    const typing = document.createElement("div");
    typing.className = "agent-msg agent-msg-assistant agent-typing";
    typing.setAttribute("aria-label", "Assistant is typing");
    typing.innerHTML = "<span></span><span></span><span></span>";
    ui.messages.appendChild(typing);
  }
  ui.suggestions.innerHTML = agent.transcript.length
    ? ""
    : SUGGESTIONS.map(s => `<button type="button" class="filter-chip">${s}</button>`).join("");
  ui.messages.scrollTop = ui.messages.scrollHeight;
}

function setBusy(value) {
  busy = value;
  ui.input.disabled = value;
  ui.send.disabled = value;
  renderTranscript();
}

// ---------- Boot ----------
if (AGENT_API_URL) {
  buildWidget();
  ui.panel.hidden = !agent.open;
  ui.launcher.setAttribute("aria-expanded", String(agent.open));
  ui.launcher.classList.toggle("is-open", agent.open);
  renderTranscript();

  // A tool changed page mid-turn: pick the turn back up here.
  if (agent.pending) runTurn(agent.pending);
}
