mod games;
mod trainer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![games::detect_games, games::launch_game, trainer::trainer_send])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
