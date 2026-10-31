import { emitTo, listen } from "@tauri-apps/api/event";
import { LogicalPosition, primaryMonitor } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useState } from "react";

// The toast is its own always-on-top, transparent, click-through window ("toast" in tauri.conf.json), so it shows over
// games without being part of them and works for every game. Exclusive-fullscreen games still hide it.

export const TOAST_SETTING = "toast:position";
export const TOAST_POSITIONS = ["Top left", "Top right", "Bottom left", "Bottom right"];
const WIDTH = 340, HEIGHT = 72, MARGIN = 24, SHOWN_MS = 2000;

interface ToastMessage { text: string; on: boolean }

const position = (): string => {
  try {
    return JSON.parse(localStorage.getItem(TOAST_SETTING) ?? "null") ?? TOAST_POSITIONS[1];
  } catch {
    return TOAST_POSITIONS[1];
  }
};

/** Called from the main window when a hotkey fires. Does nothing when the toast is turned off. */
export function showToast(text: string, on: boolean) {
  if (position() === "Off") return;
  emitTo<ToastMessage>("toast", "toast", { text, on }).catch(() => {});
}

let audio: AudioContext | undefined;
// WebView2 keeps audio muted until the page gets a click, and a global hotkey doesn't count: unlock on the first click.
window.addEventListener("pointerdown", () => { audio ??= new AudioContext(); audio.resume().catch(() => {}); }, { once: true });

/** A short beep, high for on and low for off, unless Settings > Hotkeys > Hotkey sound is off. Same for every game. */
export function playBeep(on: boolean) {
  try {
    if (JSON.parse(localStorage.getItem("toggle:Hotkey sound") ?? "true") === false) return;
    audio ??= new AudioContext();
    audio.resume().catch(() => {});
    const osc = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime;
    osc.frequency.value = on ? 880 : 520;
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09); // fade out so it doesn't click
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.09);
  } catch { /* no audio device: stay silent */ }
}

/** What the toast window renders: nothing, or one message for two seconds. */
export function ToastWindow() {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const [corner, setCorner] = useState(TOAST_POSITIONS[1]);

  useEffect(() => {
    document.documentElement.style.background = document.body.style.background = "transparent";
    let hide: number | undefined;
    const stop = listen<ToastMessage>("toast", async ({ payload }) => {
      // Re-read the corner every time: it lives in shared localStorage and may have changed in Settings.
      const where = position();
      const monitor = await primaryMonitor();
      if (monitor) {
        const scale = monitor.scaleFactor;
        const left = monitor.position.x / scale, top = monitor.position.y / scale;
        const w = monitor.size.width / scale, h = monitor.size.height / scale;
        const x = where.endsWith("left") ? left + MARGIN : left + w - WIDTH - MARGIN;
        const y = where.startsWith("Top") ? top + MARGIN : top + h - HEIGHT - MARGIN;
        await getCurrentWebviewWindow().setPosition(new LogicalPosition(x, y)).catch(() => {});
      }
      setCorner(where);
      setMessage(payload);
      clearTimeout(hide);
      hide = window.setTimeout(() => setMessage(null), SHOWN_MS);
    });
    return () => { stop.then((f) => f()); clearTimeout(hide); };
  }, []);

  const right = corner.endsWith("right"), bottom = corner.startsWith("Bottom");
  return (
    <div className="toast-window" style={{ justifyContent: right ? "flex-end" : "flex-start", alignItems: bottom ? "flex-end" : "flex-start" }}>
      {message && (
        <div className="toast" key={`${message.text}${message.on}${Date.now()}`} role="status">
          <i className={message.on ? "on" : ""} />{message.text}<b>{message.on ? "ON" : "OFF"}</b>
        </div>
      )}
    </div>
  );
}
