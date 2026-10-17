// ============================================================
// MIXPANEL SETUP — loaded synchronously in <head> on every page
// ============================================================
// Order matters here: the tab's user is resolved *before* the SDK loads,
// so feature flags are fetched for the right person and two open tabs
// never end up writing events under each other's distinct_id.

const MP_TOKEN = "ea1bc069fc5c58a1f102e62b7b0e6e08";

// Every page declares what it is via <html data-page="...">. Values match
// the old single-page ids so `page_name` stays backwards compatible.
const PAGE_TYPE = document.documentElement.dataset.page;

// ---------- Tab-scoped storage ----------
// sessionStorage = one "shopper" per browser tab. A new tab (or the
// Reset user button) starts a fresh user, cart and experiment exposure.
const KEYS = {
  user: "mixdemo.user",
  platform: "mixdemo.platform",
  cart: "mixdemo.cart",
  coupon: "mixdemo.coupon",
  variants: "mixdemo.variants",
  bannerViewed: "mixdemo.bannerViewed",
  lastOrder: "mixdemo.lastOrder",
  flash: "mixdemo.flash",
  agent: "mixdemo.agent"
};

const store = {
  get(key, fallback = null) {
    try {
      const v = sessionStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  },
  remove(key) {
    try { sessionStorage.removeItem(key); } catch (e) {}
  }
};

// ---------- Market / platform (feature flag context) ----------
// Picked once per tab so the flag context doesn't flip between pages.
function pickMarketValue(indiaVal, globalVal, indiaChance = 0.5) {
  return Math.random() < indiaChance ? indiaVal : globalVal;
}
let currency = store.get(KEYS.platform);
if (!currency) {
  currency = pickMarketValue("India", "Global");
  store.set(KEYS.platform, currency);
}

// ---------- Random user generator ----------
const FIRST_NAMES = [
  // Indian
  "Aarav", "Diya", "Kabir", "Meera", "Rohan", "Anaya", "Vihaan", "Isha",
  "Arjun", "Saanvi", "Reyansh", "Aditi", "Krish", "Riya", "Ayaan", "Zara",
  "Dev", "Tara", "Ishaan", "Kiara",
  // Western / European
  "Liam", "Emma", "Noah", "Olivia", "Ethan", "Sophia", "Lucas", "Ava",
  "Mason", "Mia", "Logan", "Charlotte", "James", "Amelia", "Oliver", "Harper",
  "Benjamin", "Evelyn", "Henry", "Abigail",
  // East Asian
  "Hiroshi", "Yuki", "Kenji", "Sakura", "Wei", "Lin", "Jian", "Mei",
  "Min-jun", "Ji-woo", "Hyun", "Soo-yeon", "Akira", "Haruki", "Xiao", "Chen",
  // Southeast Asian
  "Adi", "Putri", "Linh", "Anh", "Siti", "Rafa", "Mai", "Nguyen",
  // Middle Eastern
  "Omar", "Layla", "Yusuf", "Fatima", "Hassan", "Noor", "Ali", "Amira",
  "Karim", "Yasmin", "Tariq", "Leila",
  // African
  "Kwame", "Amara", "Chidi", "Zola", "Tunde", "Nia", "Kofi", "Adaeze",
  // Latin American / Spanish
  "Mateo", "Sofia", "Diego", "Valentina", "Santiago", "Camila", "Lucas", "Isabella",
  "Javier", "Lucia",
  // Russian / Slavic
  "Dmitri", "Anastasia", "Ivan", "Natasha",
  // French / Italian
  "Luca", "Chloé", "Matteo", "Giulia", "Antoine", "Élise"
];

const LAST_NAMES = [
  // Indian
  "Sharma", "Patel", "Iyer", "Kapoor", "Reddy", "Nair", "Khan", "Mehta",
  "Singh", "Banerjee", "Joshi", "Gupta", "Rao", "Desai", "Chopra", "Verma",
  // Western / European
  "Smith", "Johnson", "Williams", "Brown", "Davis", "Miller", "Wilson", "Taylor",
  // East / Southeast Asian
  "Tanaka", "Yamamoto", "Kim", "Park", "Chen", "Wang", "Nguyen", "Tran",
  // Middle Eastern / African
  "Hassan", "Khalil", "Okonkwo", "Mensah",
  // Latin / Hispanic
  "Garcia", "Rodriguez", "Martinez", "Lopez", "Hernandez", "Silva",
  // European (continental)
  "Müller", "Rossi", "Dubois", "Kowalski", "Petrov", "Andersen"
];
const PLAN_TIERS = ["free", "pro", "enterprise"];

function generateRandomUser() {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  const tier = PLAN_TIERS[Math.floor(Math.random() * PLAN_TIERS.length)];
  const suffix = Math.floor(Math.random() * 10000);
  const name = `${first} ${last}`;
  const email = `${first.toLowerCase()}.${last.toLowerCase()}${suffix}@mixdemo.com`;
  return { name, email, tier };
}

// ---------- Resolve this tab's user ----------
let currentUser = store.get(KEYS.user);
const isNewUser = !currentUser;

// Mixpanel's persistence lives in localStorage, which is shared by every tab.
// If this tab is starting a new user, or another tab has since identified as
// someone else, drop the persisted identity before init. That is exactly what
// mixpanel.reset() does (fresh $device_id), but done synchronously so the SDK
// never boots — or fetches flags — as the wrong person.
try {
  const persistenceKey = `mp_${MP_TOKEN}_mixpanel`;
  const persisted = JSON.parse(localStorage.getItem(persistenceKey) || "null");
  if (isNewUser || (persisted && persisted.distinct_id !== currentUser.email)) {
    localStorage.removeItem(persistenceKey);
  }
} catch (e) {}

if (isNewUser) {
  currentUser = generateRandomUser();
  store.set(KEYS.user, currentUser);
}

// ============================================================
// MIXPANEL SDK + SESSION REPLAY
// ============================================================
var MIXPANEL_CUSTOM_LIB_URL = 'https://cdn.mxpnl.com/libs/mixpanel-2.84.0-ve-alpha-2.min.js';
(function (f, b) { if (!b.__SV) { var e, g, i, h; window.mixpanel = b; b._i = []; b.init = function (e, f, c) { function g(a, d) { var b = d.split("."); 2 == b.length && ((a = a[b[0]]), (d = b[1])); a[d] = function () { a.push([d].concat(Array.prototype.slice.call(arguments, 0))); }; } var a = b; "undefined" !== typeof c ? (a = b[c] = []) : (c = "mixpanel"); a.people = a.people || []; a.toString = function (a) { var d = "mixpanel"; "mixpanel" !== c && (d += "." + c); a || (d += " (stub)"); return d; }; a.people.toString = function () { return a.toString(1) + ".people (stub)"; }; i = "disable time_event track track_pageview track_links track_forms track_with_groups add_group set_group remove_group register register_once alias unregister identify name_tag set_config reset opt_in_tracking opt_out_tracking has_opted_in_tracking has_opted_out_tracking clear_opt_in_out_tracking start_batch_senders people.set people.set_once people.unset people.increment people.append people.union people.track_charge people.clear_charges people.delete_user people.remove".split(" "); for (h = 0; h < i.length; h++) g(a, i[h]); var j = "set set_once union unset remove delete".split(" "); a.get_group = function () { function b(c) { d[c] = function () { call2_args = arguments; call2 = [c].concat(Array.prototype.slice.call(call2_args, 0)); a.push([e, call2]); }; } for (var d = {}, e = ["get_group"].concat(Array.prototype.slice.call(arguments, 0)), c = 0; c < j.length; c++) b(j[c]); return d; }; b._i.push([e, f, c]); }; b.__SV = 1.2; e = f.createElement("script"); e.type = "text/javascript"; e.async = !0; e.src = "undefined" !== typeof MIXPANEL_CUSTOM_LIB_URL ? MIXPANEL_CUSTOM_LIB_URL : "file:" === f.location.protocol && "//cdn.mxpnl.com/libs/mixpanel-2-latest.min.js".match(/^\/\//) ? "https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js" : "//cdn.mxpnl.com/libs/mixpanel-2-latest.min.js"; g = f.getElementsByTagName("script")[0]; g.parentNode.insertBefore(e, g); } })(document, window.mixpanel || []);

// Resolves once the real SDK has loaded (the stub can't read flags).
let resolveMixpanelReady;
const mixpanelReady = new Promise(resolve => { resolveMixpanelReady = resolve; });

mixpanel.init(MP_TOKEN, {
  debug: true,
  // Page views are sent manually below, after identify + register, so the
  // automatic $mp_web_page_view carries the right user and page_type.
  track_pageview: false,
  persistence: "localStorage",
  api_host: "https://api.mixpanel.com",   // US residency
  record_sessions_percent: 100,            // Session Replay: capture 100% for demo
  remote_settings_mode: 'disabled',
  record_mask_text_selector: ".mp-mask",   // mask any element with .mp-mask
  record_block_selector: ".mp-block",      // block any element with .mp-block
  record_idle_timeout_ms: 1800000,
  record_max_ms: 86400000,
  record_network: true,                    // capture network requests in replays
  record_heatmap_data: true,               // capture click/scroll heatmap data
  autocapture: {
    pageview: false,
    click: false,
    dead_click: true,
    input: false,
    rage_click: true,
    scroll: true,
    submit: false,
    capture_text_content: false,
  },                                       // we'll do explicit tracking for clarity
  flags: {
    context: {
      company_id: "X",
      custom_properties: {
        platform: currency
      },
    },
  },                                       // enable feature flag SDK
  visual_experiments: true,
  loaded: function (mp) {
    resolveMixpanelReady(mp);
  }
});

// page_type is a super property so every event — including autocaptured
// rage/dead clicks and scrolls — can be broken down by template.
mixpanel.register({ $mp_user_agent: navigator.userAgent, page_type: PAGE_TYPE });

// Re-asserting identity on every page load is a no-op when nothing changed,
// and repairs it if another tab touched the shared persistence.
mixpanel.identify(currentUser.email);

if (isNewUser) {
  mixpanel.people.set({
    "$name": currentUser.name,
    "$email": currentUser.email,
    "plan_tier": currentUser.tier
  });
  console.log(`%c[MixDemo] New user identified: ${currentUser.name} (${currentUser.email}) · tier: ${currentUser.tier}`,
              "color: #16a34a; font-weight: bold;");
}

// SDK page view ($mp_web_page_view) — URL, title, referrer, UTMs.
mixpanel.track_pageview();
