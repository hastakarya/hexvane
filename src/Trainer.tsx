import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { useEffect, useMemo, useState } from "react";
import { trainerSend, type Game } from "./games";
import { HotkeyButton, Toggle } from "./ui";

interface State {
  inGame: boolean;
  health?: boolean;
  stamina?: boolean;
  hp?: number;
  maxHp?: number;
  energy?: number;
  maxEnergy?: number;
  money?: number;
}

/** Games with a real trainer (a Hexvane Bridge plugin under trainers/). */
export const hasTrainer = (g: Game) => g.name.toLowerCase() === "graveyard keeper";

/** Graveyard Keeper money counts in silver: 1 = 1 silver, 100 = 1 gold, 0.01 = 1 copper. */
function formatMoney(silver: number) {
  const c = Math.round(silver * 100);
  const parts = [[Math.floor(c / 10000), "g"], [Math.floor(c / 100) % 100, "s"], [c % 100, "c"]] as const;
  return parts.filter(([n], i) => n > 0 || i === 2).map(([n, u]) => `${n}${u}`).join(" ");
}

export function GraveyardKeeperTrainer() {
  const [state, setState] = useState<State | null>(null);
  const [offline, setOffline] = useState<"down" | "busy" | false>(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const refresh = () =>
    trainerSend("state")
      .then((s) => { setState(JSON.parse(s)); setOffline(false); })
      .catch((e) => { setState(null); setOffline(e === "not running" ? "down" : "busy"); });

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(id);
  }, [message]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, []);

  const run = async (command: string, done?: string) => {
    try {
      await trainerSend(command);
      if (done) setMessage({ text: done, error: false });
      refresh();
    } catch (e) {
      setMessage({ text: e === "not running" ? "Start Graveyard Keeper first." : String(e), error: true });
    }
  };

  const ready = !!state?.inGame;
  return (
    <div className="detail-body">
      <div className="cheats">
        <div className="section-label">PLAYER</div>
        <CheatToggle title="Unlimited Health" cheat="health" value={state?.health} detail={ready ? `${Math.round(state!.hp!)} / ${state!.maxHp}` : undefined} disabled={!state} onChange={(on) => run(`set health ${on ? 1 : 0}`)} />
        <CheatToggle title="Unlimited Stamina" cheat="stamina" value={state?.stamina} detail={ready ? `${Math.round(state!.energy!)} / ${state!.maxEnergy}` : undefined} disabled={!state} onChange={(on) => run(`set stamina ${on ? 1 : 0}`)} />

        <div className="section-label">MONEY</div>
        <div className="row">
          <div className="row-title">
            Add money
            <div className="setting-desc">{ready ? `You have ${formatMoney(state!.money!)}` : "Load a save to see your money."}</div>
          </div>
          {[["+1 silver", 1], ["+1 gold", 100], ["+10 gold", 1000]].map(([label, silver]) => (
            <button key={label} className="btn btn-secondary btn-sm" disabled={!ready} onClick={() => run(`money ${silver}`, `Added ${formatMoney(silver as number)}.`)}>{label}</button>
          ))}
        </div>

        <div className="section-label">ITEMS</div>
        <ItemGiver ready={ready} onGive={(id, name, count) => run(`give ${id} ${count}`, `Added ${count} × ${name}.`)} />
      </div>

      <div className="aside">
        <div className="panel">
          {offline === "busy" ? (
            <>
              <div style={{ color: "var(--warning)", fontWeight: 600 }}>● Game is busy</div>
              <div className="muted" style={{ fontSize: 13 }}>The game is loading or paused. Hexvane reconnects when it's back.</div>
            </>
          ) : offline ? (
            <>
              <div style={{ color: "var(--warning)", fontWeight: 600 }}>● Game not running</div>
              <div className="muted" style={{ fontSize: 13 }}>Start Graveyard Keeper. Hexvane connects on its own once the game is up.</div>
            </>
          ) : !state ? (
            <div className="muted">Connecting…</div>
          ) : !ready ? (
            <>
              <div style={{ color: "var(--warning)", fontWeight: 600 }}>● In the menu</div>
              <div className="muted" style={{ fontSize: 13 }}>Load a save. Health and stamina locks already apply once you're in.</div>
            </>
          ) : (
            <>
              <div style={{ color: "var(--lime)", fontWeight: 600 }}>● Connected</div>
              <div className="muted" style={{ fontSize: 13 }}>Changes apply right away in your game.</div>
            </>
          )}
          {message && <div style={{ fontSize: 13, color: message.error ? "var(--danger)" : "var(--text)" }} role="status">{message.text}</div>}
        </div>
      </div>
    </div>
  );
}

// Hotkeys live in the app (localStorage). useGameHotkeys registers them system-wide, so they work whichever window has focus.
// Not F1: BepInEx's Configuration Manager, common in modded games, opens on F1.
const HOTKEYS = [
  { cheat: "health", storageKey: "hotkey:gyk:health", initial: "F7", command: "toggle health" },
  { cheat: "stamina", storageKey: "hotkey:gyk:stamina", initial: "F8", command: "toggle stamina" },
  { cheat: "panic", storageKey: "hotkey:Disable all cheats", initial: "Ctrl + F12", command: "off" }, // set in Settings > Hotkeys
];

/**
 * While Graveyard Keeper is running, holds the cheat hotkeys as global shortcuts and forwards presses to the plugin.
 * Released when the game closes, so F7 and friends go back to other apps. Mounted once at the app root.
 */
export function useGameHotkeys() {
  useEffect(() => {
    let registered = ""; // the key set currently held, "" when none
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const up = await trainerSend("ping").then(() => true, () => false);
        const keys = HOTKEYS.map((h) => stored(h.storageKey, h.initial));
        const sound = stored("toggle:Hotkey sound", true);
        const want = up ? `${keys.join("|")}|${sound}` : ""; // picks up changes made in Settings too
        if (want === registered) return;
        await unregisterAll();
        registered = "";
        if (!up) return;
        for (const [i, h] of HOTKEYS.entries()) {
          // "Ctrl + Shift + F7" (app label) -> "Ctrl+Shift+F7" (accelerator)
          await register(keys[i].replace(/\s/g, ""), (e) => {
            if (e.state === "Pressed") trainerSend(h.command).catch(() => {});
          }).catch(() => {}); // taken by another app or not a valid key: skip it
        }
        trainerSend(`sound ${sound ? 1 : 0}`).catch(() => {});
        registered = want;
      } finally {
        busy = false;
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      clearInterval(id);
      unregisterAll().catch(() => {});
    };
  }, []);
}

function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function CheatToggle({ title, cheat, value, detail, disabled, onChange }: { title: string; cheat: string; value?: boolean; detail?: string; disabled: boolean; onChange: (on: boolean) => void }) {
  const hotkey = HOTKEYS.find((h) => h.cheat === cheat)!;
  return (
    <div className="row">
      <div className="row-title" style={disabled ? { opacity: 0.5 } : undefined}>
        {title}
        {detail && <div className="setting-desc mono">{detail}</div>}
      </div>
      {/* shortcut: while the game runs, the current key is held globally, so pressing that same key again while rebinding isn't seen */}
      <HotkeyButton className="key" storageKey={hotkey.storageKey} initial={hotkey.initial} label={title} />
      <div style={disabled ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
        <Toggle on={!!value} onChange={onChange} label={title} />
      </div>
    </div>
  );
}

function ItemGiver({ ready, onGive }: { ready: boolean; onGive: (id: string, name: string, count: number) => void }) {
  const [items, setItems] = useState<[string, string, string][] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<[string, string] | null>(null);
  const [count, setCount] = useState(10);

  // The list comes from the game itself, so it needs a loaded save; fetch it once per game session.
  useEffect(() => {
    if (!ready) setItems(null);
    else if (!items) trainerSend("items").then((s) => setItems(JSON.parse(s))).catch(() => {});
  }, [ready, items]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!items || !q || picked?.[1] === query) return [];
    return items.filter(([id, name]) => name.toLowerCase().includes(q) || id.includes(q)).slice(0, 8);
  }, [items, query, picked]);

  return (
    <div className="row" style={{ flexWrap: "wrap" }}>
      <div className="dropdown" style={{ flex: 1, minWidth: 220 }}>
        <input className="input" style={{ width: "100%" }} placeholder={ready ? (items ? `Search ${items.length} items` : "Loading items…") : "Load a save first"} disabled={!ready} value={query} aria-label="Item"
          onChange={(e) => { setQuery(e.target.value); setPicked(null); }} />
        {matches.length > 0 && (
          <div className="dropdown-menu" role="listbox" aria-label="Items">
            {matches.map(([id, name]) => (
              <button key={id} role="option" aria-selected={false} className="dropdown-item" onClick={() => { setPicked([id, name]); setQuery(name); }}>
                {name}<span className="mono faint" style={{ fontSize: 11 }}>{id}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <input className="input mono" style={{ width: 80 }} type="number" min={1} max={999} value={count} aria-label="Count" disabled={!ready}
        onChange={(e) => setCount(Math.max(1, Math.min(999, Number(e.target.value) || 1)))} />
      <button className="btn btn-primary" disabled={!ready || !picked} onClick={() => picked && onGive(picked[0], picked[1], count)}>Give</button>
    </div>
  );
}
