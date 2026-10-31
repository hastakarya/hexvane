# Ryse: Son of Rome trainer

Ryse runs on CryEngine 3 and has no mod loader, so this trainer has no plugin. Hexvane changes the running game's memory directly (`src-tauri/src/ryse.rs`, using the engine in `src-tauri/src/native.rs`). No game files are changed. See [How it works](../README.md#how-it-works) for the Unity plugin route used by other games.

Tested on the Steam build **1.0.0.153** (`Bin64/Ryse.exe`).

## Cheats

| Cheat | Default key | What it does |
| --- | --- | --- |
| Undead | F7 | You still take damage, but a hit that would kill you leaves you at 1 health |
| Add valor | none | Adds 1,000 / 10,000 / 100,000 valor to spend on upgrades. Open the upgrade menu in the game once first |

Ctrl + F12 (the panic key) turns Undead off.

## Campaign only

Ryse has an online co-op arena. Hexvane reads the current level from the game's `Game.log` ("Loading level X") and only changes the game in campaign levels: `dover`, `forum`, `glott`, `oswald`, `palace`, `rome`, `york`. In `mp_gladiator` (the online arena), `Colosseum` and the menus, every change is undone and the cheats can't be turned on.

## How the cheats work

| Hook (byte pattern in `Ryse.exe`) | Game instruction | What Hexvane adds |
| --- | --- | --- |
| `44 8B 71 40 4C 8B E1` | reads an entity's health (`[rcx+40]`) | remembers the player (`[rcx+78] == 0xFED0`); with Undead on, keeps the hit from taking health to 0 |
| `8B 41 20 2B 41 2C` | the upgrade menu reads valor | remembers the stats struct; valor total is stored at `+0 +4 +8 +20 +24 +28`, used at `+2C` |

Each hook replaces the instruction with a jump to a small block of code Hexvane writes into the game, which runs the original instruction and jumps back. Turning cheats off or leaving the campaign puts the original bytes back. If Hexvane restarts while the game runs, it finds its own hooks again instead of failing.

The patterns come from a public Cheat Engine table for this build (FearLess Revolution, "Ryse - Son of Rome (v1.0.0.153) +6"). Only the patterns and offsets were used; no table or script is run.

## Not included

- **Unlimited Spears**: the only public pattern targets a different build and crashed this one.
- **Unlimited Focus**: no public pattern exists for this build, and a memory search hasn't found it yet. The developer tool `src-tauri/examples/ryse_probe.rs` (snapshots of the player struct, plus a value scan that narrows by up / down / unchanged) is there to continue the search.
