import {
  buildBusinessAdvice,
  buildBusinessHealthSummary,
  buildBusinessProjection,
  buildHealthReply,
  buildProjectionReply,
  buildAdviceReply,
  buildBusinessAttentionSignals,
  calculateBusinessHealthScore,
} from "../src/agent/business-projection.js";
import { generateAmandaResponse } from "../src/agent/brain.js";
import { routeIntent } from "../src/agent/intent-router.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── Shared fixtures ────────────────────────────────────────────────────────

function healthyBusinessData() {
  return {
    googleSheets: {
      lastSyncedAt: new Date().toISOString(),
      parsedRanges: {
        "Analytics!A1:F20": [
          { metric: "orders_today",        value: "18" },
          { metric: "average_order_value", value: "69444" },
          { metric: "conversion_rate",     value: "4.8" },
          { metric: "total_revenue",       value: "2090000" },
          { metric: "abandoned_checkouts", value: "1" },
          { metric: "failed_payments",     value: "0" },
          { metric: "refund_requests",     value: "0" },
          { metric: "customer_complaints", value: "0" },
        ],
        "Products!A1:G50": [
          { product_name: "Premium Sneakers Bundle", revenue: "500000", stock: "12", status: "trending" },
          { product_name: "SoundDrop Pro",           revenue: "420000", stock: "8",  status: "normal" },
          { product_name: "HydraSteel Bottle",       revenue: "25000",  stock: "3",  status: "underperforming" },
        ],
        "Inventory!A1:F50": [
          { product: "Leather Backpack", stock: "2", status: "low_stock" },
          { product: "Travel Duffel Bag", stock: "3", status: "low_stock" },
        ],
        "Customer Issues!A1:I50": [],
      },
      summary: {
        topProduct: "Premium Sneakers Bundle",
        topProductRevenue: 500000,
        lowStockItems: [
          { name: "Leather Backpack", stock: 2, revenue: 280000 },
          { name: "Travel Duffel Bag", stock: 3, revenue: 140000 },
        ],
        customerIssues: [],
        totalRevenue: 2090000,
        recommendations: ["Restock Leather Backpack", "Promote Premium Sneakers Bundle"],
      },
    },
    websiteEvents: [],
    approvalRequests: [],
  };
}

function atRiskBusinessData() {
  return {
    googleSheets: {
      lastSyncedAt: new Date().toISOString(),
      summary: {
        topProduct: null,
        topProductRevenue: 0,
        lowStockItems: [
          { name: "Product A", stock: 1 },
          { name: "Product B", stock: 0 },
        ],
        customerIssues: [
          { customer: "Chinedu", issue: "Late delivery", priority: "high" },
          { customer: "Kemi",    issue: "Wrong item",   priority: "high" },
        ],
        customerIssueCount: 2,
        totalRevenue: 100000,
        recommendations: [],
      },
    },
    websiteEvents: [
      { type: "abandoned_checkout", status: "new",  value: 250000, customerName: "Tunde",  priority: "high" },
      { type: "abandoned_checkout", status: "new",  value: 350000, customerName: "Amaka",  priority: "high" },
      { type: "abandoned_checkout", status: "new",  value: 150000, customerName: "Emeka",  priority: "high" },
      { type: "failed_payment",     status: "new",  value: 75000,  customerName: "Mariam", priority: "high" },
      { type: "failed_payment",     status: "new",  value: 120000, customerName: "Ibrahim",priority: "high" },
      { type: "refund_request",     status: "new",  value: 45000,  customerName: "Bola",   priority: "medium" },
      { type: "delivery_complaint", status: "new",  value: 35000,  customerName: "Ngozi",  priority: "high" },
      { type: "delivery_complaint", status: "new",  value: 45000,  customerName: "Funmi",  priority: "high" },
    ],
    approvalRequests: [],
  };
}

function noDataBusiness() {
  return { googleSheets: {}, websiteEvents: [], approvalRequests: [] };
}

// ── Test 1: Healthy business scores well ──────────────────────────────────

function testHealthyScore() {
  // Use a clean fixture with no low stock or underperforming products
  const clean = {
    googleSheets: {
      lastSyncedAt: new Date().toISOString(),
      parsedRanges: {},
      summary: {
        topProduct: "Premium Sneakers Bundle",
        topProductRevenue: 500000,
        lowStockItems: [],
        customerIssues: [],
        customerIssueCount: 0,
        totalRevenue: 2090000,
      },
    },
    websiteEvents: [],
    approvalRequests: [{ id: "a1", status: "pending" }], // pending approval → +5
  };
  const { score } = calculateBusinessHealthScore(clean);
  assert(score >= 65, `Expected clean business score >= 65, got ${score}`);
}

// Data with issues is "stable but exposed" — verify that band too
function testStableButExposedScore() {
  const { score } = calculateBusinessHealthScore(healthyBusinessData());
  assert(score >= 50 && score < 65, `Expected score in stable-but-exposed range (50–64), got ${score}`);
}

// ── Test 2: Low stock reduces score ──────────────────────────────────────

function testLowStockReducesScore() {
  const healthy = calculateBusinessHealthScore(healthyBusinessData()).score;
  const noLowStock = calculateBusinessHealthScore({
    ...healthyBusinessData(),
    googleSheets: { ...healthyBusinessData().googleSheets, summary: { ...healthyBusinessData().googleSheets.summary, lowStockItems: [] } },
  }).score;
  assert(noLowStock > healthy, `Score without low stock (${noLowStock}) should be higher than with low stock (${healthy})`);
}

// ── Test 3: Failed payments and refunds reduce score ─────────────────────

function testRisksReduceScore() {
  const { score } = calculateBusinessHealthScore(atRiskBusinessData());
  const baseScore = calculateBusinessHealthScore(noDataBusiness()).score;
  assert(score < baseScore, `At-risk business (${score}) should score below base (${baseScore})`);
  assert(score < 65, `At-risk business score (${score}) should be below 65`);
}

// ── Test 4: Projection returns 3/6/12-month values ───────────────────────

function testProjectionValues() {
  const data = healthyBusinessData();
  const projection = buildBusinessProjection(data);
  assert(projection.projection3m > 0, "3-month projection should be > 0");
  assert(projection.projection6m > projection.projection3m, "6-month should exceed 3-month");
  assert(projection.projection12m > projection.projection6m, "12-month should exceed 6-month");
  assert(typeof projection.score === "number", "Projection should include score");
  assert(projection.disclaimer.length > 0, "Projection should include disclaimer");
  assert(projection.confidence, "Projection should include confidence level");
}

// ── Test 5: Advice includes low stock recommendation ─────────────────────

function testAdviceLowStock() {
  const { advice } = buildBusinessAdvice(healthyBusinessData());
  const hasLowStockAdvice = advice.some((a) => a.toLowerCase().includes("restock") || a.toLowerCase().includes("stock"));
  assert(hasLowStockAdvice, `Expected low stock advice, got: ${JSON.stringify(advice)}`);
}

// ── Test 6: Advice includes top product recommendation ───────────────────

function testAdviceTopProduct() {
  const { advice } = buildBusinessAdvice(healthyBusinessData());
  const hasTopProductAdvice = advice.some((a) => a.includes("Premium Sneakers Bundle"));
  assert(hasTopProductAdvice, `Expected top product advice mentioning "Premium Sneakers Bundle", got: ${JSON.stringify(advice)}`);
}

// ── Test 7: Voice commands route correctly ────────────────────────────────

function testVoiceRouting() {
  const cases = [
    ["How is my business doing?",                      "business_health"],
    ["Is my business doing well?",                     "business_health"],
    ["Is my business improving or getting worse?",     "business_health"],
    ["Project my business for the next 3 months",      "business_projection_3_months"],
    ["What will my business look like in 6 months?",   "business_projection_6_months"],
    ["Give me a 1 year business projection",           "business_projection_1_year"],
    ["What should I focus on to grow?",                "business_growth_advice"],
    ["What is hurting my business right now?",         "business_risks"],
    ["What products should I double down on?",         "business_focus_products"],
    ["What products should I stop pushing?",           "business_focus_products"],
    ["Business projection",                            "business_projection"],
  ];
  for (const [phrase, expected] of cases) {
    const result = routeIntent(phrase);
    assert(result.intent === expected, `"${phrase}" → expected "${expected}", got "${result.intent}"`);
  }
}

// ── Test 8: Brain does not fall to generic fallback ──────────────────────

function testNotGenericFallback() {
  const result = routeIntent("How is my business doing?");
  assert(result.intent !== "unknown", "Business health should not route to unknown.");
  assert(result.routedTo !== "general.fallback", "Business health should not fall to general.fallback.");
}

// ── Test 9: Reply includes confidence and disclaimer ─────────────────────

function testReplyIncludesDisclaimer() {
  const reply = buildHealthReply(healthyBusinessData());
  assert(reply.toLowerCase().includes("confidence"), `Reply should include confidence: "${reply.slice(0, 120)}"`);
  assert(reply.toLowerCase().includes("projection") || reply.toLowerCase().includes("directional"),
    `Reply should mention projection/directional: "${reply.slice(0, 120)}"`);
}

// ── Test 10: Projection reply uses correct month window ──────────────────

function testProjectionReplyMonths() {
  const data = healthyBusinessData();
  const reply3  = buildProjectionReply(data, 3);
  const reply6  = buildProjectionReply(data, 6);
  const reply12 = buildProjectionReply(data, 12);
  assert(reply3.includes("3-month"),   `3-month reply should say "3-month": ${reply3.slice(0, 80)}`);
  assert(reply6.includes("6-month"),   `6-month reply should say "6-month": ${reply6.slice(0, 80)}`);
  assert(reply12.includes("12-month"), `12-month reply should say "12-month": ${reply12.slice(0, 80)}`);
}

// ── Test 11: Attention engine signals for at-risk business ───────────────

function testAttentionEngineSignals() {
  const atRisk = atRiskBusinessData();
  const signals = buildBusinessAttentionSignals(atRisk);
  assert(signals.some((s) => s.type === "business_at_risk"), "Expected business_at_risk signal.");
  assert(signals.some((s) => s.type === "revenue_recovery_opportunity"), "Expected revenue_recovery_opportunity signal.");

  // Truly clean business (score >= 65) should not trigger business_at_risk
  const cleanBiz = {
    googleSheets: {
      lastSyncedAt: new Date().toISOString(),
      parsedRanges: {},
      summary: { topProduct: "Premium Sneakers Bundle", topProductRevenue: 500000, lowStockItems: [], customerIssues: [], totalRevenue: 2090000 },
    },
    websiteEvents: [],
    approvalRequests: [],
  };
  const cleanSignals = buildBusinessAttentionSignals(cleanBiz);
  assert(!cleanSignals.some((s) => s.type === "business_at_risk"), "Clean high-scoring business should not trigger business_at_risk.");
}

// ── Test 12: No data gracefully returns base score ───────────────────────

function testNoDataGraceful() {
  const { score } = calculateBusinessHealthScore(noDataBusiness());
  assert(score >= 50 && score <= 60, `Empty data should return near-base score (50–60), got ${score}`);
  const reply = buildHealthReply(noDataBusiness());
  assert(reply.length > 20, "Should return a non-empty reply even with no data.");
}

// ── Run all ────────────────────────────────────────────────────────────────

// ── Test 0: Full brain response-level test ────────────────────────────────

async function testBrainResponseNotGeneric() {
  const ctx = {
    message: "How is my business doing?",
    businessData: {
      googleSheets: {
        lastSyncedAt: new Date().toISOString(),
        parsedRanges: {},
        summary: {
          topProduct: "Premium Sneakers Bundle",
          topProductRevenue: 500000,
          lowStockItems: [{ name: "Leather Backpack", stock: 2 }],
          customerIssues: [],
          totalRevenue: 2090000,
        },
      },
      websiteEvents: [],
      approvalRequests: [],
    },
    memory: {},
    settings: {},
    transcripts: [],
    user: { name: "Test User", company: "Test Co" },
    workspace: {},
  };

  const result = await generateAmandaResponse(ctx);

  assert(result.intent === "business_health", `Expected intent=business_health, got "${result.intent}"`);
  assert(result.routedTo === "business.health", `Expected routedTo=business.health, got "${result.routedTo}"`);

  const reply = String(result.reply || "").toLowerCase();
  const GENERIC_FALLBACK = "i understand. based on the recent workspace context";
  assert(!reply.includes(GENERIC_FALLBACK.toLowerCase()), `Brain returned generic fallback reply: "${reply.slice(0, 120)}"`);

  const hasBusinessContent = (
    reply.includes("business") ||
    reply.includes("health") ||
    reply.includes("score") ||
    reply.includes("projection") ||
    reply.includes("confidence") ||
    reply.includes("month")
  );
  assert(hasBusinessContent, `Reply should contain business health content: "${reply.slice(0, 120)}"`);
}

await testBrainResponseNotGeneric();

testHealthyScore();
testStableButExposedScore();
testLowStockReducesScore();
testRisksReduceScore();
testProjectionValues();
testAdviceLowStock();
testAdviceTopProduct();
testVoiceRouting();
testNotGenericFallback();
testReplyIncludesDisclaimer();
testProjectionReplyMonths();
testAttentionEngineSignals();
testNoDataGraceful();

console.log("Business projection tests passed.");
