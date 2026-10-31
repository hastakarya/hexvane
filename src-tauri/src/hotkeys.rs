//! Cheat hotkeys that work whichever window has focus. Registered hotkeys (RegisterHotKey) don't reach Hexvane while
//! some games are in front (Ryse reads the keyboard in a way that swallows them), so this polls the key state instead,
//! like most trainers. Keys aren't blocked: the game sees them too.

use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_MENU, VK_SHIFT};

#[derive(Clone, Copy, Debug, PartialEq)]
struct Combo {
    ctrl: bool,
    alt: bool,
    shift: bool,
    vk: u16,
}

/// The current hotkeys: (id sent back to the page, combo, held at the last poll).
static KEYS: Mutex<Vec<(String, Combo, bool)>> = Mutex::new(Vec::new());
static STARTED: std::sync::Once = std::sync::Once::new();

/// Windows virtual-key code for a key name as the app shows it (browser `KeyboardEvent.key`, upper-cased letters).
fn vk(name: &str) -> Option<u16> {
    let b = name.as_bytes();
    Some(match name {
        _ if b.len() == 1 && b[0].is_ascii_uppercase() => b[0] as u16, // A-Z
        _ if b.len() == 1 && b[0].is_ascii_digit() => b[0] as u16,     // 0-9
        _ if b.len() >= 2 && b[0] == b'F' => {
            let n: u16 = name[1..].parse().ok()?;
            if !(1..=24).contains(&n) {
                return None;
            }
            0x70 + n - 1 // F1-F24
        }
        "Space" => 0x20,
        "Tab" => 0x09,
        "Enter" => 0x0D,
        "Backspace" => 0x08,
        "Insert" => 0x2D,
        "Delete" => 0x2E,
        "Home" => 0x24,
        "End" => 0x23,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "ArrowLeft" => 0x25,
        "ArrowUp" => 0x26,
        "ArrowRight" => 0x27,
        "ArrowDown" => 0x28,
        _ => return None,
    })
}

/// "Ctrl + Shift + F7" -> Combo.
fn parse(label: &str) -> Option<Combo> {
    let mut c = Combo { ctrl: false, alt: false, shift: false, vk: 0 };
    for part in label.split('+').map(str::trim) {
        match part {
            "Ctrl" => c.ctrl = true,
            "Alt" => c.alt = true,
            "Shift" => c.shift = true,
            key => c.vk = vk(key)?,
        }
    }
    (c.vk != 0).then_some(c)
}

fn down(vk: u16) -> bool {
    unsafe { GetAsyncKeyState(vk as i32) as u16 & 0x8000 != 0 }
}

fn held(c: &Combo) -> bool {
    down(c.vk) && down(VK_CONTROL) == c.ctrl && down(VK_MENU) == c.alt && down(VK_SHIFT) == c.shift
}

/// Replaces the hotkeys with `keys` ([id, label] pairs); an empty list turns them off. Returns labels it couldn't read.
/// Each new press emits a "hotkey" event carrying the id.
#[tauri::command]
pub fn set_hotkeys(app: AppHandle, keys: Vec<(String, String)>) -> Vec<String> {
    let mut bad = Vec::new();
    let parsed = keys
        .into_iter()
        .filter_map(|(id, label)| match parse(&label) {
            Some(c) => Some((id, c, true)), // treat as held, so a key already down doesn't fire straight away
            None => {
                bad.push(label);
                None
            }
        })
        .collect();
    *KEYS.lock().unwrap() = parsed;
    STARTED.call_once(|| {
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(25));
            let mut keys = KEYS.lock().unwrap();
            for (id, combo, was) in keys.iter_mut() {
                let now = held(combo);
                if now && !*was {
                    let _ = app.emit("hotkey", id.clone());
                }
                *was = now;
            }
        });
    });
    bad
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_app_labels() {
        assert_eq!(parse("F7"), Some(Combo { ctrl: false, alt: false, shift: false, vk: 0x76 }));
        assert_eq!(parse("Ctrl + F12"), Some(Combo { ctrl: true, alt: false, shift: false, vk: 0x7B }));
        assert_eq!(parse("Ctrl + Alt + Shift + K").map(|c| (c.ctrl, c.alt, c.shift, c.vk)), Some((true, true, true, 0x4B)));
        assert_eq!(parse("1").map(|c| c.vk), Some(0x31));
        assert_eq!(parse("ArrowUp").map(|c| c.vk), Some(0x26));
        assert_eq!(parse("Ctrl + "), None);
        assert_eq!(parse("Wat"), None);
        assert_eq!(parse("F25"), None);
    }
}
