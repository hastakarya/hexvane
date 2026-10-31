import { useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { artUrl, coverFor, demoCheats, detectGames, isBlocked, launchGame, type Game, type Store } from "./games";
import { GraveyardKeeperTrainer, hasTrainer } from "./Trainer";
import { Art, Avatar, CoffeeIcon, Dropdown, ErrorBoundary, KeyRow, Logo, SelectRow, SliderRow, TitleBar, Toggle, ToggleRow, useStored } from "./ui";
import { Auth, Onboarding } from "./Welcome";
import "./styles.css";

type View = { name: "library" | "settings" | "account" } | { name: "game"; game: Game };

const NAV = [
  { id: "library", label: "Library", icon: "▦" },
  { id: "settings", label: "Settings", icon: "⚙" },
  { id: "account", label: "Account", icon: "◉" },
] as const;

export default function App() {
  const [view, setView] = useState<View>({ name: "library" });
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avatar, setAvatar] = useStored<string | null>("avatar", null);
  const [onboarded, setOnboarded] = useStored("onboarded", false);
  const [entered, setEntered] = useStored("entered", false);

  const scan = () => {
    setGames(null);
    setError(null);
    detectGames().then(setGames).catch((e) => setError(String(e)));
  };
  useEffect(scan, []);

  const active = view.name === "game" ? "library" : view.name;

  if (!onboarded) return <><TitleBar plain /><Onboarding onDone={() => setOnboarded(true)} /></>;
  if (!entered) return <><TitleBar plain /><Auth onGuest={() => setEntered(true)} /></>;

  return (
    <>
    <TitleBar overlay={view.name === "game"} />
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><Logo /> Hexvane</div>
        {NAV.map((n) => (
          <button key={n.id} className={`nav-item ${active === n.id ? "active" : ""}`} onClick={() => setView({ name: n.id })}>
            <span className="icon">{n.icon}</span> {n.label}
          </button>
        ))}
        <button className="profile" onClick={() => setView({ name: "account" })}>
          <Avatar src={avatar} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Guest</div>
            <div className="supporter">Free · Supporter ♥</div>
          </div>
        </button>
      </aside>
      <main className="main">
        {/* keyed by screen so switching screens clears a previous crash */}
        <ErrorBoundary key={view.name}>
          {view.name === "library" && <Library games={games} error={error} onRescan={scan} onOpen={(game) => setView({ name: "game", game })} />}
          {view.name === "game" && <GameDetail game={view.game} onBack={() => setView({ name: "library" })} />}
          {view.name === "settings" && <Settings />}
          {view.name === "account" && <Account avatar={avatar} onAvatar={setAvatar} onSignIn={() => setEntered(false)} />}
        </ErrorBoundary>
      </main>
    </div>
    </>
  );
}

function Library({ games, error, onRescan, onOpen }: { games: Game[] | null; error: string | null; onRescan: () => void; onOpen: (g: Game) => void }) {
  const [query, setQuery] = useState("");
  const [store, setStore] = useState<Store | "All">("All");
  const shown = useMemo(
    () => (games ?? []).filter((g) => (store === "All" || g.store === store) && g.name.toLowerCase().includes(query.toLowerCase())),
    [games, query, store],
  );

  return (
    <div className="page">
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <h1 style={{ flex: 1 }}>Library</h1>
        <input className="search" placeholder="Search your games…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn btn-secondary" style={{ padding: "8px 12px" }} onClick={onRescan} aria-label="Rescan games">⟳</button>
      </div>
      <div className="chips">
        {(["All", "Steam", "Epic", "GOG"] as const).map((s) => (
          <button key={s} className={`chip ${store === s ? "active" : ""}`} onClick={() => setStore(s)}>
            {s === "All" ? `Installed (${games?.length ?? 0})` : s}
          </button>
        ))}
      </div>

      {error && <div className="center"><h2>Couldn't scan for games</h2><p className="muted">{error}</p><button className="btn btn-primary" onClick={onRescan}>Try again</button></div>}
      {!error && games === null && <div className="center muted">Scanning Steam, Epic and GOG…</div>}
      {!error && games?.length === 0 && (
        <div className="center">
          <div style={{ fontSize: 64, color: "var(--border)" }}>▦</div>
          <h2>No games found on this PC</h2>
          <p className="muted">We looked in Steam, Epic and GOG install folders.</p>
          <button className="btn btn-primary" onClick={onRescan}>Scan again</button>
        </div>
      )}
      {games && games.length > 0 && shown.length === 0 && <div className="center"><h2>No results for “{query}”</h2><p className="muted">Check the spelling or clear the filters.</p></div>}

      <div className="grid">
        {shown.map((g) => {
          const { background, monogram } = coverFor(g);
          const blocked = isBlocked(g);
          return (
            <button key={g.id} className="card" onClick={() => onOpen(g)}>
              <div className="cover" style={{ background, opacity: blocked ? 0.45 : 1 }}>
                <span className="monogram">{monogram}</span>
                <Art className="cover-img" src={artUrl(g.art.cover)} />
              </div>
              <div className="card-info">
                <div className="card-title" title={g.name}>{g.name}</div>
                <div className="card-meta" style={{ color: blocked ? "var(--danger)" : "var(--aqua)" }}>
                  {blocked ? "⛔ Online — blocked" : `● ${g.store}`}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GameDetail({ game, onBack }: { game: Game; onBack: () => void }) {
  const blocked = isBlocked(game);
  const sections = [...new Set(demoCheats.map((c) => c.section))];
  return (
    <div>
      <div className="hero" style={{ background: coverFor(game).background }}>
        <Art className="hero-img" src={artUrl(game.art.hero)} />
        <button className="back" onClick={onBack}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 3 4.5 7l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Library
        </button>
        <Art className="hero-logo" src={artUrl(game.art.logo)} alt="" />
        <div className="hero-content">
          <h1>{game.name}</h1>
          <div style={{ color: "#bfc8b9", fontSize: 13 }}>{game.store} · {game.installDir}</div>
        </div>
        {!blocked && <button className="btn btn-play" style={{ position: "relative" }} onClick={() => launchGame(game.id).catch((e) => alert(`Couldn't start ${game.name}: ${e}`))}>▶ PLAY</button>}
      </div>

      {blocked ? (
        <div className="center">
          <div className="blocked">
            <div style={{ fontSize: 40, color: "var(--danger)" }}>⛔</div>
            <h2 style={{ margin: "8px 0" }}>This game isn't supported</h2>
            <p className="muted">{game.name} is an online game or uses anti-cheat. Hexvane never attaches to online or anti-cheat games, to keep your account safe.</p>
          </div>
        </div>
      ) : hasTrainer(game) ? (
        <GraveyardKeeperTrainer />
      ) : (
        <div className="detail-body">
          <div className="cheats">
            {sections.map((s) => (
              <div key={s} style={{ display: "contents" }}>
                <div className="section-label">{s.toUpperCase()}</div>
                {demoCheats.filter((c) => c.section === s).map((c) =>
                  c.kind === "toggle" ? <ToggleRow key={c.name} title={c.name} keyLabel={c.key} initial={false} /> : <SliderRow key={c.name} {...c} />,
                )}
              </div>
            ))}
          </div>
          <div className="aside">
            <div className="panel">
              <div style={{ color: "var(--warning)", fontWeight: 600 }}>● Preview only</div>
              <div className="muted" style={{ fontSize: 13 }}>These cheats are placeholders. Toggles don't change the game yet.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TABS = ["General", "Hotkeys", "Overlay", "About"] as const;

function Settings() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("General");
  return (
    <div className="settings">
      <div className="tabs">
        {TABS.map((t) => <button key={t} className={`nav-item ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      <div className="page" style={{ flex: 1, gap: 12 }}>
        <h1>{tab}</h1>
        {tab === "General" && <>
          <ToggleRow title="Launch on startup" desc="Start Hexvane minimized when Windows starts." />
          <ToggleRow title="Minimize to tray on close" desc="Keep Hexvane running so hotkeys still work." />
          <SelectRow title="Language" desc="Interface language." options={["English"]} />
          <ToggleRow title="Notifications" desc="Tell me when a favorite game gets new cheats." />
        </>}
        {tab === "Hotkeys" && <>
          <KeyRow title="Toggle overlay" desc="Show or hide the in-game overlay." keys="Ctrl + Tab" />
          <KeyRow title="Disable all cheats" desc="Panic key: turns every active cheat off." keys="Ctrl + F12" />
          <ToggleRow title="Hotkey sound" desc="Play a short sound when a hotkey fires." />
        </>}
        {tab === "Overlay" && <OverlaySettings />}
        {tab === "About" && <About />}
      </div>
    </div>
  );
}

const POSITIONS = ["Top left", "Top right", "Bottom left", "Bottom right"];

function OverlaySettings() {
  const [enabled, setEnabled] = useStored("overlay:enabled", true);
  const [position, setPosition] = useStored("overlay:position", POSITIONS[0]);
  const [vertical, horizontal] = position.toLowerCase().split(" ");
  return <>
    <p className="muted" style={{ margin: 0 }}>The panel shown on top of your game.</p>
    <div className="row">
      <div className="row-title">Enable in-game overlay<div className="setting-desc">Works with DirectX 11/12 and Vulkan games.</div></div>
      <Toggle on={enabled} onChange={setEnabled} label="Enable in-game overlay" />
    </div>
    <div className="row">
      <div className="row-title">Position<div className="setting-desc">Where the panel opens.</div></div>
      <Dropdown value={position} options={POSITIONS} onChange={setPosition} label="Position" />
    </div>
    <div className="section-label">PREVIEW</div>
    <div className={`overlay-preview ${enabled ? "" : "off"}`} aria-label={`Preview: overlay ${enabled ? `in the ${position.toLowerCase()} corner` : "turned off"}`}>
      <span className="overlay-preview-game">[ your game ]</span>
      {enabled ? (
        <div className="mini-overlay" style={{ [vertical]: 16, [horizontal]: 16 }}>
          <div className="mini-overlay-head"><Logo size={14} /><b>Star Voyager</b><span>● Attached</span></div>
          <div className="mini-row">Unlimited Health<span className="mono">F1</span><i className="on" /></div>
          <div className="mini-row">No Reload<span className="mono">F3</span><i /></div>
          <div className="mini-row">Game Speed<span className="mono" style={{ color: "var(--lime)" }}>1.5x</span></div>
          <div className="mini-hint">Ctrl + Tab to hide</div>
        </div>
      ) : <span className="overlay-preview-off">Overlay is off</span>}
    </div>
    <div className="setting-desc">This panel appears on top of your game. Toggle cheats without alt-tabbing, and hide it with your overlay hotkey.</div>
  </>;
}

function About() {
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => { getVersion().then(setVersion).catch(() => setVersion("?")); }, []);
  return <>
    <p className="muted" style={{ margin: 0 }}>Hexvane works only with single-player games and offline modes. It never attaches to online games or games with anti-cheat.</p>
    <div className="section-label">UPDATES</div>
    <div className="row">
      <div className="row-title">
        Hexvane <span className="mono muted" style={{ fontSize: 13, marginLeft: 6 }}>v{version}</span>
        {/* shortcut: no update server yet, so the button only reports that; wire to tauri-plugin-updater before release */}
        <div className="setting-desc">{status ?? "Update checking isn't connected yet."}</div>
      </div>
      <button className="btn btn-secondary" onClick={() => setStatus("No update server yet. You're on the build you installed.")}>Check for updates</button>
    </div>
    <SelectRow title="Update channel" desc="Beta gets new features first." options={["Stable", "Beta"]} />
    <ToggleRow title="Download app updates automatically" desc="You are asked before anything installs." />
    <div className="section-label">PRIVACY</div>
    <ToggleRow title="Send crash reports" desc="Anonymous. No game or personal data." initial={false} />
    <div className="section-label">HELP</div>
    <ButtonRow title="Help & community" desc="Guides, FAQ and Discord." label="Open ↗" />
    <ButtonRow title="Licenses" desc="Open-source notices for fonts and libraries." label="View" />
  </>;
}

// shortcut: Help and Licenses buttons have no target yet; point them at the website / a licenses screen when those exist
function ButtonRow({ title, desc, label }: { title: string; desc: string; label: string }) {
  return (
    <div className="row">
      <div className="row-title">{title}<div className="setting-desc">{desc}</div></div>
      <button className="btn btn-secondary">{label}</button>
    </div>
  );
}

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function Account({ avatar, onAvatar, onSignIn }: { avatar: string | null; onAvatar: (src: string | null) => void; onSignIn: () => void }) {
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setAvatarError("Choose an image file (PNG, JPG, GIF or WebP).");
    if (file.size > MAX_AVATAR_BYTES) return setAvatarError("That image is over 2 MB. Choose a smaller one.");
    setAvatarError(null);
    const reader = new FileReader();
    reader.onload = () => onAvatar(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <div className="page">
      <h1>Account</h1>
      <div className="row" style={{ padding: 20, gap: 16 }}>
        <Avatar src={avatar} size={64} />
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 20 }}>Guest</h2>
          <div className="muted" style={{ fontSize: 13 }}>Sign in to sync favorites and hotkeys across PCs.</div>
          {avatarError && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 4 }}>{avatarError}</div>}
        </div>
        <label className="btn btn-secondary">
          Change picture
          <input type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {avatar && <button className="btn btn-secondary" onClick={() => onAvatar(null)}>Use logo</button>}
        <button className="btn btn-primary" onClick={onSignIn}>Sign in</button>
      </div>
      <div className="donate">
        <CoffeeIcon size={44} color="var(--warning)" />
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 18 }}>Hexvane is free, forever</h2>
          <div style={{ color: "#bfc8b9", fontSize: 14 }}>No ads, no paywall. If it saved you a few hours of grinding, a coffee keeps new games and updates coming.</div>
        </div>
        <button className="btn btn-coffee" style={{ display: "flex", alignItems: "center", gap: 8 }}><CoffeeIcon size={18} color="var(--on-lime)" /> Buy me a coffee</button>
        <button className="btn btn-secondary">Donate ♥</button>
      </div>
    </div>
  );
}
