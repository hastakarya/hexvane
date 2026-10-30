import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type Store = "Steam" | "Epic" | "GOG";

export interface Game {
  id: string;
  name: string;
  store: Store;
  installDir: string;
  art: { cover: string | null; hero: string | null; logo: string | null };
}

/** Artwork as a URL the webview can load: Epic art is already https, Steam art is a local file. */
export const artUrl = (path: string | null) => (!path ? null : path.startsWith("https://") ? path : convertFileSrc(path));

export type Cheat =
  | { kind: "toggle"; name: string; key: string; section: string }
  | { kind: "slider"; name: string; min: number; max: number; step: number; value: number; unit: string; section: string };

export const detectGames = () => invoke<Game[]>("detect_games");

// shortcut: hard-coded list, replace with a server-side blocklist (online / anti-cheat titles) before release
const BLOCKED = ["counter-strike", "valorant", "apex legends", "fortnite", "rust", "dota 2", "pubg", "rainbow six", "call of duty", "destiny 2", "overwatch"];
export const isBlocked = (g: Game) => BLOCKED.some((b) => g.name.toLowerCase().includes(b));

// shortcut: placeholder cheats for every game until the cheat engine and per-game definitions exist
export const demoCheats: Cheat[] = [
  { kind: "toggle", name: "Unlimited Health", key: "F1", section: "Player" },
  { kind: "toggle", name: "Unlimited Stamina", key: "F2", section: "Player" },
  { kind: "toggle", name: "No Reload", key: "F3", section: "Player" },
  { kind: "slider", name: "Game Speed", min: 0.5, max: 3, step: 0.1, value: 1, unit: "x", section: "Player" },
  { kind: "toggle", name: "Unlimited Ammo", key: "F4", section: "Inventory" },
  { kind: "slider", name: "Credits", min: 0, max: 100000, step: 1000, value: 50000, unit: "", section: "Inventory" },
];

const COVERS = [
  ["#2e4a0a", "#0f5e6b"], ["#8c2b2b", "#3b1d0f"], ["#d9268c", "#2b1d6b"], ["#3d3d4a", "#121218"],
  ["#e8b04a", "#4a7a2b"], ["#4a9ae8", "#1d2b6b"], ["#0f3b6b", "#020b1a"], ["#b8862b", "#3b2a0f"],
];

// Stable cover colours and monogram per game until real cover art is fetched
export function coverFor(g: Game) {
  const hash = [...g.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const [a, b] = COVERS[hash % COVERS.length];
  const words = g.name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  const monogram = (words.length > 1 ? words[0][0] + words[1][0] : g.name.slice(0, 2)).toUpperCase();
  return { background: `linear-gradient(${a}, ${b})`, monogram };
}
