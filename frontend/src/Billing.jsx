import React, { useEffect, useState } from "react";
import { X, CreditCard, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import * as api from "./api.js";

const PLANS = [
  {
    id: "pro",
    name: "Pro",
    price: "$19/mo",
    features: ["Unlimited contract uploads", "Full risk analysis + chat", "Clause rewrite & negotiation help"],
  },
  {
    id: "business",
    name: "Business",
    price: "$49/mo",
    features: ["Everything in Pro", "Contract comparison & benchmarking", "Priority processing"],
  },
];

/**
 * Self-contained billing modal: shows current plan, lets a free user start
 * Stripe Checkout for Pro/Business, and gives a paying user a link into
 * Stripe's hosted Billing Portal (upgrade/downgrade/cancel/invoices — we
 * don't build any of that UI ourselves, Stripe hosts it).
 */
export default function Billing({ t, onClose }) {
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyPlan, setBusyPlan] = useState(null); // which plan's button is mid-request
  const [portalBusy, setPortalBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getSubscription();
        if (!cancelled) setSub(data);
      } catch (e) {
        if (!cancelled) setError(e.message || "Could not load billing status");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUpgrade(planId) {
    setError("");
    setBusyPlan(planId);
    try {
      const url = await api.startCheckout(planId);
      window.location.href = url;
    } catch (e) {
      setError(e.message || "Could not start checkout");
      setBusyPlan(null);
    }
  }

  async function handleManage() {
    setError("");
    setPortalBusy(true);
    try {
      const url = await api.openBillingPortal();
      window.location.href = url;
    } catch (e) {
      setError(e.message || "Could not open billing portal");
      setPortalBusy(false);
    }
  }

  const currentPlan = sub?.plan || "free";

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 16, width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <CreditCard size={18} color={t.accent} />
            <span style={{ fontSize: 16, fontWeight: 700, color: t.text }}>Billing</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: t.textDim, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: t.textDim, fontSize: 13, padding: "20px 0" }}>
              <Loader2 size={16} className="animate-spin" /> Loading billing status…
            </div>
          ) : (
            <>
              {error && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.riskHigh + "1A", color: t.riskHigh, borderRadius: 10, padding: "10px 12px", fontSize: 12.5, marginBottom: 16 }}>
                  <AlertTriangle size={14} /> {error}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: t.surface2, borderRadius: 12, padding: "12px 16px", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>Current plan</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: t.text, textTransform: "capitalize" }}>
                    {currentPlan}
                    {sub?.status && sub.status !== "active" && (
                      <span style={{ fontSize: 11, fontWeight: 500, color: t.riskMed, marginLeft: 8, textTransform: "none" }}>({sub.status})</span>
                    )}
                  </div>
                  {sub?.current_period_end && (
                    <div style={{ fontSize: 11.5, color: t.textDim, marginTop: 2 }}>
                      {sub.cancel_at_period_end ? "Cancels" : "Renews"} {new Date(sub.current_period_end).toLocaleDateString()}
                    </div>
                  )}
                </div>
                {currentPlan !== "free" && (
                  <button
                    onClick={handleManage}
                    disabled={portalBusy}
                    style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, padding: "8px 14px", color: t.text, fontSize: 12.5, cursor: portalBusy ? "default" : "pointer" }}
                  >
                    {portalBusy ? "Opening…" : "Manage subscription"}
                  </button>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {PLANS.map((plan) => {
                  const isCurrent = currentPlan === plan.id;
                  return (
                    <div key={plan.id} style={{ border: `1px solid ${isCurrent ? t.accent : t.border}`, borderRadius: 12, padding: 16 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{plan.name}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: t.text, margin: "4px 0 12px" }}>{plan.price}</div>
                      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                        {plan.features.map((f) => (
                          <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: t.textDim }}>
                            <CheckCircle2 size={13} color={t.accent} style={{ flexShrink: 0, marginTop: 1 }} /> {f}
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() => handleUpgrade(plan.id)}
                        disabled={isCurrent || busyPlan === plan.id}
                        style={{
                          width: "100%", padding: "9px 12px", borderRadius: 10, border: "none",
                          background: isCurrent ? t.surface2 : t.accent,
                          color: isCurrent ? t.textDim : "#08110C",
                          fontSize: 12.5, fontWeight: 700, cursor: isCurrent ? "default" : "pointer",
                        }}
                      >
                        {isCurrent ? "Current plan" : busyPlan === plan.id ? "Redirecting…" : `Upgrade to ${plan.name}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
