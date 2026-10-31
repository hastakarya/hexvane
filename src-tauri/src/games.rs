use base64::Engine;
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

/// Artwork as local file paths (Steam cache) or https URLs (Epic CDN); None when the store has none.
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

const EPIC_DATA: &str = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data";

fn epic_games() -> Vec<Game> {
    let Ok(entries) = fs::read_dir(Path::new(EPIC_DATA).join("Manifests")) else { return vec![] };
    let catalog = fs::read_to_string(Path::new(EPIC_DATA).join("Catalog\\catcache.bin"))
        .ok()
        .and_then(|b64| base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(serde_json::Value::Null);
    entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "item"))
        .filter_map(|e| parse_epic(&fs::read_to_string(e.path()).ok()?, &catalog))
        .collect()
}

fn parse_epic(text: &str, catalog: &serde_json::Value) -> Option<Game> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let s = |k: &str| v.get(k)?.as_str().map(str::to_owned);
    Some(Game {
        id: format!("epic:{}", s("AppName")?),
        name: s("DisplayName")?,
        store: "Epic",
        install_dir: s("InstallLocation")?,
        art: s("CatalogItemId").map(|item| epic_art(catalog, &item)).unwrap_or_default(),
    })
}

/// Image URLs (Epic CDN) for a catalog item from the launcher's decoded catcache.bin.
fn epic_art(catalog: &serde_json::Value, item_id: &str) -> Art {
    let Some(item) = catalog.as_array().and_then(|items| items.iter().find(|i| i["id"] == item_id)) else { return Art::default() };
    let images = item["keyImages"].as_array().map(Vec::as_slice).unwrap_or_default();
    let find = |types: &[&str]| types.iter().find_map(|t| images.iter().find(|i| i["type"] == *t)?["url"].as_str().map(str::to_owned));
    Art {
        cover: find(&["DieselGameBoxTall", "OfferImageTall", "Thumbnail"]),
        hero: find(&["DieselGameBox", "OfferImageWide", "DieselStoreFrontWide"]),
        logo: find(&["DieselGameBoxLogo"]),
    }
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

/// The launcher URL that starts a game, or None for GOG (started from its exe instead).
fn launch_url(id: &str) -> Option<String> {
    let (store, key) = id.split_once(':')?;
    match store {
        "steam" => Some(format!("steam://rungameid/{key}")),
        "epic" => Some(format!("com.epicgames.launcher://apps/{key}?action=launch&silent=true")),
        _ => None,
    }
}

/// Starts a game through its store's launcher (Steam, Epic), or its exe for GOG.
#[tauri::command]
pub fn launch_game(id: String) -> Result<(), String> {
    if let Some(url) = launch_url(&id) {
        return tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string());
    }
    let gog_id = id.strip_prefix("gog:").ok_or("unknown store")?;
    let key = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(format!("SOFTWARE\\WOW6432Node\\GOG.com\\Games\\{gog_id}"))
        .map_err(|_| "game not found in GOG's registry")?;
    let exe: String = key.get_value("exe").map_err(|_| "GOG has no exe for this game")?;
    let dir: String = key.get_value("workingDir").or_else(|_| key.get_value("path")).unwrap_or_default();
    std::process::Command::new(exe).current_dir(dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn builds_launch_urls() {
        assert_eq!(launch_url("steam:599140").as_deref(), Some("steam://rungameid/599140"));
        assert_eq!(launch_url("epic:Fortnite").as_deref(), Some("com.epicgames.launcher://apps/Fortnite?action=launch&silent=true"));
        assert_eq!(launch_url("gog:123"), None);
    }

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
        let item = r#"{"AppName":"Fortnite","DisplayName":"Fortnite","InstallLocation":"C:\\Games\\Fortnite","CatalogItemId":"abc"}"#;
        let catalog = serde_json::json!([
            {"id": "other", "keyImages": [{"type": "DieselGameBoxTall", "url": "https://x/wrong"}]},
            {"id": "abc", "keyImages": [
                {"type": "DieselGameBox", "url": "https://x/wide"},
                {"type": "DieselGameBoxTall", "url": "https://x/tall"}
            ]}
        ]);
        let g = parse_epic(item, &catalog).unwrap();
        assert_eq!((g.id.as_str(), g.store, g.install_dir.as_str()), ("epic:Fortnite", "Epic", "C:\\Games\\Fortnite"));
        assert_eq!(g.art.cover.as_deref(), Some("https://x/tall"));
        assert_eq!(g.art.hero.as_deref(), Some("https://x/wide"));
        assert!(g.art.logo.is_none());
        assert!(parse_epic("{}", &serde_json::Value::Null).is_none());
        assert_eq!(parse_epic(item, &serde_json::Value::Null).unwrap().art, Art::default());
    }
}
