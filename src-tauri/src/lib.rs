use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;

struct TerminalSessionStore {
    next_id: AtomicU64,
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl Default for TerminalSessionStore {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

struct PtySession {
    _master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send>>,
    output: Arc<Mutex<String>>,
    cwd: Mutex<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSession {
    session_id: String,
    cwd: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    output: String,
    cwd: String,
    exited: bool,
}

#[tauri::command]
fn load_terminal_settings(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let settings_path = terminal_settings_path(&app)?;
    if !settings_path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&settings_path).map_err(|error| error.to_string())?;
    let settings = serde_json::from_str(&contents).map_err(|error| error.to_string())?;
    Ok(Some(settings))
}

#[tauri::command]
fn save_terminal_settings(
    app: tauri::AppHandle,
    settings: serde_json::Value,
) -> Result<(), String> {
    let settings_path = terminal_settings_path(&app)?;
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let contents = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(settings_path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
fn create_terminal_session(
    store: tauri::State<'_, TerminalSessionStore>,
    cwd: Option<String>,
) -> Result<TerminalSession, String> {
    let session_number = store.next_id.fetch_add(1, Ordering::Relaxed);
    let session_id = format!("session-{session_number}");
    let cwd = resolve_session_cwd(cwd)?;
    let cwd_string = cwd.to_string_lossy().to_string();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;

    let init_script = format!(
        "Remove-Module PSReadLine -ErrorAction SilentlyContinue; \
         $Host.UI.RawUI.WindowTitle='tauri-termin'; \
         function global:prompt {{ \"$(Get-Location)> \" }}; \
         Set-Location -LiteralPath '{cwd}'",
        cwd = escape_powershell_single_quote(&cwd_string),
    );

    let mut command = CommandBuilder::new("powershell.exe");
    command.args([
        "-NoLogo",
        "-NoProfile",
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        &init_script,
    ]);
    command.cwd(cwd.clone());

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair.master.take_writer().map_err(|error| error.to_string())?;

    let output = Arc::new(Mutex::new(String::new()));
    let output_for_thread = Arc::clone(&output);

    std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let chunk = String::from_utf8_lossy(&buffer[..read]);
                    if let Ok(mut output) = output_for_thread.lock() {
                        output.push_str(&chunk);
                    } else {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let session = PtySession {
        _master: pair.master,
        writer: Mutex::new(writer),
        child: Mutex::new(child),
        output,
        cwd: Mutex::new(cwd_string.clone()),
    };

    store
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire terminal session store".to_string())?
        .insert(session_id.clone(), session);

    Ok(TerminalSession {
        session_id,
        cwd: cwd_string,
    })
}

#[tauri::command]
fn write_terminal_input(
    store: tauri::State<'_, TerminalSessionStore>,
    session_id: &str,
    input: &str,
) -> Result<(), String> {
    let sessions = store
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire terminal session store".to_string())?;
    let session = sessions
        .get(session_id)
        .ok_or_else(|| format!("Unknown terminal session: {session_id}"))?;

    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "Failed to lock terminal writer".to_string())?;

    writer
        .write_all(input.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn resize_terminal(
    store: tauri::State<'_, TerminalSessionStore>,
    session_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = store
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire terminal session store".to_string())?;
    let session = sessions
        .get(session_id)
        .ok_or_else(|| format!("Unknown terminal session: {session_id}"))?;

    session
        ._master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn poll_terminal_output(
    store: tauri::State<'_, TerminalSessionStore>,
    session_id: &str,
) -> Result<TerminalOutput, String> {
    let sessions = store
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire terminal session store".to_string())?;
    let session = sessions
        .get(session_id)
        .ok_or_else(|| format!("Unknown terminal session: {session_id}"))?;

    let drained = {
        let mut output = session
            .output
            .lock()
            .map_err(|_| "Failed to lock terminal output".to_string())?;
        std::mem::take(&mut *output)
    };

    let exited = session
        .child
        .lock()
        .map_err(|_| "Failed to lock terminal child".to_string())?
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_some();

    let cwd = session
        .cwd
        .lock()
        .map_err(|_| "Failed to lock terminal cwd".to_string())?
        .clone();

    Ok(TerminalOutput {
        output: drained,
        cwd,
        exited,
    })
}

#[tauri::command]
fn close_terminal_session(
    store: tauri::State<'_, TerminalSessionStore>,
    session_id: &str,
) -> Result<(), String> {
    let session = store
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire terminal session store".to_string())?
        .remove(session_id)
        .ok_or_else(|| format!("Unknown terminal session: {session_id}"))?;

    let result = session
        .child
        .lock()
        .map_err(|_| "Failed to lock terminal child".to_string())?
        .kill()
        .map_err(|error| error.to_string());

    result
}

fn escape_powershell_single_quote(value: &str) -> String {
    value.replace('\'', "''")
}

fn resolve_session_cwd(cwd: Option<String>) -> Result<PathBuf, String> {
    match cwd {
        Some(path) if !path.trim().is_empty() => {
            let candidate = PathBuf::from(path);
            if candidate.is_dir() {
                Ok(candidate)
            } else {
                Err(format!("Working directory does not exist: {}", candidate.display()))
            }
        }
        _ => env::current_dir().map_err(|error| error.to_string()),
    }
}

fn terminal_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let home_dir = app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?;
    Ok(home_dir
        .join(".config")
        .join("tauri-termin")
        .join("settings.json"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalSessionStore::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_terminal_settings,
            save_terminal_settings,
            create_terminal_session,
            write_terminal_input,
            resize_terminal,
            poll_terminal_output,
            close_terminal_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
