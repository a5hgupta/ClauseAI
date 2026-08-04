import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Upload, FileText, MessageSquare, Menu, X, Search, Plus, Sun, Moon,
  Send, AlertTriangle, ShieldCheck, ChevronDown, ChevronRight, Loader2,
  Sparkles, LayoutGrid, ClipboardList, GitCompare, Check, Download, Printer, FileDown,
  LayoutDashboard, Star, CalendarClock, Bell, BellRing, Wand2, Lightbulb,
  ArrowRight, CheckCircle2, Clock, Scale, MessageCircle, Gauge, LogOut, CreditCard
} from "lucide-react";
import * as api from "./api.js";
import AuthGate from "./Auth.jsx";
import Billing from "./Billing.jsx";

/* ---------------------------------------------------------
   All contract analysis, chat, comparison, rewrite, and
   benchmark logic now lives server-side (see api.js) — the
   Anthropic API key never reaches the browser. File
   extraction (PDF/DOCX/OCR) also now runs server-side via
   the FastAPI backend's extraction pipeline, which handles
   scanned/image PDFs via OCR that the old client-only demo
   could not.
--------------------------------------------------------- */

/* ---------------------------------------------------------
   ClauseIQ — AI contract explainer
   Token system:
   Color  — bg-dark #0B0D0C, bg-light #FAFAF9, surface-dark #15171A,
            surface-light #FFFFFF, accent green #06C167, accent-dim #0A3B25,
            risk-high #FF5A5A, risk-med #FFB020, risk-low #06C167
   Type   — Inter (display/body), JetBrains Mono (scores, data)
   Layout — sidebar (contract library) + main (overview / chat tabs)
   Signature — semicircular "risk arc" gauge, Uber-style precision numerals
--------------------------------------------------------- */

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');`;

const THEMES = {
  dark: {
    bg: "#0B0D0C",
    surface: "#15171A",
    surface2: "#1C1F22",
    border: "#272B2E",
    text: "#ECEDEE",
    textDim: "#9AA0A6",
    accent: "#06C167",
    accentDim: "#0A3B25",
    riskHigh: "#FF5A5A",
    riskMed: "#FFB020",
    riskLow: "#06C167",
  },
  light: {
    bg: "#FAFAF9",
    surface: "#FFFFFF",
    surface2: "#F2F2F1",
    border: "#E5E5E3",
    text: "#14171A",
    textDim: "#6B7076",
    accent: "#06A75A",
    accentDim: "#DFF6EA",
    riskHigh: "#E33E3E",
    riskMed: "#C9820A",
    riskLow: "#06A75A",
  },
};

function riskColor(score, t) {
  if (score >= 67) return t.riskHigh;
  if (score >= 34) return t.riskMed;
  return t.riskLow;
}
function riskLabel(score) {
  if (score >= 67) return "High";
  if (score >= 34) return "Medium";
  return "Low";
}
function textAtLevel(val, level) {
  if (typeof val === "string") return val;
  if (val && typeof val === "object") return val[level] || val.simple || val.intermediate || val.lawStudent || "";
  return "";
}
function disputeColor(level, t) {
  if (level === "high") return t.riskHigh;
  if (level === "medium") return t.riskMed;
  return t.riskLow;
}

function buildMarkdownReport(contract) {
  const a = contract.analysis || {};
  const lines = [];
  lines.push(`# ${contract.name}`);
  lines.push(`_${a.docType || "Document"} — ClauseIQ AI report_`);
  lines.push("");
  lines.push(`**Overall risk score:** ${a.riskScore ?? "—"}/100 (${riskLabel(a.riskScore ?? 0)} risk)`);
  lines.push("");
  lines.push("## Summary");
  lines.push(textAtLevel(a.summary, "simple") || "—");
  lines.push("");
  lines.push("## Risk by category");
  Object.entries(a.categories || {}).forEach(([k, v]) => {
    if (v) lines.push(`- **${k}:** ${v}/100`);
  });
  lines.push("");
  lines.push("## Flagged clauses");
  (a.clauses || []).forEach((c) => {
    lines.push(`- **[${(c.risk || "").toUpperCase()}] ${c.title}** — ${textAtLevel(c.explanation, "simple")}`);
  });
  lines.push("");
  lines.push("## Obligations");
  (a.obligations || []).forEach((o) => {
    lines.push(`- **${o.party}:** ${o.obligation}`);
  });
  lines.push("");
  if ((a.keyDates || []).length > 0) {
    lines.push("## Key dates");
    a.keyDates.forEach((d) => {
      lines.push(`- **${d.label}${d.date ? ` — ${d.date}` : ""}**${d.note ? `: ${d.note}` : ""}`);
    });
    lines.push("");
  }
  lines.push("---");
  lines.push(
    "_This report provides AI-assisted explanations and educational insights. It is not a law firm and does not provide legal advice. Consult a qualified lawyer before making legal decisions._"
  );
  return lines.join("\n");
}

function downloadMarkdown(contract) {
  const md = buildMarkdownReport(contract);
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${contract.name.replace(/\.[^/.]+$/, "")}-clauseiq-report.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function ArcGauge({ score, t, size = 168 }) {
  const stroke = 14;
  const w = size, h = size * 0.62;
  const color = riskColor(score, t);
  return (
    <div style={{ position: "relative", width: w, height: h + 6 }}>
      <svg width={w} height={h + 6} viewBox={`0 0 ${w} ${h + 6}`}>
        <path
          d={`M ${stroke},${h} A ${w / 2 - stroke},${w / 2 - stroke} 0 0 1 ${w - stroke},${h}`}
          fill="none" stroke={t.surface2} strokeWidth={stroke} strokeLinecap="round"
        />
        <path
          d={`M ${stroke},${h} A ${w / 2 - stroke},${w / 2 - stroke} 0 0 1 ${w - stroke},${h}`}
          fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          pathLength="1" strokeDasharray="1" strokeDashoffset={1 - score / 100}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(.4,0,.2,1)" }}
        />
      </svg>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, textAlign: "center" }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 34, color: t.text, lineHeight: 1 }}>
          {score}
        </div>
        <div style={{ fontSize: 11, color, fontWeight: 600, letterSpacing: 0.4, marginTop: 2 }}>
          {riskLabel(score)} RISK
        </div>
      </div>
    </div>
  );
}

function CategoryBar({ label, value, t }) {
  if (!value) return null;
  const color = riskColor(value, t);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: t.textDim, marginBottom: 4 }}>
        <span style={{ textTransform: "capitalize" }}>{label}</span>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", color: t.text }}>{value}</span>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: t.surface2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: 4, transition: "width 700ms ease" }} />
      </div>
    </div>
  );
}

function ClauseCard({ clause, t, level, bookmarked, onToggleBookmark, rewriteState, onRequestRewrite, notes, onAddNote }) {
  const [open, setOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const color = clause.risk === "high" ? t.riskHigh : clause.risk === "medium" ? t.riskMed : t.riskLow;
  const rw = rewriteState || {};
  const noteList = notes || [];
  return (
    <div style={{ borderLeft: `3px solid ${color}`, background: t.surface2, borderRadius: 12, marginBottom: 8, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, color, textTransform: "uppercase", flexShrink: 0 }}>{clause.risk}</span>
          <span style={{ color: t.text, fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clause.title}</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {noteList.length > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3, color: t.textDim }}>
              <MessageCircle size={13} /> <span style={{ fontSize: 11 }}>{noteList.length}</span>
            </span>
          )}
          {onToggleBookmark && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onToggleBookmark(); }}
              style={{ display: "flex", padding: 3, cursor: "pointer" }}
              title={bookmarked ? "Remove from saved clauses" : "Save this clause"}
            >
              <Star size={15} color={bookmarked ? t.accent : t.textDim} fill={bookmarked ? t.accent : "none"} />
            </span>
          )}
          {open ? <ChevronDown size={16} color={t.textDim} /> : <ChevronRight size={16} color={t.textDim} />}
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px 14px" }}>
          <div style={{ fontSize: 13.5, color: t.textDim, lineHeight: 1.5, marginBottom: 10 }}>
            {textAtLevel(clause.explanation, level)}
          </div>

          {clause.disputeLikelihood && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <Gauge size={14} color={disputeColor(clause.disputeLikelihood, t)} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, color: disputeColor(clause.disputeLikelihood, t), textTransform: "uppercase" }}>
                  {clause.disputeLikelihood} dispute likelihood
                </div>
                {clause.disputeReason && (
                  <div style={{ fontSize: 12.5, color: t.textDim, marginTop: 2, lineHeight: 1.45 }}>{clause.disputeReason}</div>
                )}
              </div>
            </div>
          )}

          {(clause.risk === "high" || clause.risk === "medium") && onRequestRewrite && (
            <>
              {!rw.data && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRequestRewrite(); }}
                  disabled={rw.loading}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, background: "transparent",
                    border: `1px solid ${t.border}`, borderRadius: 9, padding: "7px 11px", fontSize: 12,
                    fontWeight: 600, color: rw.loading ? t.textDim : t.accent, cursor: rw.loading ? "default" : "pointer",
                  }}
                >
                  {rw.loading ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Wand2 size={13} />}
                  {rw.loading ? "Drafting suggestion…" : "Suggest fairer wording"}
                </button>
              )}

              {rw.error && (
                <div style={{ fontSize: 12, color: t.riskHigh, marginTop: 6 }}>{rw.error}</div>
              )}

              {rw.data && (
                <div style={{ marginTop: 4, marginBottom: 10, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, color: t.accent, letterSpacing: 0.4, marginBottom: 6 }}>
                    <Wand2 size={12} /> SUGGESTED REWRITE
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.55, color: t.text, marginBottom: 10 }}>{rw.data.rewrite}</div>
                  {(rw.data.talkingPoints || []).length > 0 && (
                    <>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: t.textDim, letterSpacing: 0.4, marginBottom: 6 }}>
                        TALKING POINTS
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {rw.data.talkingPoints.map((p, i) => (
                          <li key={i} style={{ fontSize: 12.5, color: t.textDim, lineHeight: 1.5, marginBottom: 4 }}>{p}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {onAddNote && (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, color: t.textDim, letterSpacing: 0.4, marginBottom: 8 }}>
                <MessageCircle size={12} /> NOTES
              </div>
              {noteList.map((n, i) => (
                <div key={i} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: "8px 10px", marginBottom: 6 }}>
                  <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{n.text}</div>
                  <div style={{ fontSize: 10.5, color: t.textDim, marginTop: 3 }}>{new Date(n.ts).toLocaleString()}</div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && noteDraft.trim()) { e.preventDefault(); onAddNote(noteDraft.trim()); setNoteDraft(""); }
                  }}
                  placeholder="Add a note for yourself or your team…"
                  style={{ flex: 1, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 9, padding: "8px 10px", color: t.text, fontSize: 12.5, outline: "none" }}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!noteDraft.trim()) return;
                    onAddNote(noteDraft.trim());
                    setNoteDraft("");
                  }}
                  disabled={!noteDraft.trim()}
                  style={{
                    flexShrink: 0, background: noteDraft.trim() ? t.accent : t.surface, color: noteDraft.trim() ? "#06110B" : t.textDim,
                    border: `1px solid ${noteDraft.trim() ? t.accent : t.border}`, borderRadius: 9, padding: "0 12px", fontSize: 12, fontWeight: 600,
                    cursor: noteDraft.trim() ? "pointer" : "default",
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const RESULT_TYPE_LABEL = {
  contract: "Contract",
  summary: "Summary",
  clause: "Clause",
  obligation: "Obligation",
  chat: "Chat",
};

function SmartSearchOverlay({ t, query, setQuery, results, onClose, onSelect }) {
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "12vh 16px 16px 16px" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 620, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 18, boxShadow: "0 20px 60px rgba(0,0,0,0.4)", overflow: "hidden" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: `1px solid ${t.border}` }}>
          <Search size={17} color={t.textDim} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
            placeholder="Search contracts, clauses, obligations, chat…"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: t.text, fontSize: 15 }}
          />
          <button onClick={onClose} style={{ background: "none", border: "none", color: t.textDim, cursor: "pointer", display: "flex" }}>
            <X size={17} />
          </button>
        </div>
        <div style={{ maxHeight: "56vh", overflowY: "auto", padding: 8 }}>
          {query.trim().length < 2 && (
            <div style={{ padding: "24px 14px", textAlign: "center", color: t.textDim, fontSize: 13 }}>
              Type at least 2 characters to search everything in your library.
            </div>
          )}
          {query.trim().length >= 2 && results.length === 0 && (
            <div style={{ padding: "24px 14px", textAlign: "center", color: t.textDim, fontSize: 13 }}>
              No matches for "{query}".
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => onSelect(r)}
              style={{
                width: "100%", textAlign: "left", display: "flex", flexDirection: "column", gap: 3,
                background: "transparent", border: "none", borderRadius: 12, padding: "10px 12px", cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = t.surface2)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, color: t.accent, textTransform: "uppercase", flexShrink: 0 }}>
                  {RESULT_TYPE_LABEL[r.type] || r.type}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
              </div>
              {r.snippet && (
                <div style={{ fontSize: 12.5, color: t.textDim, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.snippet}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClauseIQApp({ onLogout }) {
  const [mode, setMode] = useState("dark");
  const t = THEMES[mode];
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [contracts, setContracts] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [tab, setTab] = useState("overview");
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [search, setSearch] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
  const [compareResult, setCompareResult] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState("");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [dashboardMode, setDashboardMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [explainLevel, setExplainLevel] = useState("simple");
  const [billingOpen, setBillingOpen] = useState(false);
  const fileInputRef = useRef(null);
  const chatEndRef = useRef(null);

  const active = contracts.find((c) => c.id === activeId) || null;

  // Load the user's contract library from the backend on mount. Contracts
  // still mid-pipeline (queued/extracting/analyzing) are included with a
  // null analysis so the sidebar can show them as pending instead of
  // silently omitting them; ready ones come back with their analysis
  // pre-fetched so risk scores show immediately in the sidebar/dashboard.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLibraryLoading(true);
      setLibraryError("");
      try {
        const items = await api.listContracts();
        const withAnalysis = await Promise.all(
          items.map(async (item) => {
            const shell = {
              id: item.id,
              name: item.name,
              analysis: null,
              messages: [],
              chatSessionId: null,
              createdAt: new Date(item.created_at).getTime(),
              reviewed: false,
              bookmarks: [],
              rewrites: {},
              reminders: [],
              clauseNotes: {},
              standardComparison: null,
              pipelineStatus: item.status,
              pipelineDetail: item.status_detail,
            };
            if (item.status === "ready") {
              try {
                const { analysis } = await api.getContractWithAnalysis(item.id);
                shell.analysis = analysis;
              } catch (_) {
                /* analysis fetch failed — leave null, still show the contract */
              }
            }
            return shell;
          })
        );
        if (!cancelled) setContracts(withAnalysis);
      } catch (e) {
        if (!cancelled) setLibraryError(e.message || "Couldn't load your contract library.");
      } finally {
        if (!cancelled) setLibraryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages?.length, chatBusy]);

  const emptyContractShell = (id, name, createdAt) => ({
    id,
    name,
    analysis: null,
    messages: [],
    chatSessionId: null,
    createdAt,
    reviewed: false,
    bookmarks: [],
    rewrites: {},
    reminders: [],
    clauseNotes: {},
    standardComparison: null,
  });

  // Uploads a real File to the backend, which extracts text (with OCR
  // fallback for scanned PDFs/images — something the old client-only demo
  // could never do) and runs AI analysis async, then polls until it's ready.
  const uploadAndTrack = useCallback(async (file, displayName) => {
    setUploadError("");
    setAnalyzing(true);
    try {
      const { id, name, analysis } = await api.uploadAndAnalyze(file, displayName);
      const contract = { ...emptyContractShell(id, name, Date.now()), analysis };
      setContracts((prev) => [contract, ...prev]);
      setActiveId(contract.id);
      setTab("overview");
      setSidebarOpen(false);
      setDashboardMode(false);
    } catch (e) {
      setUploadError("Couldn't analyze this document. " + (e.message || "Please try again."));
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const analyzeAndAdd = useCallback(
    (text, name) => uploadAndTrack(api.textToFile(text, name), name),
    [uploadAndTrack]
  );

  const handleFile = useCallback(
    async (file) => {
      setUploadError("");
      const lower = file.name.toLowerCase();
      if (!/\.(txt|docx|doc|pdf|png|jpe?g)$/.test(lower)) {
        setUploadError(
          `.${lower.split(".").pop()} isn't supported — try .txt, .docx, .pdf, .png, or .jpg, or paste the text below.`
        );
        return;
      }
      await uploadAndTrack(file, file.name);
    },
    [uploadAndTrack]
  );

  // Ensures a chat session exists on the backend for this contract (creating
  // one and loading any prior history the first time a contract is opened).
  const ensureSession = useCallback(async (contract) => {
    if (contract.chatSessionId) return contract.chatSessionId;
    const session = await api.ensureChatSession(contract.id);
    const history = await api.loadChatMessages(session.id);
    setContracts((prev) =>
      prev.map((c) => (c.id === contract.id ? { ...c, chatSessionId: session.id, messages: history } : c))
    );
    return session.id;
  }, []);

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !active || chatBusy) return;
    setChatInput("");
    const userMsg = { role: "user", content: text };
    setContracts((prev) =>
      prev.map((c) => (c.id === active.id ? { ...c, messages: [...c.messages, userMsg] } : c))
    );
    setChatBusy(true);
    const activeId_ = active.id;
    try {
      const sessionId = await ensureSession(active);
      // Add an empty assistant message we'll fill in as deltas stream in.
      setContracts((prev) =>
        prev.map((c) => (c.id === activeId_ ? { ...c, messages: [...c.messages, { role: "assistant", content: "" }] } : c))
      );
      await api.streamChatMessage(sessionId, text, explainLevel, (delta) => {
        setContracts((prev) =>
          prev.map((c) => {
            if (c.id !== activeId_) return c;
            const msgs = [...c.messages];
            const last = msgs[msgs.length - 1];
            msgs[msgs.length - 1] = { ...last, content: last.content + delta };
            return { ...c, messages: msgs };
          })
        );
      });
    } catch (e) {
      setContracts((prev) =>
        prev.map((c) =>
          c.id === activeId_
            ? { ...c, messages: [...c.messages, { role: "assistant", content: "Something went wrong reaching the AI. Please try again." }] }
            : c
        )
      );
    } finally {
      setChatBusy(false);
    }
  }, [chatInput, active, chatBusy, explainLevel, ensureSession]);

  const toggleReviewed = useCallback((id) => {
    setContracts((prev) => prev.map((c) => (c.id === id ? { ...c, reviewed: !c.reviewed } : c)));
  }, []);

  const toggleBookmark = useCallback((contractId, clauseIndex) => {
    setContracts((prev) =>
      prev.map((c) => {
        if (c.id !== contractId) return c;
        const has = c.bookmarks.includes(clauseIndex);
        return { ...c, bookmarks: has ? c.bookmarks.filter((i) => i !== clauseIndex) : [...c.bookmarks, clauseIndex] };
      })
    );
  }, []);

  const requestRewrite = useCallback(async (contract, clauseIndex) => {
    const clause = contract.analysis?.clauses?.[clauseIndex];
    if (!clause?.id) return;
    setContracts((prev) =>
      prev.map((c) =>
        c.id === contract.id
          ? { ...c, rewrites: { ...c.rewrites, [clauseIndex]: { loading: true } } }
          : c
      )
    );
    try {
      const result = await api.suggestFairerWording(clause.id);
      setContracts((prev) =>
        prev.map((c) =>
          c.id === contract.id
            ? { ...c, rewrites: { ...c.rewrites, [clauseIndex]: { loading: false, data: result } } }
            : c
        )
      );
    } catch (e) {
      setContracts((prev) =>
        prev.map((c) =>
          c.id === contract.id
            ? { ...c, rewrites: { ...c.rewrites, [clauseIndex]: { loading: false, error: "Couldn't draft a suggestion. Please try again." } } }
            : c
        )
      );
    }
  }, []);

  const toggleReminder = useCallback((contractId, dateIndex) => {
    setContracts((prev) =>
      prev.map((c) => {
        if (c.id !== contractId) return c;
        const has = c.reminders.includes(dateIndex);
        return { ...c, reminders: has ? c.reminders.filter((i) => i !== dateIndex) : [...c.reminders, dateIndex] };
      })
    );
  }, []);

  const addClauseNote = useCallback((contractId, clauseIndex, text) => {
    setContracts((prev) =>
      prev.map((c) => {
        if (c.id !== contractId) return c;
        const existing = c.clauseNotes?.[clauseIndex] || [];
        return { ...c, clauseNotes: { ...c.clauseNotes, [clauseIndex]: [...existing, { text, ts: Date.now() }] } };
      })
    );
  }, []);

  const requestStandardComparison = useCallback(async (contract) => {
    setContracts((prev) =>
      prev.map((c) => (c.id === contract.id ? { ...c, standardComparison: { loading: true } } : c))
    );
    try {
      const result = await api.benchmarkContract(contract.id);
      setContracts((prev) =>
        prev.map((c) => (c.id === contract.id ? { ...c, standardComparison: { loading: false, data: result } } : c))
      );
    } catch (e) {
      setContracts((prev) =>
        prev.map((c) =>
          c.id === contract.id
            ? { ...c, standardComparison: { loading: false, error: "Couldn't run the comparison. Please try again." } }
            : c
        )
      );
    }
  }, []);

  const toggleCompareId = useCallback((id) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  }, []);

  const runCompare = useCallback(async () => {
    const selected = contracts.filter((c) => compareIds.includes(c.id));
    if (selected.length < 2) return;
    setCompareError("");
    setCompareLoading(true);
    setCompareResult(null);
    try {
      const result = await api.compareContracts(selected.map((c) => c.id));
      setCompareResult({ ...result, names: selected.map((c) => c.name) });
    } catch (e) {
      setCompareError("Couldn't compare these contracts. " + (e.message || "Please try again."));
    } finally {
      setCompareLoading(false);
    }
  }, [contracts, compareIds]);

  const filteredContracts = contracts.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  const searchResults = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const results = [];
    contracts.forEach((c) => {
      if (c.name.toLowerCase().includes(q)) {
        results.push({ type: "contract", contractId: c.id, title: c.name, snippet: c.analysis?.docType || "Contract", tab: "overview" });
      }
      if (textAtLevel(c.analysis?.summary, "simple").toLowerCase().includes(q)) {
        results.push({ type: "summary", contractId: c.id, title: c.name, snippet: textAtLevel(c.analysis.summary, "simple"), tab: "overview" });
      }
      (c.analysis?.clauses || []).forEach((cl, i) => {
        const explSimple = textAtLevel(cl.explanation, "simple");
        if (cl.title.toLowerCase().includes(q) || explSimple.toLowerCase().includes(q)) {
          results.push({ type: "clause", contractId: c.id, title: `${c.name} — ${cl.title}`, snippet: explSimple, tab: "overview", risk: cl.risk });
        }
      });
      (c.analysis?.obligations || []).forEach((o) => {
        if (o.obligation.toLowerCase().includes(q) || o.party.toLowerCase().includes(q)) {
          results.push({ type: "obligation", contractId: c.id, title: `${c.name} — ${o.party}`, snippet: o.obligation, tab: "overview" });
        }
      });
      (c.messages || []).forEach((m) => {
        if (m.content.toLowerCase().includes(q)) {
          results.push({ type: "chat", contractId: c.id, title: `${c.name} — chat`, snippet: m.content, tab: "chat" });
        }
      });
    });
    return results.slice(0, 40);
  }, [searchQuery, contracts]);

  const dashboardStats = React.useMemo(() => {
    const total = contracts.length;
    const pending = contracts.filter((c) => !c.reviewed);
    const avgRisk = total ? Math.round(contracts.reduce((s, c) => s + (c.analysis?.riskScore ?? 0), 0) / total) : 0;
    const savedClauses = [];
    contracts.forEach((c) => {
      (c.bookmarks || []).forEach((idx) => {
        const cl = c.analysis?.clauses?.[idx];
        if (cl) savedClauses.push({ contractId: c.id, contractName: c.name, clause: cl });
      });
    });
    const upcoming = [];
    contracts.forEach((c) => {
      (c.analysis?.keyDates || []).forEach((d, idx) => {
        if (d.date) upcoming.push({ contractId: c.id, contractName: c.name, ...d, reminderOn: (c.reminders || []).includes(idx), dateIndex: idx });
      });
    });
    upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

    const categoryTotals = {};
    contracts.forEach((c) => {
      Object.entries(c.analysis?.categories || {}).forEach(([k, v]) => {
        if (!v) return;
        if (!categoryTotals[k]) categoryTotals[k] = { sum: 0, n: 0 };
        categoryTotals[k].sum += v;
        categoryTotals[k].n += 1;
      });
    });
    let topCategory = null;
    Object.entries(categoryTotals).forEach(([k, v]) => {
      const avg = v.sum / v.n;
      if (!topCategory || avg > topCategory.avg) topCategory = { key: k, avg };
    });

    const highRiskCount = contracts.reduce(
      (s, c) => s + (c.analysis?.clauses || []).filter((cl) => cl.risk === "high").length,
      0
    );

    const recommendations = [];
    if (pending.length > 0) {
      recommendations.push(`${pending.length} contract${pending.length > 1 ? "s" : ""} still ${pending.length > 1 ? "need" : "needs"} a first review — start with the highest risk score.`);
    }
    if (highRiskCount > 0) {
      recommendations.push(`${highRiskCount} high-risk clause${highRiskCount > 1 ? "s" : ""} flagged across your library — try "Suggest fairer wording" on each before signing.`);
    }
    if (topCategory && topCategory.avg >= 40) {
      recommendations.push(`${topCategory.key.charAt(0).toUpperCase() + topCategory.key.slice(1)} risk runs highest across your contracts (avg ${Math.round(topCategory.avg)}/100) — worth a closer look.`);
    }
    if (upcoming.length > 0) {
      recommendations.push(`${upcoming.length} upcoming date${upcoming.length > 1 ? "s" : ""} on the timeline — set reminders so nothing slips.`);
    }
    if (recommendations.length === 0 && total > 0) {
      recommendations.push("Nothing urgent — your library is reviewed and low-risk. Nice work.");
    }

    return { total, pending, avgRisk, savedClauses, upcoming, recommendations, highRiskCount };
  }, [contracts]);

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: t.bg, color: t.text, minHeight: "100vh", display: "flex", position: "relative" }}>
      <style>{FONT_IMPORT}</style>
      <style>{`
        #clauseiq-print-report { position: absolute; left: -9999px; top: 0; width: 720px; }
        @media print {
          body * { visibility: hidden !important; }
          #clauseiq-print-report, #clauseiq-print-report * { visibility: visible !important; }
          #clauseiq-print-report { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>

      {/* Sidebar */}
      <aside
        style={{
          width: 268, flexShrink: 0, background: t.surface, borderRight: `1px solid ${t.border}`,
          display: "flex", flexDirection: "column", position: sidebarOpen ? "fixed" : "relative",
          left: sidebarOpen ? 0 : undefined, top: 0, bottom: 0, zIndex: 40,
          transform: sidebarOpen ? "translateX(0)" : undefined,
        }}
        className={sidebarOpen ? "" : "hidden md:flex"}
      >
        <div style={{ padding: "18px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: t.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ShieldCheck size={16} color="#06110B" strokeWidth={2.5} />
            </div>
            <span style={{ fontWeight: 800, fontSize: 15.5, letterSpacing: -0.2 }}>ClauseIQ</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden" style={{ background: "none", border: "none", color: t.textDim, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: "0 12px" }}>
          <button
            onClick={() => { setActiveId(null); setCompareMode(false); setDashboardMode(false); setUploadError(""); setSidebarOpen(false); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
              background: t.accent, color: "#06110B", border: "none", borderRadius: 12, padding: "10px 12px",
              fontWeight: 700, fontSize: 13.5, cursor: "pointer",
            }}
          >
            <Plus size={16} /> New contract
          </button>
          <button
            onClick={() => {
              setActiveId(null); setDashboardMode(true); setCompareMode(false); setSidebarOpen(false);
            }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
              background: dashboardMode ? t.accentDim : "transparent", color: dashboardMode ? t.accent : t.text,
              border: `1px solid ${dashboardMode ? t.accent : t.border}`, borderRadius: 12,
              padding: "9px 12px", fontWeight: 600, fontSize: 13, cursor: "pointer", marginTop: 8,
            }}
          >
            <LayoutDashboard size={15} /> Dashboard
          </button>
          <button
            onClick={() => {
              setActiveId(null); setCompareMode(true); setDashboardMode(false); setCompareResult(null);
              setCompareIds([]); setCompareError(""); setSidebarOpen(false);
            }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
              background: "transparent", color: t.text, border: `1px solid ${t.border}`, borderRadius: 12,
              padding: "9px 12px", fontWeight: 600, fontSize: 13, cursor: "pointer", marginTop: 8,
            }}
          >
            <GitCompare size={15} /> Compare contracts
          </button>
        </div>

        <div style={{ padding: "14px 12px 6px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.surface2, borderRadius: 10, padding: "8px 10px" }}>
            <Search size={14} color={t.textDim} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contracts"
              style={{ background: "transparent", border: "none", outline: "none", color: t.text, fontSize: 13, width: "100%" }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: t.textDim, letterSpacing: 0.5, padding: "10px 8px 6px 8px" }}>LIBRARY</div>
          {filteredContracts.length === 0 && (
            <div style={{ fontSize: 12.5, color: t.textDim, padding: "0 8px" }}>No contracts yet.</div>
          )}
          {filteredContracts.map((c) => {
            const score = c.analysis?.riskScore ?? 0;
            const isActive = c.id === activeId;
            return (
              <button
                key={c.id}
                onClick={() => { setActiveId(c.id); setTab("overview"); setCompareMode(false); setDashboardMode(false); setSidebarOpen(false); }}
                style={{
                  width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 10px", borderRadius: 10, border: "none", cursor: "pointer", marginBottom: 2,
                  background: isActive ? t.surface2 : "transparent", color: t.text,
                }}
              >
                <FileText size={15} color={t.textDim} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{c.name}</span>
                {!c.reviewed && (
                  <span title="Pending review" style={{ width: 6, height: 6, borderRadius: "50%", background: t.riskMed, flexShrink: 0 }} />
                )}
                <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: riskColor(score, t), flexShrink: 0 }}>{score}</span>
              </button>
            );
          })}
        </div>

        <div style={{ padding: 12, borderTop: `1px solid ${t.border}`, display: "flex", gap: 8 }}>
          <button
            onClick={() => setMode((m) => (m === "dark" ? "light" : "dark"))}
            style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, justifyContent: "center", background: t.surface2, border: "none", borderRadius: 10, padding: "9px 12px", color: t.text, fontSize: 12.5, cursor: "pointer" }}
          >
            {mode === "dark" ? <Sun size={14} /> : <Moon size={14} />} {mode === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            onClick={() => setBillingOpen(true)}
            title="Billing"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", background: t.surface2, border: "none", borderRadius: 10, padding: "9px 12px", color: t.textDim, fontSize: 12.5, cursor: "pointer" }}
          >
            <CreditCard size={14} />
          </button>
          <button
            onClick={onLogout}
            title="Log out"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", background: t.surface2, border: "none", borderRadius: 10, padding: "9px 12px", color: t.textDim, fontSize: 12.5, cursor: "pointer" }}
          >
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      {billingOpen && <Billing t={t} onClose={() => setBillingOpen(false)} />}

      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 30 }} className="md:hidden" />
      )}

      {/* Main */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: `1px solid ${t.border}`, background: t.bg, position: "sticky", top: 0, zIndex: 10 }}>
          <button onClick={() => setSidebarOpen(true)} className="md:hidden" style={{ background: "none", border: "none", color: t.text, cursor: "pointer" }}>
            <Menu size={20} />
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {dashboardMode ? "Dashboard" : compareMode ? "Compare contracts" : active ? active.name : "Understand any contract, instantly"}
            </div>
            {active && !compareMode && !dashboardMode && (
              <div style={{ fontSize: 11.5, color: t.textDim }}>{active.analysis?.docType || "Document"}</div>
            )}
          </div>
          {active && !compareMode && (
            <div style={{ display: "flex", gap: 6, background: t.surface, borderRadius: 10, padding: 3, border: `1px solid ${t.border}` }}>
              {[
                { id: "overview", icon: LayoutGrid, label: "Overview" },
                { id: "timeline", icon: CalendarClock, label: "Timeline" },
                { id: "chat", icon: MessageSquare, label: "Chat" },
              ].map((tb) => (
                <button
                  key={tb.id}
                  onClick={() => setTab(tb.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
                    padding: "6px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                    background: tab === tb.id ? t.accent : "transparent",
                    color: tab === tb.id ? "#06110B" : t.textDim,
                  }}
                >
                  <tb.icon size={14} /> <span className="hidden sm:inline">{tb.label}</span>
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setSearchOpen(true)}
            title="Search everything"
            style={{ display: "flex", alignItems: "center", gap: 6, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: "8px 10px", color: t.text, cursor: "pointer", flexShrink: 0 }}
          >
            <Search size={15} />
          </button>

          {active && !compareMode && (
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setExportMenuOpen((o) => !o)}
                style={{ display: "flex", alignItems: "center", gap: 6, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: "8px 10px", color: t.text, cursor: "pointer" }}
              >
                <Download size={15} />
              </button>
              {exportMenuOpen && (
                <>
                  <div onClick={() => setExportMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 19 }} />
                  <div
                    style={{
                      position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20, minWidth: 200,
                      background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, padding: 6,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                    }}
                  >
                    <button
                      onClick={() => { setExportMenuOpen(false); setTimeout(() => window.print(), 50); }}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "9px 10px", color: t.text, fontSize: 13, cursor: "pointer" }}
                    >
                      <Printer size={14} /> Print / Save as PDF
                    </button>
                    <button
                      onClick={() => { setExportMenuOpen(false); downloadMarkdown(active); }}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, textAlign: "left", background: "transparent", border: "none", borderRadius: 8, padding: "9px 10px", color: t.text, fontSize: 13, cursor: "pointer" }}
                    >
                      <FileDown size={14} /> Download as Markdown
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </header>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {libraryLoading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "70vh", gap: 12 }}>
              <Loader2 size={28} color={t.accent} style={{ animation: "spin 1s linear infinite" }} />
              <div style={{ color: t.textDim, fontSize: 13.5 }}>Loading your contracts…</div>
            </div>
          )}

          {!libraryLoading && libraryError && !active && !compareMode && !dashboardMode && (
            <div style={{ maxWidth: 480, margin: "80px auto", padding: "0 20px", textAlign: "center" }}>
              <AlertTriangle size={24} color={t.riskHigh} style={{ marginBottom: 10 }} />
              <div style={{ color: t.text, fontSize: 14, marginBottom: 4 }}>Couldn't load your contract library</div>
              <div style={{ color: t.textDim, fontSize: 13 }}>{libraryError}</div>
            </div>
          )}

          {!libraryLoading && !libraryError && !active && !analyzing && !compareMode && !dashboardMode && (
            <div style={{ maxWidth: 560, margin: "0 auto", padding: "48px 20px" }}>
              <div style={{ textAlign: "center", marginBottom: 28 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: t.accentDim, color: t.accent, fontSize: 11.5, fontWeight: 700, padding: "5px 12px", borderRadius: 999, marginBottom: 14 }}>
                  <Sparkles size={12} /> AI-assisted, plain-English contract review
                </div>
                <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, margin: 0 }}>Upload a contract to get started</h1>
                <p style={{ color: t.textDim, fontSize: 14, marginTop: 8, lineHeight: 1.5 }}>
                  Get a plain-English summary, a risk score, flagged clauses, and a chat you can ask anything.
                </p>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]); }}
                style={{
                  border: `1.5px dashed ${t.border}`, borderRadius: 18, padding: "36px 20px", textAlign: "center",
                  cursor: "pointer", background: t.surface, marginBottom: 14,
                }}
              >
                <Upload size={26} color={t.accent} style={{ marginBottom: 10 }} />
                <div style={{ fontSize: 14, fontWeight: 600 }}>Drop a .txt, .docx, or .pdf file, or click to browse</div>
                <div style={{ fontSize: 12, color: t.textDim, marginTop: 4 }}>Scanned/image PDFs need OCR, not available in this demo</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.docx,.pdf"
                  onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ""; }}
                  style={{ display: "none" }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0", color: t.textDim, fontSize: 11.5 }}>
                <div style={{ flex: 1, height: 1, background: t.border }} /> OR PASTE TEXT <div style={{ flex: 1, height: 1, background: t.border }} />
              </div>

              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste contract text here…"
                rows={5}
                style={{ width: "100%", resize: "vertical", background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 12, color: t.text, fontSize: 13.5, outline: "none", fontFamily: "inherit" }}
              />
              <button
                disabled={!pasteText.trim()}
                onClick={() => analyzeAndAdd(pasteText, "Pasted contract")}
                style={{
                  marginTop: 10, width: "100%", background: pasteText.trim() ? t.accent : t.surface2,
                  color: pasteText.trim() ? "#06110B" : t.textDim, border: "none", borderRadius: 12, padding: "11px 12px",
                  fontWeight: 700, fontSize: 13.5, cursor: pasteText.trim() ? "pointer" : "default",
                }}
              >
                Analyze contract
              </button>

              {uploadError && (
                <div style={{ display: "flex", gap: 8, marginTop: 14, padding: 12, borderRadius: 12, background: mode === "dark" ? "#2A1414" : "#FDECEC", color: t.riskHigh, fontSize: 13 }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{uploadError}</span>
                </div>
              )}
            </div>
          )}

          {analyzing && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "70vh", gap: 12 }}>
              <Loader2 size={28} color={t.accent} className="animate-spin" style={{ animation: "spin 1s linear infinite" }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ fontSize: 13.5, color: t.textDim }}>Reading clauses, scoring risk…</div>
            </div>
          )}

          {active && !compareMode && tab === "overview" && (
            <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 18px 40px 18px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ display: "flex", gap: 4, background: t.surface, borderRadius: 10, padding: 3, border: `1px solid ${t.border}` }}>
                  {[
                    { id: "simple", label: "Simple" },
                    { id: "intermediate", label: "Intermediate" },
                    { id: "lawStudent", label: "Law student" },
                  ].map((lv) => (
                    <button
                      key={lv.id}
                      onClick={() => setExplainLevel(lv.id)}
                      style={{
                        border: "none", cursor: "pointer", padding: "6px 11px", borderRadius: 8, fontSize: 12,
                        fontWeight: 600, background: explainLevel === lv.id ? t.accent : "transparent",
                        color: explainLevel === lv.id ? "#06110B" : t.textDim,
                      }}
                    >
                      {lv.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => toggleReviewed(active.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, background: active.reviewed ? t.accentDim : t.surface,
                    border: `1px solid ${active.reviewed ? t.accent : t.border}`, borderRadius: 10, padding: "7px 12px",
                    color: active.reviewed ? t.accent : t.textDim, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <CheckCircle2 size={14} /> {active.reviewed ? "Reviewed" : "Mark as reviewed"}
                </button>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 20, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 20, padding: 22, marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "center", flex: "0 0 auto" }}>
                  <ArcGauge score={active.analysis?.riskScore ?? 0} t={t} />
                </div>
                <div style={{ flex: "1 1 220px", minWidth: 220 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: t.textDim, letterSpacing: 0.5, marginBottom: 10 }}>RISK BY CATEGORY</div>
                  {Object.entries(active.analysis?.categories || {}).map(([k, v]) => (
                    <CategoryBar key={k} label={k} value={v} t={t} />
                  ))}
                </div>
              </div>

              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 18, padding: 18, marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: t.textDim, letterSpacing: 0.5, marginBottom: 8 }}>SUMMARY</div>
                <p style={{ fontSize: 14.5, lineHeight: 1.6, margin: 0 }}>{textAtLevel(active.analysis?.summary, explainLevel)}</p>
              </div>

              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: t.textDim, letterSpacing: 0.5, marginBottom: 8, paddingLeft: 2 }}>FLAGGED CLAUSES</div>
                {(active.analysis?.clauses || []).map((cl, i) => (
                  <ClauseCard
                    key={i}
                    clause={cl}
                    t={t}
                    level={explainLevel}
                    bookmarked={(active.bookmarks || []).includes(i)}
                    onToggleBookmark={() => toggleBookmark(active.id, i)}
                    rewriteState={active.rewrites?.[i]}
                    onRequestRewrite={() => requestRewrite(active, i)}
                    notes={active.clauseNotes?.[i]}
                    onAddNote={(text) => addClauseNote(active.id, i, text)}
                  />
                ))}
              </div>

              {(active.analysis?.obligations || []).length > 0 && (
                <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 18, padding: 18, marginBottom: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: t.textDim, letterSpacing: 0.5, marginBottom: 10 }}>
                    <ClipboardList size={13} /> OBLIGATIONS
                  </div>
                  {active.analysis.obligations.map((o, i) => (
                    <div key={i} style={{ fontSize: 13.5, marginBottom: 8, lineHeight: 1.4 }}>
                      <span style={{ fontWeight: 700, color: t.accent }}>{o.party}: </span>
                      <span style={{ color: t.text }}>{o.obligation}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 18, padding: 18, marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: active.standardComparison?.data ? 14 : 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: t.textDim, letterSpacing: 0.5 }}>
                    <Scale size={13} /> INDUSTRY-STANDARD COMPARISON
                  </div>
                  {!active.standardComparison?.data && (
                    <button
                      onClick={() => requestStandardComparison(active)}
                      disabled={active.standardComparison?.loading}
                      style={{
                        display: "flex", alignItems: "center", gap: 6, background: "transparent",
                        border: `1px solid ${t.border}`, borderRadius: 9, padding: "7px 11px", fontSize: 12,
                        fontWeight: 600, color: active.standardComparison?.loading ? t.textDim : t.accent,
                        cursor: active.standardComparison?.loading ? "default" : "pointer", flexShrink: 0,
                      }}
                    >
                      {active.standardComparison?.loading ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Scale size={13} />}
                      {active.standardComparison?.loading ? "Comparing…" : "Compare to industry standard"}
                    </button>
                  )}
                </div>

                {active.standardComparison?.error && (
                  <div style={{ fontSize: 12.5, color: t.riskHigh, marginTop: 10 }}>{active.standardComparison.error}</div>
                )}

                {!active.standardComparison?.data && !active.standardComparison?.loading && !active.standardComparison?.error && (
                  <p style={{ fontSize: 12.5, color: t.textDim, marginTop: 10, lineHeight: 1.5, margin: "10px 0 0 0" }}>
                    See how this contract's terms stack up against what's typically market-standard, based on the AI's general knowledge — not a live legal database.
                  </p>
                )}

                {active.standardComparison?.data && (
                  <>
                    <p style={{ fontSize: 11.5, color: t.textDim, fontStyle: "italic", marginBottom: 12, lineHeight: 1.5 }}>
                      {active.standardComparison.data.disclaimer}
                    </p>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", fontSize: 10.5, color: t.textDim, fontWeight: 700, padding: "0 8px 8px 0", letterSpacing: 0.3 }}>TOPIC</th>
                            <th style={{ textAlign: "left", fontSize: 10.5, color: t.textDim, fontWeight: 700, padding: "0 8px 8px 0", letterSpacing: 0.3 }}>THIS CONTRACT</th>
                            <th style={{ textAlign: "left", fontSize: 10.5, color: t.textDim, fontWeight: 700, padding: "0 0 8px 0", letterSpacing: 0.3 }}>TYPICAL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(active.standardComparison.data.rows || []).map((row, i) => {
                            const flagColor = row.flag === "worse" ? t.riskHigh : row.flag === "better" ? t.riskLow : t.textDim;
                            return (
                              <tr key={i} style={{ borderTop: `1px solid ${t.border}` }}>
                                <td style={{ padding: "8px 8px 8px 0", fontSize: 12.5, fontWeight: 600, color: t.text, borderLeft: `3px solid ${flagColor}`, paddingLeft: 8 }}>
                                  {row.topic}
                                </td>
                                <td style={{ padding: "8px", fontSize: 12, color: t.textDim, lineHeight: 1.4, verticalAlign: "top" }}>{row.thisContract}</td>
                                <td style={{ padding: "8px 0", fontSize: 12, color: t.textDim, lineHeight: 1.4, verticalAlign: "top" }}>{row.typical}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => setTab("chat")}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: t.accent, color: "#06110B", border: "none", borderRadius: 14, padding: "13px 12px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
              >
                <MessageSquare size={16} /> Ask a question about this contract
              </button>
            </div>
          )}

          {active && !compareMode && tab === "timeline" && (
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 18px 40px 18px" }}>
              <div style={{ marginBottom: 18 }}>
                <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, margin: 0 }}>Timeline</h1>
                <p style={{ color: t.textDim, fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
                  Deadlines and key dates ClauseIQ found in this contract. Set a reminder to see it on your Dashboard.
                </p>
              </div>

              {(active.analysis?.keyDates || []).length === 0 && (
                <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 24, textAlign: "center", color: t.textDim, fontSize: 13.5 }}>
                  No dated events found in this contract.
                </div>
              )}

              {[...(active.analysis?.keyDates || [])]
                .map((d, i) => ({ ...d, i }))
                .sort((a, b) => {
                  if (a.date && b.date) return new Date(a.date) - new Date(b.date);
                  if (a.date) return -1;
                  if (b.date) return 1;
                  return 0;
                })
                .map((d) => {
                  const hasReminder = (active.reminders || []).includes(d.i);
                  return (
                    <div
                      key={d.i}
                      style={{
                        display: "flex", gap: 14, alignItems: "flex-start", background: t.surface,
                        border: `1px solid ${t.border}`, borderRadius: 14, padding: 14, marginBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          flexShrink: 0, width: 40, height: 40, borderRadius: 10, background: t.surface2,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        <Clock size={17} color={t.accent} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{d.label}</div>
                        <div style={{ fontSize: 12.5, color: t.textDim, marginTop: 2 }}>
                          {d.date ? new Date(d.date).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "No fixed date"}
                          {d.note ? ` — ${d.note}` : ""}
                        </div>
                      </div>
                      <button
                        onClick={() => toggleReminder(active.id, d.i)}
                        title={hasReminder ? "Remove reminder" : "Set reminder"}
                        style={{
                          flexShrink: 0, display: "flex", alignItems: "center", gap: 6, background: hasReminder ? t.accentDim : "transparent",
                          border: `1px solid ${hasReminder ? t.accent : t.border}`, borderRadius: 9, padding: "7px 10px",
                          color: hasReminder ? t.accent : t.textDim, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        }}
                      >
                        {hasReminder ? <BellRing size={13} /> : <Bell size={13} />}
                        <span className="hidden sm:inline">{hasReminder ? "Reminder set" : "Remind me"}</span>
                      </button>
                    </div>
                  );
                })}
            </div>
          )}

          {active && !compareMode && tab === "chat" && (
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 18px", display: "flex", flexDirection: "column", minHeight: "72vh" }}>
              {active.messages.length === 0 && (
                <div style={{ textAlign: "center", color: t.textDim, fontSize: 13.5, marginTop: 40, marginBottom: 20 }}>
                  Try: "What happens if I terminate early?" · "Is the penalty clause standard?" · "Summarize section 3."
                </div>
              )}
              <div style={{ flex: 1 }}>
                {active.messages.map((m, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 12 }}>
                    <div
                      style={{
                        maxWidth: "82%", padding: "10px 14px", borderRadius: 16,
                        borderBottomRightRadius: m.role === "user" ? 4 : 16,
                        borderBottomLeftRadius: m.role === "user" ? 16 : 4,
                        background: m.role === "user" ? t.accent : t.surface,
                        border: m.role === "user" ? "none" : `1px solid ${t.border}`,
                        color: m.role === "user" ? "#06110B" : t.text,
                        fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap",
                      }}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
                {chatBusy && (
                  <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
                    <div style={{ padding: "10px 14px", borderRadius: 16, background: t.surface, border: `1px solid ${t.border}` }}>
                      <Loader2 size={15} color={t.textDim} style={{ animation: "spin 1s linear infinite" }} />
                      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div style={{ display: "flex", gap: 8, position: "sticky", bottom: 12, marginTop: 12 }}>
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  placeholder="Ask about this contract…"
                  style={{ flex: 1, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "12px 14px", color: t.text, fontSize: 14, outline: "none" }}
                />
                <button
                  onClick={sendChat}
                  disabled={!chatInput.trim() || chatBusy}
                  style={{
                    background: chatInput.trim() && !chatBusy ? t.accent : t.surface2,
                    color: chatInput.trim() && !chatBusy ? "#06110B" : t.textDim,
                    border: "none", borderRadius: 14, width: 46, display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: chatInput.trim() && !chatBusy ? "pointer" : "default",
                  }}
                >
                  <Send size={17} />
                </button>
              </div>
            </div>
          )}

          {dashboardMode && !analyzing && (
            <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 18px 40px 18px" }}>
              <div style={{ marginBottom: 20 }}>
                <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4, margin: 0 }}>Dashboard</h1>
                <p style={{ color: t.textDim, fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
                  A quick look across your whole contract library.
                </p>
              </div>

              {contracts.length === 0 ? (
                <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 24, textAlign: "center", color: t.textDim, fontSize: 13.5 }}>
                  Upload a contract to see your dashboard.
                </div>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
                    {[
                      { label: "Contracts", value: dashboardStats.total },
                      { label: "Avg. risk score", value: dashboardStats.avgRisk },
                      { label: "Pending review", value: dashboardStats.pending.length },
                      { label: "High-risk clauses", value: dashboardStats.highRiskCount },
                    ].map((s) => (
                      <div key={s.label} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: "16px 16px" }}>
                        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 26, fontWeight: 700, color: t.text }}>{s.value}</div>
                        <div style={{ fontSize: 11.5, color: t.textDim, marginTop: 4 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {dashboardStats.recommendations.length > 0 && (
                    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 18, marginBottom: 18 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: t.textDim, letterSpacing: 0.5, marginBottom: 12 }}>
                        <Lightbulb size={13} /> RECOMMENDATIONS
                      </div>
                      {dashboardStats.recommendations.map((r, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, lineHeight: 1.5, marginBottom: 10, color: t.text }}>
                          <Sparkles size={14} color={t.accent} style={{ flexShrink: 0, marginTop: 2 }} />
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {dashboardStats.pending.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: t.textDim, letterSpacing: 0.5, marginBottom: 8, paddingLeft: 2 }}>PENDING REVIEW</div>
                      {dashboardStats.pending.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => { setActiveId(c.id); setTab("overview"); setDashboardMode(false); }}
                          style={{
                            width: "100%", display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                            background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "12px 14px",
                            marginBottom: 8, cursor: "pointer",
                          }}
                        >
                          <FileText size={16} color={t.textDim} style={{ flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 13.5, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                          <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: riskColor(c.analysis?.riskScore ?? 0, t) }}>
                            {c.analysis?.riskScore ?? 0}
                          </span>
                          <ArrowRight size={14} color={t.textDim} />
                        </button>
                      ))}
                    </div>
                  )}

                  {dashboardStats.upcoming.length > 0 && (
                    <div style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: t.textDim, letterSpacing: 0.5, marginBottom: 8, paddingLeft: 2 }}>UPCOMING DATES</div>
                      {dashboardStats.upcoming.slice(0, 8).map((d, i) => (
                        <button
                          key={i}
                          onClick={() => { setActiveId(d.contractId); setTab("timeline"); setDashboardMode(false); }}
                          style={{
                            width: "100%", display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                            background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: "12px 14px",
                            marginBottom: 8, cursor: "pointer",
                          }}
                        >
                          {d.reminderOn ? <BellRing size={15} color={t.accent} style={{ flexShrink: 0 }} /> : <CalendarClock size={15} color={t.textDim} style={{ flexShrink: 0 }} />}
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</div>
                            <div style={{ fontSize: 11.5, color: t.textDim }}>{d.contractName} · {new Date(d.date).toLocaleDateString()}</div>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {dashboardStats.savedClauses.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: t.textDim, letterSpacing: 0.5, marginBottom: 8, paddingLeft: 2 }}>SAVED CLAUSES</div>
                      {dashboardStats.savedClauses.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => { setActiveId(s.contractId); setTab("overview"); setDashboardMode(false); }}
                          style={{
                            width: "100%", textAlign: "left", background: t.surface, border: `1px solid ${t.border}`,
                            borderLeft: `3px solid ${riskColor(s.clause.risk === "high" ? 80 : s.clause.risk === "medium" ? 50 : 10, t)}`,
                            borderRadius: 12, padding: "12px 14px", marginBottom: 8, cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Star size={13} color={t.accent} fill={t.accent} style={{ flexShrink: 0 }} />
                            <span style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>{s.clause.title}</span>
                          </div>
                          <div style={{ fontSize: 12, color: t.textDim, marginTop: 4, marginLeft: 21 }}>{s.contractName}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {compareMode && (
            <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 18px 40px 18px" }}>
              {!compareResult && !compareLoading && (
                <>
                  <div style={{ marginBottom: 20 }}>
                    <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4, margin: 0 }}>Compare contracts</h1>
                    <p style={{ color: t.textDim, fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
                      Pick 2–3 contracts from your library to see changed clauses, missing clauses, new risks, and deadline differences.
                    </p>
                  </div>

                  {contracts.length < 2 ? (
                    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 24, textAlign: "center", color: t.textDim, fontSize: 13.5 }}>
                      Upload at least 2 contracts to compare them.
                    </div>
                  ) : (
                    <>
                      <div style={{ marginBottom: 16 }}>
                        {contracts.map((c) => {
                          const checked = compareIds.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              onClick={() => toggleCompareId(c.id)}
                              style={{
                                width: "100%", display: "flex", alignItems: "center", gap: 12, textAlign: "left",
                                padding: "12px 14px", borderRadius: 14, border: `1px solid ${checked ? t.accent : t.border}`,
                                background: checked ? t.accentDim : t.surface, cursor: "pointer", marginBottom: 8,
                              }}
                            >
                              <div
                                style={{
                                  width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${checked ? t.accent : t.border}`,
                                  background: checked ? t.accent : "transparent", flexShrink: 0,
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                }}
                              >
                                {checked && <Check size={12} color="#06110B" strokeWidth={3} />}
                              </div>
                              <FileText size={15} color={t.textDim} style={{ flexShrink: 0 }} />
                              <span style={{ fontSize: 13.5, flex: 1, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                              <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: riskColor(c.analysis?.riskScore ?? 0, t), flexShrink: 0 }}>
                                {c.analysis?.riskScore ?? 0}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <button
                        disabled={compareIds.length < 2}
                        onClick={runCompare}
                        style={{
                          width: "100%", background: compareIds.length >= 2 ? t.accent : t.surface2,
                          color: compareIds.length >= 2 ? "#06110B" : t.textDim, border: "none", borderRadius: 14,
                          padding: "13px 12px", fontWeight: 700, fontSize: 14, cursor: compareIds.length >= 2 ? "pointer" : "default",
                        }}
                      >
                        Compare{compareIds.length > 0 ? ` (${compareIds.length} selected)` : ""}
                      </button>

                      {compareError && (
                        <div style={{ display: "flex", gap: 8, marginTop: 14, padding: 12, borderRadius: 12, background: mode === "dark" ? "#2A1414" : "#FDECEC", color: t.riskHigh, fontSize: 13 }}>
                          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{compareError}</span>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}

              {compareLoading && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", gap: 12 }}>
                  <Loader2 size={28} color={t.accent} style={{ animation: "spin 1s linear infinite" }} />
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  <div style={{ fontSize: 13.5, color: t.textDim }}>Comparing contracts…</div>
                </div>
              )}

              {compareResult && !compareLoading && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
                    <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3, margin: 0 }}>Comparison</h1>
                    <button
                      onClick={() => { setCompareResult(null); setCompareIds([]); }}
                      style={{ background: t.surface2, border: `1px solid ${t.border}`, borderRadius: 10, padding: "7px 12px", color: t.text, fontSize: 12.5, cursor: "pointer", flexShrink: 0 }}
                    >
                      New comparison
                    </button>
                  </div>

                  <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 16, marginBottom: 18 }}>
                    <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>{compareResult.summary}</p>
                  </div>

                  <div style={{ overflowX: "auto", marginBottom: 18, border: `1px solid ${t.border}`, borderRadius: 16, background: t.surface }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", fontSize: 11, color: t.textDim, fontWeight: 700, padding: "14px 10px 8px 14px", letterSpacing: 0.4 }}>TOPIC</th>
                          {compareResult.names.map((n, i) => (
                            <th key={i} style={{ textAlign: "left", fontSize: 11, color: t.textDim, fontWeight: 700, padding: "14px 14px 8px 10px", letterSpacing: 0.4 }}>
                              {n.length > 20 ? n.slice(0, 20) + "…" : n}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(compareResult.rows || []).map((row, i) => {
                          const flagColor = row.flag === "risk" ? t.riskHigh : row.flag === "favorable" ? t.riskLow : t.textDim;
                          return (
                            <tr key={i} style={{ borderTop: `1px solid ${t.border}` }}>
                              <td style={{ padding: "10px 10px 10px 14px", fontSize: 13, fontWeight: 600, color: t.text, borderLeft: `3px solid ${flagColor}` }}>
                                {row.topic}
                              </td>
                              {(row.values || []).map((v, j) => (
                                <td key={j} style={{ padding: "10px 14px 10px 10px", fontSize: 12.5, color: t.textDim, lineHeight: 1.4, verticalAlign: "top" }}>
                                  {v}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {(compareResult.missing || []).length > 0 && (
                    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, padding: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: t.textDim, letterSpacing: 0.5, marginBottom: 10 }}>MISSING CLAUSES</div>
                      {compareResult.missing.map((m, i) => (
                        <div key={i} style={{ fontSize: 13, marginBottom: 8, lineHeight: 1.5 }}>
                          <span style={{ fontWeight: 700, color: t.text }}>{m.topic}: </span>
                          <span style={{ color: t.textDim }}>
                            present in {(m.presentIn || []).join(", ") || "—"}, missing in {(m.missingIn || []).join(", ") || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ borderTop: `1px solid ${t.border}`, padding: "9px 18px", textAlign: "center", fontSize: 11, color: t.textDim, background: t.bg }}>
          ClauseIQ provides AI-assisted explanations and educational insights. It is not a law firm and does not provide legal advice. Consult a qualified lawyer before making legal decisions.
        </div>
      </main>

      {searchOpen && (
        <SmartSearchOverlay
          t={t}
          query={searchQuery}
          setQuery={setSearchQuery}
          results={searchResults}
          onClose={() => setSearchOpen(false)}
          onSelect={(r) => {
            setActiveId(r.contractId);
            setTab(r.tab || "overview");
            setCompareMode(false);
            setDashboardMode(false);
            setSearchOpen(false);
            setSearchQuery("");
          }}
        />
      )}

      {active && (
        <div id="clauseiq-print-report">
          <div style={{ fontFamily: "Inter, system-ui, sans-serif", color: "#111", padding: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <ShieldCheck size={18} color="#06A75A" />
              <span style={{ fontWeight: 800, fontSize: 15 }}>ClauseIQ</span>
            </div>
            <h1 style={{ fontSize: 22, margin: "10px 0 2px 0" }}>{active.name}</h1>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 18 }}>{active.analysis?.docType || "Document"} — AI-assisted report</div>

            <div style={{ display: "flex", gap: 24, alignItems: "center", border: "1px solid #ddd", borderRadius: 10, padding: 14, marginBottom: 18 }}>
              <div style={{ fontSize: 32, fontWeight: 800 }}>{active.analysis?.riskScore ?? "—"}<span style={{ fontSize: 14, fontWeight: 400, color: "#666" }}>/100</span></div>
              <div style={{ fontSize: 13, color: "#444" }}>Overall risk score — {riskLabel(active.analysis?.riskScore ?? 0)} risk</div>
            </div>

            <h3 style={{ fontSize: 13, letterSpacing: 0.5, color: "#666", textTransform: "uppercase", marginBottom: 6 }}>Summary</h3>
            <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 18 }}>{textAtLevel(active.analysis?.summary, explainLevel)}</p>

            <h3 style={{ fontSize: 13, letterSpacing: 0.5, color: "#666", textTransform: "uppercase", marginBottom: 6 }}>Risk by category</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginBottom: 18 }}>
              <tbody>
                {Object.entries(active.analysis?.categories || {}).filter(([, v]) => v).map(([k, v]) => (
                  <tr key={k} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "6px 4px", textTransform: "capitalize" }}>{k}</td>
                    <td style={{ padding: "6px 4px", textAlign: "right", fontWeight: 700 }}>{v}/100</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 style={{ fontSize: 13, letterSpacing: 0.5, color: "#666", textTransform: "uppercase", marginBottom: 6 }}>Flagged clauses</h3>
            {(active.analysis?.clauses || []).map((c, i) => (
              <div key={i} style={{ borderLeft: "3px solid #888", paddingLeft: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#666" }}>{c.risk}</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{c.title}</div>
                <div style={{ fontSize: 12.5, color: "#444", lineHeight: 1.5 }}>{textAtLevel(c.explanation, explainLevel)}</div>
              </div>
            ))}

            {(active.analysis?.obligations || []).length > 0 && (
              <>
                <h3 style={{ fontSize: 13, letterSpacing: 0.5, color: "#666", textTransform: "uppercase", marginTop: 18, marginBottom: 6 }}>Obligations</h3>
                {active.analysis.obligations.map((o, i) => (
                  <div key={i} style={{ fontSize: 12.5, marginBottom: 6 }}>
                    <strong>{o.party}:</strong> {o.obligation}
                  </div>
                ))}
              </>
            )}

            {(active.analysis?.keyDates || []).length > 0 && (
              <>
                <h3 style={{ fontSize: 13, letterSpacing: 0.5, color: "#666", textTransform: "uppercase", marginTop: 18, marginBottom: 6 }}>Key dates</h3>
                {active.analysis.keyDates.map((d, i) => (
                  <div key={i} style={{ fontSize: 12.5, marginBottom: 6 }}>
                    <strong>{d.label}{d.date ? ` — ${d.date}` : ""}:</strong> {d.note}
                  </div>
                ))}
              </>
            )}

            <div style={{ marginTop: 26, paddingTop: 14, borderTop: "1px solid #ddd", fontSize: 10.5, color: "#777", lineHeight: 1.5 }}>
              This report provides AI-assisted explanations and educational insights. It is not a law firm and does not provide legal advice. Consult a qualified lawyer before making legal decisions.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Top-level export: handles session bootstrap (silently resuming a session
 * from the stored refresh token) and gates the real app behind login/signup
 * until a valid session exists. Kept separate from ClauseIQApp so the theme
 * toggle can be shared between the logged-out and logged-in states without
 * threading auth state through the entire 1700-line component.
 */
export default function ClauseIQ() {
  const [mode, setMode] = useState("dark");
  const [authed, setAuthed] = useState(false);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await api.bootstrapSession();
      if (!cancelled) {
        setAuthed(ok);
        setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const t = THEMES[mode];

  if (booting) {
    return (
      <div
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          background: t.bg,
          color: t.textDim,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Loader2 size={26} color={t.accent} style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  if (!authed) {
    return <AuthGate t={t} mode={mode} setMode={setMode} onAuthed={() => setAuthed(true)} />;
  }

  return (
    <ClauseIQApp
      onLogout={async () => {
        await api.logout();
        setAuthed(false);
      }}
    />
  );
}
