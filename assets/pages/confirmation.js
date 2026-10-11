// ============================================================
// ORDER CONFIRMATION
// ============================================================
// URL: confirmation.html?order=<id>. The receipt comes from the order
// saved at checkout; any other order id shows a not-found state.

const orderId = new URLSearchParams(window.location.search).get("order") || "";
const lastOrder = store.get(KEYS.lastOrder);
const order = lastOrder && lastOrder.orderId === orderId ? lastOrder : null;
const content = document.getElementById("confirmationContent");

if (order) {
  content.innerHTML = `
    <div style="font-size: 64px; margin-bottom: 16px;">✅</div>
    <h1>Order placed!</h1>
    <p style="color: var(--muted); margin: 16px 0 32px;">Thanks for shopping with MixDemo. Order ID: <strong id="orderId"></strong></p>
    <div class="cart-summary">
      ${order.items.map(i => `<div class="summary-line"><span>${i.name} × ${i.qty}</span><span>$${i.price * i.qty}</span></div>`).join("")}
      ${summaryLinesHtml(order.totals, order.couponCode)}
    </div>
    <a class="btn-primary" href="index.html">Continue shopping</a>
  `;
  document.getElementById("orderId").textContent = order.orderId;
} else {
  document.title = "Order not found — MixDemo";
  content.innerHTML = `
    <h1>We couldn't find that order</h1>
    <p style="color: var(--muted); margin: 16px 0 32px;">Orders are only shown in the tab they were placed in.</p>
    <a class="btn-primary" href="index.html">Continue shopping</a>
  `;
}

trackPageView({ "order_id": orderId, "order_found": !!order });
