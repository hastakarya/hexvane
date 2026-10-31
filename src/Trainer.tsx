import { useEffect, useMemo, useState } from "react";
import { trainerSend, type Game } from "./games";
import { Toggle } from "./ui";

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
        <CheatToggle title="Unlimited Health" value={state?.health} detail={ready ? `${Math.round(state!.hp!)} / ${state!.maxHp}` : undefined} disabled={!state} onChange={(on) => run(`set health ${on ? 1 : 0}`)} />
        <CheatToggle title="Unlimited Stamina" value={state?.stamina} detail={ready ? `${Math.round(state!.energy!)} / ${state!.maxEnergy}` : undefined} disabled={!state} onChange={(on) => run(`set stamina ${on ? 1 : 0}`)} />

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

function CheatToggle({ title, value, detail, disabled, onChange }: { title: string; value?: boolean; detail?: string; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="row" style={disabled ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
      <div className="row-title">
        {title}
        {detail && <div className="setting-desc mono">{detail}</div>}
      </div>
      {/* shortcut: no in-game hotkeys yet; needs a global shortcut (or the plugin reading keys) bound to the stored hotkey */}
      <Toggle on={!!value} onChange={onChange} label={title} />
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
