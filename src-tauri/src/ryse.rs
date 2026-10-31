//! Ryse: Son of Rome (CryEngine 3, native x64). No mod loader, so Hexvane patches the game's memory directly.
//! Cheats only run in campaign levels: the online Colosseum must never be touched.

use crate::native::{find_pid, parse_pattern, Hook, Process};
use serde::Serialize;
use std::sync::Mutex;

const EXE: &str = "Ryse.exe";
// Campaign levels (GameRyse/Levels). Left out on purpose: mp_gladiator (online arena) and Colosseum.
const CAMPAIGN: &[&str] = &["dover", "forum", "glott", "oswald", "palace", "rome", "york"];

// Where the game reads an entity's health: mov r14d,[rcx+40] / mov r12,rcx (build 1.0.0.153).
const HEALTH_READ: &str = "44 8B 71 40 4C 8B E1";
// Where the upgrade menu reads valor: mov eax,[rcx+20] / sub eax,[rcx+2C].
const VALOR_READ: &str = "8B 41 20 2B 41 2C";
// The stats struct keeps the valor total in six places; all must match.
const VALOR_TOTAL: [usize; 6] = [0x0, 0x4, 0x8, 0x20, 0x24, 0x28];
const VALOR_USED: usize = 0x2C;

// Data slots inside the code caves (caves are 0x1000 bytes; code stays below 0x100).
pub const PLAYER_SLOT: usize = 0x100; // health cave: the player entity, seen on its last health read
const UNDEAD_FLAG: usize = 0x108; // health cave: 1 = undead on
const STATS_SLOT: usize = 0x100; // valor cave: the stats struct, seen when the upgrade menu reads it
/// How the health cave starts; tools/ryse_probe finds the cave (and the player pointer) by it.
pub const HEALTH_CAVE_START: &str = "81 79 78 D0 FE 00 00 75 1B 48 89 0D";

struct Session {
    process: Process,
    health: Option<Hook>,
    valor: Option<Hook>,
    allowed: bool,
}

struct Trainer {
    session: Option<Session>,
    want_undead: bool,
}

static STATE: Mutex<Trainer> = Mutex::new(Trainer { session: None, want_undead: false });

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RyseState {
    running: bool,
    level: Option<String>,
    allowed: bool,
    undead: bool,
    /// Valor you can spend; None until the upgrade menu has been opened once this session
    valor: Option<i32>,
    error: Option<String>,
}

impl RyseState {
    fn off(running: bool, error: Option<String>) -> RyseState {
        RyseState { running, level: None, allowed: false, undead: false, valor: None, error }
    }
}

/// The level the game is in, from its log: the last "Loading level X", unless it was unloaded afterwards (menu).
fn current_level(log: &str) -> Option<String> {
    let mut level = None;
    for line in log.lines() {
        if let Some(rest) = line.split("Loading level ").nth(1) {
            level = rest.split_whitespace().next().map(|s| s.to_lowercase());
        } else if line.contains("UnLoadLevel") {
            level = None;
        }
    }
    level
}

fn read_log_tail(install_dir: &str) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(std::path::Path::new(install_dir).join("Game.log")) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(512 * 1024)));
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

fn find(p: &Process, pattern: &str) -> Result<usize, String> {
    let (base, size) = p.module(EXE).ok_or("Couldn't find Ryse.exe in the game process")?;
    // Same choice as Cheat Engine's aobscanmodule: the first match.
    p.scan_module(base, size, &parse_pattern(pattern)).first().copied().ok_or_else(|| {
        "This version of Ryse isn't supported (game code not found). Restart the game if Hexvane was reopened while cheats were on.".into()
    })
}

fn rip(cave: usize, next: usize, target: usize) -> [u8; 4] {
    ((cave + target) as i64 - (cave + next) as i64).to_le_bytes()[..4].try_into().unwrap()
}

/// Remembers the player entity on every health read, and when the undead flag is set keeps a hit from killing.
fn health_cave(cave: usize) -> Vec<u8> {
    let mut c = vec![0x81, 0x79, 0x78, 0xD0, 0xFE, 0x00, 0x00]; //  0 cmp dword [rcx+78],FED0 ; the player?
    c.extend([0x75, 0x1B]); //                                      7 jne original
    c.extend([0x48, 0x89, 0x0D]); //                                9 mov [rip+PLAYER_SLOT],rcx
    c.extend(rip(cave, 16, PLAYER_SLOT));
    c.extend([0x80, 0x3D]); //                                     16 cmp byte [rip+UNDEAD_FLAG],0
    c.extend(rip(cave, 23, UNDEAD_FLAG));
    c.push(0x00);
    c.extend([0x74, 0x0B]); //                                     23 je original
    c.extend([0x39, 0x51, 0x40]); //                               25 cmp [rcx+40],edx ; health above the hit?
    c.extend([0x77, 0x06]); //                                     28 ja original
    c.extend([0x89, 0x51, 0x40]); //                               30 mov [rcx+40],edx ; else health = hit + 1
    c.extend([0xFF, 0x41, 0x40]); //                               33 inc dword [rcx+40]
    c.extend([0x44, 0x8B, 0x71, 0x40, 0x4C, 0x8B, 0xE1]); //       36 original: mov r14d,[rcx+40] / mov r12,rcx
    c
}

fn valor_cave(cave: usize) -> Vec<u8> {
    let mut c = vec![0x48, 0x89, 0x0D]; // mov [rip+STATS_SLOT],rcx ; remember the stats struct
    c.extend(rip(cave, 7, STATS_SLOT));
    c.extend([0x8B, 0x41, 0x20, 0x2B, 0x41, 0x2C]); // original: mov eax,[rcx+20] / sub eax,[rcx+2C]
    c
}

fn parse_bytes(pattern: &str) -> Vec<u8> {
    parse_pattern(pattern).into_iter().map(|b| b.expect("hooked bytes can't be wildcards")).collect()
}

/// Hooks the game code, or takes over our own hook if an earlier Hexvane session (e.g. before a restart) left it in.
fn hook(p: &Process, pattern: &str, len: usize, body: fn(usize) -> Vec<u8>, cave_start: &str) -> Result<Hook, String> {
    let original = &parse_bytes(pattern)[..len];
    match find(p, pattern) {
        Ok(addr) => Hook::install(p, addr, original, body),
        Err(e) => match p.scan_caves(&parse_pattern(cave_start)).first() {
            Some(&cave) => Hook::adopt(p, cave, body(cave).len(), original),
            None => Err(e),
        },
    }
}

/// How the valor cave starts (its stats-slot displacement varies).
const VALOR_CAVE_START: &str = "48 89 0D ?? ?? ?? ?? 8B 41 20 2B 41 2C E9";

/// Undoes every change to the game.
fn remove_all(s: &mut Session) {
    if let Some(h) = s.health.take() {
        let _ = h.remove(&s.process);
    }
    if let Some(h) = s.valor.take() {
        let _ = h.remove(&s.process);
    }
}

/// Brings the game in line with the level and what the player asked for.
fn sync(t: &mut Trainer, install_dir: &str) -> RyseState {
    if t.session.as_ref().is_some_and(|s| !s.process.is_alive()) {
        t.session = None;
    }
    if t.session.is_none() {
        if let Some(pid) = find_pid(EXE) {
            match Process::open(pid) {
                Ok(process) => t.session = Some(Session { process, health: None, valor: None, allowed: false }),
                Err(e) => return RyseState::off(true, Some(e)),
            }
        }
    }
    let Some(s) = t.session.as_mut() else { return RyseState::off(false, None) };

    let level = current_level(&read_log_tail(install_dir));
    s.allowed = level.as_deref().is_some_and(|l| CAMPAIGN.contains(&l));
    let mut error = None;
    if !s.allowed {
        remove_all(s);
    } else {
        if s.health.is_none() {
            match hook(&s.process, HEALTH_READ, 7, health_cave, HEALTH_CAVE_START) {
                Ok(h) => s.health = Some(h),
                Err(e) => error = Some(e),
            }
        }
        if s.valor.is_none() {
            match hook(&s.process, VALOR_READ, 6, valor_cave, VALOR_CAVE_START) {
                Ok(h) => s.valor = Some(h),
                Err(e) => error = error.or(Some(e)),
            }
        }
        if let Some(h) = &s.health {
            let _ = s.process.write(h.cave + UNDEAD_FLAG, &[t.want_undead as u8]);
        }
    }

    let valor = stats(s).ok().and_then(|ptr| {
        let total = s.process.read_i32(ptr + VALOR_TOTAL[3]).ok()?;
        let used = s.process.read_i32(ptr + VALOR_USED).ok()?;
        Some(total - used)
    });
    RyseState {
        running: true,
        level,
        allowed: s.allowed,
        undead: s.health.is_some() && t.want_undead,
        valor,
        error,
    }
}

/// The stats struct pointer the valor hook captured (set once the upgrade menu has been opened).
fn stats(s: &Session) -> Result<usize, String> {
    let hook = s.valor.as_ref().ok_or("Cheats are off outside the campaign.")?;
    match s.process.read_u64(hook.cave + STATS_SLOT)? {
        0 => Err("Open the upgrade menu in the game once, then try again.".into()),
        ptr => Ok(ptr as usize),
    }
}

fn set(install_dir: &str, apply: impl FnOnce(&mut Trainer)) -> Result<RyseState, String> {
    let mut t = STATE.lock().unwrap();
    apply(&mut t);
    let state = sync(&mut t, install_dir);
    match (&state.error, state.allowed) {
        (Some(e), _) => Err(e.clone()),
        (None, false) => Err("Cheats only work in campaign levels.".into()),
        _ => Ok(state),
    }
}

#[tauri::command]
pub fn ryse_state(install_dir: String) -> RyseState {
    sync(&mut STATE.lock().unwrap(), &install_dir)
}

#[tauri::command]
pub fn ryse_set(install_dir: String, cheat: String, on: bool) -> Result<RyseState, String> {
    set(&install_dir, |t| match cheat.as_str() {
        "undead" => t.want_undead = on,
        _ => {}
    })
}

/// Panic key: every cheat off.
#[tauri::command]
pub fn ryse_off(install_dir: String) -> RyseState {
    let mut t = STATE.lock().unwrap();
    t.want_undead = false;
    sync(&mut t, &install_dir)
}

#[tauri::command]
pub fn ryse_add_valor(install_dir: String, amount: i32) -> Result<RyseState, String> {
    let mut t = STATE.lock().unwrap();
    sync(&mut t, &install_dir);
    let s = t.session.as_ref().ok_or("Start Ryse first.")?;
    if !s.allowed {
        return Err("Cheats only work in campaign levels.".into());
    }
    let ptr = stats(s)?;
    let total = s.process.read_i32(ptr + VALOR_TOTAL[3])?;
    let new = total.saturating_add(amount).max(0).to_le_bytes();
    for off in VALOR_TOTAL {
        s.process.write(ptr + off, &new)?;
    }
    Ok(sync(&mut t, &install_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_level_from_log() {
        let log = "x\n==== Loading level palace ====\nUnLoadLevel End: 0.9 sec\n==== Loading level Forum ====\nstuff";
        assert_eq!(current_level(log).as_deref(), Some("forum"));
        assert_eq!(current_level(&format!("{log}\nUnLoadLevel End: 0.6 sec")), None);
        assert_eq!(current_level("==== Loading level mp_gladiator ===="), Some("mp_gladiator".into()));
        assert_eq!(current_level("nothing"), None);
    }

    #[test]
    fn health_cave_jumps_land_on_the_original_code() {
        let cave = 0x10_0000;
        let c = health_cave(cave);
        assert_eq!(c.len(), 43);
        assert!(c.ends_with(&parse_bytes(HEALTH_READ)));
        assert!(c.starts_with(&parse_bytes(HEALTH_CAVE_START)));
        assert_eq!(9 + c[8] as usize, 36); // jne
        assert_eq!(25 + c[24] as usize, 36); // je
        assert_eq!(30 + c[29] as usize, 36); // ja
        let disp = |at: usize| i32::from_le_bytes(c[at..at + 4].try_into().unwrap()) as i64;
        assert_eq!(cave as i64 + 16 + disp(12), (cave + PLAYER_SLOT) as i64);
        assert_eq!(cave as i64 + 23 + disp(18), (cave + UNDEAD_FLAG) as i64);
    }

    #[test]
    fn caves_can_be_found_again_after_a_restart() {
        use crate::native::{find_pattern, jmp};
        for (body, start) in [(health_cave as fn(usize) -> Vec<u8>, HEALTH_CAVE_START), (valor_cave, VALOR_CAVE_START)] {
            let mut code = body(0x2000);
            code.extend(jmp(0x2000 + code.len(), 0x9000));
            assert_eq!(find_pattern(&code, &parse_pattern(start)), vec![0]);
        }
    }

    #[test]
    fn valor_cave_stores_the_stats_pointer() {
        let v = valor_cave(0x1000);
        assert!(v.ends_with(&parse_bytes(VALOR_READ)));
        assert_eq!(0x1000 + 7 + i32::from_le_bytes(v[3..7].try_into().unwrap()) as usize, 0x1000 + STATS_SLOT);
    }
}
