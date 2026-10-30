use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use winreg::RegKey;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub name: String,
    pub store: &'static str,
    pub install_dir: String,
    pub art: Art,
}

/// Local artwork file paths; empty when the store has no cached art for the game.
#[derive(Serialize, Debug, PartialEq, Default)]
pub struct Art {
    pub cover: Option<String>,
    pub hero: Option<String>,
    pub logo: Option<String>,
}

// Steam "apps" that are runtimes, not games
const STEAM_SKIP: &[&str] = &["228980", "1070560", "1391110", "1628350", "1493710"];

#[tauri::command]
pub fn detect_games() -> Vec<Game> {
    let mut games = steam_games();
    games.extend(epic_games());
    games.extend(gog_games());
    // the same Steam library can appear twice (registry path uses '/', libraryfolders.vdf uses '\')
    games.sort_by(|a, b| (a.name.to_lowercase(), &a.id).cmp(&(b.name.to_lowercase(), &b.id)));
    games.dedup_by(|a, b| a.id == b.id);
    games
}

/// Values of every `"key" "value"` line in Valve's KeyValues text (.vdf / .acf).
fn vdf_values(text: &str, key: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('"').collect();
            // a key/value line splits into: indent, key, gap, value, rest
            (parts.len() >= 5 && parts[1].eq_ignore_ascii_case(key)).then(|| parts[3].replace("\\\\", "\\"))
        })
        .collect()
}

fn steam_games() -> Vec<Game> {
    let Ok(steam) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam") else { return vec![] };
    let Ok(steam_path) = steam.get_value::<String, _>("SteamPath") else { return vec![] };
    let steam_path = PathBuf::from(steam_path);

    let mut libraries = vec![steam_path.clone()];
    if let Ok(text) = fs::read_to_string(steam_path.join("steamapps/libraryfolders.vdf")) {
        libraries.extend(vdf_values(&text, "path").into_iter().map(PathBuf::from));
    }
    libraries.sort();
    libraries.dedup();

    let cache = steam_path.join("appcache/librarycache");
    let mut games: Vec<Game> = libraries.iter().flat_map(|lib| steam_library(lib)).collect();
    for g in &mut games {
        g.art = steam_art(&cache.join(g.id.trim_start_matches("steam:")));
    }
    games
}

/// Steam caches artwork per app, either directly in the app folder or one hashed subfolder down.
fn steam_art(app_dir: &Path) -> Art {
    let mut files = vec![];
    if let Ok(entries) = fs::read_dir(app_dir) {
        for e in entries.flatten() {
            match fs::read_dir(e.path()) {
                Ok(sub) => files.extend(sub.flatten().map(|s| s.path())),
                Err(_) => files.push(e.path()),
            }
        }
    }
    let find = |names: &[&str]| {
        names.iter().find_map(|n| files.iter().find(|p| p.file_name().is_some_and(|f| f == *n))).map(|p| p.to_string_lossy().into_owned())
    };
    Art {
        cover: find(&["library_600x900.jpg", "library_capsule.jpg"]),
        hero: find(&["library_hero.jpg"]),
        logo: find(&["logo.png"]),
    }
}

fn steam_library(lib: &Path) -> Vec<Game> {
    let apps = lib.join("steamapps");
    let Ok(entries) = fs::read_dir(&apps) else { return vec![] };
    entries
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("appmanifest_"))
        .filter_map(|e| parse_acf(&fs::read_to_string(e.path()).ok()?, &apps))
        .collect()
}

fn parse_acf(text: &str, apps: &Path) -> Option<Game> {
    let first = |k| vdf_values(text, k).into_iter().next();
    let id = first("appid")?;
    if STEAM_SKIP.contains(&id.as_str()) {
        return None;
    }
    Some(Game {
        name: first("name")?,
        install_dir: apps.join("common").join(first("installdir")?).to_string_lossy().into_owned(),
        id: format!("steam:{id}"),
        store: "Steam",
        art: Art::default(),
    })
}

fn epic_games() -> Vec<Game> {
    let dir = Path::new("C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests");
    let Ok(entries) = fs::read_dir(dir) else { return vec![] };
    entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "item"))
        .filter_map(|e| parse_epic(&fs::read_to_string(e.path()).ok()?))
        .collect()
}

fn parse_epic(text: &str) -> Option<Game> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let s = |k: &str| v.get(k)?.as_str().map(str::to_owned);
    Some(Game {
        id: format!("epic:{}", s("AppName")?),
        name: s("DisplayName")?,
        store: "Epic",
        install_dir: s("InstallLocation")?,
        art: Art::default(),
    })
}

fn gog_games() -> Vec<Game> {
    let Ok(root) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SOFTWARE\\WOW6432Node\\GOG.com\\Games") else { return vec![] };
    root.enum_keys()
        .flatten()
        .filter_map(|id| {
            let key = root.open_subkey(&id).ok()?;
            Some(Game {
                name: key.get_value("gameName").ok()?,
                install_dir: key.get_value("path").ok()?,
                id: format!("gog:{id}"),
                store: "GOG",
                art: Art::default(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_library_paths() {
        let vdf = r#""libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"label"		""
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}"#;
        assert_eq!(vdf_values(vdf, "path"), vec!["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]);
    }

    #[test]
    fn parses_app_manifest_and_skips_runtimes() {
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"620\"\n\t\"name\"\t\t\"Portal 2\"\n\t\"installdir\"\t\t\"Portal 2\"\n}";
        let g = parse_acf(acf, Path::new("D:\\lib\\steamapps")).unwrap();
        assert_eq!((g.id.as_str(), g.name.as_str(), g.store), ("steam:620", "Portal 2", "Steam"));
        assert!(g.install_dir.ends_with("common\\Portal 2"));

        let runtime = acf.replace("620", "228980");
        assert!(parse_acf(&runtime, Path::new("x")).is_none());
    }

    #[test]
    fn finds_steam_art_flat_and_nested() {
        let dir = std::env::temp_dir().join(format!("hexvane-art-{}", std::process::id()));
        fs::create_dir_all(dir.join("abc123")).unwrap();
        fs::write(dir.join("library_600x900.jpg"), b"x").unwrap();
        fs::write(dir.join("abc123").join("logo.png"), b"x").unwrap();
        let art = steam_art(&dir);
        fs::remove_dir_all(&dir).unwrap();
        assert!(art.cover.unwrap().ends_with("library_600x900.jpg"));
        assert!(art.logo.unwrap().ends_with("abc123\\logo.png"));
        assert!(art.hero.is_none());
    }

    #[test]
    fn parses_epic_manifest() {
        let item = r#"{"AppName":"Fortnite","DisplayName":"Fortnite","InstallLocation":"C:\\Games\\Fortnite"}"#;
        let g = parse_epic(item).unwrap();
        assert_eq!((g.id.as_str(), g.store, g.install_dir.as_str()), ("epic:Fortnite", "Epic", "C:\\Games\\Fortnite"));
        assert!(parse_epic("{}").is_none());
    }
}
