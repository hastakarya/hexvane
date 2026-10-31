//! Installs the in-game Hexvane Bridge plugin into a game's BepInEx folder.
//! The plugin ships inside the app (build it first: see trainers/GraveyardKeeper/README.md).

use serde::Serialize;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

// shortcut: one bundled plugin (Graveyard Keeper); key this by game when a second trainer exists
const BRIDGE_DLL: &[u8] = include_bytes!("../../trainers/GraveyardKeeper/bin/Release/net472/Hexvane.Bridge.dll");

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginStatus {
    /// BepInEx 5 is installed in the game (the plugin can't load without it)
    bepinex: bool,
    installed: bool,
    /// The installed copy is the one this app ships
    up_to_date: bool,
}

fn plugin_dir(game_dir: &Path) -> PathBuf {
    game_dir.join("BepInEx").join("plugins").join("Hexvane")
}

fn status(game_dir: &Path, bundled: &[u8]) -> PluginStatus {
    let installed = fs::read(plugin_dir(game_dir).join("Hexvane.Bridge.dll")).ok();
    PluginStatus {
        bepinex: game_dir.join("BepInEx").join("core").join("BepInEx.dll").is_file(),
        up_to_date: installed.as_deref() == Some(bundled),
        installed: installed.is_some(),
    }
}

/// Turns file errors into something a player can act on.
fn explain(e: std::io::Error) -> String {
    match (e.kind(), e.raw_os_error()) {
        // 32: file in use; 1224: DLL loaded by the running game
        (_, Some(32 | 1224)) => "Close the game first: it has the plugin open.".into(),
        (ErrorKind::PermissionDenied, _) => "Windows didn't allow writing to the game folder.".into(),
        _ => e.to_string(),
    }
}

fn install(game_dir: &Path, bundled: &[u8]) -> Result<(), String> {
    if !status(game_dir, bundled).bepinex {
        return Err("BepInEx 5 isn't installed in this game.".into());
    }
    let dir = plugin_dir(game_dir);
    fs::create_dir_all(&dir).map_err(explain)?;
    fs::write(dir.join("Hexvane.Bridge.dll"), bundled).map_err(explain)
}

#[tauri::command]
pub fn plugin_status(game_dir: String) -> PluginStatus {
    status(Path::new(&game_dir), BRIDGE_DLL)
}

#[tauri::command]
pub fn install_plugin(game_dir: String) -> Result<(), String> {
    install(Path::new(&game_dir), BRIDGE_DLL)
}

/// Removes only Hexvane's own folder in BepInEx/plugins.
#[tauri::command]
pub fn uninstall_plugin(game_dir: String) -> Result<(), String> {
    let dir = plugin_dir(Path::new(&game_dir));
    if !dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(dir).map_err(explain)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_only_with_bepinex_and_tracks_version() {
        let game = std::env::temp_dir().join(format!("hexvane-plugin-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&game);
        fs::create_dir_all(&game).unwrap();

        assert_eq!(status(&game, b"v1"), PluginStatus { bepinex: false, installed: false, up_to_date: false });
        assert!(install(&game, b"v1").is_err());

        fs::create_dir_all(game.join("BepInEx/core")).unwrap();
        fs::write(game.join("BepInEx/core/BepInEx.dll"), b"").unwrap();
        install(&game, b"v1").unwrap();
        assert_eq!(status(&game, b"v1"), PluginStatus { bepinex: true, installed: true, up_to_date: true });
        assert!(!status(&game, b"v2").up_to_date);

        fs::remove_dir_all(&game).unwrap();
    }
}
