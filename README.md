# Hexvane

A free desktop trainer app for **single-player PC games**. Hexvane finds the games installed on your PC and gives each one a page of cheats: toggles, sliders, and hotkeys.

> Hexvane never attaches to online games or games with anti-cheat. That keeps your accounts safe and keeps other players unaffected.

**Status:** early. Game detection and the interface work. **Graveyard Keeper** has real cheats through a BepInEx plugin; every other game still shows placeholder cheats.

## Features

| Feature | Status |
| --- | --- |
| Detect installed Steam games (all library folders) | Working |
| Detect installed Epic and GOG games | Working |
| Official Steam artwork (cover, banner, logo), read from Steam's local cache | Working |
| Official Epic artwork (cover, banner, logo when available) from the launcher's catalog cache | Working |
| GOG artwork | Not started (gradient placeholder) |
| Library: search, store filter | Working |
| Play button: starts the game through Steam or Epic, or its exe for GOG | Working (Steam tested; Epic and GOG untested) |
| Game page: cheat toggles, sliders, hotkey chips | UI only |
| Rebind hotkeys (click a key, press a new combination), saved locally | Working |
| Block online / anti-cheat games | Hard-coded name list |
| Settings: general, hotkeys, overlay (with live preview), about (with updates) | UI only, choices saved locally where noted |
| Account page: profile picture (Hex H logo by default, replaceable), donation card | Picture works, rest UI only |
| Custom dark title bar with own minimise / maximise / close | Working |
| Onboarding (3 steps, first launch only) | Working |
| Sign in / sign up forms with validation, or continue as guest | Forms only: no account server yet |
| Graveyard Keeper cheats: unlimited health, unlimited stamina, add money, give items | Working (needs the Hexvane Bridge plugin, see below) |
| Cheats for other games | Not started (placeholders) |
| In-game hotkeys for cheats | Not started |
| In-game overlay | Not started (settings preview only) |

## Tech stack

- [Tauri 2](https://tauri.app) app: Rust backend, WebView2 frontend
- React 19 + TypeScript, built with Vite
- Plain CSS with design tokens in `src/styles.css`
- Fonts: Space Grotesk (headings), Inter (body text), JetBrains Mono (keys and values), all bundled under the SIL Open Font License
- App icon: generated from `src-tauri/icons/app-icon.svg` with `npx tauri icon src-tauri/icons/app-icon.svg`

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

## Graveyard Keeper trainer

Graveyard Keeper is a Unity game, so its cheats run as a [BepInEx 5](https://github.com/BepInEx/BepInEx) plugin, `trainers/GraveyardKeeper`. The plugin listens on `127.0.0.1:47821` (this PC only) and the app sends it one text command per request: `state`, `set health 0|1`, `set stamina 0|1`, `money <amount>` (the game counts in silver: 100 = 1 gold), `give <item id> <count>`, `items` (or `items all` to skip the filter).

To build and install it you need the [.NET 8 SDK](https://dotnet.microsoft.com) (`winget install Microsoft.DotNet.SDK.8`) and BepInEx 5 already installed in the game:

```bash
cd trainers/GraveyardKeeper && dotnet build -c Release
```

Copy `bin/Release/net472/Hexvane.Bridge.dll` into `<game folder>/BepInEx/plugins/Hexvane/`, with the game closed. To uninstall, delete that folder. If the game is not in the default Steam folder, build with `-p:GameDir="<game folder>"`.

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
  Trainer.tsx         Graveyard Keeper cheat page
  styles.css          Design tokens (Toxic lime palette) and styles
  assets/fonts/       Bundled fonts
src-tauri/            Rust backend
  src/games.rs        Steam / Epic / GOG detection and Steam / Epic artwork lookup, with tests
  src/trainer.rs      Sends commands to the in-game plugin
  src/lib.rs          Tauri setup and commands
  tauri.conf.json     Window, bundle and asset-protocol settings
```

## How game detection works

- **Steam:** reads the Steam folder from the registry, then `steamapps/libraryfolders.vdf` for every library, then each `appmanifest_*.acf`. Artwork comes from `Steam/appcache/librarycache/<appid>/`.
- **Epic:** reads the launcher manifests in `C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item`. Artwork links come from the launcher's catalog cache, `Data\Catalog\catcache.bin` (base64 JSON), matched by `CatalogItemId`.
- **GOG:** reads `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games` in the registry.

Detection only reads local files and registry keys. The one network use is the app window loading Epic artwork from Epic's CDN (`cdn1.epicgames.com`). Steam artwork is local.

## Known shortcuts

Search the code for `shortcut:` to find them.

- Every game except Graveyard Keeper shows the same demo cheat list.
- The Graveyard Keeper plugin is installed by hand; the app doesn't install it yet.
- The online / anti-cheat blocklist is a short hard-coded list of names.

## Design

The full UI design (screens, components, Toxic lime palette, Hex H logo) is in the FigCraft file `Hexvane Trainer App.figcraft`. It is kept outside this repository.
