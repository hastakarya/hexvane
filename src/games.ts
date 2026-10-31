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

export const detectGames = () => invoke<Game[]>("detect_games");

export const launchGame = (id: string) => invoke<void>("launch_game", { id });

export interface PluginStatus { bepinex: boolean; installed: boolean; upToDate: boolean }
export const pluginStatus = (gameDir: string) => invoke<PluginStatus>("plugin_status", { gameDir });
export const installPlugin = (gameDir: string) => invoke<void>("install_plugin", { gameDir });
export const uninstallPlugin = (gameDir: string) => invoke<void>("uninstall_plugin", { gameDir });

/** One command to the in-game Hexvane Bridge plugin. Rejects with "not running" when the game isn't up. */
export const trainerSend = (command: string) => invoke<string>("trainer_send", { command });

// shortcut: hard-coded list, replace with a server-side blocklist (online / anti-cheat titles) before release
const BLOCKED = ["counter-strike", "valorant", "apex legends", "fortnite", "rust", "dota 2", "pubg", "rainbow six", "call of duty", "destiny 2", "overwatch"];
export const isBlocked = (g: Game) => BLOCKED.some((b) => g.name.toLowerCase().includes(b));

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
