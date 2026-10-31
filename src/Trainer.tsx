import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import { installPlugin, pluginStatus, trainerSend, uninstallPlugin, type Game, type PluginStatus } from "./games";
import { isRyse, ryseHotkeys, ryseState } from "./Ryse";
import { playBeep, showToast } from "./Toast";
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
export const isGraveyardKeeper = (g: Game) => g.name.toLowerCase() === "graveyard keeper";
export const hasTrainer = (g: Game) => isGraveyardKeeper(g) || isRyse(g);

/** Graveyard Keeper money counts in silver: 1 = 1 silver, 100 = 1 gold, 0.01 = 1 copper. */
function formatMoney(silver: number) {
  const c = Math.round(silver * 100);
  const parts = [[Math.floor(c / 10000), "g"], [Math.floor(c / 100) % 100, "s"], [c % 100, "c"]] as const;
  return parts.filter(([n], i) => n > 0 || i === 2).map(([n, u]) => `${n}${u}`).join(" ");
}

export function GraveyardKeeperTrainer({ game }: { game: Game }) {
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
        <CheatToggle title="Unlimited Health" hotkey={GK_HOTKEYS[0]} value={state?.health} detail={ready ? `${Math.round(state!.hp!)} / ${state!.maxHp}` : undefined} disabled={!state} onChange={(on) => run(`set health ${on ? 1 : 0}`)} />
        <CheatToggle title="Unlimited Stamina" hotkey={GK_HOTKEYS[1]} value={state?.stamina} detail={ready ? `${Math.round(state!.energy!)} / ${state!.maxEnergy}` : undefined} disabled={!state} onChange={(on) => run(`set stamina ${on ? 1 : 0}`)} />

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
        <PluginPanel gameDir={game.installDir} />
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

const BEPINEX_GUIDE = "https://docs.bepinex.dev/articles/user_guide/installation/index.html";

/** Installs, updates or removes the in-game plugin the cheats run through. */
function PluginPanel({ gameDir }: { gameDir: string }) {
  const [status, setStatus] = useState<PluginStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const check = () => pluginStatus(gameDir).then(setStatus).catch((e) => setError(String(e)));
  useEffect(() => { check(); }, [gameDir]);

  const act = async (action: (dir: string) => Promise<void>) => {
    setWorking(true);
    setError(null);
    try { await action(gameDir); } catch (e) { setError(String(e)); }
    await check();
    setWorking(false);
  };

  if (!status) return null;
  const errorLine = error && <div style={{ fontSize: 13, color: "var(--danger)" }} role="alert">{error}</div>;
  if (status.installed && status.upToDate) {
    return (
      <div className="muted" style={{ fontSize: 13, display: "flex", gap: 8, flexWrap: "wrap", padding: "0 4px" }}>
        <span>✓ Hexvane plugin installed</span>
        <button className="link muted" disabled={working} onClick={() => act(uninstallPlugin)}>Remove</button>
        {errorLine}
      </div>
    );
  }
  return (
    <div className="panel">
      {!status.bepinex ? (
        <>
          <div style={{ color: "var(--warning)", fontWeight: 600 }}>● BepInEx needed</div>
          <div className="muted" style={{ fontSize: 13 }}>The cheats run as a BepInEx 5 plugin, and BepInEx isn't installed in this game yet. Install it, start the game once, then come back.</div>
          <button className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start", fontFamily: "inherit" }} onClick={() => openUrl(BEPINEX_GUIDE)}>How to install BepInEx</button>
          <button className="link muted" style={{ alignSelf: "flex-start" }} onClick={check}>Check again</button>
        </>
      ) : (
        <>
          <div style={{ color: "var(--warning)", fontWeight: 600 }}>● {status.installed ? "Plugin update ready" : "Plugin not installed"}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {status.installed ? "A newer Hexvane plugin comes with this version of the app." : "The cheats run through a small Hexvane plugin in the game's BepInEx folder."} Close the game before installing.
          </div>
          <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={working} onClick={() => act(installPlugin)}>
            {working ? "Installing…" : status.installed ? "Update plugin" : "Install plugin"}
          </button>
        </>
      )}
      {errorLine}
    </div>
  );
}

// Hotkeys live in the app (localStorage). useGameHotkeys registers them system-wide, so they work whichever window has focus.
// Not F1: BepInEx's Configuration Manager, common in modded games, opens on F1.
/** A cheat hotkey: `fire` applies it and resolves to the cheat's new state, for the toast. */
export interface Hotkey { cheat: string; title: string; storageKey: string; initial: string; fire: () => Promise<boolean> }

const PANIC = { cheat: "panic", title: "All cheats", storageKey: "hotkey:Disable all cheats", initial: "Ctrl + F12" }; // set in Settings > Hotkeys

const gkToggle = (cheat: string) => async () => {
  await trainerSend(`toggle ${cheat}`);
  return !!JSON.parse(await trainerSend("state"))[cheat];
};
const GK_HOTKEYS: Hotkey[] = [
  { cheat: "health", title: "Unlimited Health", storageKey: "hotkey:gyk:health", initial: "F7", fire: gkToggle("health") },
  { cheat: "stamina", title: "Unlimited Stamina", storageKey: "hotkey:gyk:stamina", initial: "F8", fire: gkToggle("stamina") },
  { ...PANIC, fire: () => trainerSend("off").then(() => false) },
];

/** The hotkeys for whichever supported game is running right now, or null. */
async function activeHotkeys(games: Game[]): Promise<Hotkey[] | null> {
  if (await trainerSend("ping").then(() => true, () => false)) return GK_HOTKEYS;
  const ryse = games.find(isRyse);
  if (ryse && (await ryseState(ryse.installDir).catch(() => null))?.running) return ryseHotkeys(ryse.installDir);
  return null;
}

/**
 * While a supported game runs, watches its cheat hotkeys (the Rust side polls the keyboard, see hotkeys.rs) and applies
 * them on press, whichever window has focus. Off when no supported game runs. Mounted once at the app root.
 */
export function useGameHotkeys(games: Game[] | null) {
  const gamesRef = useRef(games ?? []);
  gamesRef.current = games ?? [];
  useEffect(() => {
    let active: Hotkey[] = [];
    let watching = ""; // the key set being watched, "" when none
    let busy = false;
    const stop = listen<string>("hotkey", ({ payload }) => {
      const h = active.find((k) => k.storageKey === payload);
      h?.fire().then((on) => { showToast(h.title, on); playBeep(on); }, () => {});
    });
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const hotkeys = (await activeHotkeys(gamesRef.current)) ?? [];
        const keys = hotkeys.map((h): [string, string] => [h.storageKey, stored(h.storageKey, h.initial)]);
        const want = JSON.stringify(keys); // picks up changes made in Settings too
        active = hotkeys;
        if (want === watching) return;
        await invoke("set_hotkeys", { keys });
        // The app plays the beep for every game; keep the Graveyard Keeper plugin's own beep off so it doesn't double.
        if (hotkeys === GK_HOTKEYS) trainerSend("sound 0").catch(() => {});
        watching = want;
      } finally {
        busy = false;
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      clearInterval(id);
      stop.then((f) => f());
      invoke("set_hotkeys", { keys: [] }).catch(() => {});
    };
  }, []);
}

export function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function CheatToggle({ title, hotkey, value, detail, disabled, onChange }: { title: string; hotkey: Pick<Hotkey, "storageKey" | "initial">; value?: boolean; detail?: string; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="row">
      <div className="row-title" style={disabled ? { opacity: 0.5 } : undefined}>
        {title}
        {detail && <div className="setting-desc mono">{detail}</div>}
      </div>
      {/* shortcut: pressing the current key while rebinding also toggles the cheat (the key watcher sees it too) */}
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
