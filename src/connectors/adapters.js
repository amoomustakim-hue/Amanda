function count(items) {
  return Array.isArray(items) ? items.length : 0;
}

function pendingOrders(data) {
  return (data.orders || []).filter(
    (order) => !["delivered", "cancelled", "refunded"].includes(order.status),
  );
}

function unansweredMessages(data) {
  return (data.messages || []).filter(
    (message) => message.needsReply || message.status === "unanswered",
  );
}

function highValueLeads(data) {
  return (data.leads || []).filter((lead) => Number(lead.score || 0) >= 80);
}

export const connectorAdapters = {
  gmail: {
    capabilities: ["read_messages", "classify_emails", "draft_local_replies", "create_gmail_drafts_after_approval"],
    displayName: "Gmail",
    kind: "email",
    read(data) {
      const messages = data.gmailMessages || [];
      const drafts = data.gmailDrafts || [];
      return {
        highlights: messages
          .filter((message) => message.needsReply)
          .slice(0, 3)
          .map((message) => message.subject),
        metrics: {
          draftsWaiting: drafts.filter((draft) => draft.status === "needs_approval").length,
          important: messages.filter((message) => message.priority === "high").length,
          unread: messages.filter((message) => message.status === "unread").length,
        },
      };
    },
    writeActions: ["create_gmail_draft"],
  },
  google_calendar: {
    capabilities: ["read_events", "find_open_windows", "request_event_approval"],
    displayName: "Google Calendar",
    kind: "calendar",
    read(data) {
      return {
        highlights: (data.calendarWindows || []).map((window) => window.label),
        metrics: {
          availableWindows: count(data.calendarWindows),
        },
      };
    },
    writeActions: ["create_event", "update_event", "delete_event"],
  },
  google_sheets: {
    capabilities: ["read_rows", "summarize_sheet", "request_update_approval"],
    displayName: "Google Sheets",
    kind: "spreadsheet",
    read(data) {
      return {
        highlights: [
          `${count(data.customers)} customers`,
          `${count(data.leads)} leads`,
          `${count(data.orders)} orders`,
        ],
        metrics: {
          customers: count(data.customers),
          leads: count(data.leads),
          orders: count(data.orders),
        },
      };
    },
    writeActions: ["append_row", "update_row", "delete_row"],
  },
  shopify: {
    capabilities: ["read_orders", "summarize_orders", "request_refund_approval"],
    displayName: "Shopify",
    kind: "commerce",
    read(data) {
      return {
        highlights: pendingOrders(data).map((order) => `${order.publicId || order.id}: ${order.status}`),
        metrics: {
          pendingOrders: pendingOrders(data).length,
          totalOrders: count(data.orders),
        },
      };
    },
    writeActions: ["refund_order", "cancel_order", "update_fulfillment"],
  },
  whatsapp_business: {
    capabilities: ["read_threads", "draft_message", "request_send_approval"],
    displayName: "WhatsApp Business",
    kind: "messaging",
    read(data) {
      return {
        highlights: unansweredMessages(data)
          .filter((message) => message.channel === "WhatsApp")
          .map((message) => message.subject),
        metrics: {
          unanswered: unansweredMessages(data).filter((message) => message.channel === "WhatsApp").length,
        },
      };
    },
    writeActions: ["send_message"],
  },
  slack: {
    capabilities: ["read_channels", "summarize_threads", "request_message_approval"],
    displayName: "Slack",
    kind: "team_comms",
    read(data) {
      return {
        highlights: (data.tasks || [])
          .filter((task) => task.status === "open")
          .slice(0, 3)
          .map((task) => task.text),
        metrics: {
          openTasks: count(data.tasks),
        },
      };
    },
    writeActions: ["send_message"],
  },
  hubspot: {
    capabilities: ["read_contacts", "read_deals", "request_crm_update_approval"],
    displayName: "HubSpot",
    kind: "crm",
    read(data) {
      return {
        highlights: highValueLeads(data).map((lead) => `${lead.company}: ${lead.stage}`),
        metrics: {
          highValueLeads: highValueLeads(data).length,
          leads: count(data.leads),
        },
      };
    },
    writeActions: ["update_contact", "update_deal", "delete_record"],
  },
  notion: {
    capabilities: ["read_pages", "summarize_docs", "request_page_update_approval"],
    displayName: "Notion",
    kind: "knowledge_base",
    read(data) {
      return {
        highlights: (data.summaries || []).slice(-3).map((summary) => summary.recommendation),
        metrics: {
          summaries: count(data.summaries),
        },
      };
    },
    writeActions: ["create_page", "update_page", "delete_record"],
  },
  airtable: {
    capabilities: ["read_records", "summarize_records", "request_record_update_approval"],
    displayName: "Airtable",
    kind: "database",
    read(data) {
      return {
        highlights: (data.records || []).map((record) => record.note),
        metrics: {
          records: count(data.records),
        },
      };
    },
    writeActions: ["create_record", "update_record", "delete_record"],
  },
  paystack: {
    capabilities: ["read_payments", "summarize_revenue", "request_refund_approval"],
    displayName: "Paystack",
    kind: "payments",
    read(data) {
      const revenue = (data.orders || []).reduce((sum, order) => sum + Number(order.total || 0), 0);
      return {
        highlights: [`${revenue.toLocaleString("en-US")} demo revenue tracked`],
        metrics: {
          revenue,
          transactions: count(data.orders),
        },
      };
    },
    writeActions: ["refund_payment"],
  },
  flutterwave: {
    capabilities: ["read_payments", "summarize_revenue", "request_refund_approval"],
    displayName: "Flutterwave",
    kind: "payments",
    read(data) {
      const highLeads = highValueLeads(data);
      return {
        highlights: highLeads.map((lead) => `${lead.company}: ${lead.value || 0} potential value`),
        metrics: {
          highValueLeads: highLeads.length,
        },
      };
    },
    writeActions: ["refund_payment"],
  },
};

export function defaultConnectorRecords({ demoMode = false } = {}) {
  return Object.entries(connectorAdapters).map(([id, adapter]) => ({
    capabilities: adapter.capabilities,
    connectedAt: null,
    id,
    isDemo: demoMode && !["gmail", "google_calendar", "google_sheets"].includes(id),
    kind: adapter.kind,
    label: adapter.displayName,
    mode: demoMode && !["gmail", "google_calendar", "google_sheets"].includes(id)
      ? "demo"
      : "not_connected",
    source: demoMode && !["gmail", "google_calendar", "google_sheets"].includes(id) ? "demo" : "real",
    status: demoMode && !["gmail", "google_calendar", "google_sheets"].includes(id)
      ? "Demo connector"
      : id === "google_calendar" || id === "gmail" || id === "google_sheets"
        ? "Not connected"
        : "Coming soon",
    writeActions: adapter.writeActions || [],
  }));
}
