// 端口转发模块 - TCP 流量代理转发，支持连接管理和流量统计

use super::{current_time, generate_id, ForwardRule, ForwardRuleInput, ForwardStats};
use crate::storage;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, Semaphore};
use tokio::time::{timeout, Duration};

/// 转发规则存储 - 延迟初始化
static FORWARD_RULES: Lazy<Arc<Mutex<HashMap<String, ForwardRule>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// 是否已从文件加载
static RULES_LOADED: Lazy<Arc<Mutex<bool>>> = Lazy::new(|| Arc::new(Mutex::new(false)));

/// 转发控制器（用于停止转发）
static FORWARD_CONTROLLERS: Lazy<Arc<Mutex<HashMap<String, Arc<ForwardController>>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// 确保转发规则已从文件加载
async fn ensure_rules_loaded() {
    let mut loaded = RULES_LOADED.lock().await;
    if !*loaded {
        match load_rules_from_file() {
            Ok(rules) => {
                let mut rules_map = FORWARD_RULES.lock().await;
                *rules_map = rules;
                *loaded = true; // 只有成功加载才设置为 true
            }
            Err(e) => {
                log::warn!("加载转发规则失败，将在下次重试: {}", e);
                // 不设置 loaded = true，允许下次重试
            }
        }
    }
}

/// 从文件加载转发规则
fn load_rules_from_file() -> Result<HashMap<String, ForwardRule>, String> {
    let config = storage::get_storage_config()?;
    let path = config.forward_rules_file();

    log::info!("加载转发规则: {:?}", path);

    if !path.exists() {
        log::info!("转发规则文件不存在，返回空列表");
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("读取转发规则失败: {}", e))?;

    let versioned: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析转发规则失败: {}", e))?;

    // VersionedData 使用 flatten，rules 在顶层
    let rules_arr = match versioned.get("rules").and_then(|r| r.as_array()) {
        Some(arr) => arr,
        None => {
            log::info!("转发规则为空，返回空列表");
            return Ok(HashMap::new());
        }
    };

    let mut rules = HashMap::new();
    for rule_val in rules_arr {
        if let Ok(rule) = serde_json::from_value::<serde_json::Value>(rule_val.clone()) {
            let id = rule.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let name = rule.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let local_port = rule.get("local_port").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
            let remote_host = rule.get("remote_host").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let remote_port = rule.get("remote_port").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
            let created_at = rule.get("created_at").and_then(|v| v.as_str()).unwrap_or_default().to_string();

            if !id.is_empty() {
                log::info!("加载转发规则: {} ({}:{} -> {}:{})", name, "localhost", local_port, remote_host, remote_port);
                rules.insert(id.clone(), ForwardRule {
                    id,
                    name,
                    local_port,
                    remote_host,
                    remote_port,
                    status: "stopped".to_string(),
                    connections: 0,
                    bytes_in: 0,
                    bytes_out: 0,
                    created_at,
                });
            }
        }
    }

    log::info!("共加载 {} 个转发规则", rules.len());
    Ok(rules)
}

/// 保存转发规则到文件
async fn save_rules_to_file() -> Result<(), String> {
    let config = storage::get_storage_config()?;

    // 确保数据目录存在
    config.ensure_dirs()?;

    let rules = FORWARD_RULES.lock().await;

    // 只保存持久化需要的字段
    let rules_data: Vec<serde_json::Value> = rules.values().map(|r| {
        serde_json::json!({
            "id": r.id,
            "name": r.name,
            "local_port": r.local_port,
            "remote_host": r.remote_host,
            "remote_port": r.remote_port,
            "created_at": r.created_at
        })
    }).collect();

    // 使用与 VersionedData flatten 一致的格式
    let data = serde_json::json!({
        "version": 1,
        "last_updated": chrono::Utc::now().to_rfc3339(),
        "rules": rules_data
    });

    let content = serde_json::to_string(&data)
        .map_err(|e| format!("序列化转发规则失败: {}", e))?;

    let path = config.forward_rules_file();
    log::info!("保存转发规则到: {:?}", path);

    fs::write(&path, content)
        .map_err(|e| format!("写入转发规则失败: {}", e))?;

    log::info!("转发规则保存成功，共 {} 个规则", rules.len());
    Ok(())
}

/// 转发控制器
struct ForwardController {
    /// 停止标志
    stop: AtomicBool,
    /// 当前连接数
    connections: AtomicU32,
    /// 入站字节数
    bytes_in: AtomicU64,
    /// 出站字节数
    bytes_out: AtomicU64,
}

impl ForwardController {
    fn new() -> Self {
        Self {
            stop: AtomicBool::new(false),
            connections: AtomicU32::new(0),
            bytes_in: AtomicU64::new(0),
            bytes_out: AtomicU64::new(0),
        }
    }

    fn is_stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    fn inc_connections(&self) {
        self.connections.fetch_add(1, Ordering::SeqCst);
    }

    fn dec_connections(&self) {
        self.connections.fetch_sub(1, Ordering::SeqCst);
    }

    fn add_bytes_in(&self, bytes: u64) {
        self.bytes_in.fetch_add(bytes, Ordering::SeqCst);
    }

    fn add_bytes_out(&self, bytes: u64) {
        self.bytes_out.fetch_add(bytes, Ordering::SeqCst);
    }

    fn get_stats(&self) -> (u32, u64, u64) {
        (
            self.connections.load(Ordering::SeqCst),
            self.bytes_in.load(Ordering::SeqCst),
            self.bytes_out.load(Ordering::SeqCst),
        )
    }
}

/// 添加转发规则
#[tauri::command]
pub async fn add_forward_rule(input: ForwardRuleInput) -> Result<ForwardRule, String> {
    ensure_rules_loaded().await;

    // 验证端口
    if input.local_port == 0 {
        return Err("本地端口不能为 0".to_string());
    }
    if input.remote_port == 0 {
        return Err("远程端口不能为 0".to_string());
    }
    if input.remote_host.is_empty() {
        return Err("远程主机不能为空".to_string());
    }

    // 检查端口是否已被使用
    {
        let rules = FORWARD_RULES.lock().await;
        for rule in rules.values() {
            if rule.local_port == input.local_port && rule.status == "running" {
                return Err(format!("端口 {} 已被其他规则使用", input.local_port));
            }
        }
    }

    let rule_id = generate_id();
    let rule = ForwardRule {
        id: rule_id.clone(),
        name: input.name,
        local_port: input.local_port,
        remote_host: input.remote_host,
        remote_port: input.remote_port,
        status: "stopped".to_string(),
        connections: 0,
        bytes_in: 0,
        bytes_out: 0,
        created_at: current_time(),
    };

    // 保存规则
    {
        let mut rules = FORWARD_RULES.lock().await;
        rules.insert(rule_id.clone(), rule.clone());
    }

    // 持久化到文件
    if let Err(e) = save_rules_to_file().await {
        log::error!("保存转发规则失败: {}", e);
        // 移除刚添加的规则，因为无法持久化
        let mut rules = FORWARD_RULES.lock().await;
        rules.remove(&rule_id);
        return Err(format!("保存转发规则失败: {}", e));
    }

    Ok(rule)
}

/// 移除转发规则
#[tauri::command]
pub async fn remove_forward_rule(rule_id: String) -> Result<(), String> {
    ensure_rules_loaded().await;

    // 先停止转发
    let _ = stop_forwarding(rule_id.clone()).await;

    // 保存旧规则以便回滚
    let old_rule = {
        let rules = FORWARD_RULES.lock().await;
        rules.get(&rule_id).cloned()
    };

    // 移除规则
    {
        let mut rules = FORWARD_RULES.lock().await;
        rules.remove(&rule_id);
    }

    // 持久化到文件
    if let Err(e) = save_rules_to_file().await {
        log::error!("保存转发规则失败: {}", e);
        // 回滚：恢复删除的规则
        if let Some(rule) = old_rule {
            let mut rules = FORWARD_RULES.lock().await;
            rules.insert(rule_id, rule);
        }
        return Err(format!("保存转发规则失败: {}", e));
    }

    Ok(())
}

/// 启动转发
#[tauri::command]
pub async fn start_forwarding(rule_id: String) -> Result<(), String> {
    ensure_rules_loaded().await;

    // 获取规则
    let rule = {
        let rules = FORWARD_RULES.lock().await;
        rules.get(&rule_id).cloned()
    };

    let rule = rule.ok_or_else(|| format!("规则不存在: {}", rule_id))?;

    if rule.status == "running" {
        return Err("转发已在运行中".to_string());
    }

    // 创建控制器
    let controller = Arc::new(ForwardController::new());

    // 保存控制器
    {
        let mut controllers = FORWARD_CONTROLLERS.lock().await;
        controllers.insert(rule_id.clone(), controller.clone());
    }

    // 更新状态
    {
        let mut rules = FORWARD_RULES.lock().await;
        if let Some(r) = rules.get_mut(&rule_id) {
            r.status = "running".to_string();
        }
    }

    // 启动转发任务
    let id = rule_id.clone();
    let local_port = rule.local_port;
    let remote_host = rule.remote_host.clone();
    let remote_port = rule.remote_port;

    tokio::spawn(async move {
        if let Err(e) = run_forward_server(&id, local_port, &remote_host, remote_port, controller).await {
            log::error!("转发服务错误: {}", e);
        }

        // 更新状态
        let mut rules = FORWARD_RULES.lock().await;
        if let Some(r) = rules.get_mut(&id) {
            r.status = "stopped".to_string();
        }
    });

    Ok(())
}

/// 运行转发服务器
async fn run_forward_server(
    rule_id: &str,
    local_port: u16,
    remote_host: &str,
    remote_port: u16,
    controller: Arc<ForwardController>,
) -> Result<(), String> {
    let addr = format!("0.0.0.0:{}", local_port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("绑定端口失败: {}", e))?;

    log::info!("转发服务启动: {} -> {}:{}", local_port, remote_host, remote_port);

    // 连接数限制
    let semaphore = Arc::new(Semaphore::new(100));
    let remote_addr = format!("{}:{}", remote_host, remote_port);

    loop {
        // 检查是否需要停止
        if controller.is_stopped() {
            log::info!("转发服务停止: {}", local_port);
            break;
        }

        // 设置接受连接的超时，以便定期检查停止标志
        let accept_result = timeout(Duration::from_secs(1), listener.accept()).await;

        match accept_result {
            Ok(Ok((inbound, peer_addr))) => {
                let permit = semaphore.clone().acquire_owned().await;
                if permit.is_err() {
                    continue;
                }

                let remote = remote_addr.clone();
                let ctrl = controller.clone();
                let id = rule_id.to_string();

                tokio::spawn(async move {
                    let _permit = permit;
                    ctrl.inc_connections();

                    // 更新连接数
                    update_rule_stats(&id).await;

                    if let Err(e) = handle_connection(inbound, &remote, ctrl.clone()).await {
                        log::debug!("连接处理错误 {}: {}", peer_addr, e);
                    }

                    ctrl.dec_connections();

                    // 更新连接数
                    update_rule_stats(&id).await;
                });
            }
            Ok(Err(e)) => {
                log::error!("接受连接错误: {}", e);
            }
            Err(_) => {
                // 超时，继续循环检查停止标志
                continue;
            }
        }
    }

    Ok(())
}

/// 处理单个连接
async fn handle_connection(
    mut inbound: TcpStream,
    remote_addr: &str,
    controller: Arc<ForwardController>,
) -> Result<(), String> {
    // 连接超时
    let connect_timeout = Duration::from_secs(10);

    let mut outbound = timeout(connect_timeout, TcpStream::connect(remote_addr))
        .await
        .map_err(|_| "连接超时".to_string())?
        .map_err(|e| format!("连接远程服务器失败: {}", e))?;

    let (mut ri, mut wi) = inbound.split();
    let (mut ro, mut wo) = outbound.split();

    let ctrl1 = controller.clone();
    let ctrl2 = controller.clone();

    // 设置空闲超时
    let idle_timeout = Duration::from_secs(300); // 5 分钟

    let client_to_server = async {
        let mut buf = [0u8; 8192];
        loop {
            match timeout(idle_timeout, tokio::io::AsyncReadExt::read(&mut ri, &mut buf)).await {
                Ok(Ok(0)) => break,
                Ok(Ok(n)) => {
                    ctrl1.add_bytes_out(n as u64);
                    if tokio::io::AsyncWriteExt::write_all(&mut wo, &buf[..n])
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(Err(_)) | Err(_) => break,
            }
        }
        let _ = wo.shutdown().await;
    };

    let server_to_client = async {
        let mut buf = [0u8; 8192];
        loop {
            match timeout(idle_timeout, tokio::io::AsyncReadExt::read(&mut ro, &mut buf)).await {
                Ok(Ok(0)) => break,
                Ok(Ok(n)) => {
                    ctrl2.add_bytes_in(n as u64);
                    if tokio::io::AsyncWriteExt::write_all(&mut wi, &buf[..n])
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(Err(_)) | Err(_) => break,
            }
        }
        let _ = wi.shutdown().await;
    };

    tokio::join!(client_to_server, server_to_client);

    Ok(())
}

/// 更新规则统计信息
async fn update_rule_stats(rule_id: &str) {
    let stats = {
        let controllers = FORWARD_CONTROLLERS.lock().await;
        controllers.get(rule_id).map(|c| c.get_stats())
    };

    if let Some((connections, bytes_in, bytes_out)) = stats {
        let mut rules = FORWARD_RULES.lock().await;
        if let Some(rule) = rules.get_mut(rule_id) {
            rule.connections = connections;
            rule.bytes_in = bytes_in;
            rule.bytes_out = bytes_out;
        }
    }
}

/// 停止转发
#[tauri::command]
pub async fn stop_forwarding(rule_id: String) -> Result<(), String> {
    log::info!("停止转发: {}", rule_id);

    // 发送停止信号
    {
        let controllers = FORWARD_CONTROLLERS.lock().await;
        if let Some(controller) = controllers.get(&rule_id) {
            controller.stop();
            log::info!("已发送停止信号");
        } else {
            log::warn!("未找到转发控制器: {}", rule_id);
        }
    }

    // 等待一小段时间让服务停止
    tokio::time::sleep(Duration::from_millis(500)).await;

    // 更新状态
    {
        let mut rules = FORWARD_RULES.lock().await;
        if let Some(rule) = rules.get_mut(&rule_id) {
            rule.status = "stopped".to_string();
            log::info!("转发状态已更新为停止");
        }
    }

    // 移除控制器
    {
        let mut controllers = FORWARD_CONTROLLERS.lock().await;
        controllers.remove(&rule_id);
    }

    Ok(())
}

/// 获取所有转发规则
#[tauri::command]
pub async fn get_forward_rules() -> Result<Vec<ForwardRule>, String> {
    ensure_rules_loaded().await;

    // 先更新所有运行中规则的统计信息
    let rule_ids: Vec<String> = {
        let rules = FORWARD_RULES.lock().await;
        rules
            .values()
            .filter(|r| r.status == "running")
            .map(|r| r.id.clone())
            .collect()
    };

    for id in rule_ids {
        update_rule_stats(&id).await;
    }

    let rules = FORWARD_RULES.lock().await;
    Ok(rules.values().cloned().collect())
}

/// 获取单个转发规则
#[tauri::command]
pub async fn get_forward_rule(rule_id: String) -> Result<Option<ForwardRule>, String> {
    ensure_rules_loaded().await;

    update_rule_stats(&rule_id).await;

    let rules = FORWARD_RULES.lock().await;
    Ok(rules.get(&rule_id).cloned())
}

/// 获取转发统计
#[tauri::command]
pub async fn get_forward_stats(rule_id: String) -> Result<ForwardStats, String> {
    let controllers = FORWARD_CONTROLLERS.lock().await;
    let (connections, bytes_in, bytes_out) = controllers
        .get(&rule_id)
        .map(|c| c.get_stats())
        .unwrap_or((0, 0, 0));

    Ok(ForwardStats {
        rule_id,
        connections,
        bytes_in,
        bytes_out,
    })
}

/// 更新转发规则
#[tauri::command]
pub async fn update_forward_rule(rule_id: String, input: ForwardRuleInput) -> Result<ForwardRule, String> {
    ensure_rules_loaded().await;

    // 获取当前规则（用于回滚）
    let current_rule = {
        let rules = FORWARD_RULES.lock().await;
        rules.get(&rule_id).cloned()
    };

    let current = current_rule.ok_or_else(|| format!("规则不存在: {}", rule_id))?;
    let old_rule = current.clone();

    // 如果正在运行，先停止
    if current.status == "running" {
        stop_forwarding(rule_id.clone()).await?;
    }

    // 更新规则
    {
        let mut rules = FORWARD_RULES.lock().await;
        if let Some(rule) = rules.get_mut(&rule_id) {
            rule.name = input.name;
            rule.local_port = input.local_port;
            rule.remote_host = input.remote_host;
            rule.remote_port = input.remote_port;
        }
    }

    // 持久化到文件
    if let Err(e) = save_rules_to_file().await {
        log::error!("保存转发规则失败: {}", e);
        // 回滚：恢复旧规则
        let mut rules = FORWARD_RULES.lock().await;
        rules.insert(rule_id.clone(), old_rule);
        return Err(format!("保存转发规则失败: {}", e));
    }

    let rules = FORWARD_RULES.lock().await;
    rules
        .get(&rule_id)
        .cloned()
        .ok_or_else(|| "规则不存在".to_string())
}
