/*
  Thin client for the ClauseIQ FastAPI backend.

  Design notes:
  - The access token lives in memory only (a module-level variable), never in
    localStorage — that's what keeps it out of reach of any XSS in the page.
    The refresh token *does* go in localStorage, because this backend issues
    it as an opaque bearer string in the JSON body (not an httpOnly cookie),
    so there's nowhere more secure to put it client-side without backend
    changes. It's still short-lived-revocable server-side (rotation +
    reuse detection are already implemented in /auth/refresh).
  - Every function here throws a plain Error with a human-readable message on
    failure — components can show `err.message` directly.
  - Field names coming back from the backend are intentionally re-shaped to
    match what the existing ClauseIQ UI already expects (camelCase, the
    3-level `{simple, intermediate, lawStudent}` objects, etc.) so the render
    code in ClauseIQ.jsx does not need to change.
*/

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";
const REFRESH_KEY = "clauseiq_refresh_token";

let accessToken = null;
let refreshing = null; // in-flight refresh promise, so concurrent 401s don't all refresh at once

function getRefreshToken() {
  return localStorage.getItem(REFRESH_KEY);
}
function setRefreshToken(token) {
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}

export function getAccessToken() {
  return accessToken;
}
export function isAuthed() {
  return !!getRefreshToken();
}
export function clearSession() {
  accessToken = null;
  setRefreshToken(null);
}

function setSession({ access_token, refresh_token }) {
  accessToken = access_token;
  if (refresh_token) setRefreshToken(refresh_token);
}

async function parseErrorBody(res) {
  try {
    const data = await res.json();
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((d) => d.msg).join("; ");
    if (data.detail?.length) return String(data.detail);
  } catch (_) {
    /* not JSON */
  }
  return `Request failed (${res.status})`;
}

/**
 * Core fetch wrapper. Attaches the bearer token, and on a 401 transparently
 * tries exactly one refresh-and-retry before giving up (so a normal
 * short-lived access token expiring mid-session doesn't interrupt the user).
 */
async function request(path, { method = "GET", body, isForm = false, headers = {}, retry = true } = {}) {
  const finalHeaders = { ...headers };
  if (accessToken) finalHeaders["Authorization"] = `Bearer ${accessToken}`;
  if (!isForm && body !== undefined) finalHeaders["Content-Type"] = "application/json";

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (res.status === 401 && retry && getRefreshToken()) {
    const ok = await doRefresh();
    if (ok) return request(path, { method, body, isForm, headers, retry: false });
  }

  if (!res.ok) {
    throw new Error(await parseErrorBody(res));
  }
  if (res.status === 204) return null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res;
}

async function doRefresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: getRefreshToken() }),
      });
      if (!res.ok) {
        clearSession();
        return false;
      }
      const data = await res.json();
      setSession(data);
      return true;
    } catch (_) {
      clearSession();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Called once on app boot: if a refresh token is stored, exchange it for a
 * fresh access token so the user doesn't have to log in again every visit. */
export async function bootstrapSession() {
  if (!getRefreshToken()) return false;
  return doRefresh();
}

// ---------------------------------------------------------------- auth ----

export async function signup(email, password, name) {
  const data = await request("/auth/signup", { method: "POST", body: { email, password, name } });
  setSession(data);
  return data;
}

export async function login(email, password) {
  const data = await request("/auth/login", { method: "POST", body: { email, password } });
  setSession(data);
  return data;
}

export async function logout() {
  const token = getRefreshToken();
  try {
    if (token) await request("/auth/logout", { method: "POST", body: { refresh_token: token } });
  } finally {
    clearSession();
  }
}

export function me() {
  return request("/auth/me");
}

export function forgotPassword(email) {
  return request("/auth/forgot-password", { method: "POST", body: { email } });
}

export function resetPassword(token, new_password) {
  return request("/auth/reset-password", { method: "POST", body: { token, new_password } });
}

// ----------------------------------------------------------- contracts ----

function levelText(v) {
  if (v && typeof v === "object") return v;
  const s = v || "";
  return { simple: s, intermediate: s, lawStudent: s };
}

/** Maps a backend AnalysisOut into the shape ClauseIQ.jsx's render code
 * already expects (docType, riskScore, camelCase key dates, etc). */
function mapAnalysis(a) {
  if (!a) return null;
  return {
    docType: a.doc_type || "Document",
    riskScore: a.risk_score,
    summary: levelText(a.summary),
    categories: a.categories || {},
    missingClauses: a.missing_clauses || [],
    obligations: a.obligations || [],
    keyDates: (a.key_dates || []).map((d) => ({ label: d.label, date: d.date, note: d.note })),
    clauses: (a.clauses || []).map((c) => ({
      id: c.id,
      title: c.title,
      category: c.category,
      risk: c.risk_level,
      excerpt: c.excerpt,
      explanation: levelText(c.explanation),
      disputeLikelihood: c.dispute_likelihood || null,
      disputeReason: c.dispute_reason || null,
    })),
  };
}

async function pollAnalysis(contractId, { intervalMs = 1500, timeoutMs = 180000 } = {}) {
  const start = Date.now();
  for (;;) {
    const contract = await request(`/contracts/${contractId}`);
    if (contract.status === "ready") {
      const analysis = await request(`/contracts/${contractId}/analysis`);
      return { contract, analysis: mapAnalysis(analysis) };
    }
    if (contract.status === "failed") {
      throw new Error(contract.status_detail || "Analysis failed");
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("Analysis is taking longer than expected — check back in your library shortly.");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Uploads a File (or a pasted-text blob built by the caller) and waits for
 * the async extraction+analysis pipeline to finish. Returns
 * { id, name, analysis } ready to drop into ClauseIQ's contracts state.
 */
export async function uploadAndAnalyze(file, displayName, onStatus) {
  const form = new FormData();
  form.append("file", file, file.name);
  onStatus?.("uploading");
  const created = await request("/contracts", { method: "POST", body: form, isForm: true });
  onStatus?.("processing");
  const { contract, analysis } = await pollAnalysis(created.id);
  return { id: contract.id, name: displayName || contract.original_filename, analysis };
}

export function textToFile(text, name) {
  const safeName = /\.[^/.]+$/.test(name) ? name : `${name}.txt`;
  return new File([text], safeName.endsWith(".txt") ? safeName : `${name || "pasted-contract"}.txt`, {
    type: "text/plain",
  });
}

export async function listContracts() {
  const data = await request("/contracts?limit=100");
  return data.items;
}

export async function getContractWithAnalysis(contractId) {
  const contract = await request(`/contracts/${contractId}`);
  let analysis = null;
  if (contract.status === "ready") {
    try {
      analysis = mapAnalysis(await request(`/contracts/${contractId}/analysis`));
    } catch (_) {
      analysis = null;
    }
  }
  return { contract, analysis };
}

export function deleteContract(contractId) {
  return request(`/contracts/${contractId}`, { method: "DELETE" });
}

export function rewriteClause(clauseId, tone) {
  return request(`/clauses/${clauseId}/rewrite`, { method: "POST", body: { tone } });
}

export function negotiationSuggestions(clauseId) {
  return request(`/clauses/${clauseId}/negotiation`, { method: "POST", body: {} });
}

/** Combines the backend's separate rewrite + negotiation calls into the
 * single {rewrite, talkingPoints} shape the "Suggest fairer wording" UI
 * already renders. */
export async function suggestFairerWording(clauseId) {
  const [rewrite, negotiation] = await Promise.all([
    rewriteClause(clauseId, "balanced"),
    negotiationSuggestions(clauseId),
  ]);
  return { rewrite: rewrite.rewritten_text, talkingPoints: negotiation.suggestions || [] };
}

export async function compareContracts(contractIds) {
  const result = await request("/contracts/compare", { method: "POST", body: { contract_ids: contractIds } });
  return result; // { summary, rows: [{topic, flag, values}], missing }
}

export function benchmarkContract(contractId) {
  return request(`/contracts/${contractId}/benchmark`, { method: "POST" });
}

// ---------------------------------------------------------------- chat ----

export async function ensureChatSession(contractId) {
  const sessions = await request(`/contracts/${contractId}/chat/sessions`);
  if (sessions.length > 0) return sessions[0];
  return request(`/contracts/${contractId}/chat/sessions`, { method: "POST" });
}

export async function loadChatMessages(sessionId) {
  const msgs = await request(`/chat/sessions/${sessionId}/messages`);
  return msgs.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Streams a chat reply via SSE. Calls onDelta(text) for each chunk and
 * resolves with the full concatenated reply when done. Throws on error.
 */
export async function streamChatMessage(sessionId, message, explainLevel, onDelta) {
  const res = await fetch(`${BASE_URL}/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ message, explain_level: explainLevel }),
  });

  if (res.status === 401 && getRefreshToken()) {
    const ok = await doRefresh();
    if (ok) return streamChatMessage(sessionId, message, explainLevel, onDelta);
  }
  if (!res.ok) throw new Error(await parseErrorBody(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop(); // last chunk may be incomplete
    for (const evt of events) {
      const line = evt.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const payload = JSON.parse(line.slice(6));
      if (payload.error) throw new Error(payload.error);
      if (payload.delta) {
        full += payload.delta;
        onDelta(payload.delta);
      }
    }
  }
  return full;
}

// ------------------------------------------------------------- billing ----

/** Returns { plan, status, current_period_end, cancel_at_period_end }.
 * Defaults to the free plan shape if the user has never touched billing. */
export function getSubscription() {
  return request("/billing/subscription");
}

/** Kicks off Stripe Checkout for the given plan ("pro" | "business") and
 * returns the hosted checkout URL — caller is responsible for redirecting
 * (window.location.href = url), since that's a full-page navigation away
 * from the SPA. */
export async function startCheckout(plan) {
  const { checkout_url } = await request("/billing/checkout", { method: "POST", body: { plan } });
  return checkout_url;
}

/** Opens Stripe's hosted Billing Portal (update card, view invoices, cancel). */
export async function openBillingPortal() {
  const { portal_url } = await request("/billing/portal", { method: "POST" });
  return portal_url;
}
