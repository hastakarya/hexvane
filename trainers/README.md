# Cheats (trainers)

Each supported game has its own trainer in this folder. A trainer is the part that runs inside the game and changes it. The Hexvane app is only the remote control.

## Supported games

| Game | Engine | How it works | Cheats | Docs |
| --- | --- | --- | --- | --- |
| Graveyard Keeper | Unity (Mono) | BepInEx 5 plugin | Unlimited health, unlimited stamina, add money, give items | [GraveyardKeeper](GraveyardKeeper/README.md) |
| Ryse: Son of Rome | CryEngine 3 (native) | Memory patches from the app, campaign only | Undead, add valor | [Ryse](Ryse/README.md) |

Every other detected game shows "Coming soon" in the library and can't be opened.

## Hotkeys

While a supported game runs, Hexvane watches its cheat hotkeys by polling the keyboard (`src-tauri/src/hotkeys.rs`), so they work whichever window has focus, including games that swallow normal Windows hotkeys. Each press shows the toast and plays a short beep from the app.

## How it works (plugin games)

```
Hexvane app  ──  one text line over 127.0.0.1:47821  ──>  plugin inside the game  ──>  game objects
(React page)      (src-tauri/src/trainer.rs)              (Hexvane.Bridge.dll)          (health, money, inventory)
```

1. Hexvane installs `Hexvane.Bridge.dll` into the game's BepInEx folder (one click on the game page), and BepInEx loads it when the game starts.
2. The plugin listens on `127.0.0.1:47821`. Only this PC can reach it.
3. The app sends one command per request, such as `set health 1`, and gets one line back: a result, or `err <message>`.
4. The plugin applies the change through the game's own code, on Unity's main thread.

Hexvane never edits save files. Changes are made in the running game and reach the save only when the player saves.

## Adding a game

1. Check the engine. Unity Mono games (an `Assembly-CSharp.dll` in `<game>_Data/Managed`) can use the plugin approach. Other engines can use the memory engine in `src-tauri/src/native.rs`, like Ryse.
2. Make a folder here with the plugin project. Copy `GraveyardKeeper/` as a start, keep the same line protocol, and use a free port or the same one.
3. Add a page for the game in `src/` and include the game in `hasTrainer` in `src/Trainer.tsx`. The library then shows it as "Cheats ready".
4. Write a `README.md` for the game (cheats, commands, build and install) and add it to the table above.
5. Never add a game that is online or has anti-cheat.
