/* ============================================================
   business-projection.js
   Deterministic business health scoring, projection, and advice.
   No external API calls. Based on locally available business data.
   ============================================================ */

function cleanText(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function fmt(n) {
  return Number(n).toLocaleString("en-NG");
}

// ── Health Scoring ─────────────────────────────────────────

const HEALTH_BANDS = [
  { min: 80, label: "Healthy and growing",       growth: 1.15, risk: "low" },
  { min: 65, label: "Good but needs attention",  growth: 1.08, risk: "low" },
  { min: 50, label: "Stable but exposed",        growth: 1.00, risk: "medium" },
  { min: 35, label: "At risk",                   growth: 0.85, risk: "high" },
  { min: 0,  label: "Declining or unhealthy",    growth: 0.70, risk: "high" },
];

function classifyScore(score) {
  return HEALTH_BANDS.find((b) => score >= b.min) || HEALTH_BANDS[HEALTH_BANDS.length - 1];
}

export function calculateBusinessHealthScore(businessData = {}) {
  const sheets = businessData.googleSheets?.summary || {};
  const webEvents = businessData.websiteEvents || [];
  const openWebEvents = webEvents.filter((e) => e.status === "new" || e.status === "reviewed");
  const analytics = extractAnalyticsFromSheets(businessData);
  const approvalRequests = businessData.approvalRequests || [];
  const pendingApprovals = approvalRequests.filter((r) => r.status === "pending");

  let score = 50;
  const factors = [];

  // Positive: revenue and product data present
  if (sheets.topProduct && sheets.topProductRevenue > 0) {
    score += 15;
    factors.push({ label: "Top product with revenue data", delta: +15 });
  }

  if (analytics.ordersToday > 0) {
    score += 10;
    factors.push({ label: `${analytics.ordersToday} orders today`, delta: +10 });
  }

  if (analytics.conversionRate >= 3) {
    score += 10;
    factors.push({ label: `${analytics.conversionRate}% conversion rate`, delta: +10 });
  }

  if (sheets.topProductRevenue >= 200000) {
    score += 10;
    factors.push({ label: "Strong top-product revenue", delta: +10 });
  }

  const issues = sheets.customerIssues || [];
  const customerIssueCount = typeof sheets.customerIssueCount === "number"
    ? sheets.customerIssueCount
    : issues.length;
  if (customerIssueCount <= 1) {
    score += 5;
    factors.push({ label: "Low customer issues", delta: +5 });
  }

  // Negative: risk signals
  const abandonedCheckouts = (analytics.abandonedCheckouts || 0) +
    openWebEvents.filter((e) => e.type === "abandoned_checkout").length;
  if (abandonedCheckouts >= 3) {
    score -= 10;
    factors.push({ label: `${abandonedCheckouts} abandoned checkouts`, delta: -10 });
  }

  const failedPayments = (analytics.failedPayments || 0) +
    openWebEvents.filter((e) => e.type === "failed_payment").length;
  if (failedPayments >= 2) {
    score -= 10;
    factors.push({ label: `${failedPayments} failed payments`, delta: -10 });
  }

  const refundRequests = (analytics.refundRequests || 0) +
    openWebEvents.filter((e) => e.type === "refund_request").length;
  if (refundRequests >= 1) {
    score -= 10;
    factors.push({ label: `${refundRequests} refund request(s)`, delta: -10 });
  }

  const complaints = (analytics.customerComplaints || 0) +
    openWebEvents.filter((e) => e.type === "delivery_complaint").length;
  if (complaints >= 2) {
    score -= 10;
    factors.push({ label: `${complaints} customer complaints`, delta: -10 });
  }

  const lowStockCount = (sheets.lowStockItems || []).length ||
    (typeof sheets.lowStockCount === "number" ? sheets.lowStockCount : 0);
  if (lowStockCount > 0) {
    score -= 10;
    factors.push({ label: `${lowStockCount} low-stock item(s)`, delta: -10 });
  }

  const underperforming = detectUnderperformingProducts(businessData);
  if (underperforming.length > 0) {
    score -= 10;
    factors.push({ label: `${underperforming.length} underperforming product(s)`, delta: -10 });
  }

  // Positive: pending approvals show active engagement
  if (pendingApprovals.length > 0 && pendingApprovals.length <= 3) {
    score += 5;
    factors.push({ label: "Active approval queue", delta: +5 });
  }

  return { factors, score: Math.max(0, Math.min(100, score)) };
}

// ── Revenue Estimation ─────────────────────────────────────

function extractAnalyticsFromSheets(businessData = {}) {
  const sheets = businessData.googleSheets || {};
  const parsed = sheets.parsedRanges || {};

  // Try to find an Analytics tab
  for (const [, rows] of Object.entries(parsed)) {
    for (const row of rows) {
      const keys = Object.keys(row);
      if (keys.some((k) => k.includes("orders_today") || k.includes("orderstoday"))) {
        return {
          abandonedCheckouts: parseNum(row["abandoned_checkouts"] || row["abandonedcheckouts"]),
          averageOrderValue:  parseNum(row["average_order_value"] || row["averageordervalue"] || row["avg_order_value"]),
          conversionRate:     parseNum(row["conversion_rate"] || row["conversionrate"]),
          customerComplaints: parseNum(row["customer_complaints"] || row["customercomplaints"]),
          failedPayments:     parseNum(row["failed_payments"] || row["failedpayments"]),
          ordersToday:        parseNum(row["orders_today"] || row["orderstoday"]),
          refundRequests:     parseNum(row["refund_requests"] || row["refundrequests"]),
          totalRevenue:       parseNum(row["total_revenue"] || row["totalrevenue"]),
        };
      }
    }
  }

  // Fall back to sheet summary
  const s = sheets.summary || {};
  return {
    abandonedCheckouts: s.abandonedCheckouts || 0,
    averageOrderValue:  s.averageOrderValue || 0,
    conversionRate:     s.conversionRate || 0,
    customerComplaints: s.customerComplaints || 0,
    failedPayments:     s.failedPayments || 0,
    ordersToday:        s.ordersToday || 0,
    refundRequests:     s.refundRequests || 0,
    totalRevenue:       s.totalRevenue || 0,
  };
}

function parseNum(value) {
  const n = Number(String(value || "").replace(/[₦,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function estimateMonthlyRevenue(businessData = {}) {
  const analytics = extractAnalyticsFromSheets(businessData);
  const sheets = businessData.googleSheets?.summary || {};
  const webEvents = (businessData.websiteEvents || [])
    .filter((e) => e.status === "new" || e.status === "reviewed");

  let estimate = 0;
  let source = "none";

  // Priority 1: ordersToday * averageOrderValue * 30
  if (analytics.ordersToday > 0 && analytics.averageOrderValue > 0) {
    estimate = analytics.ordersToday * analytics.averageOrderValue * 30;
    source = "daily_run_rate";
  } else if (analytics.totalRevenue > 0) {
    // Priority 2: assume total revenue is roughly monthly
    estimate = analytics.totalRevenue;
    source = "sheet_total_revenue";
  } else if (sheets.totalRevenue > 0) {
    estimate = sheets.totalRevenue;
    source = "sheet_summary";
  } else if (sheets.topProductRevenue > 0) {
    // Priority 3: extrapolate from top product
    estimate = sheets.topProductRevenue * 2.5;
    source = "top_product_extrapolation";
  } else if (webEvents.length > 0) {
    // Priority 4: sum website event values
    estimate = webEvents.reduce((s, e) => s + Number(e.value || 0), 0);
    source = "website_events";
  } else {
    // No data
    return { estimate: 0, source: "insufficient_data" };
  }

  return { estimate: Math.round(estimate), source };
}

function detectUnderperformingProducts(businessData = {}) {
  const parsed = businessData.googleSheets?.parsedRanges || {};
  const result = [];
  for (const [, rows] of Object.entries(parsed)) {
    for (const row of rows) {
      const statusKey = Object.keys(row).find((k) => k.includes("status"));
      if (statusKey && String(row[statusKey] || "").toLowerCase() === "underperforming") {
        const nameKey = Object.keys(row).find((k) => k.includes("product") || k.includes("name") || k.includes("item"));
        if (nameKey && row[nameKey]) result.push(cleanText(row[nameKey]));
      }
    }
  }
  return [...new Set(result)];
}

function detectConfidenceLevel(businessData = {}) {
  const hasSheets = Boolean(businessData.googleSheets?.lastSyncedAt);
  const hasWebEvents = (businessData.websiteEvents || []).length > 0;
  const hasAnalytics = extractAnalyticsFromSheets(businessData).ordersToday > 0;
  if (hasSheets && hasAnalytics) return "medium-high";
  if (hasSheets || (hasWebEvents && hasSheets)) return "medium";
  if (hasWebEvents) return "low-medium";
  return "low";
}

// ── Projection ─────────────────────────────────────────────

export function buildBusinessProjection(businessData = {}) {
  const { score } = calculateBusinessHealthScore(businessData);
  const band = classifyScore(score);
  const { estimate: monthly, source } = estimateMonthlyRevenue(businessData);
  const confidence = detectConfidenceLevel(businessData);

  const projection3m  = Math.round(monthly * 3  * band.growth);
  const projection6m  = Math.round(monthly * 6  * band.growth);
  const projection12m = Math.round(monthly * 12 * band.growth);

  return {
    confidence,
    disclaimer: "This is a directional projection based on current synced data, not a guaranteed forecast.",
    growth: band.growth,
    healthLabel: band.label,
    monthlyEstimate: monthly,
    projection12m,
    projection3m,
    projection6m,
    revenueSource: source,
    score,
  };
}

// ── Advice ─────────────────────────────────────────────────

export function buildBusinessAdvice(businessData = {}) {
  const sheets = businessData.googleSheets?.summary || {};
  const analytics = extractAnalyticsFromSheets(businessData);
  const webEvents = (businessData.websiteEvents || [])
    .filter((e) => e.status === "new" || e.status === "reviewed");
  const underperforming = detectUnderperformingProducts(businessData);
  const advice = [];
  const risks = [];

  // Low stock advice
  const lowStockItems = sheets.lowStockItems || [];
  if (lowStockItems.length > 0) {
    const names = lowStockItems.slice(0, 3).map((i) => cleanText(i.name || i)).join(", ");
    advice.push(`Restock ${names} — inventory is critically low and may block sales.`);
    risks.push(`Low stock on ${lowStockItems.length} item(s) could cause missed sales.`);
  }

  // Top product promotion
  if (sheets.topProduct) {
    const topRev = sheets.topProductRevenue ? ` (₦${fmt(sheets.topProductRevenue)} revenue)` : "";
    advice.push(`Promote ${sheets.topProduct}${topRev} — it is your strongest revenue driver right now.`);
  }

  // Underperforming product advice
  if (underperforming.length > 0) {
    const names = underperforming.slice(0, 2).join(" and ");
    advice.push(`Bundle or discount ${names} with stronger products — ${underperforming.length === 1 ? "it is" : "they are"} underperforming.`);
    risks.push(`Underperforming products are tying up stock and marketing resources.`);
  }

  // Abandoned checkouts
  const abandonedCount = (analytics.abandonedCheckouts || 0) +
    webEvents.filter((e) => e.type === "abandoned_checkout").length;
  if (abandonedCount > 0) {
    const value = webEvents
      .filter((e) => e.type === "abandoned_checkout")
      .reduce((s, e) => s + Number(e.value || 0), 0);
    advice.push(`Follow up on ${abandonedCount} abandoned checkout${abandonedCount === 1 ? "" : "s"}${value > 0 ? ` (₦${fmt(value)} potential recovery)` : ""} — this is recoverable revenue.`);
    risks.push(`${abandonedCount} abandoned checkout${abandonedCount === 1 ? "" : "s"} represent potential lost revenue.`);
  }

  // Failed payments
  const failedCount = (analytics.failedPayments || 0) +
    webEvents.filter((e) => e.type === "failed_payment").length;
  if (failedCount > 0) {
    advice.push(`Recover ${failedCount} failed payment${failedCount === 1 ? "" : "s"} with retry follow-up messages — the customer was ready to buy.`);
    risks.push(`Failed payments reduce realized revenue.`);
  }

  // Refund and complaint risks
  const refundCount = (analytics.refundRequests || 0) +
    webEvents.filter((e) => e.type === "refund_request").length;
  const complaintCount = (analytics.customerComplaints || 0) +
    webEvents.filter((e) => e.type === "delivery_complaint").length;
  if (refundCount > 0 || complaintCount > 0) {
    advice.push(`Address delivery and product-quality issues — ${refundCount} refund request${refundCount === 1 ? "" : "s"} and ${complaintCount} complaint${complaintCount === 1 ? "" : "s"} are hurting trust and cash flow.`);
    risks.push("Refunds and complaints reduce net revenue and damage customer trust.");
  }

  // Bulk/high-value inquiry follow-up
  const highValue = webEvents.filter((e) => e.type === "high_value_inquiry" || e.type === "bulk_order_inquiry");
  if (highValue.length > 0) {
    advice.push(`Follow up on ${highValue.length} high-value or bulk inquiry${highValue.length === 1 ? "" : "ies"} — these may convert into large orders.`);
  }

  // Customer issue follow-up from sheets
  const issueCount = typeof sheets.customerIssueCount === "number"
    ? sheets.customerIssueCount
    : (sheets.customerIssues || []).length;
  if (issueCount > 0 && !risks.some((r) => r.includes("complaint"))) {
    risks.push(`${issueCount} customer issue${issueCount === 1 ? "" : "s"} in your sheet need attention.`);
  }

  // Fallback if no specific advice
  if (advice.length === 0) {
    advice.push("Keep syncing your Google Sheet and website events — more data will unlock sharper recommendations.");
  }
  if (risks.length === 0) {
    risks.push("No major risks detected from available data.");
  }

  return { advice: advice.slice(0, 5), risks: risks.slice(0, 4) };
}

// ── Health Summary ─────────────────────────────────────────

export function buildBusinessHealthSummary(businessData = {}) {
  const { score, factors } = calculateBusinessHealthScore(businessData);
  const band = classifyScore(score);
  const { advice, risks } = buildBusinessAdvice(businessData);
  const projection = buildBusinessProjection(businessData);
  const sheets = businessData.googleSheets?.summary || {};
  const confidence = detectConfidenceLevel(businessData);

  return {
    advice,
    band,
    confidence,
    factors,
    healthLabel: band.label,
    projection,
    risks,
    score,
    topProduct: sheets.topProduct || null,
    topProductRevenue: sheets.topProductRevenue || 0,
  };
}

// ── Spoken Reply Builder ───────────────────────────────────

export function buildHealthReply(businessData = {}) {
  const summary = buildBusinessHealthSummary(businessData);
  const { score, healthLabel, projection, advice, risks, topProduct, topProductRevenue, confidence } = summary;
  const hasProjection = projection.monthlyEstimate > 0;

  let reply = `Your business looks ${healthLabel.toLowerCase()} — health score ${score}/100.`;

  if (topProduct) {
    reply += ` ${topProduct} is your top revenue driver${topProductRevenue > 0 ? ` with ₦${fmt(topProductRevenue)} revenue` : ""}.`;
  }

  if (risks[0] && !risks[0].includes("No major risks")) {
    reply += ` Key risk: ${risks[0]}`;
  }

  if (hasProjection) {
    reply += ` At the current pace, I project approximately ₦${fmt(projection.projection3m)} over 3 months, ₦${fmt(projection.projection6m)} over 6 months, and ₦${fmt(projection.projection12m)} over 1 year.`;
  }

  if (advice[0]) reply += ` I recommend: ${advice[0]}`;

  reply += ` Confidence: ${confidence}. ${projection.disclaimer}`;

  return reply;
}

export function buildProjectionReply(businessData = {}, months = 3) {
  const { score, healthLabel, projection, advice, risks, confidence } = buildBusinessHealthSummary(businessData);
  const projValue = months === 3 ? projection.projection3m
    : months === 6 ? projection.projection6m
    : projection.projection12m;

  if (projection.monthlyEstimate === 0) {
    return `I need more business data to project revenue. Sync your Google Sheet and website events, then ask me again.`;
  }

  let reply = `Business is currently: ${healthLabel} (score ${score}/100).`;
  reply += ` ${months}-month projection: approximately ₦${fmt(projValue)}`;
  if (projection.growth !== 1.0) {
    reply += ` (growth adjustment: ${((projection.growth - 1) * 100).toFixed(0)}%)`;
  }
  reply += `.`;
  if (risks[0] && !risks[0].includes("No major risks")) {
    reply += ` Main risk: ${risks[0]}`;
  }
  if (advice[0]) reply += ` Recommendation: ${advice[0]}`;
  reply += ` Confidence: ${confidence}. ${projection.disclaimer}`;
  return reply;
}

export function buildAdviceReply(businessData = {}, focus = "general") {
  const { advice, risks, score, healthLabel } = buildBusinessHealthSummary(businessData);

  if (focus === "risks") {
    return risks.length > 0 && !risks[0].includes("No major risks")
      ? `These are the main risks for your business right now: ${risks.join(" ")} Your health score is ${score}/100 (${healthLabel}).`
      : `No significant risks detected from available data. Health score: ${score}/100 (${healthLabel}).`;
  }

  if (focus === "products") {
    const sheets = businessData.googleSheets?.summary || {};
    const underperforming = detectUnderperformingProducts(businessData);
    const parts = [];
    if (sheets.topProduct) parts.push(`Double down on ${sheets.topProduct} — it drives the most revenue.`);
    if (underperforming.length > 0) parts.push(`Consider discounting or bundling ${underperforming.slice(0, 2).join(" and ")} — they are underperforming.`);
    if (sheets.lowStockItems?.length > 0) parts.push(`Restock ${sheets.lowStockItems.slice(0, 2).map((i) => i.name || i).join(" and ")} before they block sales.`);
    return parts.length > 0
      ? parts.join(" ")
      : "Sync your Google Sheet for product-level recommendations.";
  }

  // General growth focus
  return advice.length > 0
    ? `Top ${Math.min(3, advice.length)} things to focus on: ${advice.slice(0, 3).join(" ")}`
    : "Sync your Google Sheet and website events for personalised growth recommendations.";
}

// ── Attention Engine helper ────────────────────────────────

export function buildBusinessAttentionSignals(businessData = {}) {
  const { score, healthLabel, projection, advice, risks } = buildBusinessHealthSummary(businessData);

  const signals = [];
  if (score < 65) {
    signals.push({
      priority: score < 50 ? "high" : "medium",
      reason: `Business health score is ${score}/100 — ${healthLabel.toLowerCase()}.`,
      recommendedAction: advice[0] || "Review business risks and take corrective action.",
      score: Math.max(72, 100 - score),
      title: `Business health alert: ${healthLabel}`,
      type: "business_at_risk",
    });
  }

  if (projection.monthlyEstimate > 0) {
    const webEvents = (businessData.websiteEvents || [])
      .filter((e) => e.type === "abandoned_checkout" && (e.status === "new" || e.status === "reviewed"));
    const totalAbandoned = webEvents.reduce((s, e) => s + Number(e.value || 0), 0);
    if (totalAbandoned > 0) {
      signals.push({
        priority: "high",
        reason: "Abandoned checkouts represent immediate revenue recovery opportunity.",
        recommendedAction: `Follow up on abandoned checkouts — ₦${fmt(totalAbandoned)} is recoverable.`,
        score: 88,
        title: `₦${fmt(totalAbandoned)} in abandoned checkouts to recover`,
        type: "revenue_recovery_opportunity",
      });
    }
  }

  const underperforming = detectUnderperformingProducts(businessData);
  if (underperforming.length > 0) {
    signals.push({
      priority: "medium",
      reason: "Underperforming products are reducing business efficiency.",
      recommendedAction: `Bundle or discount ${underperforming[0]} — it is underperforming.`,
      score: 62,
      title: `${underperforming.length} underperforming product${underperforming.length === 1 ? "" : "s"} detected`,
      type: "underperforming_product",
    });
  }

  return signals;
}
