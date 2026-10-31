# Graveyard Keeper trainer

A [BepInEx 5](https://github.com/BepInEx/BepInEx) plugin, `Hexvane.Bridge.dll`, that lets the Hexvane app change Graveyard Keeper while it runs. See [How it works](../README.md#how-it-works) for the overall design.

## Cheats

| Cheat | What it does |
| --- | --- |
| Unlimited Health | Keeps health at the maximum while on |
| Unlimited Stamina | Keeps stamina (energy) at the maximum while on |
| Add money | Adds 1 silver, 1 gold or 10 gold |
| Give items | Adds any normal item, tool, weapon, armour or bait to the inventory |

Body parts, souls, graves and workers can't be given, because giving them can break quests.

The locks keep working while the game is in the background (the plugin sets `Application.runInBackground`).

## Commands

The plugin listens on `127.0.0.1:47821`. Send one line and read one line back. Errors start with `err `.

| Command | Reply |
| --- | --- |
| `ping` | `ok` |
| `state` | JSON: `inGame`, `health`, `stamina`, `hp`, `maxHp`, `energy`, `maxEnergy`, `money`, `moneyText` |
| `set health 0\|1` | `ok` |
| `set stamina 0\|1` | `ok` |
| `money <amount>` | `ok`. The game counts in silver: `1` = 1 silver, `100` = 1 gold, `0.01` = 1 copper |
| `give <item id> <count>` | `ok`, or `err inventory is full` |
| `items` | JSON list of `[id, name, type]` for items that can be given |
| `items all` | The same, without the filter |

`money`, `give` and `items` need a loaded save (`err load a save first`). If the game is loading, the reply is `err game is busy`.

## Game fields used

| Value | Field |
| --- | --- |
| Health | `MainGame.me.player.hp`, maximum `MainGame.me.save.max_hp` |
| Stamina | `MainGame.me.player.energy`, maximum `MainGame.me.save.max_energy` |
| Money | `MainGame.me.player.data.money` |
| Give item | `MainGame.me.player.AddToInventory(id, count)` |
| Item list | `GameBalance.me.items_data` |

## Build

Needs the [.NET 8 SDK](https://dotnet.microsoft.com) and BepInEx 5 already installed in the game.

```bash
winget install Microsoft.DotNet.SDK.8
```

```bash
cd trainers/GraveyardKeeper && dotnet build -c Release
```

If the game isn't in the default Steam folder, add `-p:GameDir="<game folder>"`.

## Install and uninstall

With the game closed, copy `bin/Release/net472/Hexvane.Bridge.dll` into `<game folder>/BepInEx/plugins/Hexvane/`. The DLL is locked while the game runs.

To uninstall, delete `<game folder>/BepInEx/plugins/Hexvane/`.

The app doesn't install the plugin yet; it's copied by hand.
