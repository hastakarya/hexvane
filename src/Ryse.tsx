import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { Game } from "./games";
import { CheatToggle, type Hotkey } from "./Trainer";

// Ryse: Son of Rome has no mod loader; the Rust side (src-tauri/src/ryse.rs) patches its memory directly,
// and only in campaign levels.

interface RyseState { running: boolean; level: string | null; allowed: boolean; undead: boolean; valor: number | null; error: string | null }
type Cheat = "undead";

export const isRyse = (g: Game) => g.name.toLowerCase().startsWith("ryse");
export const ryseState = (installDir: string) => invoke<RyseState>("ryse_state", { installDir });
const setCheat = (installDir: string, cheat: Cheat, on: boolean) => invoke<RyseState>("ryse_set", { installDir, cheat, on });
const addValor = (installDir: string, amount: number) => invoke<RyseState>("ryse_add_valor", { installDir, amount });

const KEYS: Record<Cheat, { storageKey: string; initial: string }> = {
  undead: { storageKey: "hotkey:ryse:undead", initial: "F7" },
};

const toggle = (dir: string, cheat: Cheat) => async () => (await setCheat(dir, cheat, !(await ryseState(dir))[cheat]))[cheat];
export const ryseHotkeys = (dir: string): Hotkey[] => [
  { cheat: "undead", title: "Undead", ...KEYS.undead, fire: toggle(dir, "undead") },
  { cheat: "panic", title: "All cheats", storageKey: "hotkey:Disable all cheats", initial: "Ctrl + F12", fire: () => invoke("ryse_off", { installDir: dir }).then(() => false) },
];

const LEVEL_NAMES: Record<string, string> = { palace: "Palace", forum: "Forum", dover: "Dover", oswald: "Oswald", glott: "Glott", york: "York", rome: "Rome" };

export function RyseTrainer({ game }: { game: Game }) {
  const dir = game.installDir;
  const [state, setState] = useState<RyseState | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    const refresh = () => ryseState(dir).then(setState).catch(() => setState(null));
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [dir]);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(id);
  }, [message]);

  const run = (action: Promise<RyseState>, done?: string) =>
    action.then((s) => { setState(s); if (done) setMessage({ text: done, error: false }); }, (e) => setMessage({ text: String(e), error: true }));

  const ready = !!state?.allowed;
  return (
    <div className="detail-body">
      <div className="cheats">
        <div className="section-label">PLAYER</div>
        <CheatToggle title="Undead" hotkey={KEYS.undead} value={state?.undead} detail="Health still drops, but never to zero" disabled={!ready} onChange={(on) => run(setCheat(dir, "undead", on))} />

        <div className="section-label">VALOR</div>
        <div className="row">
          <div className="row-title">
            Add valor
            <div className="setting-desc">
              {!ready ? "Available in campaign levels." : state!.valor === null ? "Open the upgrade menu in the game once to unlock this." : `You have ${state!.valor.toLocaleString()} valor to spend`}
            </div>
          </div>
          {[1000, 10000, 100000].map((n) => (
            <button key={n} className="btn btn-secondary btn-sm" disabled={!ready || state!.valor === null} onClick={() => run(addValor(dir, n), `Added ${n.toLocaleString()} valor.`)}>+{n.toLocaleString()}</button>
          ))}
        </div>
      </div>

      <div className="aside">
        <div className="panel">
          {!state?.running ? (
            <>
              <div style={{ color: "var(--warning)", fontWeight: 600 }}>● Game not running</div>
              <div className="muted" style={{ fontSize: 13 }}>Start Ryse. Hexvane connects on its own, without changing any game files.</div>
            </>
          ) : !ready ? (
            <>
              <div style={{ color: "var(--warning)", fontWeight: 600 }}>● Cheats paused</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {state.level ? `Cheats stay off in "${state.level}": they only run in campaign levels, never in the online Colosseum.` : "Start or continue the campaign. Cheats stay off in menus and the online Colosseum."}
              </div>
            </>
          ) : (
            <>
              <div style={{ color: "var(--lime)", fontWeight: 600 }}>● Connected · {LEVEL_NAMES[state.level!] ?? state.level}</div>
              <div className="muted" style={{ fontSize: 13 }}>Changes apply right away. They're undone when you leave the campaign.</div>
            </>
          )}
          {(message || state?.error) && (
            <div style={{ fontSize: 13, color: message && !message.error ? "var(--text)" : "var(--danger)" }} role="status">{message?.text ?? state!.error}</div>
          )}
        </div>
      </div>
    </div>
  );
}
