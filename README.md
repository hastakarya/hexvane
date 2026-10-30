# Hexvane

A free desktop trainer app for **single-player PC games**. Hexvane finds the games installed on your PC and gives each one a page of cheats: toggles, sliders, and hotkeys.

> Hexvane never attaches to online games or games with anti-cheat. That keeps your accounts safe and keeps other players unaffected.

**Status:** early app shell. Game detection and the interface work. The cheats are placeholders: toggles don't change any game yet.

## Features

| Feature | Status |
| --- | --- |
| Detect installed Steam games (all library folders) | Working |
| Detect installed Epic and GOG games | Working |
| Official Steam artwork (cover, banner, logo), read from Steam's local cache | Working |
| Library: search, store filter | Working |
| Game page: cheat toggles, sliders, hotkey chips | UI only |
| Block online / anti-cheat games | Hard-coded name list |
| Settings: general, hotkeys, overlay, updates, about | UI only |
| Account page with donation card | UI only |
| Cheat engine (memory read/write, hotkeys) | Not started |
| In-game overlay, onboarding, sign-in | Not started |

## Tech stack

- [Tauri 2](https://tauri.app) app: Rust backend, WebView2 frontend
- React 19 + TypeScript, built with Vite
- Plain CSS with design tokens in `src/styles.css`
- Fonts: Space Grotesk (headings), JetBrains Mono (keys and values), both bundled under the SIL Open Font License

## Requirements

Windows 10 or 11 with:

- [Node.js](https://nodejs.org) 20 or newer
- [Rust](https://rustup.rs) (stable, MSVC toolchain)
- Visual Studio 2022 Build Tools with **Desktop development with C++**
- WebView2 runtime (already on Windows 11)

To install Rust and the Build Tools with winget:

```bash
winget install --id Rustlang.Rustup -e
```

```bash
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

## Getting started

```bash
npm install
```

```bash
npm run tauri dev
```

The first run compiles Tauri and takes a few minutes. Later runs are fast, and the frontend reloads on save.

## Tests and checks

```bash
cd src-tauri && cargo test
```

```bash
npx tsc --noEmit
```

## Build an installer

```bash
npm run tauri build
```

The installer is written to `src-tauri/target/release/bundle/`.

## Project layout

```
src/                  React frontend
  App.tsx             App shell, sidebar and all screens
  ui.tsx              Shared pieces: logo, toggle, slider, dropdown, artwork
  games.ts            Game types, Tauri calls, placeholder cheats, blocklist
  styles.css          Design tokens (Toxic lime palette) and styles
  assets/fonts/       Bundled fonts
src-tauri/            Rust backend
  src/games.rs        Steam / Epic / GOG detection and Steam artwork lookup, with tests
  src/lib.rs          Tauri setup and commands
  tauri.conf.json     Window, bundle and asset-protocol settings
```

## How game detection works

- **Steam:** reads the Steam folder from the registry, then `steamapps/libraryfolders.vdf` for every library, then each `appmanifest_*.acf`. Artwork comes from `Steam/appcache/librarycache/<appid>/`.
- **Epic:** reads the launcher manifests in `C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item`.
- **GOG:** reads `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games` in the registry.

Detection only reads files and registry keys. It makes no network calls.

## Known shortcuts

Search the code for `shortcut:` to find them.

- Every game shows the same demo cheat list.
- The online / anti-cheat blocklist is a short hard-coded list of names.

## Design

The full UI design (screens, components, Toxic lime palette, Hex H logo) is in the FigCraft file `Hexvane Trainer App.figcraft`. It is kept outside this repository.
