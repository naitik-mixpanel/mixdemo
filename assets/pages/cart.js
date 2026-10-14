// ============================================================
// CART
// ============================================================

function renderCart() {
  const itemsEl = document.getElementById("cartItems");
  const summaryEl = document.getElementById("cartSummary");
  const couponRow = document.getElementById("couponRow");
  const items = cartItems();

  if (items.length === 0) {
    itemsEl.innerHTML = `
      <p style="color: var(--muted); margin-bottom: 16px;">Your cart is empty.</p>
      <a class="btn-primary" href="index.html">Continue shopping</a>
    `;
    summaryEl.style.display = "none";
    couponRow.style.display = "none";
    return;
  }

  itemsEl.innerHTML = items.map(item => `
    <div class="cart-item">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="font-size: 32px;">${item.emoji}</div>
        <div>
          <a href="${productUrl(item)}" style="font-weight: 600;">${item.name}</a>
          <div style="color: var(--muted); font-size: 13px;">Qty: ${item.qty} · $${item.price} each</div>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 16px;">
        <div style="font-weight: 600;">$${item.price * item.qty}</div>
        <button class="btn-secondary" onclick="removeFromCart('${item.id}')" style="padding: 6px 12px;">Remove</button>
      </div>
    </div>
  `).join("");

  summaryEl.style.display = "block";
  couponRow.style.display = "flex";
  summaryEl.innerHTML = `
    ${summaryLinesHtml(cartTotals(), coupon && coupon.code)}
    <button class="btn-primary" style="width: 100%; margin-top: 16px;" onclick="startCheckout()">Proceed to checkout</button>
  `;
}

function removeFromCart(productId) {
  const item = cartItems().find(x => x.id === productId);
  cart = cart.filter(x => x.id !== productId);
  saveCart();
  mixpanel.track("Remove from Cart", {
    "products": item ? [buildProductEntry(item)] : []
  });
  renderCart();
}

// ---------- Coupon (Session Replay bait) ----------
// This button is intentionally janky — it appears to do nothing on most codes.
// Perfect for showing rage-clicks in Session Replay.
function applyCoupon() {
  const code = document.getElementById("couponInput").value.trim().toUpperCase();
  mixpanel.track("Coupon Attempted", {
    "code": code,
    "code_length": code.length
  });

  if (code === "TENOFF" && bannerVariant === "variant_b") {
    coupon = { code: "TENOFF", pct: 10 };
    saveCoupon();
    showToast("Coupon applied! 10% off.");
    mixpanel.track("Coupon Applied", {
      "code": code,
      "discount_pct": 10,
      "from_promo_banner": bannerVariant === "variant_b"
    });
    renderCart();
  } else {
    // ❌ Silent failure — no error message. Triggers rage-click behavior.
    // Simulates a real bug worth catching with Session Replay.
    mixpanel.track("Coupon Failed", { "code": code, "reason": "invalid_silent" });
  }
}

// ---------- Init ----------
renderBreadcrumbs([
  { label: "Home", href: "index.html" },
  { label: "Cart" }
]);
renderCart();
onVariantsChange(renderCart);   // shipping cost depends on the banner flag
trackPageView({ "cart_size": cartSize(), "cart_value": cartSubtotal() });
