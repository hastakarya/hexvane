import { useEffect, useRef, useState, type ReactNode } from "react";

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
      {keyLabel && <span className="key">{keyLabel}</span>}
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
      <button className="keybind">{keys}</button>
    </div>
  );
}
