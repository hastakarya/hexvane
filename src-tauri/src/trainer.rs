//! Talks to the Hexvane Bridge plugin running inside a game (see `trainers/`).
//! One text line out, one line back, over 127.0.0.1 only.

use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

const BRIDGE: ([u8; 4], u16) = ([127, 0, 0, 1], 47821);

fn send(command: &str) -> std::io::Result<String> {
    let addr = SocketAddr::from(BRIDGE);
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(300))?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.write_all(format!("{}\n", command.replace('\n', " ")).as_bytes())?;
    let mut reply = String::new();
    BufReader::new(stream).read_line(&mut reply)?;
    Ok(reply.trim_end().to_string())
}

/// Sends one command. Errors: "not running" when the game (or plugin) isn't up, else the plugin's message.
#[tauri::command]
pub async fn trainer_send(command: String) -> Result<String, String> {
    let reply = tauri::async_runtime::spawn_blocking(move || send(&command))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "not running".to_string())?;
    match reply.strip_prefix("err ") {
        Some(message) => Err(message.to_string()),
        None => Ok(reply),
    }
}
