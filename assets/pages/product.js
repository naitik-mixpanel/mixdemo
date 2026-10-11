// ============================================================
// PRODUCT DETAIL — one template for every product
// ============================================================
// URL: product.html?id=<slug>. The page reads the slug, looks the product
// up in the catalog and renders it, the same way a real PDP would call a
// product API.

const requestedId = new URLSearchParams(window.location.search).get("id") || "";
const product = findProduct(requestedId);

function renderProductDetail() {
  const p = product;
  const shippingNote = computeShippingCost() === 0
    ? "Free shipping on this order."
    : `Flat-rate shipping: $${STANDARD_SHIPPING_COST}.`;

  document.getElementById("productDetailContent").innerHTML = `
    <div class="product-detail">
      <div class="detail-img">${p.emoji}</div>
      <div>
        <h1>${p.name}</h1>
        <p style="color: var(--muted); margin: 8px 0 16px;">
          Category: <a href="${categoryUrl(p.category)}">${CATEGORY_LABELS[p.category]}</a>
        </p>
        <div style="font-size: 32px; color: var(--accent); font-weight: 700; margin-bottom: 16px;">$${p.price}</div>
        <p style="margin-bottom: 8px;">${p.description}</p>
        <p style="color: var(--muted); font-size: 14px; margin-bottom: 24px;">${shippingNote}</p>
        <div class="detail-actions">
          <button class="btn-primary" data-add-to-cart="${p.id}">${ctaLabel()}</button>
          <a class="btn-secondary" href="cart.html">View cart</a>
        </div>
      </div>
    </div>
  `;

  const related = PRODUCTS.filter(x => x.category === p.category && x.id !== p.id);
  document.getElementById("related").innerHTML = related.length ? `
    <h2>More in ${CATEGORY_LABELS[p.category]}</h2>
    <div class="product-grid">${related.map(productCardHtml).join("")}</div>
  ` : "";
}

if (product) {
  document.title = `${product.name} — MixDemo`;
  renderBreadcrumbs([
    { label: "Home", href: "index.html" },
    { label: CATEGORY_LABELS[product.category], href: categoryUrl(product.category) },
    { label: product.name }
  ]);
  renderProductDetail();
  onVariantsChange(renderProductDetail);   // CTA wording + shipping note

  const productProps = {
    "product_id": product.id,
    "product_name": product.name,
    "product_category": product.category
  };
  trackPageView(productProps);

  // Product Viewed — products array even though it's a single product.
  // Keeps event shape consistent with Add to Cart, Checkout, Purchase.
  mixpanel.track("Product Viewed", {
    "products": [buildProductEntry({ ...product, qty: 1 })]
  });
} else {
  document.title = "Product not found — MixDemo";
  renderBreadcrumbs([
    { label: "Home", href: "index.html" },
    { label: "Product not found" }
  ]);
  document.getElementById("productDetailContent").innerHTML = `
    <div class="panel">
      <h1 style="margin-bottom: 8px;">We couldn't find that product</h1>
      <p style="color: var(--muted); margin-bottom: 24px;">It may have been removed, or the link is incorrect.</p>
      <a class="btn-primary" href="index.html">Back to shop</a>
    </div>
  `;
  trackPageView({ "product_id": requestedId, "product_found": false });
}
