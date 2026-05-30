/* ============================================================
   LuxeCart — app.js
   Amanda Demo Store · Full digital store with analytics,
   customer care, and live Amanda event integration.
   ============================================================ */

'use strict';

const AMANDA_BASE    = 'http://localhost:3000';
const AMANDA_SECRET  = 'demo-secret';

// ── State ─────────────────────────────────────────────────
let cart   = JSON.parse(localStorage.getItem('lc_cart')   || '[]');
let events = JSON.parse(localStorage.getItem('lc_events') || '[]');
let deliveryFee    = 2500;
let abandonedTimer = null;
let lastInteraction = Date.now();
let currentStep    = 1;
let isCheckoutOpen = false;
let activeTab      = 'storefront';

// ── Products ───────────────────────────────────────────────
const PRODUCTS = [
  {
    id: 'p001', name: 'Air Phantom Pro', category: 'Sneakers',
    price: 85000, unitsSold: 142, revenue: 500000,
    status: 'trending',
    desc: 'Limited edition premium athletic sneakers',
    img: 'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=500&q=80'
  },
  {
    id: 'p002', name: 'NovaTech Watch X1', category: 'Smart Gadgets',
    price: 150000, unitsSold: 67, revenue: 350000,
    status: 'normal',
    desc: 'Precision smartwatch with AMOLED display',
    img: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&q=80'
  },
  {
    id: 'p003', name: 'Urban Leather Backpack', category: 'Accessories',
    price: 45000, unitsSold: 89, revenue: 280000,
    status: 'normal',
    desc: 'Full-grain leather with laptop compartment',
    img: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500&q=80'
  },
  {
    id: 'p004', name: 'SoundDrop Pro', category: 'Gadgets',
    price: 75000, unitsSold: 103, revenue: 420000,
    status: 'trending',
    desc: 'Noise-cancelling wireless earbuds, 32hr battery',
    img: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500&q=80'
  },
  {
    id: 'p005', name: 'Obsidian Hoodie', category: 'Streetwear',
    price: 35000, unitsSold: 74, revenue: 165000,
    status: 'normal',
    desc: 'Heavyweight cotton fleece, oversized fit',
    img: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=500&q=80'
  },
  {
    id: 'p006', name: 'Noir Oud Perfume', category: 'Beauty',
    price: 60000, unitsSold: 55, revenue: 210000,
    status: 'low_stock',
    desc: 'Luxury oud & amber, 100ml EDP',
    img: 'https://images.unsplash.com/photo-1588405748880-12d1d2a59f75?w=500&q=80'
  },
  {
    id: 'p007', name: 'Terrain Duffel Bag', category: 'Travel',
    price: 55000, unitsSold: 38, revenue: 140000,
    status: 'normal',
    desc: 'Water-resistant 45L weekend travel bag',
    img: 'https://images.unsplash.com/photo-1550850839-8dc894ed385a?w=500&q=80'
  },
  {
    id: 'p008', name: 'HydraSteel Bottle', category: 'Fitness',
    price: 25000, unitsSold: 29, revenue: 25000,
    status: 'underperforming',
    desc: 'Double-wall insulated, 750ml, keeps cold 24hr',
    img: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=500&q=80'
  }
];

// ── Store Analytics ────────────────────────────────────────
const STORE_ANALYTICS = {
  totalRevenue:       2090000,
  ordersToday:        18,
  averageOrderValue:  69444,
  abandonedCheckouts: 4,
  failedPayments:     2,
  refundRequests:     1,
  customerComplaints: 3,
  conversionRate:     4.8,
  topProduct:         'Air Phantom Pro',
  topProductRevenue:  500000,
  lowestProduct:      'HydraSteel Bottle',
  lowestProductRevenue: 25000,
};

// ── Support Tickets ────────────────────────────────────────
const SUPPORT_TICKETS = [
  {
    id: 'tkt_001',
    customerName: 'Chinedu Nwosu',
    email: 'chinedu@example.com',
    type: 'delivery_complaint',
    priority: 'high',
    status: 'open',
    product: 'Urban Leather Backpack',
    value: 45000,
    message: 'Customer reported delayed delivery and wants an urgent update on package location. Order was placed 5 days ago.',
    createdAt: new Date(Date.now() - 2 * 3600000).toISOString()
  },
  {
    id: 'tkt_002',
    customerName: 'Funmilayo Adeyemi',
    email: 'funmi@example.com',
    type: 'refund_request',
    priority: 'high',
    status: 'open',
    product: 'NovaTech Watch X1',
    value: 150000,
    message: 'Watch arrived with cracked display. Customer is requesting a full refund and return label immediately.',
    createdAt: new Date(Date.now() - 5 * 3600000).toISOString()
  },
  {
    id: 'tkt_003',
    customerName: 'Ibrahim Musa',
    email: 'ibrahim@example.com',
    type: 'bulk_order_inquiry',
    priority: 'high',
    status: 'open',
    product: 'Obsidian Hoodie',
    value: 700000,
    message: 'Customer is interested in ordering 20+ units for a corporate gift. Needs bulk pricing and delivery timeline to Abuja.',
    createdAt: new Date(Date.now() - 1 * 3600000).toISOString()
  },
  {
    id: 'tkt_004',
    customerName: 'Ngozi Eze',
    email: 'ngozi@example.com',
    type: 'failed_payment',
    priority: 'medium',
    status: 'open',
    product: 'SoundDrop Pro',
    value: 75000,
    message: 'Payment was declined twice. Customer wants help completing purchase and checking if card issue is on our end.',
    createdAt: new Date(Date.now() - 4 * 3600000).toISOString()
  },
  {
    id: 'tkt_005',
    customerName: 'Kemi Johnson',
    email: 'kemi@example.com',
    type: 'support_message',
    priority: 'medium',
    status: 'pending',
    product: 'Noir Oud Perfume',
    value: 60000,
    message: 'Customer asking about restocking timeline. Item is marked low stock and she wants to know when it will be back.',
    createdAt: new Date(Date.now() - 6 * 3600000).toISOString()
  },
  {
    id: 'tkt_006',
    customerName: 'Bola Fasola',
    email: 'bola@example.com',
    type: 'support_message',
    priority: 'low',
    status: 'resolved',
    product: 'Terrain Duffel Bag',
    value: 55000,
    message: 'Customer asked about colour options. Resolved — confirmed available colours by email.',
    createdAt: new Date(Date.now() - 24 * 3600000).toISOString()
  }
];

// ── Customer Pool ──────────────────────────────────────────
const CUSTOMERS = [
  { name: 'Tunde Ade',         email: 'tunde@example.com' },
  { name: 'Amaka Okafor',      email: 'amaka@example.com' },
  { name: 'Mariam Bello',      email: 'mariam@example.com' },
  { name: 'Chinedu Nwosu',     email: 'chinedu@example.com' },
  { name: 'Kemi Johnson',      email: 'kemi@example.com' },
  { name: 'Ibrahim Musa',      email: 'ibrahim@example.com' },
  { name: 'Funmilayo Adeyemi', email: 'funmi@example.com' },
  { name: 'Emeka Obi',         email: 'emeka@example.com' },
  { name: 'Ngozi Eze',         email: 'ngozi@example.com' },
  { name: 'Bola Fasola',       email: 'bola@example.com' }
];

// ── Event Configuration ────────────────────────────────────
const EVENT_CONFIG = {
  new_order: {
    label: 'New Order',
    desc: 'Customer completed checkout & payment confirmed',
    icon: '🛍️', color: '#22C55E', bgColor: '#0d331a',
    priority: 'medium',
    values: [25000, 45000, 75000, 85000, 95000],
    message: (n, p, v) =>
      `${n} completed a new order for ${p}. Payment of ₦${fmt(v)} confirmed.`
  },
  abandoned_checkout: {
    label: 'Abandoned Checkout',
    desc: 'Customer left without completing purchase',
    icon: '⚠️', color: '#F59E0B', bgColor: '#3d2800',
    priority: 'high',
    values: [150000, 250000, 350000, 500000, 650000],
    message: (n, p, v) =>
      `${n} added ${p} to cart (₦${fmt(v)}) but did not complete checkout. Recovery opportunity.`
  },
  failed_payment: {
    label: 'Failed Payment',
    desc: 'Payment declined during checkout',
    icon: '❌', color: '#EF4444', bgColor: '#3d1212',
    priority: 'high',
    values: [75000, 120000, 150000, 200000, 280000],
    message: (n, p, v) =>
      `Payment of ₦${fmt(v)} declined for ${n}'s order of ${p}. Customer may need follow-up.`
  },
  delivery_complaint: {
    label: 'Delivery Complaint',
    desc: 'Customer reporting delivery issue',
    icon: '📦', color: '#F97316', bgColor: '#3d1800',
    priority: 'high',
    values: [35000, 45000, 60000, 75000],
    message: (n, p, v) =>
      `${n} reported a delivery issue for ${p} (₦${fmt(v)}). Customer is requesting update on location.`
  },
  refund_request: {
    label: 'Refund Request',
    desc: 'Customer requesting a refund',
    icon: '↩️', color: '#A855F7', bgColor: '#2d1040',
    priority: 'medium',
    values: [25000, 45000, 60000, 75000, 85000],
    message: (n, p, v) =>
      `${n} requested a refund of ₦${fmt(v)} for ${p}. Reason: damaged packaging on arrival.`
  },
  bulk_order_inquiry: {
    label: 'Bulk Order Inquiry',
    desc: 'High-volume purchase inquiry',
    icon: '📋', color: '#3B82F6', bgColor: '#0d1f3d',
    priority: 'high',
    values: [500000, 650000, 750000, 850000, 1200000],
    message: (n, p, v) =>
      `${n} is inquiring about bulk pricing for 50+ units of ${p}. Estimated value ₦${fmt(v)}. Needs quote.`
  },
  high_value_inquiry: {
    label: 'High-Value Inquiry',
    desc: 'Premium customer needs immediate attention',
    icon: '💎', color: '#C9A84C', bgColor: '#3d2800',
    priority: 'high',
    values: [350000, 500000, 750000, 850000, 1000000],
    message: (n, p, v) =>
      `${n} (₦${fmt(v)} potential) asked about availability, delivery timeline, and discount options for ${p}. High-value lead.`
  }
};

// ── Amanda API ─────────────────────────────────────────────
async function sendToAmanda(event) {
  console.log('%c[Amanda Event]', 'color:#C9A84C;font-weight:bold', event);
  try {
    const res = await fetch(`${AMANDA_BASE}/api/connectors/website/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amanda-website-secret': AMANDA_SECRET
      },
      body: JSON.stringify(event)
    });
    if (res.ok) {
      console.log('%c[Amanda] Event accepted ✓', 'color:#22C55E');
    } else {
      console.warn('[Amanda] Event rejected:', res.status);
    }
  } catch {
    console.warn('[Amanda] Backend not connected — event logged locally only');
  }
}

async function sendStoreSnapshot() {
  const a = STORE_ANALYTICS;
  const snapshotEvent = {
    type:         'high_value_inquiry',
    customerName: 'Store Analytics',
    email:        'analytics@mockstore.local',
    value:        a.totalRevenue,
    currency:     'NGN',
    product:      a.topProduct,
    message:      `Store summary: ${a.topProduct} is the top-selling product with ₦${fmt(a.topProductRevenue)} revenue. ${a.lowestProduct} is underperforming with ₦${fmt(a.lowestProductRevenue)} revenue. Orders today: ${a.ordersToday}. Abandoned checkouts: ${a.abandonedCheckouts}. Conversion rate: ${a.conversionRate}%. Recommended focus: promote and restock ${a.topProduct}.`,
    priority:     'high',
    source:       'mock_ecommerce_website',
    metadata: {
      kind:                'store_summary',
      topProduct:          a.topProduct,
      topProductRevenue:   a.topProductRevenue,
      lowestProduct:       a.lowestProduct,
      lowestProductRevenue: a.lowestProductRevenue,
      ordersToday:         a.ordersToday,
      conversionRate:      a.conversionRate,
      averageOrderValue:   a.averageOrderValue,
      abandonedCheckouts:  a.abandonedCheckouts,
      failedPayments:      a.failedPayments
    }
  };
  await sendToAmanda(snapshotEvent);
  showToast('📊 Snapshot sent to Amanda', `Store summary: ₦${fmt(a.totalRevenue)} total revenue · ${a.ordersToday} orders today`, 'success', 5000);
}

// ── Generate Event ─────────────────────────────────────────
async function generateEvent(type, overrides = {}) {
  const cfg      = EVENT_CONFIG[type];
  const customer = rand(CUSTOMERS);
  const product  = rand(PRODUCTS);
  const value    = rand(cfg.values);

  const event = {
    id:           `evt_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    type,
    customerName: customer.name,
    email:        customer.email,
    value,
    currency:     'NGN',
    product:      product.name,
    message:      cfg.message(customer.name, product.name, value),
    priority:     cfg.priority,
    source:       'mock_ecommerce_website',
    createdAt:    new Date().toISOString(),
    ...overrides
  };

  await sendToAmanda(event);

  events.unshift(event);
  if (events.length > 30) events = events.slice(0, 30);
  localStorage.setItem('lc_events', JSON.stringify(events));
  renderEvents();

  const isHighVal = value >= 300000;
  showToast(
    isHighVal ? `🔥 ${cfg.label}` : cfg.label,
    `${event.customerName} · ₦${fmt(value)}${isHighVal ? ' — High priority! Sent to Amanda.' : ' · Sent to Amanda.'}`,
    isHighVal ? 'warning' : 'success',
    isHighVal ? 5000 : 3500
  );

  const btn = document.querySelector(`[data-type="${type}"]`);
  if (btn) {
    btn.classList.add('active-flash');
    setTimeout(() => btn.classList.remove('active-flash'), 600);
  }

  return event;
}

// ── Tab Switching ──────────────────────────────────────────
function switchTab(tabName) {
  activeTab = tabName;

  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });

  const storefront = ['storefront'];
  const hero = document.getElementById('hero');
  const ticker = document.querySelector('[data-section="storefront"]');
  const heroSection = document.querySelector('.ticker[data-section]')?.closest?.('section');

  document.querySelectorAll('[data-section]').forEach(el => {
    const section = el.dataset.section;
    el.classList.toggle('hidden', section !== tabName);
  });

  // Hero is always visible only on storefront
  if (hero) hero.style.display = tabName === 'storefront' ? '' : 'none';
  if (ticker) ticker.style.display = tabName === 'storefront' ? '' : 'none';
}

// ── Render Analytics ───────────────────────────────────────
function renderAnalytics() {
  renderAnalyticsKPIs();
  renderProductsChart();
  renderAnalyticsAttention();
}

function renderAnalyticsKPIs() {
  const el = document.getElementById('analytics-kpi-grid');
  if (!el) return;
  const a = STORE_ANALYTICS;
  const kpis = [
    { label: 'Total Revenue',       value: `₦${fmt(a.totalRevenue)}`,   icon: 'bx-money', color: 'gold', sub: 'All time' },
    { label: 'Orders Today',         value: a.ordersToday,               icon: 'bx-package', color: 'green', sub: 'Last 24h' },
    { label: 'Avg Order Value',      value: `₦${fmt(a.averageOrderValue)}`, icon: 'bx-bar-chart', color: 'blue', sub: 'Per order' },
    { label: 'Conversion Rate',      value: `${a.conversionRate}%`,      icon: 'bx-trending-up', color: 'green', sub: 'Visits → Orders' },
    { label: 'Abandoned Checkouts',  value: a.abandonedCheckouts,        icon: 'bx-cart-x', color: 'amber', sub: 'Need recovery', alert: true },
    { label: 'Failed Payments',      value: a.failedPayments,            icon: 'bx-x-circle', color: 'red', sub: 'Need follow-up', alert: true },
    { label: 'Refund Requests',      value: a.refundRequests,            icon: 'bx-undo', color: 'purple', sub: 'Pending review', alert: a.refundRequests > 0 },
    { label: 'Customer Complaints',  value: a.customerComplaints,        icon: 'bx-error-circle', color: 'orange', sub: 'Open tickets', alert: a.customerComplaints > 0 },
  ];
  el.innerHTML = kpis.map(k => `
    <div class="kpi-card${k.alert ? ' kpi-alert' : ''}">
      <div class="kpi-icon kpi-${k.color}"><i class='bx ${k.icon}'></i></div>
      <div class="kpi-body">
        <div class="kpi-value">${k.value}</div>
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>
    </div>
  `).join('');
}

function renderProductsChart() {
  const el = document.getElementById('analytics-products-chart');
  if (!el) return;
  const sorted = [...PRODUCTS].sort((a, b) => b.revenue - a.revenue);
  const maxRev = sorted[0].revenue;
  el.innerHTML = sorted.map(p => {
    const pct = Math.round((p.revenue / maxRev) * 100);
    const statusColors = { trending: '#22C55E', normal: '#3B82F6', low_stock: '#F59E0B', underperforming: '#EF4444' };
    const statusLabels = { trending: '🔥 Trending', normal: '✓ Normal', low_stock: '⚠ Low Stock', underperforming: '↓ Underperforming' };
    const color = statusColors[p.status] || '#666';
    return `
      <div class="pc-row">
        <div class="pc-name">${p.name}</div>
        <div class="pc-bar-wrap">
          <div class="pc-bar" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="pc-rev">₦${fmt(p.revenue)}</div>
        <div class="pc-status" style="color:${color}">${statusLabels[p.status] || p.status}</div>
      </div>
    `;
  }).join('');
}

function renderAnalyticsAttention() {
  const el = document.getElementById('analytics-attention');
  if (!el) return;
  const a = STORE_ANALYTICS;
  const issues = [];
  if (a.abandonedCheckouts > 0) issues.push({ icon: '⚠️', text: `${a.abandonedCheckouts} abandoned checkout${a.abandonedCheckouts > 1 ? 's' : ''} — potential ₦${fmt(a.abandonedCheckouts * a.averageOrderValue)} recovery`, color: '#F59E0B' });
  if (a.failedPayments > 0) issues.push({ icon: '❌', text: `${a.failedPayments} failed payment${a.failedPayments > 1 ? 's' : ''} need follow-up`, color: '#EF4444' });
  if (a.refundRequests > 0) issues.push({ icon: '↩️', text: `${a.refundRequests} refund request${a.refundRequests > 1 ? 's' : ''} pending`, color: '#A855F7' });

  const lowStock = PRODUCTS.filter(p => p.status === 'low_stock');
  lowStock.forEach(p => issues.push({ icon: '📦', text: `${p.name} is low on stock`, color: '#F97316' }));

  const underperforming = PRODUCTS.filter(p => p.status === 'underperforming');
  underperforming.forEach(p => issues.push({ icon: '📉', text: `${p.name} is underperforming — ₦${fmt(p.revenue)} revenue`, color: '#EF4444' }));

  el.innerHTML = issues.length
    ? issues.map(i => `
        <div class="attn-item">
          <span class="attn-ico">${i.icon}</span>
          <span class="attn-txt" style="color:${i.color}">${i.text}</span>
        </div>
      `).join('')
    : '<div class="attn-empty">No issues detected. Store is running smoothly.</div>';
}

// ── Render Support Tickets ─────────────────────────────────
function renderSupportTickets() {
  const el = document.getElementById('support-tickets-list');
  if (!el) return;
  const typeLabels = {
    delivery_complaint: { label: 'Delivery Complaint', icon: '📦', color: '#F97316' },
    refund_request:     { label: 'Refund Request',     icon: '↩️', color: '#A855F7' },
    failed_payment:     { label: 'Failed Payment',     icon: '❌', color: '#EF4444' },
    bulk_order_inquiry: { label: 'Bulk Order Inquiry', icon: '📋', color: '#3B82F6' },
    support_message:    { label: 'Support Message',    icon: '💬', color: '#22C55E' },
  };
  const statusColors = { open: '#EF4444', pending: '#F59E0B', resolved: '#22C55E' };

  el.innerHTML = SUPPORT_TICKETS.map(t => {
    const tCfg = typeLabels[t.type] || { label: t.type, icon: '📌', color: '#aaa' };
    return `
      <div class="ticket-card pri-${t.priority}">
        <div class="ticket-top">
          <span class="ticket-type-badge" style="background:${tCfg.color}22;color:${tCfg.color};border-color:${tCfg.color}33">
            ${tCfg.icon} ${tCfg.label}
          </span>
          <span class="ticket-priority pri-badge-${t.priority}">${t.priority}</span>
          <span class="ticket-status" style="color:${statusColors[t.status] || '#aaa'}">${t.status}</span>
          <span class="ticket-time">${timeAgo(t.createdAt)}</span>
        </div>
        <div class="ticket-body">
          <div class="ticket-customer">
            <div class="t-cname">${t.customerName}</div>
            <div class="t-email">${t.email}</div>
          </div>
          <div class="ticket-meta">
            <div class="t-product"><span>Product:</span> ${t.product}</div>
            <div class="t-value">₦${fmt(t.value)}</div>
          </div>
        </div>
        <div class="ticket-msg">${t.message}</div>
        <div class="ticket-actions">
          <button class="tkt-btn" onclick="sendTicketToAmanda('${t.id}')">
            <i class='bx bx-send'></i> Send to Amanda
          </button>
          <span class="t-id">ID: ${t.id}</span>
        </div>
      </div>
    `;
  }).join('');
}

async function sendTicketToAmanda(ticketId) {
  const t = SUPPORT_TICKETS.find(x => x.id === ticketId);
  if (!t) return;
  await sendToAmanda({
    type:         t.type,
    customerName: t.customerName,
    email:        t.email,
    value:        t.value,
    currency:     'NGN',
    product:      t.product,
    message:      t.message,
    priority:     t.priority,
    source:       'mock_ecommerce_website',
  });
  showToast('Ticket sent to Amanda', `${t.customerName} · ${t.type.replace(/_/g, ' ')}`, 'success');
}

// ── Render Products ────────────────────────────────────────
function renderProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  const statusBadge = { trending: '🔥 Trending', low_stock: '⚠ Low Stock', underperforming: '↓ Low Sales' };
  grid.innerHTML = PRODUCTS.map(p => `
    <div class="product-card" id="pc-${p.id}" onclick="addToCart('${p.id}')">
      <div class="product-img">
        <img src="${p.img}" alt="${p.name}" class="real-img" loading="lazy" />
        <span class="product-cat-badge">${p.category}</span>
        ${statusBadge[p.status] ? `<span class="product-status-badge status-${p.status}">${statusBadge[p.status]}</span>` : ''}
        <button class="product-fav" onclick="event.stopPropagation();this.style.color='#ef4444'" aria-label="Favourite">
          <i class='bx bx-heart'></i>
        </button>
      </div>
      <div class="product-body">
        <div class="product-name">${p.name}</div>
        <div class="product-desc">${p.desc}</div>
        <div class="product-footer">
          <span class="product-price">₦${fmt(p.price)}</span>
          <button class="btn-add" onclick="event.stopPropagation();addToCart('${p.id}')">
            <i class='bx bx-plus'></i> Add
          </button>
        </div>
      </div>
    </div>
  `).join('');

  observeCards();
}

// ── Render Demo Grid ───────────────────────────────────────
function renderDemoGrid() {
  const grid = document.getElementById('demo-grid');
  if (!grid) return;
  grid.innerHTML = Object.entries(EVENT_CONFIG).map(([type, cfg]) => `
    <button
      class="demo-btn"
      data-type="${type}"
      style="border-left-color:${cfg.color}"
      onclick="generateEvent('${type}')"
      aria-label="Generate ${cfg.label} event"
    >
      <div class="demo-ico" style="background:${cfg.bgColor}">
        ${cfg.icon}
      </div>
      <div class="demo-info">
        <div class="demo-label" style="color:${cfg.color}">${cfg.label}</div>
        <div class="demo-desc">${cfg.desc}</div>
      </div>
      <i class='bx bx-right-arrow-alt demo-arrow'></i>
    </button>
  `).join('');
}

// ── Render Events Feed ─────────────────────────────────────
function renderEvents() {
  const list  = document.getElementById('events-list');
  const empty = document.getElementById('events-empty');
  if (!list) return;

  if (events.length === 0) {
    if (empty) empty.style.display = 'block';
    list.querySelectorAll('.event-card').forEach(el => el.remove());
    return;
  }
  if (empty) empty.style.display = 'none';

  list.querySelectorAll('.event-card').forEach(el => el.remove());
  events.forEach(ev => {
    const cfg  = EVENT_CONFIG[ev.type] || {};
    const card = document.createElement('div');
    card.className = `event-card priority-${ev.priority}`;
    card.id = `ev-${ev.id}`;
    card.innerHTML = `
      <div class="event-top">
        <span class="ev-type-badge" style="background:${cfg.bgColor||'#222'};color:${cfg.color||'#aaa'}">
          ${cfg.icon || '📌'} ${ev.type.replace(/_/g,' ')}
        </span>
        <span class="ev-pri-badge pri-${ev.priority}">${ev.priority}</span>
        <span class="ev-time">${timeAgo(ev.createdAt)}</span>
      </div>
      <div class="event-body">
        <div>
          <div class="ev-customer">
            <div class="ev-cname">${ev.customerName}</div>
            <div class="ev-email">${ev.email}</div>
          </div>
          <div class="ev-meta">
            <div class="ev-meta-item"><span>Product:</span>${ev.product}</div>
          </div>
        </div>
        <div class="ev-value">₦${fmt(ev.value)}</div>
      </div>
      <div class="ev-msg">${ev.message}</div>
      <div class="ev-id">ID: ${ev.id}</div>
    `;
    list.appendChild(card);
  });
}

function clearEvents() {
  events = [];
  localStorage.removeItem('lc_events');
  renderEvents();
  showToast('Feed cleared', 'All events removed from local feed', 'info');
}

// ── Cart Logic ─────────────────────────────────────────────
function addToCart(productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return;
  const existing = cart.find(i => i.id === productId);
  if (existing) { existing.qty += 1; } else { cart.push({ ...product, qty: 1 }); }
  saveCart(); updateCartBadge(); renderCartItems();
  generateEvent('new_order', {
    product: product.name,
    value:   product.price,
    message: `${CUSTOMERS[0].name} added ${product.name} to cart and initiated checkout.`
  });
  showToast('Added to cart', `${product.name} · ₦${fmt(product.price)}`, 'success');
  const card = document.getElementById(`pc-${productId}`);
  if (card) { card.classList.add('added'); setTimeout(() => card.classList.remove('added'), 1200); }
}

function changeQty(productId, delta) {
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(i => i.id !== productId);
  saveCart(); updateCartBadge(); renderCartItems();
}

function removeFromCart(productId) {
  cart = cart.filter(i => i.id !== productId);
  saveCart(); updateCartBadge(); renderCartItems();
}

function saveCart() { localStorage.setItem('lc_cart', JSON.stringify(cart)); }
function cartTotal() { return cart.reduce((s, i) => s + i.price * i.qty, 0); }
function cartCount() { return cart.reduce((s, i) => s + i.qty, 0); }

function updateCartBadge() {
  const badge = document.getElementById('cart-count');
  const n = cartCount();
  if (!badge) return;
  if (n > 0) {
    badge.textContent = n; badge.style.display = 'flex';
    badge.classList.remove('bounce'); void badge.offsetWidth; badge.classList.add('bounce');
  } else { badge.style.display = 'none'; }
}

function renderCartItems() {
  const container = document.getElementById('cart-items');
  const emptyEl   = document.getElementById('cart-empty');
  const botEl     = document.getElementById('cart-bot');
  const totalEl   = document.getElementById('cart-total');
  if (!container) return;
  if (cart.length === 0) {
    container.innerHTML = ''; container.appendChild(emptyEl);
    if (botEl) botEl.style.display = 'none'; return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (botEl) botEl.style.display = 'block';
  if (totalEl) totalEl.textContent = `₦${fmt(cartTotal())}`;
  container.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-img" style="background: url('${item.img}') center/cover;"></div>
      <div class="cart-item-info">
        <div class="ci-name">${item.name}</div>
        <div class="ci-price">₦${fmt(item.price)}</div>
        <div class="ci-qty">
          <button onclick="changeQty('${item.id}',-1)">−</button>
          <span class="ci-qty-num">${item.qty}</span>
          <button onclick="changeQty('${item.id}',1)">+</button>
        </div>
      </div>
      <button class="ci-remove" onclick="removeFromCart('${item.id}')" aria-label="Remove">
        <i class='bx bx-trash'></i>
      </button>
    </div>
  `).join('');
}

// ── Cart Sidebar ───────────────────────────────────────────
function openCart() { document.getElementById('cart-sidebar').classList.add('open'); document.getElementById('overlay').classList.add('open'); renderCartItems(); }
function closeCart() { document.getElementById('cart-sidebar').classList.remove('open'); document.getElementById('overlay').classList.remove('open'); }
function handleOverlayClick() { closeCart(); closeCheckout(); }

// ── Checkout Modal ─────────────────────────────────────────
function openCheckout() {
  if (cart.length === 0) { showToast('Cart is empty', 'Add some products first', 'error'); return; }
  closeCart(); currentStep = 1; goStep(1);
  document.getElementById('checkout-modal').style.display = 'flex';
  isCheckoutOpen = true; startAbandonedTimer(); updateOrderSummary();
}
function closeCheckout() { document.getElementById('checkout-modal').style.display = 'none'; isCheckoutOpen = false; stopAbandonedTimer(); }
function goStep(n) {
  currentStep = n;
  [1,2,3].forEach(i => {
    const panel = document.getElementById(`sp-${i}`);
    const ind   = document.getElementById(`si-${i}`);
    if (panel) panel.classList.toggle('hidden', i !== n);
    if (ind) { ind.classList.remove('active','done'); if (i===n) ind.classList.add('active'); if (i<n) ind.classList.add('done'); }
  });
  if (n === 3) updateOrderSummary();
}
function updateOrderSummary() {
  const el = document.getElementById('order-summary');
  if (!el) return;
  const total = cartTotal() + deliveryFee;
  el.innerHTML = `
    ${cart.map(i => `<div class="os-item"><span>${i.name} ×${i.qty}</span><span>₦${fmt(i.price*i.qty)}</span></div>`).join('')}
    <div class="os-item"><span>Delivery</span><span>₦${fmt(deliveryFee)}</span></div>
    <div class="os-total"><span>Total</span><span>₦${fmt(total)}</span></div>
  `;
}
function pickDelivery(el, fee) { document.querySelectorAll('.dopt').forEach(d => d.classList.remove('selected')); el.classList.add('selected'); deliveryFee = fee; }
function fmtCard(input) { let v = input.value.replace(/\D/g,'').slice(0,16); input.value = v.replace(/(.{4})/g,'$1 ').trim(); }

// ── Payment Simulation ─────────────────────────────────────
function simulatePayment() {
  const btn = document.getElementById('pay-btn');
  if (!btn) return;
  const name  = document.getElementById('co-name')?.value  || rand(CUSTOMERS).name;
  const email = document.getElementById('co-email')?.value || rand(CUSTOMERS).email;
  const total = cartTotal() + deliveryFee;
  const prod  = cart[0]?.name || 'Mixed Cart';
  btn.innerHTML = `<span class="spinner"></span> Processing...`; btn.disabled = true;
  setTimeout(() => {
    btn.innerHTML = `<i class='bx bxs-lock-alt'></i> Pay Now`; btn.disabled = false;
    generateEvent('new_order', { customerName: name || 'Customer', email: email || 'customer@example.com', value: total, product: prod, message: `${name||'Customer'} completed checkout. Payment of ₦${fmt(total)} confirmed.`, priority: total > 200000 ? 'high' : 'medium' });
    closeCheckout(); cart = []; saveCart(); updateCartBadge(); renderCartItems();
    showToast('✅ Order Confirmed!', `Payment of ₦${fmt(total)} successful. Amanda has been notified.`, 'success', 5000);
  }, 2200);
}
function simulateFailedPayment() {
  const modal = document.getElementById('modal-box');
  const btn   = document.getElementById('pay-btn');
  if (!btn) return;
  const name  = document.getElementById('co-name')?.value  || rand(CUSTOMERS).name;
  const email = document.getElementById('co-email')?.value || rand(CUSTOMERS).email;
  const total = cartTotal() + deliveryFee;
  const prod  = cart[0]?.name || 'Mixed Cart';
  btn.innerHTML = `<span class="spinner"></span> Processing...`; btn.disabled = true;
  setTimeout(() => {
    btn.innerHTML = `<i class='bx bxs-lock-alt'></i> Pay Now`; btn.disabled = false;
    if (modal) { modal.style.animation = 'shake .5s ease'; setTimeout(() => (modal.style.animation = ''), 600); }
    generateEvent('failed_payment', { customerName: name||'Customer', email: email||'customer@example.com', value: total, product: prod, message: `Payment of ₦${fmt(total)} declined for ${name||'Customer'}. Card error: insufficient funds. Recovery needed.` });
    showToast('❌ Payment Failed', 'Card declined. Amanda has flagged this for follow-up.', 'error', 5500);
  }, 2000);
}

// ── Abandoned Checkout Timer ───────────────────────────────
function startAbandonedTimer() {
  stopAbandonedTimer(); lastInteraction = Date.now();
  const WARN_MS = 20000; const ABANDON_MS = 35000; let warnFired = false;
  const trackActivity = () => { lastInteraction = Date.now(); };
  document.addEventListener('mousemove', trackActivity); document.addEventListener('keydown', trackActivity); document.addEventListener('click', trackActivity);
  abandonedTimer = setInterval(() => {
    if (!isCheckoutOpen) { stopAbandonedTimer(); return; }
    const idle = Date.now() - lastInteraction;
    if (idle > WARN_MS && !warnFired) { warnFired = true; showToast('⏳ Still there?', 'Your cart is waiting — complete checkout before items sell out!', 'warning', 6000); }
    if (idle > ABANDON_MS) {
      stopAbandonedTimer();
      const name  = document.getElementById('co-name')?.value  || rand(CUSTOMERS).name;
      const email = document.getElementById('co-email')?.value || rand(CUSTOMERS).email;
      const total = cartTotal(); const prod = cart[0]?.name || 'Cart Items';
      generateEvent('abandoned_checkout', { customerName: name||'Customer', email: email||'customer@example.com', value: total, product: prod, message: `${name||'Customer'} opened checkout (₦${fmt(total)}) but left after ${Math.round(idle/1000)}s. Recovery recommended.` });
      closeCheckout(); showToast('⚠️ Checkout Abandoned', `₦${fmt(total)} cart abandoned. Amanda has been notified.`, 'warning', 6000);
    }
  }, 1000);
}
function stopAbandonedTimer() { if (abandonedTimer) { clearInterval(abandonedTimer); abandonedTimer = null; } }

// ── Toast ──────────────────────────────────────────────────
function showToast(title, msg, type = 'success', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-ico">${icons[type]||'📌'}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('out'); setTimeout(() => toast.remove(), 350); }, duration);
}

// ── Helpers ────────────────────────────────────────────────
function observeCards() {
  const observer = new IntersectionObserver(
    entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.style.opacity='1'; e.target.style.transform='translateY(0)'; observer.unobserve(e.target); }
    }), { threshold: 0.1 }
  );
  document.querySelectorAll('.product-card').forEach((el, i) => {
    el.style.opacity='0'; el.style.transform='translateY(24px)';
    el.style.transition=`opacity .5s ease ${i*80}ms, transform .5s ease ${i*80}ms, border-color .25s, box-shadow .25s`;
    observer.observe(el);
  });
}
function initNavbar() {
  const nav = document.getElementById('navbar');
  if (!nav) return;
  window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 20));
}
function jumpTo(id) { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }
function injectDemoFlash() {
  const s = document.createElement('style');
  s.textContent = `.demo-btn.active-flash{transform:scale(.97);filter:brightness(1.15);}`;
  document.head.appendChild(s);
}
function rand(arr) { return arr[Math.floor(Math.random()*arr.length)]; }
function fmt(n)    { return Number(n).toLocaleString('en-NG'); }
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff/1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-NG',{day:'numeric',month:'short'});
}

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderProducts();
  renderDemoGrid();
  renderEvents();
  renderAnalytics();
  renderSupportTickets();
  updateCartBadge();
  initNavbar();
  injectDemoFlash();
  switchTab('storefront');

  if (events.length === 0) {
    setTimeout(() => generateEvent('high_value_inquiry'), 1200);
  }

  console.log(
    '%cLuxeCart Mock Store\n%cAmanda integration ACTIVE. Events POST to %chttp://localhost:3000/api/connectors/website/events',
    'color:#C9A84C;font-size:16px;font-weight:bold',
    'color:#aaa;font-size:12px',
    'color:#22C55E;font-size:12px'
  );
});
