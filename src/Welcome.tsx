import { useState, type FormEvent, type ReactNode } from "react";
import { Logo } from "./ui";

const STEPS: { title: string; body: string; art: ReactNode; colors: [string, string] }[] = [
  {
    title: "Your games, found automatically",
    body: "Hexvane scans Steam, Epic and GOG on this PC and shows every installed game in one place.",
    colors: ["#2e4a0a", "#0b4d45"],
    art: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  },
  {
    title: "Flip a switch, change the game",
    body: "Toggle infinite health, tune game speed with a slider, or bind any cheat to a hotkey. Changes apply while you play.",
    colors: ["#1c2a06", "#3a5508"],
    art: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="2" y="7" width="20" height="10" rx="5" /><circle cx="17" cy="12" r="3" fill="currentColor" /></svg>,
  },
  {
    title: "Single-player only. Always.",
    body: "Hexvane blocks online modes and games with anti-cheat, so your accounts stay safe and other players stay unaffected.",
    colors: ["#0b2a26", "#0b4d45"],
    art: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>,
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div className="split">
      <div className="split-art" style={{ background: `linear-gradient(${s.colors[0]}, ${s.colors[1]})` }}>
        <div className="split-glyph">{s.art}</div>
      </div>
      <div className="split-copy">
        <div className="step-label">STEP {step + 1} OF {STEPS.length}</div>
        <h1 className="split-title">{s.title}</h1>
        <p className="split-body">{s.body}</p>
        <div className="split-nav">
          <div className="dots" aria-hidden="true">{STEPS.map((_, i) => <span key={i} className={i === step ? "on" : ""} />)}</div>
          <button className="btn btn-secondary" onClick={() => (step === 0 ? onDone() : setStep(step - 1))}>{step === 0 ? "Skip" : "Back"}</button>
          <button className="btn btn-primary" onClick={() => (last ? onDone() : setStep(step + 1))}>{last ? "Get started" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sign in / sign up forms. Validates input; there is no account server yet, so a valid submit says so. */
export function Auth({ onGuest }: { onGuest: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [fields, setFields] = useState({ username: "", email: "", password: "", terms: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const signup = mode === "signup";

  const set = (k: keyof typeof fields, v: string | boolean) => {
    setFields({ ...fields, [k]: v });
    setErrors({ ...errors, [k]: "" });
    setNotice(null);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (signup && fields.username.trim().length < 3) next.username = "Use at least 3 characters.";
    if (!EMAIL.test(fields.email.trim())) next.email = "Enter a valid email address.";
    if (fields.password.length < 8) next.password = "Use at least 8 characters.";
    if (signup && !fields.terms) next.terms = "Agree to the terms to continue.";
    setErrors(next);
    // shortcut: no account server yet; replace with a real sign-in/sign-up call when the backend exists
    if (Object.keys(next).length === 0) setNotice("Accounts aren't available yet. Continue as guest for now. Everything works without one.");
  };
  const swap = () => {
    setMode(signup ? "signin" : "signup");
    setErrors({});
    setNotice(null);
  };

  return (
    <div className="split">
      <div className="split-brand" style={{ background: `radial-gradient(circle at 40% 45%, ${signup ? "#0b4d45" : "#2e4a0a"}, #0f120d 70%)` }}>
        <Logo size={48} />
        <h1 className="split-title">{signup ? "100% free. No subscriptions." : "3,000+ single-player games. One app."}</h1>
        <p className="split-body">{signup ? "Every cheat and hotkey is free. If Hexvane helps you, you can support it with a donation." : "Sign in to sync favorites, hotkeys and settings across your PCs."}</p>
      </div>
      <form className="auth-form" onSubmit={submit} noValidate>
        <h1>{signup ? "Create your account" : "Welcome back"}</h1>
        {!signup && <p className="muted" style={{ margin: 0 }}>Sign in to your Hexvane account</p>}
        {signup && <Field label="Username" value={fields.username} error={errors.username} onChange={(v) => set("username", v)} autoComplete="username" />}
        <Field label="Email" type="email" value={fields.email} error={errors.email} onChange={(v) => set("email", v)} autoComplete="email" />
        <Field label={signup ? "Password (8+ characters)" : "Password"} type="password" value={fields.password} error={errors.password} onChange={(v) => set("password", v)} autoComplete={signup ? "new-password" : "current-password"} />
        {signup && (
          <label className="check">
            <input type="checkbox" checked={fields.terms} onChange={(e) => set("terms", e.target.checked)} />
            <span className="check-box" aria-hidden="true" />
            <span>I agree to the <b>Terms of Service</b> and <b>Privacy Policy</b></span>
          </label>
        )}
        {errors.terms && <div className="field-error">{errors.terms}</div>}
        <button className="btn btn-primary" type="submit">{signup ? "Create account" : "Sign in"}</button>
        {notice && <div className="auth-notice" role="status">{notice}</div>}
        <div className="muted" style={{ fontSize: 13 }}>
          {signup ? "Already have an account? " : "New to Hexvane? "}
          <button type="button" className="link" onClick={swap}>{signup ? "Sign in" : "Create an account"}</button>
        </div>
        <button type="button" className="link muted" style={{ alignSelf: "flex-start" }} onClick={onGuest}>Continue as guest</button>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, error, type = "text", autoComplete }: { label: string; value: string; onChange: (v: string) => void; error?: string; type?: string; autoComplete?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className={`input ${error ? "invalid" : ""}`} type={type} value={value} autoComplete={autoComplete} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} />
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
