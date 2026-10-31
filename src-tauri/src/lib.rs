mod games;
mod hotkeys;
pub mod native;
mod plugins;
pub mod ryse;
mod trainer;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // The hotkey toast sits on top of games; clicks must pass through it to whatever is underneath.
            if let Some(toast) = app.get_webview_window("toast") {
                toast.set_ignore_cursor_events(true)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            games::detect_games,
            games::launch_game,
            hotkeys::set_hotkeys,
            trainer::trainer_send,
            plugins::plugin_status,
            plugins::install_plugin,
            plugins::uninstall_plugin,
            ryse::ryse_state,
            ryse::ryse_set,
            ryse::ryse_off,
            ryse::ryse_add_valor
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
