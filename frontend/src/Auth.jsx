import React, { useState } from "react";
import { ShieldCheck, Loader2, Sun, Moon, AlertTriangle, CheckCircle2 } from "lucide-react";
import * as api from "./api.js";

/**
 * Gate shown before the main ClauseIQ app when there's no valid session.
 * Visually consistent with ClauseIQ.jsx's own theme tokens (passed in as
 * `t`/`mode`/`setMode`) rather than inventing a new style language.
 */
export default function AuthGate({ t, mode, setMode, onAuthed }) {
  const [screen, setScreen] = useState("login"); // login | signup | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (screen === "login") {
        await api.login(email.trim(), password);
        onAuthed();
      } else if (screen === "signup") {
        await api.signup(email.trim(), password, name.trim());
        onAuthed();
      } else if (screen === "forgot") {
        await api.forgotPassword(email.trim());
        setNotice("If that email is registered, a reset link is on its way.");
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    width: "100%",
    background: t.surface2,
    border: `1px solid ${t.border}`,
    borderRadius: 12,
    padding: "11px 13px",
    color: t.text,
    fontSize: 14,
    outline: "none",
    fontFamily: "inherit",
    marginBottom: 10,
  };

  return (
    <div
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        background: t.bg,
        color: t.text,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 22 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: t.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ShieldCheck size={17} color="#06110B" strokeWidth={2.5} />
          </div>
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: -0.3 }}>ClauseIQ</span>
        </div>

        <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 18, padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 4px 0" }}>
            {screen === "login" ? "Log in" : screen === "signup" ? "Create your account" : "Reset your password"}
          </h1>
          <p style={{ fontSize: 13, color: t.textDim, margin: "0 0 18px 0" }}>
            {screen === "login"
              ? "Welcome back — analyze and chat with your contracts."
              : screen === "signup"
              ? "Free to start. Upload a contract to see it in action."
              : "We'll email you a link to set a new password."}
          </p>

          <form onSubmit={submit}>
            {screen === "signup" && (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                required
                style={inputStyle}
              />
            )}
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="Email"
              required
              style={inputStyle}
            />
            {screen !== "forgot" && (
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder={screen === "signup" ? "Password (min 10 characters)" : "Password"}
                required
                minLength={screen === "signup" ? 10 : undefined}
                style={inputStyle}
              />
            )}

            {error && (
              <div style={{ display: "flex", gap: 8, marginBottom: 12, padding: 10, borderRadius: 10, background: mode === "dark" ? "#2A1414" : "#FDECEC", color: t.riskHigh, fontSize: 12.5 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{error}</span>
              </div>
            )}
            {notice && (
              <div style={{ display: "flex", gap: 8, marginBottom: 12, padding: 10, borderRadius: 10, background: t.accentDim, color: t.accent, fontSize: 12.5 }}>
                <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>{notice}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: t.accent,
                color: "#06110B",
                border: "none",
                borderRadius: 12,
                padding: "11px 12px",
                fontWeight: 700,
                fontSize: 14,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.75 : 1,
              }}
            >
              {busy && <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />}
              {screen === "login" ? "Log in" : screen === "signup" ? "Create account" : "Send reset link"}
            </button>
          </form>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontSize: 12.5 }}>
            {screen === "login" ? (
              <>
                <button onClick={() => { setScreen("signup"); setError(""); setNotice(""); }} style={linkStyle(t)}>
                  Create an account
                </button>
                <button onClick={() => { setScreen("forgot"); setError(""); setNotice(""); }} style={linkStyle(t)}>
                  Forgot password?
                </button>
              </>
            ) : (
              <button onClick={() => { setScreen("login"); setError(""); setNotice(""); }} style={linkStyle(t)}>
                Back to login
              </button>
            )}
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button
            onClick={() => setMode((m) => (m === "dark" ? "light" : "dark"))}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: t.textDim, fontSize: 12.5, cursor: "pointer" }}
          >
            {mode === "dark" ? <Sun size={13} /> : <Moon size={13} />} {mode === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </div>
    </div>
  );
}

function linkStyle(t) {
  return { background: "none", border: "none", color: t.accent, fontWeight: 600, cursor: "pointer", padding: 0 };
}
