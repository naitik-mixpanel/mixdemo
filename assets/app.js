// ============================================================
// SHARED APP LOGIC — loaded at the end of <body> on every page
// ============================================================
// Depends on assets/mixpanel-setup.js (KEYS, store, PAGE_TYPE, currentUser,
// mixpanelReady). Each page then loads its own assets/pages/<page>.js.

// ---------- Product catalog ----------
// `slug` is what appears in product URLs: product.html?id=<slug>
const PRODUCTS = [
  { id: "p1", slug: "wireless-headphones", name: "Wireless Headphones", price: 129, category: "electronics", emoji: "🎧",
    description: "Over-ear noise-cancelling headphones with 30-hour battery life and plush memory-foam cushions." },
  { id: "p2", slug: "smart-watch", name: "Smart Watch", price: 249, category: "electronics", emoji: "⌚",
    description: "Track workouts, sleep and notifications from your wrist. Water-resistant to 50m." },
  { id: "p3", slug: "cotton-t-shirt", name: "Cotton T-Shirt", price: 29, category: "apparel", emoji: "👕",
    description: "Heavyweight organic cotton tee with a relaxed fit that softens with every wash." },
  { id: "p4", slug: "denim-jacket", name: "Denim Jacket", price: 89, category: "apparel", emoji: "🧥",
    description: "Classic trucker jacket in rigid selvedge denim, built to break in and last for years." },
  { id: "p5", slug: "ceramic-mug", name: "Ceramic Mug", price: 19, category: "home", emoji: "☕",
    description: "Hand-glazed stoneware mug that holds 350ml. Dishwasher and microwave safe." },
  { id: "p6", slug: "desk-lamp", name: "Desk Lamp", price: 59, category: "home", emoji: "💡",
    description: "Adjustable LED lamp with three colour temperatures and a weighted steel base." },
  { id: "p7", slug: "bluetooth-speaker", name: "Bluetooth Speaker", price: 79, category: "electronics", emoji: "🔊",
    description: "Pocket-sized speaker with 360° sound, 12-hour battery and IPX7 waterproofing." },
  { id: "p8", slug: "running-shoes", name: "Running Shoes", price: 119, category: "apparel", emoji: "👟",
    description: "Lightweight daily trainers with responsive foam and a breathable knit upper." }
];

const CATEGORY_LABELS = { electronics: "Electronics", apparel: "Apparel", home: "Home" };

function findProduct(idOrSlug) {
  return PRODUCTS.find(p => p.slug === idOrSlug || p.id === idOrSlug);
}

function productUrl(p) {
  return `product.html?id=${encodeURIComponent(p.slug)}`;
}

function categoryUrl(category) {
  return `index.html?category=${encodeURIComponent(category)}`;
}

// ---------- Shipping config ----------
// Standard shipping is a flat rate. The `promo_banner_test` experiment's
// variant_a promises free shipping, so we have to actually waive the cost
// for that variant — otherwise the experiment isn't a real economic test,
// it's just a UI change. variant_b and control pay the standard rate.
const STANDARD_SHIPPING_COST = 8;

function computeShippingCost() {
  if (bannerVariant === "variant_a") return 0;
  return STANDARD_SHIPPING_COST;
}

// ---------- Cart state (persisted per tab) ----------
// Stored as [{ id, qty }] and hydrated from the catalog, like a real cart API.
let cart = store.get(KEYS.cart, []);
let coupon = store.get(KEYS.coupon, null); // { code, pct } once applied

function cartItems() {
  return cart
    .map(line => {
      const p = findProduct(line.id);
      return p ? { ...p, qty: line.qty } : null;
    })
    .filter(Boolean);
}

function cartSize() {
  return cart.reduce((s, i) => s + i.qty, 0);
}

function cartSubtotal() {
  return cartItems().reduce((s, i) => s + i.price * i.qty, 0);
}

function cartTotals() {
  const subtotal = cartSubtotal();
  const discount = coupon ? subtotal * (coupon.pct / 100) : 0;
  const shipping = computeShippingCost();
  return { subtotal, discount, shipping, total: subtotal - discount + shipping };
}

function saveCart() {
  store.set(KEYS.cart, cart);
  updateCartCount();
}

function saveCoupon() {
  if (coupon) store.set(KEYS.coupon, coupon);
  else store.remove(KEYS.coupon);
}

function updateCartCount() {
  const el = document.getElementById("cartCount");
  if (el) el.textContent = cartSize();
}

// ---------- Helper: build a product object for events ----------
// Single source of truth for the shape of a product entry inside the
// `products` array. Keeps Add to Cart, Product Viewed, Checkout Started,
// and Purchase Completed consistent — important so analysts can pivot
// on product attributes the same way across all four events.
function buildProductEntry(item) {
  return {
    "product_id": item.id,
    "product_name": item.name,
    "product_price": item.price,
    "product_category": item.category,
    "quantity": item.qty || 1
  };
}

function addToCart(productId) {
  const p = findProduct(productId);
  if (!p) return;
  const existing = cart.find(x => x.id === productId);
  if (existing) existing.qty += 1;
  else cart.push({ id: productId, qty: 1 });
  saveCart();
  showToast(`${p.name} added to cart`);

  // Add to Cart — products array contains only the item just added.
  // Top-level cart_size / cart_value remain as headline rollup metrics.
  mixpanel.track("Add to Cart", {
    "products": [buildProductEntry({ ...p, qty: 1 })],
    "cart_size": cartSize(),
    "cart_value": cartSubtotal()
  });
}

// Any element with data-add-to-cart="<product id>" is an add-to-cart button.
// Product cards are links, so stop the click from also opening the product.
document.addEventListener("click", e => {
  const btn = e.target.closest("[data-add-to-cart]");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  addToCart(btn.dataset.addToCart);
});

// ---------- Navigation helpers ----------
// Events fired right before a full page load must be safely queued first,
// or the browser can unload the page mid-write. Each Mixpanel call here
// gets a callback; we navigate once they've all reported back (or after a
// short timeout so a slow network never traps the user on the page).
function afterMixpanel(...calls) {
  return Promise.all(calls.map(call => new Promise(resolve => {
    const timer = setTimeout(resolve, 1000);
    call(() => { clearTimeout(timer); resolve(); });
  })));
}

function trackAndNavigate(eventName, props, href) {
  return afterMixpanel(cb => mixpanel.track(eventName, props, cb))
    .then(() => { window.location.href = href; });
}

// ---------- Page view tracking ----------
// Each template fires the generic `Page Viewed` plus its dedicated event.
// Dedicated events make funnels easy without filtering on `page_name`.
// (The SDK's $mp_web_page_view is sent from mixpanel-setup.js.)
const PAGE_EVENT_MAP = {
  "home": "Home Viewed",
  "productDetail": "Product Detail Viewed",
  "cart": "Cart Viewed",
  "checkout": "Checkout Viewed",
  "confirmation": "Order Confirmation Viewed"
};

function trackPageView(extra = {}) {
  mixpanel.track("Page Viewed", { "page_name": PAGE_TYPE, ...extra });
  const dedicatedEvent = PAGE_EVENT_MAP[PAGE_TYPE];
  if (dedicatedEvent) mixpanel.track(dedicatedEvent, extra);
}

// ---------- Breadcrumbs ----------
// crumbs: [{ label, href? }] — the last crumb (no href) is the current page.
function renderBreadcrumbs(crumbs) {
  const nav = document.getElementById("breadcrumbs");
  if (!nav) return;
  nav.innerHTML = crumbs.map((c, i) => c.href
    ? `<a href="${c.href}" data-crumb-level="${i}">${c.label}</a>`
    : `<span aria-current="page">${c.label}</span>`
  ).join(`<span class="crumb-sep" aria-hidden="true">›</span>`);
}

document.addEventListener("click", e => {
  const link = e.target.closest("#breadcrumbs a");
  if (!link) return;
  const props = {
    "crumb_label": link.textContent,
    "crumb_level": Number(link.dataset.crumbLevel),
    "destination": link.getAttribute("href")
  };
  // Let cmd/ctrl/middle-click open a new tab as normal.
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
    mixpanel.track("Breadcrumb Clicked", props);
    return;
  }
  e.preventDefault();
  trackAndNavigate("Breadcrumb Clicked", props, link.href);
});

// ---------- Shared UI ----------
function renderHeader() {
  document.getElementById("siteHeader").innerHTML = `
    <a class="logo" href="index.html">MixDemo</a>
    <div class="nav-actions">
      <span id="experimentPills" class="experiment-pills"></span>
      <span id="userPill" class="user-pill mp-block">${currentUser.name} · ${currentUser.tier}</span>
      <button class="reset-btn mp-mask" onclick="resetSession()" title="Calls mixpanel.reset() and generates a new anonymous user">↻ Reset user</button>
      <a class="cart-btn" href="cart.html">
        Cart <span class="cart-count" id="cartCount">0</span>
      </a>
    </div>
  `;
  updateCartCount();
}

function ctaLabel() {
  return ctaVariant && ctaVariant !== "control" ? "Buy Now" : "Add to Cart";
}

function productCardHtml(p) {
  return `
    <a class="product-card" href="${productUrl(p)}">
      <div class="product-img">${p.emoji}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-price">$${p.price}</div>
      <button type="button" data-add-to-cart="${p.id}">${ctaLabel()}</button>
    </a>
  `;
}

// Subtotal / discount / shipping / total block, shared by cart, checkout
// and confirmation so the numbers always render the same way.
function summaryLinesHtml({ subtotal, discount, shipping, total }, couponCode) {
  return `
    <div class="summary-line"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
    ${discount ? `<div class="summary-line success"><span>Discount${couponCode ? ` (${couponCode})` : ""}</span><span>-$${discount.toFixed(2)}</span></div>` : ""}
    ${shipping === 0
      ? `<div class="summary-line success"><span>Shipping</span><span>FREE</span></div>`
      : `<div class="summary-line"><span>Shipping</span><span>$${shipping.toFixed(2)}</span></div>`}
    <div class="summary-total"><span>Total</span><span>$${total.toFixed(2)}</span></div>
  `;
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2000);
}

// ---------- Reset session ----------
// Clears Mixpanel identity and this tab's cart/experiment state, then reloads
// the homepage, which creates a brand new user. Useful for demoing clean
// funnels back to back.
function resetSession() {
  mixpanel.reset();
  Object.values(KEYS).forEach(key => store.remove(key));
  store.set(KEYS.flash, "Session reset — new user created");
  window.location.href = "index.html";
}

// ---------- Feature flag-driven variants ----------
// Assignment is handled entirely by Mixpanel feature flags.
// get_variant_value auto-fires $experiment_started exposure events on read,
// so we don't manually track exposures. Banner/CTA "viewed" events fire only
// when the UI is actually rendered to the user.
//
// The last known variants are cached per tab so the first paint of each page
// (CTA wording, shipping cost) is right before the flags SDK answers.
let { cta: ctaVariant = "", banner: bannerVariant = "" } = store.get(KEYS.variants, {});
const variantListeners = [];

// Pages register re-render callbacks for when variants resolve.
function onVariantsChange(fn) {
  variantListeners.push(fn);
}

function renderPromoBanner() {
  const bannerEl = document.getElementById("promoBanner");
  if (!bannerEl) return;
  if (bannerVariant === "variant_a") {
    bannerEl.innerHTML = "🚚 <strong>Free shipping</strong> on all orders — no minimum.";
    bannerEl.style.background = "#dcfce7";
    bannerEl.style.borderBottom = "1px solid #86efac";
    bannerEl.style.color = "#14532d";
    bannerEl.style.display = "block";
  } else if (bannerVariant === "variant_b") {
    bannerEl.innerHTML = "🎟️ Use code <code style='background:#fde68a;padding:2px 6px;border-radius:3px;'>TENOFF</code> at checkout for <strong>10% off</strong>.";
    bannerEl.style.background = "#fef3c7";
    bannerEl.style.borderBottom = "1px solid #fde68a";
    bannerEl.style.color = "#78350f";
    bannerEl.style.display = "block";
  } else {
    bannerEl.style.display = "none";
  }
}

function renderExperimentPills() {
  const container = document.getElementById("experimentPills");
  if (!container) return;

  const pills = [];
  if (ctaVariant) {
    pills.push(`<span class="experiment-pill cta-exp">CTA: ${ctaVariant}</span>`);
  }
  if (bannerVariant) {
    pills.push(`<span class="experiment-pill banner-exp">Banner: ${bannerVariant}</span>`);
  }
  container.innerHTML = pills.join("");
}

async function initExperiments() {
  await mixpanelReady;

  // Read both variants in parallel — no reason to serialize these calls.
  const [cta, banner] = await Promise.all([
    mixpanel.flags.get_variant_value("cta_wording_test", "control"),
    mixpanel.flags.get_variant_value("promo_banner_test", "Control")
  ]);
  ctaVariant = cta;
  bannerVariant = banner;
  store.set(KEYS.variants, { cta, banner });

  renderPromoBanner();
  renderExperimentPills();

  // The banner shows on every page, but "Promo Banner Viewed" fires once per
  // shopper (tab) so page count doesn't inflate the experiment metric.
  // Control: no banner rendered, no "viewed" event. Exposure already fired
  // via $experiment_started when get_variant_value resolved.
  const offers = { variant_a: "free_shipping", variant_b: "ten_percent_off" };
  if (offers[bannerVariant] && store.get(KEYS.bannerViewed) !== bannerVariant) {
    mixpanel.track("Promo Banner Viewed", { "offer": offers[bannerVariant] });
    store.set(KEYS.bannerViewed, bannerVariant);
  }

  variantListeners.forEach(fn => fn());
  console.log(`%c[Mixpanel Demo] CTA experiment: ${ctaVariant}`, "color: #7856ff; font-weight: bold;");
  console.log(`%c[Mixpanel Demo] Banner experiment: ${bannerVariant}`, "color: #7856ff; font-weight: bold;");
}

// ---------- Boot (shared) ----------
renderHeader();
renderPromoBanner();
renderExperimentPills();
initExperiments();

const flash = store.get(KEYS.flash);
if (flash) {
  store.remove(KEYS.flash);
  showToast(flash);
}
