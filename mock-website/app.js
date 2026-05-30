/* ============================================================
   LuxeCart — app.js
   Amanda Demo Store · All business event logic lives here
   ============================================================ */

'use strict';

// ── State ─────────────────────────────────────────────────
let cart   = JSON.parse(localStorage.getItem('lc_cart')   || '[]');
let events = JSON.parse(localStorage.getItem('lc_events') || '[]');
let deliveryFee = 2500;
let abandonedTimer   = null;
let lastInteraction  = Date.now();
let currentStep      = 1;
let isCheckoutOpen   = false;

// ── Products ───────────────────────────────────────────────
const PRODUCTS = [
  {
    id: 'p001', name: 'Air Phantom Pro', category: 'Sneakers',
    price: 85000,
    desc: 'Limited edition premium athletic sneakers',
    img: 'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=500&q=80'
  },
  {
    id: 'p002', name: 'NovaTech Watch X1', category: 'Smart Gadgets',
    price: 150000,
    desc: 'Precision smartwatch with AMOLED display',
    img: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&q=80'
  },
  {
    id: 'p003', name: 'Urban Leather Backpack', category: 'Accessories',
    price: 45000,
    desc: 'Full-grain leather with laptop compartment',
    img: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500&q=80'
  },
  {
    id: 'p004', name: 'SoundDrop Pro', category: 'Gadgets',
    price: 75000,
    desc: 'Noise-cancelling wireless earbuds, 32hr battery',
    img: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=500&q=80'
  },
  {
    id: 'p005', name: 'Obsidian Hoodie', category: 'Streetwear',
    price: 35000,
    desc: 'Heavyweight cotton fleece, oversized fit',
    img: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=500&q=80'
  },
  {
    id: 'p006', name: 'Noir Oud Perfume', category: 'Beauty',
    price: 60000,
    desc: 'Luxury oud & amber, 100ml EDP',
    img: 'https://images.unsplash.com/photo-1588405748880-12d1d2a59f75?w=500&q=80'
  },
  {
    id: 'p007', name: 'Terrain Duffel Bag', category: 'Travel',
    price: 55000,
    desc: 'Water-resistant 45L weekend travel bag',
    img: 'https://images.unsplash.com/photo-1550850839-8dc894ed385a?w=500&q=80'
  },
  {
    id: 'p008', name: 'HydraSteel Bottle', category: 'Fitness',
    price: 25000,
    desc: 'Double-wall insulated, 750ml, keeps cold 24hr',
    img: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=500&q=80'
  }
];

// ── Customer Pool (Nigerian context) ───────────────────────
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

// ── Amanda Event Sender ────────────────────────────────────
async function sendToAmanda(event) {
  // ↑ Local state & UI — always runs
  console.log('%c[Amanda Event]', 'color:#C9A84C;font-weight:bold', event);

  // TODO: Uncomment when Amanda backend is ready:
  /*
  try {
    const res = await fetch('http://localhost:3000/api/connectors/website/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-amanda-website-secret': 'demo-secret'
      },
      body: JSON.stringify(event)
    });
    if (!res.ok) console.warn('[Amanda] Event rejected:', res.status);
  } catch (err) {
    console.warn('[Amanda] Backend not connected — event stored locally only');
  }
  */
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
    product:      product.name,
    message:      cfg.message(customer.name, product.name, value),
    priority:     cfg.priority,
    source:       'mock_ecommerce_website',
    createdAt:    new Date().toISOString(),
    ...overrides
  };

  await sendToAmanda(event);

  // Store & render
  events.unshift(event);
  if (events.length > 30) events = events.slice(0, 30);
  localStorage.setItem('lc_events', JSON.stringify(events));
  renderEvents();

  // Toast
  const isHighVal = value >= 300000;
  if (isHighVal) {
    showToast(
      `🔥 ${cfg.label}`,
      `${customer.name} · ₦${fmt(value)} — High priority!`,
      'warning', 5000
    );
  } else {
    showToast(cfg.label, `${customer.name} · ₦${fmt(value)}`, 'success');
  }

  // Animate the button that was clicked (if event came from demo grid)
  const btn = document.querySelector(`[data-type="${type}"]`);
  if (btn) {
    btn.classList.add('active-flash');
    setTimeout(() => btn.classList.remove('active-flash'), 600);
  }

  return event;
}

// ── Render Products ────────────────────────────────────────
function renderProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  grid.innerHTML = PRODUCTS.map(p => `
    <div class="product-card" id="pc-${p.id}" onclick="addToCart('${p.id}')">
      <div class="product-img">
        <img src="${p.img}" alt="${p.name}" class="real-img" loading="lazy" />
        <span class="product-cat-badge">${p.category}</span>
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

// ── Render Demo Buttons ────────────────────────────────────
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
    empty && (empty.style.display = 'block');
    // Remove any existing cards
    list.querySelectorAll('.event-card').forEach(el => el.remove());
    return;
  }

  empty && (empty.style.display = 'none');

  // Full re-render (simple, works for ≤30 events)
  const existing = list.querySelectorAll('.event-card');
  existing.forEach(el => el.remove());

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
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ ...product, qty: 1 });
  }

  saveCart();
  updateCartBadge();
  renderCartItems();
  generateEvent('new_order', {
    product: product.name,
    value:   product.price,
    message: `${CUSTOMERS[0].name} added ${product.name} to cart and initiated checkout.`
  });
  showToast('Added to cart', `${product.name} · ₦${fmt(product.price)}`, 'success');

  // Flash the card
  const card = document.getElementById(`pc-${productId}`);
  if (card) {
    card.classList.add('added');
    setTimeout(() => card.classList.remove('added'), 1200);
  }
}

function changeQty(productId, delta) {
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter(i => i.id !== productId);
  }
  saveCart();
  updateCartBadge();
  renderCartItems();
}

function removeFromCart(productId) {
  cart = cart.filter(i => i.id !== productId);
  saveCart();
  updateCartBadge();
  renderCartItems();
}

function saveCart() { localStorage.setItem('lc_cart', JSON.stringify(cart)); }

function cartTotal() { return cart.reduce((s, i) => s + i.price * i.qty, 0); }

function cartCount() { return cart.reduce((s, i) => s + i.qty, 0); }

function updateCartBadge() {
  const badge = document.getElementById('cart-count');
  const n = cartCount();
  if (!badge) return;
  if (n > 0) {
    badge.textContent = n;
    badge.style.display = 'flex';
    badge.classList.remove('bounce');
    void badge.offsetWidth;
    badge.classList.add('bounce');
  } else {
    badge.style.display = 'none';
  }
}

function renderCartItems() {
  const container = document.getElementById('cart-items');
  const emptyEl   = document.getElementById('cart-empty');
  const botEl     = document.getElementById('cart-bot');
  const totalEl   = document.getElementById('cart-total');
  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = '';
    container.appendChild(emptyEl);
    if (botEl) botEl.style.display = 'none';
    return;
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
function openCart() {
  document.getElementById('cart-sidebar').classList.add('open');
  document.getElementById('overlay').classList.add('open');
  renderCartItems();
}

function closeCart() {
  document.getElementById('cart-sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

function handleOverlayClick() {
  closeCart();
  closeCheckout();
}

// ── Checkout Modal ─────────────────────────────────────────
function openCheckout() {
  if (cart.length === 0) {
    showToast('Cart is empty', 'Add some products first', 'error');
    return;
  }
  closeCart();
  currentStep = 1;
  goStep(1);
  document.getElementById('checkout-modal').style.display = 'flex';
  isCheckoutOpen = true;
  startAbandonedTimer();
  updateOrderSummary();
}

function closeCheckout() {
  document.getElementById('checkout-modal').style.display = 'none';
  isCheckoutOpen = false;
  stopAbandonedTimer();
}

function goStep(n) {
  currentStep = n;
  [1, 2, 3].forEach(i => {
    const panel = document.getElementById(`sp-${i}`);
    const ind   = document.getElementById(`si-${i}`);
    if (panel) panel.classList.toggle('hidden', i !== n);
    if (ind) {
      ind.classList.remove('active', 'done');
      if (i === n) ind.classList.add('active');
      if (i < n)  ind.classList.add('done');
    }
  });
  if (n === 3) updateOrderSummary();
}

function updateOrderSummary() {
  const el = document.getElementById('order-summary');
  if (!el) return;
  const total = cartTotal() + deliveryFee;
  el.innerHTML = `
    ${cart.map(i => `
      <div class="os-item">
        <span>${i.name} ×${i.qty}</span>
        <span>₦${fmt(i.price * i.qty)}</span>
      </div>
    `).join('')}
    <div class="os-item"><span>Delivery</span><span>₦${fmt(deliveryFee)}</span></div>
    <div class="os-total"><span>Total</span><span>₦${fmt(total)}</span></div>
  `;
}

function pickDelivery(el, fee) {
  document.querySelectorAll('.dopt').forEach(d => d.classList.remove('selected'));
  el.classList.add('selected');
  deliveryFee = fee;
}

function fmtCard(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 16);
  input.value = v.replace(/(.{4})/g, '$1 ').trim();
}

// ── Payment Simulation ─────────────────────────────────────
function simulatePayment() {
  const btn = document.getElementById('pay-btn');
  if (!btn) return;

  const name  = document.getElementById('co-name')?.value  || rand(CUSTOMERS).name;
  const email = document.getElementById('co-email')?.value || rand(CUSTOMERS).email;
  const total = cartTotal() + deliveryFee;
  const prod  = cart[0]?.name || 'Mixed Cart';

  btn.innerHTML = `<span class="spinner"></span> Processing...`;
  btn.disabled = true;

  setTimeout(() => {
    btn.innerHTML = `<i class='bx bxs-lock-alt'></i> Pay Now`;
    btn.disabled = false;

    // Success!
    generateEvent('new_order', {
      customerName: name || 'Customer',
      email:        email || 'customer@example.com',
      value:        total,
      product:      prod,
      message:      `${name || 'Customer'} completed checkout. Payment of ₦${fmt(total)} confirmed.`,
      priority:     total > 200000 ? 'high' : 'medium'
    });

    closeCheckout();
    cart = [];
    saveCart();
    updateCartBadge();
    renderCartItems();

    showToast(
      '✅ Order Confirmed!',
      `Payment of ₦${fmt(total)} successful. Amanda has been notified.`,
      'success', 5000
    );
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

  btn.innerHTML = `<span class="spinner"></span> Processing...`;
  btn.disabled = true;

  setTimeout(() => {
    btn.innerHTML = `<i class='bx bxs-lock-alt'></i> Pay Now`;
    btn.disabled = false;

    // Shake the modal
    if (modal) {
      modal.style.animation = 'shake .5s ease';
      setTimeout(() => (modal.style.animation = ''), 600);
    }

    generateEvent('failed_payment', {
      customerName: name || 'Customer',
      email:        email || 'customer@example.com',
      value:        total,
      product:      prod,
      message:      `Payment of ₦${fmt(total)} declined for ${name || 'Customer'}. Card error: insufficient funds. Recovery needed.`
    });

    showToast(
      '❌ Payment Failed',
      'Card declined. Amanda has flagged this for follow-up.',
      'error', 5500
    );
  }, 2000);
}

// ── Abandoned Checkout Timer ───────────────────────────────
// Demo: warns at 20s, fires event at 35s of inactivity
function startAbandonedTimer() {
  stopAbandonedTimer();
  lastInteraction = Date.now();

  const WARN_MS    = 20 * 1000;
  const ABANDON_MS = 35 * 1000;
  let warnFired    = false;

  const trackActivity = () => { lastInteraction = Date.now(); };
  document.addEventListener('mousemove', trackActivity);
  document.addEventListener('keydown',   trackActivity);
  document.addEventListener('click',     trackActivity);

  abandonedTimer = setInterval(() => {
    if (!isCheckoutOpen) { stopAbandonedTimer(); return; }
    const idle = Date.now() - lastInteraction;

    if (idle > WARN_MS && !warnFired) {
      warnFired = true;
      showToast(
        '⏳ Still there?',
        'Your cart is waiting — complete checkout before items sell out!',
        'warning', 6000
      );
    }

    if (idle > ABANDON_MS) {
      stopAbandonedTimer();
      const name  = document.getElementById('co-name')?.value  || rand(CUSTOMERS).name;
      const email = document.getElementById('co-email')?.value || rand(CUSTOMERS).email;
      const total = cartTotal();
      const prod  = cart[0]?.name || 'Cart Items';

      generateEvent('abandoned_checkout', {
        customerName: name || 'Customer',
        email:        email || 'customer@example.com',
        value:        total,
        product:      prod,
        message:      `${name || 'Customer'} opened checkout (₦${fmt(total)}) but left after ${Math.round(idle/1000)}s. Recovery recommended.`
      });

      closeCheckout();
      showToast(
        '⚠️ Checkout Abandoned',
        `₦${fmt(total)} cart abandoned. Amanda has been notified.`,
        'warning', 6000
      );
    }
  }, 1000);
}

function stopAbandonedTimer() {
  if (abandonedTimer) { clearInterval(abandonedTimer); abandonedTimer = null; }
}

// ── Toast Notifications ────────────────────────────────────
function showToast(title, msg, type = 'success', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-ico">${icons[type] || '📌'}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
    </div>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

// ── IntersectionObserver for product cards ─────────────────
function observeCards() {
  const observer = new IntersectionObserver(
    entries => entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
        observer.unobserve(e.target);
      }
    }),
    { threshold: 0.1 }
  );
  document.querySelectorAll('.product-card').forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = `opacity .5s ease ${i * 80}ms, transform .5s ease ${i * 80}ms, border-color .25s, box-shadow .25s`;
    observer.observe(el);
  });
}

// ── Navbar scroll effect ───────────────────────────────────
function initNavbar() {
  const nav = document.getElementById('navbar');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  });
}

// ── Smooth scroll helper ───────────────────────────────────
function jumpTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

// ── Demo grid flash style ──────────────────────────────────
function injectDemoFlash() {
  const s = document.createElement('style');
  s.textContent = `.demo-btn.active-flash { transform: scale(.97); filter: brightness(1.15); }`;
  document.head.appendChild(s);
}

// ── Utility ───────────────────────────────────────────────
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function fmt(n)    { return Number(n).toLocaleString('en-NG'); }
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderProducts();
  renderDemoGrid();
  renderEvents();
  updateCartBadge();
  initNavbar();
  injectDemoFlash();

  // Seed a welcome event if feed is empty
  if (events.length === 0) {
    setTimeout(() => {
      generateEvent('high_value_inquiry');
    }, 1200);
  }

  console.log(
    '%cLuxeCart Mock Store\n%cAmanda integration ready. Events fire to console & localStorage.\nConnect backend: POST http://localhost:3000/api/connectors/website/events',
    'color:#C9A84C;font-size:16px;font-weight:bold',
    'color:#aaa;font-size:12px'
  );
});