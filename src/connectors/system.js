import { connectorAdapters, defaultConnectorRecords } from "./adapters.js";
import { approvalBoundaryFor } from "../agent/tools.js";

function makeLocalId(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16).slice(-6)}`;
}

function ensureArray(data, key) {
  if (!Array.isArray(data[key])) data[key] = [];
  return data[key];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeFingerprintPart(value) {
  return cleanText(value).toLowerCase();
}

function calendarApprovalFingerprint(userId, connectorId, action, payload = {}) {
  if (connectorId !== "google_calendar" || action !== "create_event") return "";
  return [
    userId || "user",
    connectorId,
    action,
    normalizeFingerprintPart(payload.title),
    normalizeFingerprintPart(payload.start),
    normalizeFingerprintPart(payload.end),
    normalizeFingerprintPart(payload.location),
  ].join("|");
}

function isPendingStatus(status) {
  return status === "pending" || status === "needs_approval";
}

function hasMeaningfulValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return cleanText(value) !== "";
  return true;
}

function mergeApprovalPayload(current = {}, payload = {}) {
  const next = { ...current };
  for (const [key, value] of Object.entries(payload)) {
    if (!hasMeaningfulValue(value) && ["location", "title", "start", "end", "timeZone", "subject"].includes(key)) {
      continue;
    }
    if (value !== undefined) next[key] = value;
  }
  return next;
}

function hasUsefulUpdate(existing = {}, payload = {}) {
  const current = existing.payload || {};
  return (
    (hasMeaningfulValue(payload.location) && normalizeFingerprintPart(current.location) !== normalizeFingerprintPart(payload.location)) ||
    (hasMeaningfulValue(payload.title) && normalizeFingerprintPart(current.title) !== normalizeFingerprintPart(payload.title)) ||
    (hasMeaningfulValue(payload.start) && current.start !== payload.start) ||
    (hasMeaningfulValue(payload.end) && current.end !== payload.end) ||
    (hasMeaningfulValue(payload.timeZone) && current.timeZone !== payload.timeZone)
  );
}

function logConnectorAction(data, makeId, action, detail) {
  const logs = ensureArray(data, "actionLogs");
  const entry = {
    action,
    createdAt: new Date().toISOString(),
    detail,
    id: makeId("log"),
  };
  logs.push(entry);
  return entry;
}

function connectorRecords(data, demoMode = false) {
  const existing = ensureArray(data, "connectors");
  if (!existing.length) {
    existing.push(...defaultConnectorRecords({ demoMode }));
  }

  for (const connector of existing) {
    const adapter = connectorAdapters[connector.id];
    if (!adapter) continue;
    connector.capabilities = adapter.capabilities;
    connector.kind = adapter.kind;
    connector.label = adapter.displayName;
    connector.writeActions = adapter.writeActions || [];
  }

  const byId = new Map(existing.map((connector) => [connector.id, connector]));
  for (const record of defaultConnectorRecords({ demoMode })) {
    if (!byId.has(record.id)) {
      existing.push(record);
    }
  }
  return existing;
}

function publicConnector(connector, demoMode = false) {
  const adapter = connectorAdapters[connector.id] || {};
  const realModeConnector = !demoMode && connector.mode === "demo";
  return {
    capabilities: connector.capabilities || [],
    connectedAt: connector.connectedAt || null,
    id: connector.id,
    kind: connector.kind,
    label: connector.label,
    lastSyncAt: connector.lastSyncAt || null,
    mode: realModeConnector ? "not_connected" : connector.mode || "not_connected",
    source: realModeConnector ? "real" : connector.source || (connector.isDemo ? "demo" : "real"),
    status: realModeConnector
      ? (connector.id === "google_calendar" || connector.id === "gmail" || connector.id === "google_sheets" ? "Not connected" : "Coming soon")
      : connector.status || "Not connected",
    writeActions: connector.writeActions || adapter.writeActions || [],
  };
}

export function createConnectorSystem({ businessData, demoMode = false, makeId = makeLocalId, userId = "user" }) {
  const data = businessData || {};

  function listConnectors() {
    const connectors = connectorRecords(data, demoMode).map((connector) => publicConnector(connector, demoMode));
    logConnectorAction(data, makeId, "listConnectors", { count: connectors.length });
    return connectors;
  }

  function getConnector(connectorId) {
    const connector = connectorRecords(data, demoMode).find((item) => item.id === connectorId);
    if (!connector) return null;
    logConnectorAction(data, makeId, "getConnector", { connectorId });
    return publicConnector(connector, demoMode);
  }

  function syncConnector(connectorId) {
    const adapter = connectorAdapters[connectorId];
    const connector = connectorRecords(data, demoMode).find((item) => item.id === connectorId);
    if (!adapter || !connector) return null;
    if (!demoMode && connector.mode !== "real") {
      return {
        connector: publicConnector(connector, demoMode),
        snapshot: {
          highlights: [],
          metrics: {},
          status: "not_connected",
        },
      };
    }

    const snapshot = adapter.read(data);
    connector.lastSyncAt = new Date().toISOString();
    connector.lastSyncSummary = snapshot;
    if (connector.mode === "not_connected") {
      connector.status = demoMode ? "Mock sync only" : connector.status || "Not connected";
    }

    logConnectorAction(data, makeId, "syncConnector", {
      connectorId,
      displayName: adapter.displayName,
      metrics: snapshot.metrics,
      mode: connector.mode,
    });

    return {
      connector: publicConnector(connector, demoMode),
      snapshot,
    };
  }

  function syncAllConnectors() {
    const results = connectorRecords(data, demoMode)
      .filter((connector) => demoMode || connector.mode === "real")
      .map((connector) => syncConnector(connector.id))
      .filter(Boolean);
    logConnectorAction(data, makeId, "syncAllConnectors", { count: results.length });
    return results;
  }

  function previewExternalAction(connectorId, action, payload = {}) {
    const adapter = connectorAdapters[connectorId];
    const connector = connectorRecords(data, demoMode).find((item) => item.id === connectorId);
    if (!adapter || !connector) return null;

    const boundary = approvalBoundaryFor(action);
    const preview = {
      action,
      allowedWithoutApproval: boundary.allowedWithoutApproval,
      connector: publicConnector(connector, demoMode),
      payload,
      requiresApproval: true,
      risk: boundary.requiresApproval
        ? "External side effect requires human approval."
        : "Connector writes are approval-gated in Connector System v1.",
      status: "preview_only",
    };

    logConnectorAction(data, makeId, "previewExternalAction", {
      action,
      connectorId,
      requiresApproval: preview.requiresApproval,
    });
    return preview;
  }

  function requestApproval(connectorId, action, payload = {}) {
    const preview = previewExternalAction(connectorId, action, payload);
    if (!preview) return null;
    const requests = ensureArray(data, "approvalRequests");
    const fingerprint = calendarApprovalFingerprint(userId, connectorId, action, payload);
    if (fingerprint) {
      const same = requests.find(
        (item) =>
          item.connectorId === connectorId &&
          item.action === action &&
          isPendingStatus(item.status) &&
          item.fingerprint === fingerprint,
      );
      if (same) return { ...same, reused: true, status: "pending" };

      const related = requests
        .filter(
          (item) =>
            item.connectorId === connectorId &&
            item.action === action &&
            isPendingStatus(item.status),
        )
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
      if (related && hasUsefulUpdate(related, payload)) {
        related.payload = mergeApprovalPayload(related.payload || {}, payload);
        related.fingerprint = fingerprint;
        related.status = "pending";
        related.subject = cleanText(payload.subject) || related.subject;
        related.updatedAt = new Date().toISOString();
        logConnectorAction(data, makeId, "updateConnectorApproval", {
          action,
          approvalRequestId: related.id,
          connectorId,
        });
        return { ...related, updated: true };
      }
    }
    const request = {
      action,
      connectorId,
      createdAt: new Date().toISOString(),
      fingerprint: fingerprint || undefined,
      id: makeId("approval"),
      isDemo: demoMode && preview.connector.mode === "demo",
      payload,
      reason: preview.risk,
      riskLevel: payload.riskLevel || (connectorId === "google_calendar" && action === "create_event" ? "medium" : "high"),
      source: demoMode && preview.connector.mode === "demo" ? "demo" : "real",
      status: "pending",
      subject:
        cleanText(payload.subject) ||
        `${preview.connector.label} approval: ${action.replaceAll("_", " ")}`,
      type: "connector_action",
    };
    requests.push(request);
    logConnectorAction(data, makeId, "requestConnectorApproval", {
      action,
      approvalRequestId: request.id,
      connectorId,
    });
    return request;
  }

  return {
    getConnector,
    listConnectors,
    previewExternalAction,
    requestApproval,
    syncAllConnectors,
    syncConnector,
  };
}
