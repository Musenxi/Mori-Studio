//! Mori Studio 桌面版：窗口、启动页（选项目），给打开的项目起一个 Studio 服务（本机的 Node 跑 bin/mori-studio.mjs）。
//! 界面和接口都还是 Studio 自己的：选好项目后，窗口直接打开 http://127.0.0.1:<端口>/。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{hash_map::DefaultHasher, VecDeque};
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, Submenu};
use tauri::{AppHandle, Manager, RunEvent, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

/// Studio 用到的 Vite、Astro 要求的最低版本
const MIN_NODE: (u32, u32) = (22, 12);
const RECENT_MAX: usize = 10;
/// 第一次打开某个项目要构建界面，给足时间
const START_TIMEOUT: Duration = Duration::from_secs(180);
/// 启动页的地址：Windows 上 Tauri 用 http://tauri.localhost，别的系统用 tauri://localhost
const LAUNCHER: &str = if cfg!(windows) { "http://tauri.localhost/index.html" } else { "tauri://localhost/index.html" };

type Log = Arc<Mutex<VecDeque<String>>>;

#[derive(Default)]
struct Studio {
    child: Mutex<Option<Child>>,
    node: Mutex<Option<NodeEnv>>,
}

#[derive(Clone)]
struct NodeEnv {
    node: PathBuf,
    path: String,
}

/// 停掉正在跑的 Studio 服务
fn stop(studio: &Studio) {
    if let Some(mut c) = studio.child.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

/// Windows 上从图形界面程序拉起命令行程序，默认会弹出一个黑色的控制台窗口；不要它
fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// 跑一条命令，最多等 secs 秒，超时就杀掉
fn output_within(cmd: &mut Command, secs: u64) -> Option<String> {
    let mut c = quiet(cmd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut out = c.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        s
    });
    let start = Instant::now();
    loop {
        if c.try_wait().ok()?.is_some() {
            return reader.join().ok();
        }
        if start.elapsed() > Duration::from_secs(secs) {
            let _ = c.kill();
            let _ = c.wait();
            return None;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

/// PATH 和 node 在哪。macOS / Linux：从图形界面启动的程序拿不到终端里设的 PATH（nvm、Homebrew），所以去登录 shell 里问
#[cfg(not(windows))]
fn locate_node() -> (String, String) {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let probe = r#"printf '\n__MORI__%s\n%s\n' "$PATH" "$(command -v node)""#;
    let text = output_within(Command::new(&shell).args(["-ilc", probe]), 8)
        .or_else(|| output_within(Command::new(&shell).args(["-lc", probe]), 8))
        .unwrap_or_default();
    let mut lines = text.lines().skip_while(|l| !l.starts_with("__MORI__"));
    let mut path = lines.next().map(|l| l.trim_start_matches("__MORI__").to_string()).unwrap_or_default();
    if path.is_empty() {
        path = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".into();
    }
    (path, lines.next().unwrap_or("").trim().to_string())
}

/// Windows：图形界面程序本来就带着用户的 PATH，用 where 找 node
#[cfg(windows)]
fn locate_node() -> (String, String) {
    let path = std::env::var("PATH").unwrap_or_default();
    let found = output_within(Command::new("where.exe").arg("node"), 8).unwrap_or_default();
    (path, found.lines().next().unwrap_or("").trim().to_string())
}

const NODE_FALLBACK: &[&str] = if cfg!(windows) { &[r"C:\Program Files\nodejs\node.exe"] } else { &["/opt/homebrew/bin/node", "/usr/local/bin/node"] };

fn node_env() -> Result<NodeEnv, String> {
    let (path, found) = locate_node();
    let node = match std::env::var("MORI_NODE") {
        Ok(n) => PathBuf::from(n),
        Err(_) if !found.is_empty() => PathBuf::from(found),
        Err(_) => NODE_FALLBACK
            .iter()
            .map(PathBuf::from)
            .find(|p| p.exists())
            .ok_or("没有找到 Node.js（要 22.12 或更新）")?,
    };
    let v = output_within(Command::new(&node).arg("-v"), 8).ok_or_else(|| format!("运行 {} 失败", node.display()))?;
    let v = v.trim().trim_start_matches('v').to_string();
    let mut it = v.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
    if (it.next().unwrap_or(0), it.next().unwrap_or(0)) < MIN_NODE {
        return Err(format!("Node.js 是 {v}，要 22.12 或更新"));
    }
    Ok(NodeEnv { node, path })
}

/// Studio 的代码在哪：MORI_STUDIO_DIR > 开发时用仓库根目录 > 打包进应用的 resources/studio
fn studio_dir(app: &AppHandle) -> PathBuf {
    if let Ok(d) = std::env::var("MORI_STUDIO_DIR") {
        return d.into();
    }
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    if cfg!(debug_assertions) {
        return repo;
    }
    if let Ok(r) = app.path().resource_dir() {
        let d = r.join("studio");
        if d.join("bin/mori-studio.mjs").exists() {
            return d;
        }
    }
    repo
}

fn free_port() -> Result<u16, String> {
    let l = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    Ok(l.local_addr().map_err(|e| e.to_string())?.port())
}

/// 把子进程的输出收进来（只留最后几十行，出错时给人看）；不读的话管道满了子进程会卡住
fn drain(child: &mut Child) -> Log {
    let log: Log = Arc::default();
    let pipes: Vec<Box<dyn Read + Send>> = [
        child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>),
        child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>),
    ]
    .into_iter()
    .flatten()
    .collect();
    for pipe in pipes {
        let log = log.clone();
        thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let mut l = log.lock().unwrap();
                l.push_back(line);
                if l.len() > 40 {
                    l.pop_front();
                }
            }
        });
    }
    log
}

/// 出错时给人看的那几行：Studio 启动失败会打印“启动失败：……”
fn failure(log: &Log) -> String {
    let l = log.lock().unwrap();
    l.iter()
        .rev()
        .find(|s| s.contains("启动失败"))
        .cloned()
        .unwrap_or_else(|| l.iter().rev().filter(|s| !s.trim().is_empty()).take(3).cloned().collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n"))
}

fn hash(s: &str) -> String {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn recent_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("recent.json"))
}

fn read_recent(app: &AppHandle) -> Vec<String> {
    recent_file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_recent(app: &AppHandle, list: &[String]) {
    if let Some(f) = recent_file(app) {
        let _ = std::fs::create_dir_all(f.parent().unwrap());
        let _ = std::fs::write(f, serde_json::to_string(list).unwrap());
    }
}

fn folder_name(p: &str) -> String {
    Path::new(p).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.into())
}

#[derive(Serialize)]
struct Recent {
    path: String,
    name: String,
    exists: bool,
}

#[tauri::command]
fn recent_projects(app: AppHandle) -> Vec<Recent> {
    read_recent(&app)
        .into_iter()
        .map(|path| Recent { name: folder_name(&path), exists: Path::new(&path).is_dir(), path })
        .collect()
}

#[tauri::command]
fn forget_project(app: AppHandle, path: String) {
    let list: Vec<String> = read_recent(&app).into_iter().filter(|p| *p != path).collect();
    write_recent(&app, &list);
}

/// 打开项目：起一个 Studio 服务，等它监听上了，窗口转过去
#[tauri::command]
async fn open_project(app: AppHandle, path: String) -> Result<(), String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err("文件夹不存在".into());
    }
    let studio = app.state::<Studio>();
    stop(&studio);
    let env = {
        let mut g = studio.node.lock().unwrap();
        if g.is_none() {
            *g = Some(node_env()?);
        }
        g.clone().unwrap()
    };
    let port = free_port()?;
    // 界面按项目构建（项目里的主题模块会打包进去），每个项目一份，放在应用缓存里
    let ui = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("ui").join(hash(&path));
    let mut child = quiet(&mut Command::new(&env.node))
        .arg(studio_dir(&app).join("bin/mori-studio.mjs"))
        .args(["--root", &path, "--port", &port.to_string()])
        .env("PATH", &env.path)
        .env("MORI_STUDIO_DIST", &ui)
        .env("MORI_STUDIO_PARENT", "stdin") // 管道留在 Child 里不写；我们一退出它就断，Studio 跟着退
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 Studio 失败：{e}"))?;
    let log = drain(&mut child);
    *studio.child.lock().unwrap() = Some(child);

    let start = Instant::now();
    while TcpStream::connect(("127.0.0.1", port)).is_err() {
        let exited = studio.child.lock().unwrap().as_mut().map_or(true, |c| matches!(c.try_wait(), Ok(Some(_))));
        if exited {
            thread::sleep(Duration::from_millis(100)); // 等输出收完
            studio.child.lock().unwrap().take();
            return Err(failure(&log));
        }
        if start.elapsed() > START_TIMEOUT {
            stop(&studio);
            return Err("Studio 三分钟内没有启动".into());
        }
        thread::sleep(Duration::from_millis(200));
    }

    let mut list: Vec<String> = read_recent(&app).into_iter().filter(|p| *p != path).collect();
    list.insert(0, path.clone());
    list.truncate(RECENT_MAX);
    write_recent(&app, &list);

    let w = app.get_webview_window("main").ok_or("没有窗口")?;
    w.set_title(&format!("{} — Mori Studio", folder_name(&path))).map_err(|e| e.to_string())?;
    w.navigate(Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap()).map_err(|e| e.to_string())?;
    Ok(())
}

/// 应用图标：四种底色，菜单里切换，记在应用设置里；打包进去的图标是默认的深墨蓝（应用没开时 Dock、访达、开始菜单显示它）
const ICONS: [(&str, &str, &[u8]); 4] = [
    ("navy", "深墨蓝", include_bytes!("../app-icons/navy.png")),
    ("blue", "克莱因蓝", include_bytes!("../app-icons/blue.png")),
    ("ink", "墨黑", include_bytes!("../app-icons/ink.png")),
    ("paper", "米纸", include_bytes!("../app-icons/paper.png")),
];

/// 菜单里的四个勾选项，切换时更新勾选状态
struct IconMenu(Vec<(&'static str, CheckMenuItem<tauri::Wry>)>);

fn settings_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

fn saved_icon(app: &AppHandle) -> String {
    settings_file(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["icon"].as_str().map(String::from))
        .filter(|id| ICONS.iter().any(|(i, _, _)| i == id))
        .unwrap_or_else(|| ICONS[0].0.into())
}

fn save_icon(app: &AppHandle, id: &str) {
    if let Some(f) = settings_file(app) {
        let mut v = std::fs::read_to_string(&f).ok().and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()).unwrap_or_else(|| serde_json::json!({}));
        v["icon"] = id.into();
        let _ = std::fs::create_dir_all(f.parent().unwrap());
        let _ = std::fs::write(f, v.to_string());
    }
}

/// 换 Dock 上的图标（只在应用开着时有效；要在主线程调用）
#[cfg(target_os = "macos")]
fn set_app_icon(_app: &AppHandle, id: &str) {
    use objc2::AllocAnyThread;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;
    let (Some(mtm), Some((_, _, png))) = (MainThreadMarker::new(), ICONS.iter().find(|(i, _, _)| *i == id)) else { return };
    let data = NSData::with_bytes(png);
    if let Some(img) = NSImage::initWithData(NSImage::alloc(), &data) {
        unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&img)) };
    }
}
/// 别的系统：换窗口和任务栏上的图标
#[cfg(not(target_os = "macos"))]
fn set_app_icon(app: &AppHandle, id: &str) {
    let (Some(w), Some((_, _, png))) = (app.get_webview_window("main"), ICONS.iter().find(|(i, _, _)| *i == id)) else { return };
    if let Ok(img) = tauri::image::Image::from_bytes(png) {
        let _ = w.set_icon(img);
    }
}

/// 回到启动页（菜单“打开项目…”）
fn back_to_launcher(app: &AppHandle) {
    stop(&app.state::<Studio>());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_title("Mori Studio");
        let _ = w.navigate(Url::parse(LAUNCHER).unwrap());
    }
}

/// 启动时查一次更新（GitHub Release 上的 latest.json）；有新版本就问，同意了下载、装好、重启
fn check_update(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Ok(updater) = app.updater() else { return };
        let Ok(Some(update)) = updater.check().await else { return };
        let h = app.clone();
        app.dialog()
            .message(format!("有新版本 {}。", update.version))
            .buttons(MessageDialogButtons::OkCancelCustom("更新并重启".into(), "以后".into()))
            .show(move |yes| {
                if !yes {
                    return;
                }
                tauri::async_runtime::spawn(async move {
                    match update.download_and_install(|_, _| {}, || {}).await {
                        Ok(()) => {
                            stop(&h.state::<Studio>());
                            h.restart();
                        }
                        Err(e) => {
                            h.dialog().message(format!("更新失败：{e}")).show(|_| {});
                        }
                    }
                });
            });
    });
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Studio::default())
        .invoke_handler(tauri::generate_handler![recent_projects, open_project, forget_project])
        .setup(|app| {
            let h = app.handle();
            // 默认菜单（含编辑菜单：没有它，网页里的复制粘贴快捷键在 macOS 上不起作用）再加一个“项目”
            let menu = Menu::default(h)?;
            let open = MenuItem::with_id(h, "open-project", "打开项目…", true, Some("CmdOrCtrl+O"))?;
            menu.insert(&Submenu::with_items(h, "项目", true, &[&open])?, 1)?;
            // 应用菜单（第一个）里加“应用图标”
            let icon = saved_icon(h);
            let checks = ICONS
                .iter()
                .map(|(id, label, _)| CheckMenuItem::with_id(h, format!("icon:{id}"), *label, true, *id == icon, None::<&str>))
                .collect::<Result<Vec<_>, _>>()?;
            let refs: Vec<&dyn tauri::menu::IsMenuItem<_>> = checks.iter().map(|c| c as _).collect();
            if let Some(app_menu) = menu.items()?.first().and_then(|m| m.as_submenu().cloned()) {
                app_menu.insert(&Submenu::with_items(h, "应用图标", true, &refs)?, 1)?;
            }
            app.manage(IconMenu(ICONS.iter().map(|(id, _, _)| *id).zip(checks).collect()));
            app.set_menu(menu)?;
            set_app_icon(h, &icon);
            if !cfg!(debug_assertions) {
                check_update(h.clone());
            }
            // 命令行带了项目目录就直接打开（mori-studio-desktop <目录>）
            if let Some(p) = std::env::args().nth(1).filter(|p| Path::new(p).is_dir()) {
                let h = h.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = open_project(h, p).await {
                        eprintln!("{e}");
                    }
                });
            }
            Ok(())
        })
        .on_menu_event(|app, e| {
            let id = e.id().as_ref();
            if id == "open-project" {
                back_to_launcher(app);
            } else if let Some(icon) = id.strip_prefix("icon:") {
                save_icon(app, icon);
                set_app_icon(app, icon);
                // 只勾选中的那个（点已勾选的那项也保持勾选）
                for (other, item) in &app.state::<IconMenu>().0 {
                    let _ = item.set_checked(*other == icon);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("启动失败");
    app.run(|app, e| {
        if let RunEvent::Exit = e {
            stop(&app.state::<Studio>());
        }
    });
}
