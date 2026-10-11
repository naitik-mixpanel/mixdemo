// ============================================================
// CHECKOUT
// ============================================================

function renderCheckoutSummary() {
  document.getElementById("checkoutSummary").innerHTML = `
    <h3 style="margin-bottom: 16px;">Order summary</h3>
    ${cartItems().map(i => `<div class="summary-line"><span>${i.name} × ${i.qty}</span><span>$${i.price * i.qty}</span></div>`).join("")}
    ${summaryLinesHtml(cartTotals(), coupon && coupon.code)}
  `;
}

function completePurchase() {
  const items = cartItems();
  if (items.length === 0) return;
  document.getElementById("placeOrderBtn").disabled = true;

  // Total charged includes shipping when applicable.
  // For variant_a (free shipping banner), shipping is 0 — so revenue equals
  // subtotal minus discount.
  const totals = cartTotals();
  const { subtotal, discount, shipping, total } = totals;
  const orderId = "ORD-" + Math.floor(Math.random() * 100000);

  // Kept so the confirmation page can render the receipt.
  store.set(KEYS.lastOrder, {
    orderId,
    items: items.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
    totals,
    couponCode: coupon ? coupon.code : null
  });

  // Purchase Completed — products array uses the same shape as the
  // upstream events so a single Lexicon definition covers the chain.
  // shipping_cost and free_shipping let us slice revenue by the experiment
  // arm's shipping policy without joining back to $experiment_started.
  const purchaseProps = {
    "order_id": orderId,
    "revenue": total,
    "currency": "USD",
    "subtotal": subtotal,
    "discount_amount": discount,
    "shipping_cost": shipping,
    "free_shipping": shipping === 0,
    "coupon_used": !!coupon,
    "coupon_code": coupon ? coupon.code : null,
    "items_count": cartSize(),
    "products": items.map(buildProductEntry)
  };

  cart = [];
  coupon = null;
  saveCart();
  saveCoupon();

  // Purchase + revenue on the user profile, all safely queued before we
  // leave the page. (people.track_charge is a deprecated no-op in this SDK
  // version, so revenue lives on the event and in lifetime_revenue.)
  afterMixpanel(
    cb => mixpanel.track("Purchase Completed", purchaseProps, cb),
    cb => mixpanel.people.increment({ "total_orders": 1, "lifetime_revenue": total }, cb)
  ).then(() => {
    window.location.href = `confirmation.html?order=${encodeURIComponent(orderId)}`;
  });
}

// ---------- Init ----------
// A real store won't show checkout with nothing to buy.
if (cartItems().length === 0) {
  window.location.replace("cart.html");
} else {
  renderBreadcrumbs([
    { label: "Home", href: "index.html" },
    { label: "Cart", href: "cart.html" },
    { label: "Checkout" }
  ]);
  renderCheckoutSummary();
  onVariantsChange(renderCheckoutSummary);   // shipping cost depends on the banner flag

  document.getElementById("ckName").value = currentUser.name;
  document.getElementById("ckEmail").value = currentUser.email;

  trackPageView({ "cart_size": cartSize(), "cart_value": cartSubtotal() });
}
