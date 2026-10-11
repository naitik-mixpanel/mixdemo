// ============================================================
// HOME — product listing with search + category filter
// ============================================================
// The active category lives in the URL (index.html?category=apparel) so
// breadcrumb links from product pages land on the right filter.

const params = new URLSearchParams(window.location.search);
let activeFilter = CATEGORY_LABELS[params.get("category")] ? params.get("category") : "all";

function renderFilters() {
  document.querySelectorAll(".filter-chip").forEach(c => {
    c.classList.toggle("active", c.dataset.cat === activeFilter);
  });
}

function renderProducts() {
  const grid = document.getElementById("productGrid");
  const search = document.getElementById("searchBar").value.toLowerCase();
  const filtered = PRODUCTS.filter(p => {
    const matchCat = activeFilter === "all" || p.category === activeFilter;
    const matchSearch = !search || p.name.toLowerCase().includes(search);
    return matchCat && matchSearch;
  });

  grid.innerHTML = filtered.length
    ? filtered.map(productCardHtml).join("")
    : `<p class="empty-state">No products match your search.</p>`;
}

// ---------- Filter / search ----------
document.getElementById("filters").addEventListener("click", e => {
  if (!e.target.classList.contains("filter-chip")) return;
  activeFilter = e.target.dataset.cat;
  renderFilters();

  const url = new URL(window.location.href);
  if (activeFilter === "all") url.searchParams.delete("category");
  else url.searchParams.set("category", activeFilter);
  history.replaceState(null, "", url);

  mixpanel.track("Filter Applied", { "category": activeFilter });
  renderProducts();
});

let searchTimeout;
document.getElementById("searchBar").addEventListener("input", e => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    if (e.target.value) {
      mixpanel.track("Search Performed", {
        "query": e.target.value,
        "query_length": e.target.value.length
      });
    }
    renderProducts();
  }, 300);
});

// ---------- Init ----------
renderFilters();
renderProducts();
onVariantsChange(renderProducts);   // CTA wording depends on the flag
trackPageView(activeFilter !== "all" ? { "category": activeFilter } : {});
