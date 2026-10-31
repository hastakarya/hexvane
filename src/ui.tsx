import { Component, useEffect, useRef, useState, type ReactNode } from "react";

/** Shows the error and a reload button instead of a blank window when a screen crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center">
        <h2>Something went wrong on this screen</h2>
        <p className="muted mono" style={{ fontSize: 12 }}>{this.state.error.message}</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}
import { getCurrentWindow } from "@tauri-apps/api/window";
import { COFFEE_PATH } from "./assets/coffee-path";

/** Replaces the white Windows title bar (window decorations are off in tauri.conf.json). */
export function TitleBar({ plain = false }: { plain?: boolean }) {
  const win = getCurrentWindow();
  const icon = (d: string) => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>;
  return (
    <div className={`titlebar ${plain ? "plain" : ""}`} data-tauri-drag-region>
      <button className="titlebar-btn" aria-label="Minimize" onClick={() => win.minimize()}>{icon("M0 5.5h10")}</button>
      <button className="titlebar-btn" aria-label="Maximize" onClick={() => win.toggleMaximize()}>{icon("M.5.5h9v9h-9z")}</button>
      <button className="titlebar-btn close" aria-label="Close" onClick={() => win.close()}>{icon("M0 0l10 10M10 0 0 10")}</button>
    </div>
  );
}

/** An image that removes itself (or shows `fallback`) when missing or broken, so the gradient behind it shows. */
export function Art({ src, className, alt = "", fallback = null }: { src: string | null; className: string; alt?: string; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <>{fallback}</>;
  return <img className={className} src={src} alt={alt} draggable={false} onError={() => setFailed(true)} />;
}

/** Styled replacement for <select>: lime-accented list, closes on outside click and Escape. */
export function Dropdown({ value, options, onChange, label }: { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      <button className={`dropdown-btn ${open ? "open" : ""}`} aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>
        {value}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="dropdown-menu" role="listbox" aria-label={label}>
          {options.map((o) => (
            <button key={o} role="option" aria-selected={o === value} className={`dropdown-item ${o === value ? "selected" : ""}`} onClick={() => { onChange(o); setOpen(false); }}>
              {o}
              {o === value && <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7.5 5.8 10 11 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
      <path fill="var(--lime)" fillRule="evenodd" d="M40 3 L72 21.5 L72 58.5 L40 77 L8 58.5 L8 21.5 Z M40 10 L13.5 25.3 L13.5 54.7 L40 70 L66.5 54.7 L66.5 25.3 Z" />
      <path fill="var(--lime)" d="M26 22 H34 V38 L46 35 V22 H54 V58 H46 V44 L34 47 V58 H26 Z" />
    </svg>
  );
}

/** Flat one-colour coffee cup, the exact shape from the design (the ☕ emoji renders in colour on Windows). */
export function CoffeeIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size * 0.725} height={size} viewBox="3 3 29 40" aria-hidden="true" style={{ flex: "none" }}>
      <path d={COFFEE_PATH} fill={color} />
    </svg>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function ToggleRow({ title, desc, initial = true, keyLabel }: { title: string; desc?: string; initial?: boolean; keyLabel?: string }) {
  const [on, setOn] = useState(initial);
  return (
    <div className="row">
      <div className="row-title">
        {title}
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      {/* shortcut: cheat hotkeys are stored per cheat name, shared by all games; key them by game once real cheats exist */}
      {keyLabel && <HotkeyButton className="key" storageKey={`hotkey:cheat:${title}`} initial={keyLabel} label={title} />}
      <Toggle on={on} onChange={setOn} label={title} />
    </div>
  );
}

export function SliderRow({ name, min, max, step, value, unit }: { name: string; min: number; max: number; step: number; value: number; unit: string }) {
  const [v, setV] = useState(value);
  const shown = step < 1 ? v.toFixed(1) : v.toLocaleString();
  return (
    <div className="row">
      <div className="row-title">{name}</div>
      <input className="slider" type="range" min={min} max={max} step={step} value={v} onChange={(e) => setV(Number(e.target.value))} aria-label={name} />
      <span className="slider-value">{shown}{unit}</span>
    </div>
  );
}

export function SelectRow({ title, desc, options }: { title: string; desc: string; options: string[] }) {
  const [value, setValue] = useState(options[0]);
  return (
    <div className="row">
      <div className="row-title">
        {title}
        <div className="setting-desc">{desc}</div>
      </div>
      <Dropdown value={value} options={options} onChange={setValue} label={title} />
    </div>
  );
}

export function KeyRow({ title, desc, keys }: { title: string; desc: string; keys: string }) {
  return (
    <div className="row">
      <div className="row-title">
        {title}
        <div className="setting-desc">{desc}</div>
      </div>
      <HotkeyButton className="keybind" storageKey={`hotkey:${title}`} initial={keys} label={title} />
    </div>
  );
}

/** useState that survives restarts via localStorage; falls back to plain state if storage is unavailable. */
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? initial : (JSON.parse(saved) as T);
    } catch {
      return initial;
    }
  });
  const set = (next: T) => {
    setValue(next);
    try {
      next === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(next));
    } catch { /* storage full or blocked: keep the in-memory value */ }
  };
  return [value, set] as const;
}

const MODIFIERS = ["Control", "Shift", "Alt", "Meta"];

/** "Ctrl + Shift + R" style label for a key press, or null while only modifiers are held. */
export function comboFromEvent(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey">): string | null {
  if (MODIFIERS.includes(e.key)) return null;
  const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", key].filter(Boolean).join(" + ");
}

/** Click, then press a key combination to rebind. Escape cancels. */
export function HotkeyButton({ storageKey, initial, className, label }: { storageKey: string; initial: string; className: string; label: string }) {
  const [keys, setKeys] = useStored(storageKey, initial);
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setListening(false);
      const combo = comboFromEvent(e);
      if (combo) {
        setKeys(combo);
        setListening(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [listening]);
  return (
    <button className={`${className} ${listening ? "listening" : ""}`} aria-label={`${label} hotkey: ${keys}. Click to change.`} onClick={() => setListening(true)} onBlur={() => setListening(false)}>
      {listening ? "Press keys…" : keys}
    </button>
  );
}

/** Profile picture: the user's image if set, otherwise the Hex H logo. */
export function Avatar({ src, size = 32 }: { src: string | null; size?: number }) {
  return (
    <div className="avatar" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" /> : <Logo size={Math.round(size * 0.7)} />}
    </div>
  );
}
