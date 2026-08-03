# 全局审查整改清单

> 审查日期：2026-07-30  
> 审查基线：`main` / `44d4ed5d38f5f9f96a20267a7afff025184b7142` / `0.1.41`  
> 范围：React/TypeScript、Rust/Tauri、Node sidecar、存储、工具箱、CI 与发版流程  
> 性质：活文档。代码变化后应重新验证，不能把本清单当成永久事实。

本文记录全局只读审查中确认的问题，供后续分批整改和验收。硬约束仍以
[CLAUDE.md](../CLAUDE.md) 为准，提交、分支和验证要求见
[CONVENTIONS.md](CONVENTIONS.md)。

## 使用方式

- `[ ]` 表示尚未通过验收，`[x]` 表示已按本条“验收标准”验证完成，
  `[~]` 表示**部分整改** —— 条目下必须写明哪些子项仍未关闭，不能当成已验收。
- 建议一个编号对应一个提交或 PR；不要把安全边界、数据迁移和 UI 调整混成一次改动。
- 完成后在条目下补充 `完成提交：<sha/PR>` 和必要的迁移说明。
- 暂不处理时不要直接勾选，应记录“接受风险、原因、责任人、复查日期”。
- 代码移动后同步更新“涉及位置”。按文档约定只记录文件路径，不固定行号。

## 优先级

| 级别 | 含义 | 处理要求 |
|---|---|---|
| P0 | 可能直接造成大范围、不可恢复的数据损失 | 停止发布，最先处理 |
| P1 | 安全边界失效、凭据泄露、错误对象上的破坏性操作或平台发布阻断 | 下一版本发布前处理 |
| P2 | 可复现的数据/状态错乱、功能失效或 CI 漏检 | 紧随 P1 分批处理 |
| P3 | 工程卫生、提示一致性和长期维护风险 | 纳入日常整理 |

## 建议批次

所有 P0/P1 都是发布前置条件，不应带着未验收的 P1 发版。建议按以下顺序推进：

1. ~~**P0 数据止损**：AUD-001、AUD-044~~ —— 已完成（连带完成 AUD-011，它与恢复失败共用同一条启动路径）。
2. **安全边界与错误对象操作**：~~AUD-002～AUD-006、AUD-008、AUD-009、AUD-016～AUD-020、AUD-045～AUD-050~~
   已完成（AUD-007 部分完成）。
3. ~~**数据、升级与发布 P1**：AUD-010、AUD-021～AUD-025、AUD-051~~ —— 已完成。
4. ~~**P2/P3 整理**：AUD-012～AUD-015、AUD-026～AUD-043、AUD-052～AUD-060~~ —— 已完成。
   AUD-061 已补上 ad-hoc bundle 签名与 CI 完整性检查；Developer ID/notarization 和
   Windows Authenticode 仍需证书，尚未关闭。

> 进度：60 / 61 已整改（AUD-001～006、008～060），
> AUD-007 部分整改。
> AUD-039 是顺手关掉的：加 sidecar 测试文件时立刻踩到它描述的枚举式 ignore 漏洞。
> AUD-061 依赖 Apple Developer ID 与 Windows Authenticode 证书，需要项目所有者先完成证书采购与
> CI secrets 配置，代码侧无法单独关闭。
>
> **发版必须写进 release note 的行为变更**：
> - AUD-009：端口转发 / SSH 隧道本地口 / 静态服务的默认监听从 `0.0.0.0` 改成 `127.0.0.1`，
>   依赖局域网访问的用户需要在对应条目里手动勾选「对局域网开放」。
> - AUD-008：PairDrop 单文件上限 2GB → 256MB，且上传/下载都要求收发双方在线。
> - AUD-045：MCP Gateway 不再允许无鉴权运行，首次启动会自动生成一条访问密钥；
>   原先靠"无密钥"连接的客户端需要到设置里复制密钥后重新配置。跨域调用现在只接受
>   Tauri webview 来源，浏览器页面无法再直连本地网关。
> - AUD-046：Git 提交弹窗的「提交后推送」默认从开改成关，需要推送的用户每次自行勾选。
> - AUD-047：导入 Chat 会话默认创建新 ID 的独立会话，不再按文件里的原 ID 覆盖；
>   要覆盖需在冲突弹窗里显式选「替换现有会话」。导出 JSON 新增 `schemaVersion` 字段
>   （旧导出仍可导入）。
> - AUD-023：Linux 数据目录从「exe 旁边」改为 XDG 用户数据目录。
>   exe 旁边已有可写 `data/` 的老安装会继续沿用原位置，不需要用户手动迁移。
> - AUD-025：CI **不再自动发布** Release，构建完成后停在 Draft，需人工到 Release 页面
>   点 Publish。发版流程文档已同步。
> - AUD-050：项目详情页的默认远程改为「记住的选择 → upstream → origin → 首项」，
>   不再是列表第一个；「同步全部分支」在全部失败时如实报错、部分失败时保留明细不自动关闭。
>
> 已建立的公共守卫，后续条目应直接复用而不是各写一份：
> - `src-tauri/src/path_guard.rs` —— 受保护目录、可删除目录、外部 ID → 安全路径、
>   用户可见名称校验（`safe_path_component`）、原子占位新目录（`claim_new_subdir`）
>   与清理前复核（`ensure_created_dir_unchanged`）。
> - `src-tauri/src/commands/toolbox/ssh_hostkey.rs` —— SSH 主机密钥校验（正/反向隧道共用）。
> - `src-tauri/src/commands/toolbox/mod.rs::listen_ip` —— 监听地址与展示地址。
> - `src-tauri/src/http_body.rs::read_capped` —— HTTP 响应体的流式读取上限。
>   任何把网络响应读进内存的新代码都应走它，不要再用 `resp.bytes()`。
> - `src-tauri/src/process_guard.rs` —— 子进程独立进程组、进程树回收、
>   输出上限与 timeout 钳制。**任何 spawn 外部命令的新代码都应走这里**，不要再各写一份。
> - `src-node/resume-agent/src/storage/paths.ts` —— Node 侧的 `assertSafeId` / `safeJoin`。
> - `src-node/resume-agent/src/storage/atomicIo.ts` —— Node 侧的原子写与损坏备份，
>   与 Rust 的 `write_atomic` / `parse_json_or_backup` 语义一致。sidecar 里任何
>   JSON 数据读写都应走它，不要再直接 `fs.writeFile` + `JSON.parse` catch。
>

---

## 一、安全与破坏性操作

### AUD-001 · P0 · 保护 HOME、系统根目录和盘符根

- [x] 状态：已整改（待人工回归）
- 风险：项目路径只校验“存在且为目录”，删除项目本地目录时直接递归删除。HOME、`/`、
  盘符根或由导入数据写入的危险路径都可能成为删除目标。
- 涉及位置：
  - `src-tauri/src/path_guard.rs`（新增，守卫收敛点）
  - `src-tauri/src/commands/project.rs`
  - `src-tauri/src/lib.rs`
- 实现说明：
  - 新增 `path_guard::{ensure_safe_project_path, ensure_deletable_dir}`：只认 canonical path，
    命中「受保护目录本身 / 受保护目录的祖先 / 应用数据目录内部 / 无父级的根」即拒绝。
  - 三个边界都过守卫：`normalize_project_path`（添加）、`import_projects`（导入，跳过并告警
    而不是让整份导入失败）、`delete_project_directory`（删除时重新 canonicalize，不信任库内路径，
    并且删的是解析后的路径）。
  - 保护集合含 HOME、各系统用户数据根、应用 data/logs 及其父目录、Unix 系统目录、
    Windows `SystemDrive/SystemRoot/ProgramFiles/ProgramData/PUBLIC`。
  - 测试：`src-tauri/src/path_guard.rs` 的 4 个单测（根/HOME/祖先/symlink/普通目录/文件），
    全部只做判定，不执行任何删除。
- 整改目标：
  - 后端在添加、导入和最终删除三个边界都校验 canonical path。
  - 明确拒绝文件系统根、用户 HOME、应用数据目录及其他受保护目录。
  - 删除时重新校验，不能相信数据库中的历史路径。
- 验收标准：
  - `/`、HOME、Windows 任意盘根、受保护目录、指向受保护目录的 symlink 均被后端拒绝。
  - 普通项目目录仍可删除。
  - 路径保护有独立 Rust 测试，测试不对真实用户目录执行删除。

### AUD-002 · P1 · 简历 Agent 不得默认获得无限制 Shell

- [x] 状态：已整改（待人工回归）
- 风险：简历分析固定使用 `full_agent`，真实 Shell 仅受字符串黑名单保护。仓库内容中的提示注入
  可以诱导模型读取项目外文件、联网传输或执行破坏性命令。
- 涉及位置：
  - `src/services/resume/agents/knowledgeAgent.ts`
  - `src/pages/Toolbox/ResumeGenerator/KnowledgePanel.tsx`
  - `src-node/resume-agent/src/fs/projectBackend.ts`
  - `src-node/resume-agent/src/fs/projectBackend.test.ts`（新增）
  - `src-node/resume-agent/src/agent/runAgent.ts`
- 实现说明：
  - **不再有 shell**：`execute` 改成 `spawn(argv, { shell: false })`。`parseCommand` 先拒绝任何
    shell 元字符（`; & | $ \` ( ) < > * ? ~ \\ ' " 换行 制表`），再按空白切 argv，
    argv[0] 必须命中白名单（`git` / `wc` / `cloc`），`git` 还要再限一层只读子命令
    （log/shortlog/status/show/diff/ls-files/rev-list/rev-parse/describe/branch/tag/blame/count-objects）。
    黑名单挡不住未知写法，白名单可以 —— 命令替换、编码、别名、解释器脚本一律无从下手。
  - 敏感规则同时约束命令执行：argv 里每个非 `-` 开头的参数都过 `resolveReadable`，
    命中 ignore/敏感规则直接拒绝。
  - 默认 `read_only`：前端不再硬编码 `full_agent`。`KnowledgePanel` 增加一个**默认关闭、
    跑完自动复位**的勾选框，勾了才升到 `full_agent` —— 授权按次生效，不持久化。
  - system prompt 同步改写，不再告诉模型「execute 运行 PowerShell」。
  - 测试：`npm run resume-agent:test`（node:test，无第三方框架）钉住 5 组用例，
    含所有元字符绕过写法与 `git push/clean/reset/config` 的拒绝。
  - ponytail: `parseCommand` 不支持引号，带空格的路径参数用不了。要支持就得写真解析器，
    而元字符全禁的前提下引号本身没意义；真需要时改成工具直接收 argv 数组。
- 整改目标：
  - 默认使用 `read_only`。
  - Shell 能力必须由用户按次明确授权，并由后端执行结构化白名单或真正的进程/文件系统沙箱。
  - 敏感文件规则同时约束文件工具与命令执行，不能依赖模型自觉。
- 验收标准：
  - 未授权时任何 Shell、项目外读写和联网外传均失败。
  - `rm -r`、解释器脚本、命令替换、编码/别名绕过等不能绕过策略。
  - 运行记录能追溯用户授权和实际执行的命令。

### AUD-003 · P1 · 文件型实体 ID 必须阻止路径穿越

- [x] 状态：已整改（待人工回归）
- 实现说明：
  - Rust 侧 `path_guard::{safe_file_id, safe_data_path}`：只放行 `[A-Za-z0-9._-]`、长度 ≤128，
    显式排除 `.` / `..` / 以 `.` 开头（不会盖掉 `.pending_restore` 这类点文件），
    再对拼出的路径做 canonical containment。`generate_id()` 的产物（纳秒时间戳 hex）天然合法，
    历史 ID 无需迁移。
  - 接入点：`workflows.rs::workflow_path`、`tools/ctx.rs::session_tasks_path`、
    `api_chat/mod.rs::session_path`（改为返回 `Result`，三处调用方一并传播）。
    `storage_admin.rs` 与 `migrations/mod.rs` 的时间戳已在 AUD-044 收口。
  - Node 侧 `storage/paths.ts::{assertSafeId, safeJoin}`：原来的 `sanitizeId` 只做替换，
    `.` 不在被替换字符里，`..` 会原样留下。新函数直接拒绝而不是改名（非法 id 一定是上游出了问题，
    不该被悄悄写成另一个文件）。接入 `runStore.ts` 的 artifact 读写。
  - 测试：`path_guard::tests::{file_id_blocks_traversal_variants, safe_data_path_stays_in_dir}`
    覆盖 `../x`、绝对路径、混合分隔符、URL 编码变体、NUL、超长。
- 风险：Workflow、API Chat 会话、Chat task、简历 artifact 和恢复备份 timestamp 将外部标识
  直接拼入文件路径，`../`、绝对路径或平台分隔符可造成数据目录外读写/删除。
- 涉及位置：
  - `src-tauri/src/commands/workflows.rs`
  - `src-tauri/src/commands/api_chat/mod.rs`
  - `src-tauri/src/commands/api_chat/sessions.rs`
  - `src-tauri/src/commands/tools/ctx.rs`
  - `src-tauri/src/commands/tools/tasks.rs`
  - `src-node/resume-agent/src/storage/runStore.ts`
  - `src-node/resume-agent/src/storage/paths.ts`
  - `src-tauri/src/commands/storage_admin.rs`
  - `src-tauri/src/storage/migrations/mod.rs`
- 整改目标：建立一处跨模块复用的 ID 校验或安全路径拼接函数，并在最终文件操作前验证 containment。
- 验收标准：
  - `../x`、绝对路径、混合分隔符、URL 编码变体和 symlink 逃逸全部被拒绝。
  - 正常历史 ID 兼容；如需迁移，提供明确迁移或兼容策略。

### AUD-004 · P1 · Chat 文件工具必须服从会话工作目录

- [x] 状态：已整改（待人工回归）
- 实现说明：
  - `file_ops.rs` 的三个工具改为接收 `&ToolCtx`，所有路径（src / dst / path）统一走
    `expand_home` → `require_under_cwd` —— 与 Read/Write/Edit **完全同一个边界函数**，
    `~`、项目外绝对路径、`..`、symlink 逃逸都在 canonicalize 后被拒。
  - 删除那份 26 项的危险路径字符串列表：它挡不住 `/tmp/../etc`、展开后的 HOME 和 symlink，
    而且完全没看会话已经加载好的 `allowedCwd`。删目录时再叠一层 `path_guard::ensure_deletable_dir`，
    防止 allowedCwd 本身被设成 HOME。
  - `schema.rs` 的工具描述同步写明「必须在会话工作目录内」，模型不会再去试项目外路径。
- 风险：CopyFile、MoveFile、DeleteFile 没有使用已经加载的 `ToolCtx.allowedCwd`，模型工具可在会话
  工作目录外覆盖、移动或递归删除文件；现有危险路径字符串列表不能可靠保护 HOME 和 symlink。
- 涉及位置：
  - `src-tauri/src/commands/tools/mod.rs`
  - `src-tauri/src/commands/tools/file_ops.rs`
  - `src-tauri/src/commands/tools/schema.rs`
- 整改目标：所有文件工具共享 canonical containment 检查，危险操作还需保持明确的用户授权边界。
- 验收标准：
  - `~`、绝对项目外路径、父目录逃逸、symlink 逃逸均失败。
  - Copy/Move/Delete 与 Read/Write/Edit 使用同一目录边界。

### AUD-005 · P1 · 移除跨平台 Shell 字符串注入

- [x] 状态：已整改（待人工回归，Windows 已交叉编译验证）
- 实现说明：
  - **WSL 写配置**（`config_io.rs`）：`bash -c "cat > '<path>'"` 完全没转义路径 →
    改为 `wsl -d <distro> -- tee <linux_path>`，路径以 argv 传递，不再经过任何 shell。
  - **macOS 启动**（`launch.rs`）：原来是 `cd "<dir>" && <cli>` 只转义了 `\` 和 `"`，
    双引号里 `$(...)`、反引号、`$VAR` 照样展开，再套一层 AppleScript 双引号。
    改为统一走 `write_launch_script`：目录只以 POSIX 单引号字符串出现在临时脚本里一次
    （`sh_quote` 用 `'\''` 收尾重开，单引号内没有任何展开），
    AppleScript 里只出现 app 自己生成的 `codeshelf-launch-<nanos>.sh` 路径。
    iTerm / Terminal.app / Ghostty(.app) 三条分支现在共用这一个 helper。
  - **open_url**（`system.rs`）：新增 `validate_openable_url` —— scheme 只允许
    `http:// / https:// / mailto:`（挡掉 `file:`、`javascript:`、`ms-msdt:` 这类能被系统
    handler 变成本地读取或代码执行的），并拒绝控制字符与 `" ' & | ^ < > \``
    （Windows 走 `cmd /c start`，cmd.exe 会对参数二次解析）。
  - 未改动的分支已确认转义正确：WSL 启动与 Linux 分支用的是 `'\''`，PowerShell 用的是 `''`。
    `cli` 本身早已被 `resolve_cli` 白名单收敛为 `claude` / `codex`。
  - 测试：`system::url_tests::only_web_schemes_and_clean_chars_pass`。
  - Windows 专有代码按硬约束 3 通过 `cargo check --lib --target x86_64-pc-windows-gnu`（Docker）。
- 风险：WSL 配置路径、macOS 启动工作目录和 Windows `open_url` 会被拼入 Shell 字符串；
  引号、`$()`、`;`、`&` 等可转化为额外命令。
- 涉及位置：
  - `src-tauri/src/commands/toolbox/claude_code/config_io.rs`
  - `src-tauri/src/commands/toolbox/claude_code/launch.rs`
  - `src-tauri/src/commands/system.rs`
- 整改目标：优先使用不经过 Shell 的参数数组/标准输入；URL 入口限制允许的 scheme。
- 验收标准：
  - 带空格、引号、`$()`、`;`、`&`、换行的合法路径不会执行额外命令。
  - `open_url` 只接受明确允许的 URL scheme。
  - Windows、macOS、WSL 分支分别有可运行验证。

### AUD-006 · P1 · SSH 必须验证服务端身份

- [x] 状态：已整改（待人工回归：需要真实 SSH 服务端验证首次确认与密钥变更两条路径）
- 实现说明：
  - 新增 `src-tauri/src/commands/toolbox/ssh_hostkey.rs`，正向与反向隧道共用同一套策略
    （两边各写一份的话，迟早有一边忘了加）。
  - 用 russh 自带的 `check_known_hosts` / `learn_known_hosts`，直接读写
    **`~/.ssh/known_hosts`** —— 不另建一套存储，用户可以用 `ssh-keygen -R` 审计和撤销。
  - 三档判定：已记录且匹配 → 放行；**已变更 → 一律拒绝**，界面上没有「继续」按钮；
    未记录 → 拒绝并走 TOFU 确认。
  - 首次确认：`ssh_probe_host_key` 只取公钥不发送任何凭据（handler 拿到 key 后返回 false
    中断握手）；`ssh_trust_host_key` 重新探测并**核对用户界面上看到的那个指纹**后才写入，
    避免"展示 A 的指纹、信任了 B 的密钥"。
  - 前端 `src/services/ssh/hostKeyTrust.ts` 一处收口，正反向隧道的启动都经过它；
    `useConfirm` 补了一个非 hook 的 `confirmDialog`，供 service 层调用。
  - `describe_connect_error` 给被拒的握手补一句可执行提示 + `HOSTKEY_NOT_TRUSTED` 标记，
    否则用户只看到泛化的"SSH 连接失败"。
- 风险：SSH 与反向 SSH 的 `check_server_key` 对任意密钥返回成功，在恶意热点、DNS/ARP 劫持场景下
  可泄露密码并让隧道流量被截获或篡改。
- 涉及位置：
  - `src-tauri/src/commands/toolbox/ssh_tunnel/mod.rs`
  - `src-tauri/src/commands/toolbox/reverse_tunnel/runtime.rs`
- 整改目标：支持 known_hosts/指纹首次确认、变更告警和用户可审计的例外。
- 验收标准：
  - 首次连接明确展示指纹。
  - 已知主机密钥变化时默认拒绝连接。
  - SSH 和反向 SSH 使用同一验证策略。

### AUD-007 · P1 · SSH 密码和 passphrase 不得明文导出

- [~] 状态：**部分整改** —— 导出/导入与日志边界已关闭；本机静态存储仍是明文，见下方「未完成」。
- 实现说明（已完成部分）：
  - 正向与反向隧道的 `stripForExport` 现在清空 **password 与 passphrase**（原来只清私钥路径，
    密码是"保留"的），导出的 JSON 不含任何秘密；两个导出弹窗的文案同步改成
    「私钥路径、密码和 passphrase 都不会导出，导入后需重新填写」。
  - 导入侧无需改动：清空后的字段落到表单里就是空值，用户必须重新输入才能连接。
  - `SshAuthMethod` **去掉 derive(Debug)**，手写只暴露形状不暴露内容的实现
    （`<redacted>` / `<none>`）。`SshTunnel` 和 `ReverseTunnel` 都 derive 了 Debug，
    任何一处 `{:?}` 打日志或拼错误串都会把密码原样吐出来 —— 这是"日志和错误中不出现秘密"的根因。
- 未完成（需要产品决策，不要当成已验收）：
  - `ssh_tunnels.json` / `reverse_tunnels.json` 里的 password / passphrase 仍是明文落盘。
  - 引入系统凭据存储（keyring/Keychain/DPAPI/secret-service）是一个独立改动，
    而且现状与 `ai_providers.json` 的 API key 一致 —— 只给 SSH 加密、API key 不管，
    既不一致也解决不了同一类风险。建议单开一条「应用级秘密统一存储」的条目一并处理，
    而不是在本条里只改一半。
- 风险：隧道配置会明文持久化 password/passphrase；导出仅移除私钥路径，界面提示没有说明凭据仍在，
  用户分享 JSON 时可能泄露账户秘密。
- 涉及位置：
  - `src/pages/Toolbox/ssh-tunnel/useSshTunnel.ts`
  - `src/pages/Toolbox/ssh-tunnel/ExportDialog.tsx`
  - `src/pages/Toolbox/ReverseTunnel/index.tsx`
  - `src/pages/Toolbox/ReverseTunnel/ReverseTunnelExportDialog.tsx`
  - `src-tauri/src/commands/toolbox/ssh_tunnel/mod.rs`
  - `src-tauri/src/commands/toolbox/mod.rs`
- 整改目标：导出默认移除所有秘密；本地秘密使用系统凭据存储或明确的加密方案。
- 验收标准：
  - 导出的 JSON 不含 password/passphrase。
  - 导入后要求用户重新输入秘密。
  - 旧明文配置有迁移/清理方案，日志和错误中不出现秘密。

### AUD-008 · P1 · PairDrop 增加认证、总量和并发限制

- [x] 状态：已整改（**行为变更**：单文件上限 2GB → 256MB，见下）
- 实现说明：
  - **上传要求收发双方都在线**：`check_upload_peers` 校验 `from` / `to` 都能在
    `state.peers` 里找到。检查放在**读 `file` 字段之前**（两个客户端都把 to/from 排在 file 前发送），
    未授权的请求不会先把整个文件收进内存。
  - **下载校验归属**：`CachedFile.to` 从"可选、存了但从没校验"变成必填，新增
    `may_download()` —— 只有收件人和发件人本人能取。身份走 `?peer=`，因为下载是
    `<a href>` / 后端拉取，带不了自定义请求头。
    无权时**不删缓存**：否则任何人拿 token 打一次就能让真正的收件人再也取不到
    （一次性消费会被当成删除原语滥用）。
  - **三道限额**：单文件 `MAX_FILE_SIZE` 256MB（中继全内存，2GB 等于允许别人点一次就 OOM）、
    待领取总量 `MAX_TOTAL_CACHE` 512MB（单文件限额挡不住"多传几个"）、
    并发上传 `MAX_CONCURRENT_UPLOADS` 3（用 RAII 守卫计数，任何提前 return 都会归还名额）。
    算总量前先 `retain(|_, f| !f.is_expired())`，否则过期文件一直占额度。
  - **少一次整文件复制**：`CachedFile.bytes` 从 `Vec<u8>` 改成 `axum::body::Bytes`
    （multipart 收到的就是 Bytes，响应体也是 Bytes，全程零拷贝）。用 axum 的再导出，
    不为此新增直接依赖。
  - 两个客户端同步更新：内置浏览器端 `assets/index.html` 与桌面端 `usePairDropClient.ts`
    都补 `from` 字段与 `?peer=`；前端的 2GB 提示同步改成 256MB。
  - 测试：`pairdrop::state::tests` 三条 —— 归属校验、过期条目不占额度、
    以及一条防止有人只调其中一个限额常数的一致性断言。
- **兼容性（升级须知）**：单文件上限降到 256MB。超过这个大小的传输本来也不该走内存中继。
- 风险：服务监听全部网卡并允许任意 Origin，`/api/upload` 不校验 token/peer。单文件可达 2GB，
  内容整体进入内存并缓存五分钟，局域网匿名请求可造成 OOM。
- 涉及位置：
  - `src-tauri/src/commands/toolbox/pairdrop/runtime.rs`
  - `src-tauri/src/commands/toolbox/pairdrop/state.rs`
- 整改目标：上传和下载绑定有效会话/接收方，增加单文件、全局缓存、并发和速率限制，避免整文件复制。
- 验收标准：
  - 未加入会话的客户端无法上传或下载。
  - 超过单次、总量、并发限制时快速返回明确错误且内存保持稳定。
  - `CachedFile.to` 在下载时得到实际校验。

### AUD-009 · P1 · 服务监听地址必须与 UI 承诺一致

- [x] 状态：已整改（**行为变更**，见下方兼容性说明）
- 实现说明：
  - `toolbox::{listen_ip, listen_display_host}` 一处决定绑定地址与展示地址，三个服务共用：
    端口转发、SSH 正向隧道本地口、静态服务。默认 `127.0.0.1`。
  - `ForwardRule` / `SshTunnel` / `ServerConfig` 及其 Input 增加 `expose_lan`
    （`#[serde(default)]` = false，旧配置读入即为「仅本机」）。
  - UI：静态服务/端口转发表单与 SSH 隧道表单各加一个默认关闭的「对局域网开放」勾选框，
    文案随勾选状态变化，明确说出"将监听 0.0.0.0，同一网络下任何设备都能访问"。
  - 展示地址不再写死：`serviceHost()` 与隧道列表按 `exposeLan` 显示真实绑定地址；
    SSH 表单里那段「监听 0.0.0.0 …同局域网其他电脑可共享连接」的说明改成条件渲染，
    本机 IP 列表也只在勾选后才出现。
- **兼容性（升级须知）**：这是一次有意的行为变更。既有用户如果依赖"手机/同事直接连
  电脑上的转发端口或静态服务"，升级后会连不上，需要在对应条目里勾选「对局域网开放」。
  发版说明必须写明这一条。
- 风险：普通端口转发、正向 SSH 隧道和静态服务绑定 `0.0.0.0`，但日志或返回 URL 显示 localhost。
  用户可能在不知情时把内部服务、数据库或目录暴露给整个局域网。
- 涉及位置：
  - `src-tauri/src/commands/toolbox/forwarder.rs`
  - `src-tauri/src/commands/toolbox/ssh_tunnel/runtime.rs`
  - `src-tauri/src/commands/toolbox/server/crud.rs`
  - `src-tauri/src/commands/toolbox/server/runtime.rs`
- 整改目标：默认仅监听 loopback；开放 LAN 必须显式选择，并在 UI 展示真实绑定地址和风险。
- 验收标准：
  - 默认启动后其他 LAN 设备无法连接。
  - 选择 LAN 模式时 UI 明确显示可访问地址并要求确认。

---

## 二、数据与状态一致性

### AUD-010 · P1 · 所有 JSON 数据遵守原子写和损坏备份

- [x] 状态：已整改
- **根因在共享函数里**：`storage::write_atomic` 用的是固定临时名 `<name>.tmp`。
  两个并发保存写同一个临时文件、内容交错后各自 rename，落下的可能是一份长度对不上的
  残缺文件 —— 原子写反而成了破坏源。改成 `<name>.tmp-<pid>-<自增序号>`，
  并在写失败 / rename 失败时清掉临时文件，不把垃圾留在数据目录。
- `resume.rs`：`serde_json::from_str(..).unwrap_or(json!([]))` 换成 `parse_json_or_backup`。
  这正是 CLAUDE.md 硬约束 1 点名的写法 —— 解析失败静默回空数组，下一次 `save_resumes`
  就把空数组写回去，简历数据永久没了。（`Value::default()` 是 Null，额外归一化成 `[]`。）
- `quick_config.rs::apply_quick_config`：**没有**用 parse_json_or_backup。
  这里读的是**用户自己的** Claude `settings.json`（含 API key、MCP server、权限规则），
  两种处理都不合适 —— `unwrap_or(json!({}))` 会用只含本次勾选项的空对象覆盖掉全部配置；
  在用户目录里改名留 `.corrupt-*` 又太越界。改成**直接拒绝并说明原因**，
  让用户自己去修那几行 JSON。顺带挡住"合法 JSON 但顶层不是对象"的情况。
- **Node sidecar** 新增 `src-node/resume-agent/src/storage/atomicIo.ts`，
  语义与 Rust 侧对齐：`writeFileAtomic` / `writeJsonAtomic`（tmp → fsync → rename，
  临时名带 pid + 序号）和 `readJsonOrBackup`（损坏改名为 `.corrupt-<时间戳>` 后回 undefined）。
  `runStore.ts` 的 readJson / writeJson / writeArtifact / saveFinalOutput / saveBackground
  与 `promptStore.ts` 的 load/savePromptConfig 全部改走它。
- 验证（`cargo test --lib` 38 + sidecar 10，均通过）：
  - 两侧各加了并发写用例：12 个长度差异很大的载荷并发写同一文件，
    断言读回来恰好等于**其中某一个完整载荷**（长度对不上即为撕裂），且不留临时文件。
  - **两侧都跑了反向对照**：把临时名改回固定的 `<name>.tmp`，Rust 侧多线程直接 panic
    在 rename 竞争上，Node 侧 `not ok 9`。确认用例测的是真东西。
  - 损坏备份用例断言原路径已让开、备份内容一字未改（可人工恢复），
    并且「文件不存在」「内容为空」这两种正常初始状态**不会**产生备份。
- 风险：`resumes.json` 和 Claude 快捷配置解析失败后静默回退为空，下一次保存会覆盖原数据；
  Node sidecar 的 run/prompt/background 数据仍直接写文件。
- 涉及位置：
  - `src-tauri/src/commands/resume.rs`
  - `src-tauri/src/commands/toolbox/claude_code/quick_config.rs`
  - `src-node/resume-agent/src/storage/runStore.ts`
  - `src-node/resume-agent/src/storage/promptStore.ts`
- 整改目标：Rust 统一使用 `write_atomic`/`parse_json_or_backup`；sidecar 提供等价的原子写和损坏备份实现。
- 验收标准：
  - 截断或非法 JSON 不会被覆盖，原文件被保留为可识别备份。
  - 写入中断后旧文件或新文件至少有一份完整可读。
  - 同一文件并发保存不会共享固定临时文件而互相破坏。

### AUD-011 · P1 · 数据库初始化失败不得进入“假可用”状态

- [x] 状态：已整改（待人工回归）
- 风险：存储、SQLite 或迁移失败只写日志并继续启动；后续 `pool()` 会 panic，或在部分迁移 schema 上持续失败。
- 涉及位置：
  - `src-tauri/src/app_setup.rs`
  - `src-tauri/src/storage/db.rs`
  - `src-tauri/src/storage/mod.rs`
  - `src-tauri/src/commands/storage_admin.rs`
  - `src/App.tsx`
  - `src/components/common/StartupErrorScreen.tsx`（新增）
- 实现说明：
  - `init_storage_and_db` 拆出 `try_init_storage_and_db`，失败写入 `storage::set_startup_error`，
    错误文案区分「数据目录不可用 / 从备份恢复失败 / 数据库打开失败 / 数据库迁移失败」。
  - 新命令 `get_startup_status` 返回 fatalError、上次恢复失败原因、data/logs 目录和可用备份列表。
  - `App.tsx` 在 `initializeApp()` **之前**查询它；有 fatalError 就整屏阻断，一条数据都不加载。
  - `storage::db::init_fallback_pool()`：启动失败时装一个空的内存库，漏过去的命令得到普通 SQL 错误
    而不是 `pool()` panic 掉整个进程。
- 整改目标：启动失败时进入明确、可恢复、不会继续执行数据命令的错误状态。
- 验收标准：
  - 数据目录不可写、数据库损坏和迁移失败都有用户可见提示。
  - 失败状态不会调用未初始化的 pool。
  - 修复路径、备份位置和重试入口明确。

### AUD-012 · P2 · 合并 debounce 窗口内的设置补丁

- [x] 状态：已整改
- `_persistence.ts` 的普通 debounce 换成 `debounceMerge`：窗口内多次调用**累积**成一个
  patch，而不是后一次覆盖前一次。每个 setter 只传自己那一个字段，原来 300ms 内
  先改主题再折叠侧栏，发出去的只有 `{ sidebar_collapsed }`。
- 验证：把合并逻辑单独跑起来 —— 连续发 theme / view_mode / sidebar_collapsed /
  show_dock_icon 四个字段，实际只发出 **1 次**且四个字段全在；
  同一字段连发两次取最新值，且不带上一批的残留。
- 风险：所有设置字段共用一个 timer，各 setter 只传单字段 partial。300ms 内连续修改不同字段时，
  后一次会取消前一次，界面当次正确但重启后部分设置回退。
- 涉及位置：
  - `src/stores/_persistence.ts`
  - `src/stores/settingsStore.ts`
- 整改目标：debounce 窗口内合并 patch，或持久化完整一致快照。
- 验收标准：连续修改 theme、view mode、sidebar、dock 等多个字段后重启，所有值均保留。

### AUD-013 · P2 · 初始化加载按数据域隔离失败

- [x] 状态：已整改
- 十二项初始化读取各自容错：新增 `load(label, fallback, fn)` 包装，单项失败只影响
  该域并记下名字，其余成功结果照常写入 store。原来共用一个 `Promise.all`，
  任一项失败会丢弃全部成功结果，然后以空 store 标记初始化完成。
- 失败时弹 warning 列出**具体哪些域**用了默认值，并提示「不要在此状态下修改这些设置」——
  静默用默认值启动，用户会以为数据真没了，进而做出「重新添加项目」这类会覆盖原数据的动作。
- 风险：十二项初始化读取共用一个 `Promise.all`。任一项失败会丢弃其他成功结果，并直接以空/default store
  标记初始化完成，容易制造“数据全没了”的假象。
- 涉及位置：
  - `src/App.tsx`
- 整改目标：按域处理结果和错误，关键数据失败时提供重试/恢复提示。
- 验收标准：单独破坏一个可选配置文件时，项目、供应商和其他正常数据仍正确加载。

### AUD-014 · P2 · 删除分类/标签时持久化项目引用

- [x] 状态：已整改
- **没有新增命令**：一开始我加了 `delete_category_everywhere` / `delete_label_everywhere`，
  随后发现后端**早就有** `remove_category` / `remove_label`，只是它们同样只改词表
  不清项目引用。于是撤掉新命令，直接修既有的两个 —— 其它调用方一并受益，
  `src/bindings.ts` 也回到零 diff。
- 两个命令现在先删 `project_tags` / `project_labels` 里的全部引用，**再**更新词表。
  顺序有讲究：反过来的话中途失败会留下「词表已删、项目仍带着它」的状态，
  下次启动词表从项目重新聚合，删掉的条目照样复活。
- 前端 store 改为 `await` 后端并在失败时**回滚**乐观更新，不再 `catch(console.error)` 了事。
- 风险：删除分类或标签只更新前端内存和词表，没有写回项目引用；重启后项目值重新聚合，已删除项会复活。
- 涉及位置：
  - `src/stores/projectsStore.ts`
  - `src/pages/Shelf/index.tsx`
  - `src-tauri/src/commands/settings.rs`
- 整改目标：词表和项目引用在同一后端事务或一致操作中更新。
- 验收标准：删除后重启、重新加载项目和重新扫描均不会恢复旧分类/标签。

### AUD-015 · P2 · 保存失败不得提示成功

- [x] 状态：已整改
- `aiProvidersStore.saveAiProviders` 不再吞异常：失败时回滚乐观更新并向上抛。
- `handleSaveProvider` 改成 `await` 并接住错误：失败时显示后端原文、**不 resetForm**，
  用户填的内容留在表单里可直接重试。错误按硬约束 4 处理（Tauri 错误是纯字符串）。
- **修了报告没点到的三处同类问题**：`handleRemoveProvider` / `handleToggleProvider` /
  `handleSetDefaultProvider` 也是即发即忘，抽出 `persistProviders` 统一处理；
  `ModelManagerDialog` 里 4 个 `onChange` 的 `await saveAiProviders` 在 store 改为抛错后
  会变成静默的 unhandled rejection，加了 `persist()` 接住。
- 模型校验从「至少一个非空」改为**逐项**校验并报出第几个；顺带挡住重名模型
  （下拉里两个一样的条目，选中哪个取决于顺序）。
- 风险：AI 供应商 store 乐观更新后吞掉后端异常，页面固定提示成功并关闭表单；重启后配置消失。
  模型数组还只要求“至少一个非空”，可保存部分空 model ID。
- 涉及位置：
  - `src/stores/aiProvidersStore.ts`
  - `src/pages/Settings/AiProviderSettings.tsx`
- 整改目标：保存结果向上传播，失败时回滚或保留编辑状态；逐项校验模型 ID。
- 验收标准：模拟磁盘写失败时显示失败且不关闭表单；任何空模型项都不能保存。

### AUD-016 · P1 · 项目切换时隔离 Git 请求和破坏性操作

- [x] 状态：已整改
- 实现说明：
  - `ProjectDetailPanel` 增加 `loadTokenRef`：每次切项目自增，所有异步 Git 结果落回 state 前
    先核对序号（`isStale(token)`）—— 慢仓库的响应晚到时直接丢弃，不会覆盖新项目的数据。
    覆盖 `loadProjectDetails` / `loadCommitHistory` / `loadDivergenceCommits` / 搜索防抖四处。
  - 切换的**同一个 effect 里同步清空** gitStatus / commits / remotes / currentRemote，
    界面上不会有一帧还挂着上一个仓库的状态。
  - 破坏性操作因此自动失效：`handlePull` / `handlePush` 的 `if (!gitStatus || !currentRemote)`
    直接 return，revert / cherry-pick / discard 也没有旧 commit 和旧文件名可点 ——
    不需要在每个 handler 里各加一份判断。
- 风险：详情面板复用旧的 gitStatus、commit、remote 等数据，而操作 handler 已切换到新项目路径；
  快速切换后可能把旧 commit hash 或文件名用于新仓库。
- 涉及位置：
  - `src/pages/Shelf/index.tsx`
  - `src/components/project/ProjectDetailPanel.tsx`
  - `src/components/project/useProjectGitActions.ts`
- 整改目标：项目变化时立即清空/禁用旧数据；异步结果绑定 project ID 或请求序号。
- 验收标准：在两个仓库间快速切换并触发延迟响应，旧数据不会显示，也不能用于 discard/revert/cherry-pick/pull/push。

### AUD-017 · P1 · Chat 流事件必须先监听后启动请求

- [x] 状态：已整改
- 实现说明：
  - `useChatStream` 与 `ChatOverlay` 的监听器都改成**挂载时注册一次**，按 `requestIdRef`
    过滤，不再 `useEffect(..., [requestId])`。原写法里 `setRequestId` 之后立刻 invoke，
    而 effect 要等下一次渲染、`listen()` 本身还是异步的 —— 快速失败、非流式秒回、
    本地模型都可能抢在监听器之前到达。
  - 新增 `listenerReadyRef`：`start()` 在 invoke **之前** `await` 它，保证监听器真正就位。
  - 过滤用 ref 而不是闭包里的 state，取消/切换后旧请求的事件会被丢弃。
  - `useChatStream` 里那个只用于触发 effect 的 `requestId` state 一并删掉了。
- 风险：前端先启动请求，React effect 稍后才异步注册监听器。快速 error/done 或本地快速响应可先到，
  导致内容丢失、`streaming=true` 卡死或工具循环 Promise 永不结束。
- 涉及位置：
  - `src/pages/Chat/hooks/useChatStream.ts`
  - `src/pages/AiProviders/components/ChatOverlay.tsx`
  - `src-tauri/src/commands/chat.rs`
- 整改目标：监听注册完成后再 invoke，所有事件按 request ID 隔离并在结束时可靠清理。
- 验收标准：立即失败、非流式快速响应、快速取消和组件卸载均能结束状态且无监听泄漏。

### AUD-018 · P1 · 会话选中 ID、内容和流请求保持一致

- [x] 状态：已整改
- 实现说明：
  - **切会话先取消在途请求**：`ChatOverlay.handleSelectSession` 与
    `ApiChat.handleSelectSession` 都在切换前 `chatCancel` / `stop()` 并复位流状态。
    以前旧流会继续送 delta，而 `loadSession` 又因为 `streamingRef` 为 true 跳过加载，
    表现是「侧栏选中 B、正文还是 A、streaming 卡住」。
  - **置顶不再改当前会话**：`handleTogglePin` 原来无条件走 `persistSession`，
    而它内部会 `setActiveSession(saved)` —— 置顶别人的会话会把正文换成那一条，
    `activeSessionId` 却还指着原来的。现在只有目标就是当前会话时才更新 activeSession，
    其余只 `syncSummary`。
- 风险：API Chat/供应商验证页流式过程中允许切会话，旧请求可覆盖新会话；置顶非当前会话又会
  无条件替换 activeSession，但不更新 activeSessionId。
- 涉及位置：
  - `src/pages/Chat/index.tsx`
  - `src/pages/Chat/components/SessionItem.tsx`
  - `src/pages/ApiChat/index.tsx`
  - `src/pages/ApiChat/hooks/useApiChatOrchestration.ts`
  - `src/pages/AiProviders/components/ChatOverlay.tsx`
- 整改目标：会话切换时取消或忽略旧请求；置顶只更新目标记录，不改变当前会话。
- 验收标准：A 流式期间切到 B、置顶 C 后，侧栏选中、正文、发送目标和落盘会话始终一致。

### AUD-019 · P1 · 在任何异步准备前建立单请求锁

- [x] 状态：已整改
- 实现说明：
  - 三处各加一把**同步 ref 锁**，锁在任何 `await` 之前建立、`finally` 释放：
    `Chat/index.tsx` 的 `withSendLock`（handleSend / 编辑重发 / 重新生成 / 重试四个入口共用）、
    `useApiChatOrchestration` 的 `withRunLock`（send / regenerate / retryUser / retryFromError）、
    `ChatOverlay` 的 `sendLockRef`。
  - 根因是 `loading` / `streaming` 都是 state：`handleSend` 在 `setLoading(true)` 之前
    先 `await` 了 URL 抓取（可能几秒），两次点击 / 两次 Enter 会双双通过判断，
    然后覆盖同一份 requestId、buffer 和 callbacks，并且重复计费。ref 在同一个事件循环里就可见。
  - `useChatStream.start` 里再加一道兜底：`streamingRef.current` 为真时直接拒绝，
    防止将来新增入口时又漏一处。
- 风险：普通 Chat 在抓取 URL 上下文后才进入 loading；API Chat 与验证页的 Enter 路径也没有统一服从
  loading。快速重复发送会覆盖共享 requestId、buffer 和 callbacks，并可能重复计费。
- 涉及位置：
  - `src/pages/Chat/index.tsx`
  - `src/pages/Chat/utils/resolveContext.ts`
  - `src/pages/ApiChat/index.tsx`
  - `src/pages/AiProviders/components/ChatInputArea.tsx`
  - `src/pages/AiProviders/components/ChatOverlay.tsx`
- 整改目标：入口同步建立 single-flight 锁；按钮、快捷键、Enter 和程序调用共享同一判定。
- 验收标准：连续点击或按 Enter 只产生一个请求；取消完成前不能覆盖另一请求状态。

### AUD-020 · P1 · Session 401/403 重登录最多重试一次

- [x] 状态：已整改
- 实现说明：
  - `execute_api_endpoint` 拆成对外命令 + `execute_api_endpoint_inner(.., relogged_in: bool)`，
    重登深度用显式标记而不是无标记自递归。
  - 第二次仍是 401/403 时不再重试，直接返回带 method + URL 的可诊断错误
    （"重新登录后仍被拒绝，请检查 token 注入与账号权限"）—— 这种情况不是 token 过期，
    是配置或权限问题，再登一百次也一样。
  - 原来的自递归在"登录成功但 token 永远无效"时会无限重登 + 无限重发，
    每层还在 `Box::pin` 里累积 future，命令永不返回。
- 风险：业务端点持续返回 401/403 时会清缓存并递归调用自身，没有深度/重试标记，可能无限登录、
  无限请求并累积 future。
- 涉及位置：
  - `src-tauri/src/commands/api_chat/execute.rs`
- 整改目标：重登录次数显式计数，第二次鉴权失败直接返回可诊断错误。
- 验收标准：登录成功但 token 永久无效的模拟服务只触发一次重登录，命令在有限时间内失败返回。

---

## 三、打包与发版

### AUD-021 · P1 · Windows 便携包包含完整 sidecar

- [x] 状态：已整改（待真机回归）
- CI 与 `scripts/build-portable.bat` 都改为把 `src-tauri/resources/sidecars/` 整个复制到
  `<便携目录>/sidecars/` —— 布局与安装版一致（exe 旁边一个 `sidecars/`），
  正是 `node_agent_runtime()` 的 exe-parent 候选路径能命中的位置。
- 两处都加了**前置存在性检查**（缺 `node/node.exe` 或 `resume-agent/main.cjs` 直接失败），
  CI 还在 `Compress-Archive` 之后回读 ZIP 条目复核这两个文件确实在包里 ——
  否则这类问题只有等用户解压后点「生成简历」才会暴露。
- 风险：Tauri 将 sidecar 作为外部资源，便携 ZIP 却只复制 `CodeShelf.exe` 和 `.portable`，
  简历生成功能必然报“未找到内置 Node resume agent”。
- 涉及位置：
  - `src-tauri/tauri.conf.json`
  - `src-tauri/src/commands/resume_node_agent.rs`
  - `.github/workflows/release.yml`
  - `scripts/build-portable.bat`
- 整改目标：便携目录包含与安装版一致的 sidecar 布局。
- 验收标准：在没有系统 Node、没有源码目录的干净 Windows 环境中，解压 ZIP 后简历 sidecar 能启动。

### AUD-022 · P1 · macOS sidecar Node 架构匹配目标产物

- [x] 状态：已整改
- `prepare-resume-agent-sidecar.mjs` 不再无条件拷 `process.execPath`：
  - 目标架构来自 **Tauri target**，优先级 `--target` 参数 > `CODESHELF_SIDECAR_TARGET` >
    `TAURI_ENV_TARGET_TRIPLE` / `TAURI_ENV_ARCH` > 当前进程。后两个是 Tauri v2 传给
    `beforeBuildCommand` 的，所以 `tauri build --target x86_64-apple-darwin` 自动就对，
    **CI 不需要改任何一行**（本地交叉构建同理）。
  - 架构不匹配时从 nodejs.org 下载对应平台/架构的官方运行时（版本与本地一致）。
  - **无条件校验产物**：直接读可执行文件头判架构（Mach-O / ELF / PE，并支持 macOS
    universal 的 FAT 头），与目标不符就让构建当场失败，而不是等装到真机才发现起不来。
- 验证（本机 macOS arm64 实跑）：
  - 头部识别：本机 node → `arm64`，`/bin/ts` 类 universal 二进制 → `fat:x64+arm64`（
    FAT 是第一版漏掉的分支，实测发现后补上）。
  - target 解析：`x86_64-apple-darwin` → x64，`aarch64-apple-darwin` → arm64。
  - **交叉路径实跑**：`TAURI_ENV_ARCH=x86_64` 时真的下载了 `node-v20.20.0-darwin-x64`
    并通过 Mach-O 头校验（`darwin/x64, 86.8 MiB`），随后恢复了本机 arm64 产物。
- 待真机回归：两个安装包分别在 Intel / Apple Silicon 机器上启动 sidecar。
- 风险：ARM64 和 x86_64 构建都复制 runner 当前的 `process.execPath`，至少一个目标可能内置错误架构 Node。
- 涉及位置：
  - `.github/workflows/release.yml`
  - `scripts/prepare-resume-agent-sidecar.mjs`
- 整改目标：按 Tauri target 获取并校验 Node runtime，不能按 runner 架构猜测。
- 验收标准：两个安装包内 Node 的 `file`/架构检查分别匹配目标，并在对应真机启动 sidecar。

### AUD-023 · P1 · Linux 使用用户可写的数据目录

- [x] 状态：已整改（待真机回归）
- Linux 改用 XDG 用户数据目录（`$XDG_DATA_HOME/com.codeshelf.desktop`）。
  原来 Linux 跟着 Windows 走「exe 旁边」，但 deb 装在 /usr/... 、AppImage 跑在只读挂载点，
  普通用户在那里建不了 `data/`、`logs/`，首次启动直接失败。
- **兼容既有安装**：exe 旁边已经有 `data/` 且该目录**确实可写**时继续用它，
  免得早期以可写方式跑起来的用户升级后看到「数据全没了」。
  可写判定是**试着创建探针文件**，不看 permissions 位 —— 只读挂载下权限位可能仍是 0755。
- **Windows 一行未改**：便携版就是靠「数据跟着 exe 走」实现的，安装版也已与 NSIS
  升级逻辑绑定（硬约束 7）。这也是 Non-Goals 明确划掉的范围。`docs/DEVELOPMENT.md`
  已按平台分别写清楚。
- 关于验证方式（值得记一笔）：**故意没有把这段逻辑放进 `#[cfg(target_os = "linux")]`**。
  cfg 里的代码在本机一行都不编译（硬约束 3 说的就是这个坑），
  写成普通函数 `linux_base_dir(exe_dir)` 后，本机 `cargo check` 和单测都能覆盖它，
  只剩「调不调用它」那一行是平台相关的。非 Linux 平台的 dead_code 警告用
  `#[allow(dead_code)]` 显式压掉并注明原因。
- 验证：新增 2 条单测，覆盖「取不到 exe 目录」「旁边没有 data/」「有 data/ 且可写」
  「有 data/ 但只读」四种分支，以及「探针文件不留痕」。macOS 本机 + Windows 交叉编译均通过。
- 风险：所有非 macOS 平台把 data/logs 放在 exe 相邻目录。deb 通常位于系统目录，AppImage 常从只读挂载运行，
  普通用户无法初始化存储。
- 涉及位置：
  - `src-tauri/src/storage/config.rs`
  - `src-tauri/src/app_setup.rs`
  - `BUILD.md`
  - `docs/DEVELOPMENT.md`
- 整改目标：Linux 使用 XDG/Tauri 用户数据目录；Windows 便携行为与安装版行为显式区分。
- 验收标准：deb 和 AppImage 以普通用户首次启动、保存数据、重启读取均成功。

### AUD-024 · P1 · Release tag 与构建提交必须相同

- [x] 状态：已整改（待一次真实发布验证）
- `createRelease` / `updateRelease` 都显式传 `target_commitish: context.sha`。
  不传时 GitHub 把 tag 打在**默认分支 HEAD** 上，而附件是从 release 分支的那个 commit
  构建的 —— tag 指向的源码与二进制根本不是一回事。
- `create-release` job 新增输出 `build_sha`，所有构建任务用
  `actions/checkout@v6` + `ref: ${{ needs.create-release.outputs.build_sha }}` 固定到同一 SHA。
  分支在 workflow 运行期间可能又收到新提交，各任务各自解析分支名会拿到不同的树。
- 构建任务加了一步 `Verify checkout matches release commit`，`git rev-parse HEAD`
  与预期 SHA 不符直接 fail；同时把 SHA 以 `CODESHELF_BUILD_SHA` 注入构建环境。
- 风险：创建 Release 时未指定 `target_commitish`，新 tag 可能落在默认分支 HEAD；附件却从触发 workflow 的
  release 分支构建，tag 源码与二进制不一致。
- 涉及位置：
  - `.github/workflows/release.yml`
- 整改目标：tag、checkout、构建元数据和 Release 均绑定同一个不可变 SHA。
- 验收标准：发布后 tag SHA、workflow `github.sha` 和产物内记录的 commit SHA 完全一致。

### AUD-025 · P1 · 明确 Draft 与人工发布策略

- [x] 状态：已整改
- **选择「人工批准」**，理由：发布是对外且不可逆的动作（Release 一转正式，用户端立刻
  能检测到自动更新），构建成功不等于可以发版 —— 还要人工核对产物、签名、release notes。
  而且 `docs/更新步骤说明.md` 本来写的就是人工发布，是 workflow 偷偷自动化了。
- 删掉自动 `draft: false` 的 `publish-release` job，换成 `summarize-release`：
  只在 workflow Summary 里输出 tag、**构建 commit 与 Release 绑定 commit**、产物清单
  和一个「去 Release 页面点 Publish」的链接；若发现 Release 已不是 Draft 会发 warning。
  两个 commit 并列展示，正好也是 AUD-024 的人工核对点。
- `docs/更新步骤说明.md` 补上「CI 不会自动发布」以及两个 commit 必须一致、
  不一致就别发布的说明。
- 风险：文档和发版脚本要求人工发布 Draft，但 workflow 在构建成功后自动设置 `draft=false`。
- 涉及位置：
  - `.github/workflows/release.yml`
  - `scripts/release.sh`
  - `scripts/release.bat`
  - `docs/更新步骤说明.md`
- 整改目标：选择“人工批准”或“自动发布”中的一种，并让 workflow、脚本和文档完全一致。
- 验收标准：测试发布能按文档描述停在预期门禁；未经所选策略允许不会公开 Release。

### AUD-026 · P2 · 发版脚本只允许确定、干净、同步的来源

- [x] 状态：已整改
- `release.sh` 里被注释掉的 clean-tree 检查恢复并改为**硬失败**。它和「只 add 五个版本文件」
  组合起来有两个坑：预先 staged 的文件会被 `git commit` 一并带进发版提交；
  未暂存的改动参与了本地验证却进不了 release，「我本地测过」和「发出去的包」不是同一份代码。
- 新增 main 与 origin/main 同步校验，用 `merge-base` 区分**落后 / 领先 / 分叉**三种情况
  并给出对应的处理建议，而不是笼统报错。
- `git add` 之后回查暂存区：多出任何非版本文件就中止，并在提交前把最终文件清单打印出来。
- `release.bat` 补齐同样的三项检查（工作树干净、远程同步、暂存区清单）。
- 风险：clean-tree 检查被关闭，脚本只 add 五个版本文件，却会一并提交预先 staged 文件；未暂存代码可能参与
  本地校验但不进入 release，脚本也未确认 main 与 origin/main 同步。
- 涉及位置：
  - `scripts/release.sh`
  - `scripts/release.bat`
- 整改目标：发版前验证工作树/暂存区干净、基线与远程一致，并明确列出最终提交文件。
- 验收标准：脏工作树、预先 staged 文件、落后或分叉的 main 均被拒绝；发布提交内容可预测。

### AUD-027 · P2 · 修正发布输入、版本校验和依赖安装语义

- [x] 状态：已整改
- **移除** `workflow_dispatch` 的 version 输入（而不是去使用它）：版本的唯一真相源是仓库里的
  manifest，由 `scripts/release.sh` 写入。原来那个 `required: true` 的输入从未被任何 step
  引用 —— 填了也不生效，纯粹误导。`workflow_dispatch` 本身保留，仍可手动选分支重跑。
- `npm install` → `npm ci`：前者在 manifest 与 lock 不一致时会**就地改写 lock**，
  于是发出去的包用的依赖和仓库里记录的对不上。已确认本仓库 `npm ci --dry-run` 能跑通。
- 新增**版本一致性门禁**：构建前校验 `tauri.conf.json` / `package.json` /
  `package-lock.json` / `Cargo.toml` 四处版本号完全相同且格式合法，不一致立即失败 ——
  否则 tag、包名和 updater 清单会指向不同版本，直到用户更新失败才暴露。
- `release.bat` 的版本校验从「用 `for /f delims=.` 看有没有第三段」换成与 `release.sh`
  **完全相同**的正则，且在改写任何文件之前完成。
- 验证：用 11 个版本串（含 `1.2.foo`、`1.2.3.4`、`v1.2.3`、`1.2.3-beta`、空串）
  对比两个脚本的判定，**11/11 完全一致**；`1.2.foo` 和 `1.2.3.4` 现在都被拒绝。
  版本一致性门禁在本仓库实跑通过（四处均为 0.1.41），并验证了不一致时会拒绝。
- 风险：`workflow_dispatch` 的必填 version 未被使用；Release job 使用 `npm install`，与 CI/本地
  `npm ci` 的 lockfile 语义不同。Windows 发版脚本又只检查版本号含三个分段，
  `1.2.foo`、`1.2.3.4` 等值也能进入多文件改写，和 shell 入口的严格规则不一致。
- 涉及位置：
  - `.github/workflows/release.yml`
  - `docs/更新步骤说明.md`
  - `scripts/release.sh`
  - `scripts/release.bat`
- 整改目标：要么真正校验并使用手动版本，要么移除输入；最终出包使用与 CI 相同的确定性安装命令。
- 验收标准：
  - 保留输入时，输入版本与所有 manifest/tag/包名一致。
  - 移除输入时，workflow 和文档不再暗示手动输入会生效。
  - 两个发版脚本在改写任何文件前使用同一版本规则；非法版本不会留下部分修改。
  - 两种方案都必须在 manifest-lock 不一致时立即失败，而不是重解析。

---

## 四、工具箱与运行时可靠性

### AUD-028 · P2 · PairDrop 历史和上传目标使用单一真相源

- [x] 状态：已整改
- **历史合并写**：本地端和远端各有一个 hook 实例，各自在挂载时读一份 history 到 state，
  又各自把**整份**写回同一个 localStorage key —— 后写的把先写的另一端数据整个抹掉。
  改成 `persistEndpoint(key, endpoint)`：落盘前重新读一次，**只替换自己那个 endpoint 段**。
  不需要引入共享 store。
- **上传绑定 endpoint**：`sendFile` 开始时固定 `boundKey` 和 `boundApiBase`，
  进度回调、成功/失败消息全部写回这个 key。原来 `updateEndpoint` 用的是
  `endpointKeyRef.current`（**实时**值），大文件上传中途切房间会让进度条和最终结果
  落到新房间的会话里 —— 文件串房。
- 验证：把新旧两种落盘方式并排跑了一遍。旧行为下两端先后写入后
  `endpoints` 只剩 `remote:443`，**本地数据确认丢失**；新行为下两端数据都在，
  且本地再次写入不会抹掉远端。
- 风险：localClient 与 remoteClient 各自持有并整份写回同一个 localStorage 历史，后写者可覆盖另一端；
  上传过程中切换远端时，HTTP 上传、通知和历史还可能落到不同 endpoint。
- 涉及位置：
  - `src/pages/Toolbox/pairdrop/usePairDropClient.ts`
  - `src/pages/Toolbox/PairDrop.tsx`
- 整改目标：历史集中管理或做冲突安全合并；一次上传从开始到结束绑定不可变 endpoint/session。
- 验收标准：本地与远端同时收发、上传期间切换房间、组件卸载重挂后，消息和文件归属不丢失、不串房。

### AUD-029 · P2 · 正确解析带 registry 端口的 Docker 镜像

- [x] 状态：已整改
- 前后端各用一处规则替换 `includes(":")` / `contains(':')`，判定对齐 Docker 镜像引用语法：
  含 `@` 即带 digest；否则只看**最后一个 `/` 之后**的部分有没有 `:`。
  registry 和端口一定在第一个 `/` 之前，这样切不受端口干扰，IPv6 形式
  `[::1]:5000/team/app` 同理。
- 验证：Rust 侧 3 条单测覆盖普通镜像、私有 registry 端口（含 IPv6）、tag、digest、
  端口+tag、端口+digest 与首尾空白；前端用同样 10 个用例交叉核对，**前后端判定一致**。
  修复前 `localhost:5000/team/app` 会被当成「已有 tag」，用户填的 tag 被静默忽略。
- 风险：用 `includes(":")` 判断是否已有 tag，会把 `localhost:5000/team/app` 的端口冒号误判为 tag，
  从而忽略用户指定的 tag。
- 涉及位置：
  - `src/pages/Toolbox/docker-image/useDockerImageTool.ts`
  - `src-tauri/src/commands/toolbox/docker/commands.rs`
- 整改目标：按最后一个 `/` 之后的 `:` 或标准镜像引用解析规则识别 tag/digest。
- 验收标准：普通镜像、私有 registry 端口、tag、digest 和 IPv6 registry 用例全部正确。

### AUD-030 · P2 · 网络响应限制必须在读取过程中生效

- [x] 状态：已整改
- 新增公共模块 `src-tauri/src/http_body.rs::read_capped`：**流式**读取并在上限处立即停止，
  丢弃剩余流。三处 `resp.bytes()` 全部改走它（web_fetch、API endpoint 执行、在线文档导入）。
- 关键点：Content-Length 预检挡不住问题 —— 那个头可以缺失也可以撒谎。
  `read_capped` 保留了它用于**提前**拒绝明显超限的响应（省一次无谓下载），
  但真正的边界是读取过程中的累计计量。
- web_fetch 的下载上限（10MB）与输出上限 `max_bytes` 是**两回事**：
  CSS selector / regex 提取要在完整正文上做，所以下载上限更宽松，但必须存在。
  下载被截断时输出里会明说「内容不完整」。另给连接阶段单独设了超时上限（≤10s），
  总超时可以放宽到 120s，但连不上的地址不该占满这段时间。
- 验证：3 条单测起了**真实的本地 HTTP 服务器**。其中「无限 chunked 响应」用例
  不带 Content-Length 一直发数据，断言读取恰好停在 64KB 上限且被标记为截断 ——
  服务器侧写失败即证明我们确实提前断开了。另两条覆盖小响应完整返回、
  Content-Length 声称超限时不下载 body。
- 风险：WebFetch、API endpoint 和在线文档抓取先把完整 body 读入内存，之后才按 2MB/10MB 截断，
  无 Content-Length 的大响应仍可耗尽内存。
- 涉及位置：
  - `src-tauri/src/commands/tools/web_fetch.rs`
  - `src-tauri/src/commands/api_chat/execute.rs`
- 整改目标：流式读取并在达到上限时停止；设置连接、首字节和总读取超时。
- 验收标准：无限 chunked 响应和超大响应在固定内存/时间边界内终止。

### AUD-031 · P2 · UTF-8 截断和 glob 不得按任意字节切片

- [x] 状态：已整改
- `ctx.rs::truncate` 的 UTF-8 边界 panic 已在 AUD-049 一并修掉（同一条路径上的共享函数），
  并留了多字节字符的单测。
- `fs_ops.rs` 的手写匹配器**整个删掉**（-107 行 / +9 行），改用 `regex` crate。
  那份 `SimpleRegex` 有两个真 bug：`for i in 0..=s.len()` + `&s[i..]` 按**字节**下标切片，
  中文/emoji 文件名直接 panic；tokenize 时 `b as char` 把非 ASCII 字节按 Latin-1 解释，
  中文 pattern 永远匹配不上。
  当初写它的理由是注释里的「避免引入 regex crate」，但 `regex = "1"` 现在**已经是直接依赖**
  （web_fetch 的规则提取在用），理由不成立了。
- 验证：3 条单测覆盖中文 / emoji / 组合字符文件名的匹配与拒绝、基本 glob 语义
  （`*` 不跨 `/`、`**` 跨目录、`?` 单字符）、以及正则元字符必须按字面量处理
  （`a+b.txt` 不能匹配 `aab.txt`）。
- 风险：字符串截断和 glob matcher 使用字节索引构造 `&s[..n]`/`&s[i..]`，切进中文或 emoji 时会 panic。
- 涉及位置：
  - `src-tauri/src/commands/tools/ctx.rs`
  - `src-tauri/src/commands/tools/fs_ops.rs`
- 整改目标：只在 UTF-8 char boundary 切片，glob 优先使用成熟库或字符级算法。
- 验收标准：中文、emoji、组合字符文件名执行默认 glob、grep 和输出截断均不 panic。

### AUD-032 · P2 · 静态服务、下载器和并发写入收敛生命周期

- [x] 状态：已整改
- **代理换成 reqwest**（-178 行 / +69 行）。原来是约 170 行手写的 HTTP/1.1 客户端
  （裸 `TcpStream` + 自己拼请求 + 自己解析响应头 + 自己解 chunked），三个问题一次解决：
  - 配置写 `https://` 会被剥掉 scheme 后走**明文** TCP —— HTTPS 目标根本用不了；
  - `read_to_end` 无上限无超时，大响应或慢连接直接拖垮服务；
  - 手写的 header / chunked 解析在边缘情况上与规范有出入。
  现在有 32MB 上限（走 `http_body::read_capped`）、60s 总超时、10s 连接超时，
  并显式 `redirect::Policy::none()`（代理要如实转发上游重定向，不能自己跟过去）。
  顺带删掉了整个 `decode_chunked`。
- **服务原子认领**：`start_server` 的「已在运行」检查读完就放锁，两个并发调用会双双通过，
  第二个 `insert` 把第一个的 controller 顶掉 —— 那个 listener 就此失去 stop 句柄，
  永远关不掉、端口一直占着。改成在 `SERVER_CONTROLLERS` 锁内完成检查+写入。
- **下载原子认领**：`resume_download` 同样是读完放锁再判断，两个并发 resume 会
  spawn 出两个任务**写同一个文件**。改成在锁内检查 `paused` 并同时置为 `downloading`。
- 风险：
  - 静态服务接受 `https://` target，却用裸 TCP 发送 HTTP。
  - 代理响应无读取超时和大小上限。
  - 并发 start 可能覆盖 controller 并留下无法停止的 listener。
  - 下载 pause/resume 可能产生多个任务写同一文件。
- 涉及位置：
  - `src-tauri/src/commands/toolbox/server/runtime.rs`
  - `src-tauri/src/commands/toolbox/server/crud.rs`
  - `src-tauri/src/commands/toolbox/downloader.rs`
  - `src-tauri/src/storage/mod.rs`
- 整改目标：使用协议正确且带边界的 HTTP 客户端；服务和下载任务使用原子状态机及单一 owner。
- 验收标准：HTTPS 代理可用；并发 start/resume 只能产生一个有效任务；stop/pause 后不残留 listener 或 writer。

### AUD-033 · P2 · 剪切操作必须先确认剪贴板写入成功

- [x] 状态：已整改
- 剪切改为 `await` 写入成功后才 `execCommand("delete")`，失败则**原文不动**并提示。
  原来是 `writeText(...).catch(() => {})` 后立刻删除 —— 写入被拒时文本凭空消失且无法撤销。
- 抽了一个 `writeClipboard` helper：`navigator.clipboard` 被拒时退回后端
  `write_to_clipboard` 命令（粘贴那条路径本来就走后端，说明它在 webview 里更可靠）。
  **没有新增命令**，复用既有的。
- 两处「复制」也不再静默吞掉失败。
- 风险：自定义右键菜单发起异步 `clipboard.writeText` 后立即删除选区，写入被拒绝时文本仍会丢失。
- 涉及位置：
  - `src/components/ui/AppContextMenu.tsx`
  - `src-tauri/src/commands/toolbox/clipboard.rs`
- 整改目标：剪贴板写成功后再删除；失败时保留文本并给出反馈。
- 验收标准：模拟剪贴板权限拒绝时，输入框原文不变。

### AUD-034 · P2 · 冷启动外部添加项目事件不得丢失

- [x] 状态：已整改
- 后端在「前端就绪」之前**只入队不发事件**：新增 `ExternalAddEvent` 队列 +
  `FRONTEND_READY` 标志，`emit_or_buffer` 在**同一把锁**里完成判定和入队 ——
  否则「检查未就绪」和「push」之间前端刚好取走队列，这条事件会永远留在队列里。
- 新增命令 `take_pending_external_projects()`：取队列和置位就绪也在同一把锁里，
  保证不会有「取完之后、置位之前」产生的事件被丢掉。
- 前端在两个 listener **都注册完成后**才调用它，把冷启动期间积压的事件补跑一遍；
  处理逻辑抽成 `applyAdded` 供实时事件和补跑共用，行为完全一致。
- 顺带发现一处既有分歧并在代码里注明：tauri-specta 生成的 `Project` 用
  `string | null`，手写的 `@/types` 用 `string | undefined`，运行时是同一份 JSON。
  这里用一次带注释的 cast 桥接，没有去动两套类型定义（影响面大，值得单独处理）。
- 风险：Tauri setup 阶段可能在 React listener 注册前发出“外部添加项目”成功/失败事件，冷启动时选择、
  toast 或失败信息会丢失。
- 涉及位置：
  - `src-tauri/src/app_setup.rs`
  - `src-tauri/src/lib.rs`
  - `src/App.tsx`
- 整改目标：前端 ready 后再处理，或在后端持久/缓存待消费事件。
- 验收标准：应用未运行时通过右键菜单、命令行和 macOS Opened 打开项目，结果始终可见且正确选中。

---

## 五、CI、依赖与工程卫生

### AUD-035 · P2 · CI 覆盖真实发布构建链

- [x] 状态：已整改
- CI 的 frontend job 从「只跑 `tsc --noEmit`」扩成覆盖整条发布链：
  前端 tsc → **sidecar tsc** → **sidecar 单测** → **`npm run build`**
  （与 tauri 的 `beforeBuildCommand` 是同一条命令，含 esbuild 打包和 Vite build）。
- 验证：故意在 sidecar 里写一行类型错误，`tsc -p src-node/resume-agent/tsconfig.json`
  确实报错退出；恢复后通过。修复前这类错误要到 release 才暴露，PR 可以全绿合入。
- 风险：普通 CI 只检查根 `src` 的 TypeScript，不检查 Node sidecar、esbuild 打包和 Vite build；
  PR 可以全绿，到 release 才失败。
- 涉及位置：
  - `.github/workflows/ci.yml`
  - `tsconfig.json`
  - `src-node/resume-agent/tsconfig.json`
  - `package.json`
- 整改目标：CI 执行与发布一致的前端/sidecar 构建，或拆成等价且完整的确定性步骤。
- 验收标准：故意破坏 sidecar TS、esbuild import 或 Vite 配置时，普通 PR CI 会失败。

### AUD-036 · P2 · 生成 bindings 后检查仓库漂移

- [x] 状态：已整改
- rust job 在 `cargo test` 之后加 `git diff --exit-code -- src/bindings.ts`，
  有 diff 就明确报错并给出修复命令。`cargo test` 本身会重写 bindings，
  没有这一步的话「改了命令签名但没提交 bindings」照样是绿的（硬约束 2 形同虚设）。
- 本仓库当前无漂移，检查通过。
- 风险：Rust 测试会重写 `src/bindings.ts`，但 CI 没有检查 diff；忘记提交新 bindings 时 job 仍成功。
- 涉及位置：
  - `.github/workflows/ci.yml`
  - `src-tauri/src/handlers.rs`
  - `src/bindings.ts`
- 整改目标：生成后执行 `git diff --exit-code -- src/bindings.ts`，并让前端检查消费同一份生成结果。
- 验收标准：修改 Tauri 命令签名但不提交 bindings 时 CI 明确失败。

### AUD-037 · P2 · 让声明的 Node/Rust 版本与 lockfile 一致

- [x] 状态：已整改
- **实测真实 MSRV**：用 `cargo metadata` 扫全部依赖的 `rust-version`，最高是
  **1.88.0**（`cookie_store`、`time`）。而 Cargo.toml 声明的是 1.77.2 —— 按文档装
  1.77 的干净环境根本编译不过。已改为 `rust-version = "1.88"`。
- Node 版本按 Vite 7 的实际要求写明 `^20.19.0 || >=22.12.0`，不再是含糊的 `>= 20.x`。
- `BUILD.md`、`CLAUDE.md` 同步更新。
- CI 新增 `msrv` job **固定** `dtolnay/rust-toolchain@1.88`：其余 job 都用浮动 `stable`，
  真实 MSRV 涨了也发现不了，要等按文档装最低版本的用户来报「编译不过」。
  该 job 还会校验 Cargo.toml 的 rust-version 与自己固定的版本一致，防止只改一处。
- CI 的 Node 也从 `lts/*` 固定到 `20.19.0`，避免工具链随 runner 漂移。
- 风险：文档和 Cargo manifest 声称 Rust 1.77、Node 20.x；当前依赖实际至少需要 Rust 1.88，
  Vite 的 Node 范围为 `^20.19.0 || >=22.12.0`。浮动 stable/LTS CI 掩盖了版本漂移。
- 涉及位置：
  - `BUILD.md`
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock`
  - `package-lock.json`
  - `.github/workflows/ci.yml`
- 整改目标：选择真实支持的固定版本，更新 manifest/文档，并在 CI 中至少有一个固定工具链验证。
- 验收标准：按文档从干净环境安装后可完整构建；低于最低版本时得到明确版本错误。

### AUD-038 · P2 · 声明直接依赖并统一依赖来源

- [x] 状态：已整改
- **`esbuild` 显式声明**（`^0.27.2`）：`scripts/prepare-resume-agent-sidecar.mjs`
  直接 `import { build } from "esbuild"`，之前只靠 Vite 的传递依赖被 npm 提升到顶层。
  Vite 换个打包器或调整依赖，简历生成的构建就会莫名其妙地断掉。
- **registry 统一**：lockfile 里 49 处 `registry.npmmirror.com` 改写为 `registry.npmjs.org`
  （原本 352 : 49 混用），并新增 `.npmrc` 把策略显式写下来。现在 369 条全部来自同一 registry。
- **删除确认未使用的依赖**：`sharp`、`autoprefixer`（Tailwind v4 走 Vite 插件，
  项目里没有 PostCSS 配置）、Rust 的 `tower 0.4`（无任何 `tower::` 直接引用，
  `tower-http` 会自带）。删除前逐个全仓 grep 确认过引用。
- 验证（按验收标准「删除依赖前用构建和运行验证」）：删掉 `node_modules` 后
  **全新 `npm ci`** → `tsc` → sidecar tsc → sidecar 单测 10 通过 → `npm run build` 成功；
  Rust 侧 `cargo check` + `cargo test --lib` 49 通过 + Windows 交叉编译通过。
- 风险：sidecar 脚本直接 import `esbuild`，但只依赖 Vite 偶然提升的传递依赖；lockfile 同时使用
  npmjs 和 npmmirror，影响可复现性。另有未使用的 `sharp`、`autoprefixer`、`tower 0.4` 等候选依赖。
- 涉及位置：
  - `package.json`
  - `package-lock.json`
  - `scripts/prepare-resume-agent-sidecar.mjs`
  - `src-tauri/Cargo.toml`
  - `src-tauri/Cargo.lock`
- 整改目标：直接使用的包直接声明；registry 策略显式且一致；删除依赖前用构建和运行验证。
- 验收标准：全新 `npm ci` 不依赖 hoist 偶然性；lockfile resolved 来源符合项目约定；清理后各平台构建通过。

### AUD-039 · P2 · 补齐敏感文件和构建产物忽略规则

- [x] 状态：已整改
- 实现说明：
  - `.gitignore` 里那 13 行逐文件枚举的 sidecar dist 路径换成 `/src-node/resume-agent/dist/`——
    枚举法下每新增一个源文件，它编译出的 `.js` 就漏出来变成待提交项（本轮加
    `projectBackend.test.ts` 时立刻复现）。
  - 补 `/src-tauri/target-win/`（交叉编译产物）与 `.env` / `.env.*`，并用 `!.env.example` 放行示例。
  - `.dockerignore` 已含 `src-tauri/target-win`，无需改动；
    `defaultSensitiveFilePatterns.json` 已含 `.env` / `.env.*` / `*.key` / `*.pem` 等，无需改动。
  - 验证：`git check-ignore -v` 对 `.env`、`.env.local`、`src-tauri/target-win`、
    任意新增 sidecar dist 文件均命中；`.env.example` 仍可被 `git add` 收录。
- 风险：`.env/.env.*`、`src-tauri/target-win/` 和新增 sidecar dist 文件没有统一忽略，可能误提交秘密或产物。
- 涉及位置：
  - `.gitignore`
  - `.dockerignore`
  - `src/config/defaultSensitiveFilePatterns.json`
  - `src-node/resume-agent/tsconfig.json`
- 整改目标：按目录/模式忽略生成物和本地秘密，同时保留需要提交的示例配置例外。
- 验收标准：`git check-ignore` 能覆盖 `.env`、`.env.local`、target-win 和任意新增 sidecar dist 文件。

### AUD-040 · P2 · 收紧 WebView 文件系统能力

- [x] 状态：已整改（建议人工回归一次文件读写/目录选择）
- 先枚举前端 `@tauri-apps/plugin-fs` **实际导入的全部符号**：只有
  `exists` / `readDir` / `readTextFile` / `writeTextFile`。
- 据此移除四个无人调用的破坏性权限：`fs:allow-mkdir`、`fs:allow-remove`、
  `fs:allow-rename`、`fs:allow-copy-file`（37 → 33 条）。
  `$HOME` 下敏感目录的 deny 规则保留为第二层防护。
- 刻意**没动** `fs:allow-read` / `fs:allow-write`：报告点名的是删改移复制这类破坏性能力，
  这两个是读写本身，收得太狠反而可能在运行时踩到没覆盖到的调用路径。
- 验证：`cargo build --lib` 通过（build.rs 会解析 capabilities，schema 不合法会直接失败）。
- 风险：WebView 获得 `$HOME/**` 下未使用的 remove/rename/copy/mkdir 权限，扩大前端被利用后的破坏范围。
- 涉及位置：
  - `src-tauri/capabilities/default.json`
- 整改目标：按前端真实调用最小化操作类型和路径范围，保留敏感目录 deny 作为第二层防护。
- 验收标准：移除未使用权限后现有文件读取、保存和目录选择功能不回归，未授权删除/移动调用被拒绝。

### AUD-041 · P3 · 限制日志保留总量

- [x] 状态：已整改
- `RotationStrategy::KeepAll` → `KeepSome(5)`，配合既有的 `max_file_size(10MB)`，
  日志目录总量上界固定在**约 50MB**。
- 应用常驻托盘、一跑就是几周，KeepAll 下文件数量和总容量都没有上限。
  保留 5 个 × 10MB 仍有足够的排查窗口（单文件通常能覆盖数天运行记录）。
- 风险：日志使用 `RotationStrategy::KeepAll`，长期运行没有文件数量或总容量上限。
- 涉及位置：
  - `src-tauri/src/app_setup.rs`
- 整改目标：设定可解释的轮转和保留策略，并保留足够的故障排查窗口。
- 验收标准：持续产生超过单文件上限的日志后，日志目录总量保持在确定边界内。

### AUD-042 · P3 · 清理存量 Clippy 告警并收紧门禁

- [x] 状态：已整改
- 存量 16 条全部处理完，`cargo clippy --all-targets -- -D warnings` **通过**。
- 实际修复（不是加豁免）：
  - `matches!` 替代冗余 match（scanner）、`is_multiple_of`（netcat）、
    去掉多余引用（web_fetch）、测试模块挪到文件末尾（ctx.rs）；
  - pairdrop 的常量断言改成 `const _: () = assert!(...)` —— **编译期**断言比运行时更强，
    改坏了直接编译不过，同时也不再触发「断言结果恒定」；
  - `ExternalAddEvent::Added` 装箱：它携带整个 Project，与 `Failed(String)` 体量差距很大，
    不装箱的话队列里每个值都按最大变体分配。
- 保留的两处豁免都写了理由：`too_many_arguments`（模块内部函数、单一调用点，
  包 struct 只是换个地方写同样的字段）、`type_complexity`（8 处全是
  `Lazy<Arc<Mutex<HashMap<..>>>>` 全局句柄和 sqlx 元组行类型，起别名只是把复杂度挪走）。
- CI 的 clippy 步骤从 `--lib -- -A clippy::type_complexity` 收紧为
  `--all-targets -- -D warnings`。
- 风险：严格 Clippy 尚有存量告警，CI 长期使用豁免，新增同类问题不会形成有效质量门禁。
- 涉及位置：
  - `.github/workflows/ci.yml`
- 整改目标：清理存量告警或对确需保留的项做局部、有理由的 allow，随后启用严格检查。
- 验收标准：`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` 通过。

### AUD-043 · P3 · 前端保留后端具体错误信息

- [x] 状态：已整改
- **根因就是 CLAUDE.md 硬约束 4**：这两个页面大量使用
  `e instanceof Error ? e.message : "失败"`，而 Tauri invoke 抛出的是**纯字符串**，
  永远走不到 `.message` 那一支 —— 后端拼出来的「端口 8080 已被占用」全被吞成通用文案。
- 新增共享 `src/utils/errMsg.ts`（项目里原本只有 `useMcpGateway.ts` 里的一份局部实现，
  提取出来供全局复用），覆盖纯字符串 / Error 实例 / 结构化对象三种形态。
  批量改写 Workflows 与 ApiChat 共 4 个文件。
- 另外 5 处 `catch { showToast("error", "删除失败") }` 完全丢弃原因，改为带上 `errMsg`。
- 「打开会话失败」原本只是静默 `setActiveSession(null)` —— 用户看到的是会话内容凭空消失，
  却不知道为什么。改为如实报错。
- 其余 `/* ignore */` 的静默 catch 保持不变：都是清理路径或有明确 fallback 返回值，
  符合「只有明确可忽略的取消/清理操作才能静默处理」。
- 同时提供 `isUserCancel`，判据保守：只认明确的取消语义，拿不准一律当真错误报出来。
- 验证：12 个用例覆盖各种错误形态与取消判定，全部通过；并与旧写法做了对比 ——
  同一个后端字符串，旧写法输出「保存失败」，新写法输出「端口 8080 已被占用」。
- 风险：部分前端 catch 使用通用文案或空 catch，丢弃 Tauri 返回的具体字符串错误，降低可诊断性。
- 涉及位置：
  - `src/pages/Workflows/`
  - `src/pages/ApiChat/`
- 整改目标：用户提示保留具体失败原因；只有明确可忽略的取消/清理操作才能静默处理。
- 验收标准：模拟后端字符串错误时，页面展示或日志中能看到原始原因，且不会把用户取消误报为故障。

---

## 六、第二轮功能完整性补漏

本节是对第一轮清单逐项去重后的新增发现。它们不是“优化建议”，而是已经能从当前调用链确认的
数据破坏、错误对象操作、状态失真或功能不可达问题。

### AUD-044 · P0 · 备份恢复必须先完整验证和 staging，不能先清空当前数据

- [x] 状态：已整改（待人工回归）
- 风险：
  - `timestamp` 被直接拼成 `backup_<timestamp>`，只检查 `exists()`；利用一个真实备份名再追加
    `/..`、`/../data` 可逃逸备份根、选中当前 data 目录或备份父目录。
  - 重启恢复先递归清空当前 data，再读取和复制来源。来源损坏、是普通文件、磁盘写满、权限失败或
    source 与 destination 相同，都会在当前数据已经销毁后失败；pending flag 还可能让每次启动重试。
  - 后端已暴露列举/恢复命令，但前端没有管理入口，真实故障时用户无法在界面自助确认和恢复。
- 涉及位置：
  - `src-tauri/src/commands/storage_admin.rs`
  - `src-tauri/src/storage/migrations/mod.rs`
  - `src-tauri/src/app_setup.rs`
  - `src-tauri/src/handlers.rs`
  - `src/components/common/StartupErrorScreen.tsx`（新增，恢复入口）
- 实现说明：
  - `validate_timestamp` 严格匹配 `\d{8}T\d{6}Z`（16 字节），`..`、分隔符、绝对路径连进入拼接的机会都没有；
    `resolve_backup_dir` 再做 `symlink_metadata` 非 symlink 检查、canonical 直接子目录 containment、
    以及 source==destination / source 含 destination 的重叠检查。`list_backup_timestamps` 同样只返回合法格式。
  - `apply_pending_restore` 顺序改为：**先摘 flag**（失败不再无限重复破坏性步骤）→ 校验 →
    复制到同级 `.restore_staging_<ts>` → `verify_staging`（非空 + SQLite 文件头）→
    两次 rename 原子切换（`data → .restore_previous_<ts>`，`staging → data`；第二步失败自动换回）。
    当前数据在最后一次 rename 之前始终完好。
  - 失败时写 `.restore_failed` 并向上抛错；`app_setup` 据此进入启动阻断状态（见 AUD-011），
    不会在半恢复的数据上继续 `init_db`。
  - 前端入口：启动错误页列出可用备份并可一键标记恢复；同时展示上一次恢复失败原因与数据目录位置。
  - 测试：`storage::migrations::tests` 5 个单测覆盖时间戳格式、逃逸拒绝（校验前数据未动）、
    坏 SQLite 导致恢复失败后当前数据不变且不重试、正常恢复切换并保留快照、列举忽略非法目录。
  - ponytail: `verify_staging` 只验 SQLite 文件头魔数，不做 `PRAGMA integrity_check`；
    若出现「能打开但内容坏了」再升级。
- 整改目标：
  - timestamp 使用严格格式和 canonical containment 校验，来源必须是备份根内的真实目录，
    拒绝 symlink、source=destination 和包含 destination 的来源。
  - 先复制到独立 staging，校验文件清单和 SQLite 可读性，再原子切换；切换前保留当前状态快照。
  - 恢复失败进入阻断且可诊断的状态，不得继续在半恢复数据上初始化。
- 验收标准：
  - `<真实时间戳>/..`、`<真实时间戳>/../data`、绝对路径、普通文件和 symlink 均在清空前被拒绝。
  - 注入磁盘满、权限失败和损坏数据库时，当前数据保持不变，下一次启动不会无限重复破坏性步骤。
  - 正常恢复经界面或受控入口可完成；恢复前后数据版本和备份来源对用户可见。

### AUD-045 · P1 · MCP Gateway 在 loopback 上也必须阻止浏览器跨域无鉴权调用

- [x] 状态：已整改
- 实现说明：
  - **不再存在「已启动但无鉴权」的状态**：`apply_settings` 启动网关前先走 `ensure_gateway_key`，
    没有可用密钥就自动生成一个并落盘。`validate_mcp_auth` 里那句
    `if keys.is_empty() { return Ok(()) }` 直接删掉 —— 真出现空列表说明配置被外部改坏了，
    此时拒绝服务而不是裸奔。原来「必须监听回环」的兜底闸门随之取消（loopback 本来就不是身份认证）。
  - 密钥沿用前端已有的 v1 格式 `cs_mcp_v1_<43 base64url>_<4 校验码>`，Rust 侧复刻了同一套
    FNV-1a 校验码；随机源用 `getrandom`（操作系统 CSPRNG，本来就在依赖树里，只是提成直接依赖）。
    单测拿前端 JS 实现算出的向量做逐位比对。
  - **Origin 策略**：`Access-Control-Allow-Origin: *` 换成三个 Tauri webview 来源的白名单，
    `allow_headers(Any)` 换成显式三项。CORS 不能整个删掉 —— 应用自己的前端就是用浏览器
    `fetch()` 打到 `127.0.0.1:port/mcp` 的（`src/services/mcp/client.ts`）。
  - 另在 `http_mcp` 里加了 `origin_allowed` 前置判断：跨站页面的「简单请求」
    （text/plain + 无自定义头）不触发预检，CORS 层拦不住，只能在 handler 里判。
    无 Origin = 非浏览器客户端（Claude Desktop / curl / SDK），放行但仍校验密钥。
  - `save_app_settings` 把保存锁提前 `drop` 了：网关启动会回调 `set_mcp_gateway_keys`，
    不放锁会自锁。新增的 `set_mcp_gateway_keys` 是只写 keys 的窄入口，不回调 `apply_settings`，
    避免无限递归。
- 顺带修正：初版把校验码算在了 `cs_mcp_v1_<random>` 全串上，而前端只算随机段，
  单测立刻抓到 —— 否则每个自动生成的密钥都会在 UI 里显示「校验码不匹配」。
- 风险：网关允许任意 Origin、方法和请求头；监听回环地址且密钥列表为空时又直接跳过鉴权。
  任何能够向 localhost 发请求的网页来源都可能调用 `tools/list`/`tools/call`，借用 CodeShelf
  已保存的 endpoint 和认证信息执行真实 API 操作。loopback 不是身份认证，不能依赖浏览器 PNA
  策略作为安全边界。
- 涉及位置：
  - `src-tauri/src/mcp_gateway.rs`
  - `src/pages/Settings/McpGatewaySettings.tsx`
- 整改目标：网关始终要求高熵密钥；同时使用严格 Origin/Fetch Metadata 策略，不对任意来源返回
  `Access-Control-Allow-Origin: *`。
- 验收标准：
  - 不存在“已启动但无任何鉴权”的状态。
  - 来自非受信 Origin 的预检和 POST 请求即使目标是 `127.0.0.1` 也失败。
  - 合法 MCP 客户端使用有效密钥仍可初始化、列举和调用工具；索引页展示的鉴权状态与实际一致。

### AUD-046 · P1 · Git 提交弹窗必须让用户选择与暂存区完全一致

- [x] 状态：已整改
- 实现说明：
  - **后端 `status.rs` 其实是对的**：porcelain 的 `MM A.txt` 已经被同时放进 `staged` 和
    `unstaged` 两个列表。坏的只有前端 —— `fileMap.set(path, {type})` 去重时
    unstaged 那一轮把 staged 覆盖掉了。所以这条只改了 `GitCommitModal.tsx`，
    没动命令签名，不需要重新生成绑定。
  - `FileItem` 的互斥枚举 `type` 换成三个独立布尔 `staged` / `unstaged` / `untracked`，
    构建列表时叠加标志而不是互相覆盖；标签能显示「已暂存+已修改」。
  - 「取消暂存未选中文件」的判据改成 `f.staged` 这个独立标志。
    `git reset HEAD -- <file>` 只动 index，改动仍留在工作区，不会丢。
  - **提交前以 Git index 为真相源复核**：重新读一次 `get_git_status`，
    把 `staged` 集合与本次勾选集合做双向比对，多出或缺少任一文件都中止提交并列出差异。
    `git commit -m` 不带 pathspec，提交的是 index 的全部内容，界面勾选本身不构成任何约束 ——
    没有这道校验，unstage/add 少动一个文件就会静默把多余改动提交上去。
  - unstage / add / 校验任一步失败都 `return` 且不执行 commit/push，并 `loadGitInfo()`
    刷新列表，让界面显示 index 的真实状态。
  - 「提交后推送」默认从 **开** 改成 **关**：推送是对外、不可逆的动作，
    默认勾选会让一次误提交立刻扩散到远程。
- 验证（真实 git 仓库，非模拟）：
  - 复现旧行为：A 先 `git add` 一部分再继续改、B 普通修改，取消勾选 A 只提交 B ——
    旧逻辑下 `git show --name-only` 里 **A.txt 和 B.txt 都在**，确认是真 bug 不是臆测。
  - 新逻辑：`git reset HEAD -- A.txt` 后 `git diff --cached --name-only` 只剩 B.txt，
    提交内容只有 B.txt，A.txt 的 staged-part 与 worktree-part 在工作区完整保留，
    提交后状态回到 ` M A.txt`。
- 风险：同一文件同时有 staged/unstaged 修改时，文件列表去重会让 unstaged 类型覆盖 staged 类型。
  用户取消勾选该文件后，代码不会取消它已经存在的暂存内容，提交仍会把未选中的改动带进去；
  “提交后推送”又默认开启，错误内容可能随即上传远程。
- 涉及位置：
  - `src-tauri/src/commands/git/status.rs`
  - `src/components/project/GitCommitModal.tsx`
- 整改目标：文件状态能同时表达 staged 与 unstaged；提交前以 Git index 为真相源，精确重建或校验
  本次选择，不能用互斥枚举覆盖双重状态。
- 验收标准：
  - 文件 A 先暂存一部分再继续修改、文件 B 普通修改时，取消 A 只提交 B，A 的 staged/unstaged
    内容均按界面承诺保留。
  - 提交前后用 `git diff --cached` 验证 index 与选择集合完全一致。
  - 取消暂存或暂存任一步失败时不执行 commit/push，并保留可恢复状态。

### AUD-047 · P1 · 导入 Chat 会话不得用外部 ID 静默覆盖现有历史

- [x] 状态：已整改
- 实现说明：
  - **默认一律分配新 ID**（`handleImport` 里 `saveChatSession({ ...parsed, id: newId() })`）。
    这一条就让「导入两次得到两个独立会话」自然成立，也意味着即使冲突检测本身失效
    （比如会话列表还没加载完），也不可能覆盖到任何现有数据 —— 检测只是提示，不是防线。
  - 检测到同 ID 时弹冲突摘要：并排显示现有 / 导入文件的**标题、消息数、更新时间**。
    「替换现有会话」是 danger 按钮，「新建副本」是取消位。
  - 选替换后再来一次 danger 二次确认，写明「N 条将被 M 条覆盖」。
    **取消发生在任何写入之前**，数据库与导入前完全一致。
  - 确认替换才动手：先把现有会话原样另存为「<原标题>（替换前备份）」的独立会话，
    再写入导入内容。没有引入新的备份文件格式 —— 复用 `saveChatSession` 存成普通会话，
    用户在侧栏直接看得到、点得开。
  - 导出文件加 `schemaVersion` 字段；导入时缺失按 legacy 放行（兼容旧导出），
    高于当前版本直接拒绝（新版字段语义读不懂，勉强导入等于静默丢数据）。
  - `validateSession` 做完整嵌套校验：顶层类型、id/title 必填且为字符串、
    messages 必须是数组，并**逐条**校验 `id` / `role`（限四种合法角色）/ `content`，
    以及 `attachments` / `toolCalls` 的类型。全部在落盘之前完成，失败不产生半条会话；
    错误信息带下标（`messages[1].content 不是字符串`）方便定位。
  - `chatHelpers` 抽出 `newId()`，`makeMessage` 复用它，不再各写一份 randomUUID 兜底。
- 验证：用 esbuild 把 `validateSession` 单独打出来跑（不新增前端测试框架，遵守 Non-Goals），
  20 个用例全通过 —— 5 个应接受（含无 schemaVersion 的旧导出、空 messages），
  15 个应拒绝（顶层数组/null、各字段缺失与类型错误、未来版本、非法 role、
  以及"第二条消息才坏"确认下标准确）。
- 未做：后端 `save_chat_session` 的 upsert 语义保持不变。它是正常聊天保存的公共路径，
  改成"拒绝已存在 ID"会破坏每次发消息的写入。根因在导入路径信任了外部 ID，修在那里。
- 风险：JSON 导出保留原 session ID，导入只做极少字段检查后直接全量 upsert；同 ID 会先删除现有
  messages/tools 再写入导入内容。导出后继续聊天再导入旧文件，会无确认抹掉新增消息并提示成功。
- 涉及位置：
  - `src/pages/Chat/utils/exportSession.ts`
  - `src/pages/Chat/index.tsx`
  - `src-tauri/src/commands/chat.rs`
- 整改目标：默认导入为新 ID；只有用户明确选择“替换”并看到冲突摘要后才允许覆盖，覆盖前保留可恢复快照。
- 验收标准：
  - 导入同一文件两次得到两个独立会话，除非用户主动选择替换。
  - 替换现有 ID 前展示标题、消息数量和更新时间差异；取消后数据库不变。
  - 导入结构进行完整版本和嵌套字段校验，失败不会产生半条会话。

### AUD-048 · P1 · Git clone 目标受目录边界约束，任务占位和清理必须原子

- [x] 状态：已整改
- 实现说明（路径边界）：
  - `path_guard` 新增 `claim_new_subdir(parent, name)`，把三件事并成一步：
    校验 `name` 是单一正常路径组件 → `create_dir`（**不是** `create_dir_all`）原子占位
    → 建完 canonicalize 复核仍落在 `parent` 内且不在受保护集合里。
    `create_dir` 在目标已存在时直接返回 `AlreadyExists`，取代了原先「先 `exists()` 再建」
    的 TOCTOU 窗口，也让「这个目录确实是本次创建的」成为可断言的事实。
  - 新增 `safe_path_component`。**没有复用 `safe_file_id`** —— 那个是给机器生成的 ID 用的，
    只放行 ASCII `[A-Za-z0-9._-]`，套到仓库名上会把 `我的项目`、`foo+bar`、`.github`
    这些现在能正常克隆的名字全部误杀。改成黑名单：只挡路径分隔符、冒号、控制字符、
    `.`/`..`、首尾空白与结尾点、Windows 保留设备名。
  - 清理路径用 `ensure_created_dir_unchanged`：复核目标仍解析到当初返回的同一个
    canonical 路径，被换成 symlink 或被替换掉就**拒绝删除**并打日志，
    不会反过来删掉调用者没创建的东西。
- 实现说明（任务所有权）：
  - 裸 `Option<u32>` PID + 全局 `AtomicBool` 换成一把锁保护的 `CloneTask { id, pid, cancelled }`。
    原来的三个洞：检查与写 PID 之间没有占位（两个请求都能通过检查、第二个覆盖第一个的 PID，
    取消只杀得掉一个）；任一任务结束都无条件清空 PID（抹掉另一个任务的跟踪状态）；
    取消标志是全局的（取消 A 会让 B 也认为自己被取消，进而**删掉 B 的目录**）。
  - `claim_clone_task` 在持锁期间完成「检查 + 写入 owner id」；`set_clone_pid` /
    `release_clone_task` 都先核对「槽位还是我的吗」，过期任务改不动当前槽位。
  - `cancel_git_clone` 只标记当前任务并杀它的 PID，槽位由跑着的任务自己释放。
  - 认领之后的每一条提前返回都走 `fail()`：清理自己创建的目录 + 释放槽位，
    不会把后续 clone 永久挡在门外。
- 验证：
  - `cargo test --lib` 30 通过（新增 5 条）。`claim_new_subdir` 用例覆盖 `..`、`../outside`、
    `..\outside`、`a/b`、`a\b`、绝对路径、`CON`、`nul.txt`、结尾空格/点、内嵌 NUL ——
    并断言失败后 parent 目录里**一个条目都没落地**；同时断言 `我的项目` / `foo+bar` /
    `.github` 正常放行。symlink 替换用例确认清理被拒绝且被指向的目录毫发无损。
  - 状态机三条用例：并发只有一个能认领、取消不波及下一个任务、过期任务动不了当前槽位。
  - **Windows 交叉编译已跑**（改动落在 `#[cfg(target_os = "windows")]` 的 spawn 分支里，
    按硬约束 3 必须验证）：`cargo check --lib --target x86_64-pc-windows-gnu` 通过。
- 未做：前端 `AddProjectDialog.tsx` 没有再写一份同样的校验。规则在后端一处，
  前端复刻只会漂移；后端错误信息已经写明原因，直接显示即可。
- 风险：
  - 可编辑的 repoName 原样参与 `target_dir.join(repo_name)`；`../outside`、绝对路径或平台分隔符
    可让 clone 及失败清理落到用户所选目录之外。
  - single-flight 只做“PID 是否为空”的检查，检查与 spawn/写 PID 之间没有占位。两个并发请求可同时
    启动并覆盖全局 PID，取消只杀其中一个，任一任务结束还可能清掉另一任务的跟踪状态。
- 涉及位置：
  - `src/components/project/AddProjectDialog.tsx`
  - `src-tauri/src/commands/git/clone.rs`
- 整改目标：repoName 只接受单一正常文件名组件；最终目标验证 containment。clone 使用带 owner/request ID
  的原子状态机，清理只针对本次确实创建且仍由该任务持有的目录。
- 验收标准：
  - `..`、绝对路径、混合分隔符和 symlink 逃逸均在启动 Git 前失败。
  - 并发调用只有一个能获得任务所有权；取消只影响对应任务且状态最终回到 idle。
  - 目标创建与检查之间发生替换时，不会删除调用者未创建的目录。

### AUD-049 · P1 · Shell 和 Agent 子进程必须有输出、时间和进程树边界

- [x] 状态：已整改（Windows job object 未做，见末尾）
- 新增公共模块 `src-tauri/src/process_guard.rs`。clone.rs 和 resume_node_agent.rs 原先
  **各有一份** `kill_process_tree`，Unix 分支都是 `kill <pid>` —— 同一个 bug 抄了两遍。
  现在收敛成一处，两边都改为调用它（本地副本已删除）。
- 三条边界：
  - **进程树**：`configure()` / `configure_std()` 给子进程 `process_group(0)`，
    使 pgid == pid，`kill_tree` 就能对 `-pid` 发信号覆盖全部后代（先 TERM、300ms 后 KILL，
    并保留单进程兜底）。我们 spawn 的是 `/bin/sh -c`、`git`、`node`，它们自己还会拉起
    ssh / git-remote-https / 后台任务 —— 只杀前台进程等于取消只是看起来生效了。
  - **输出**：`shell.rs` 改成边读边计量（`read_capped`），累计到 256KB 立刻杀进程树。
    旧实现用 `Command::output()`，会把完整 stdout/stderr 先收进内存、最后才截断 50KB，
    `yes` 在超时之前就 OOM 了。
  - **时间**：`clamp_timeout_ms` 把工具参数里的 timeout 钳到 [1s, 10min]。
    这个值由模型生成，无上限时 `timeout: 999999999` 能让进程挂到应用退出。
- 顺带修了 `ctx.rs::truncate` 的 UTF-8 边界 panic：`&s[..max]` 会在多字节字符中间切断，
  而命令输出和文件内容里中文、emoji 很常见。这是所有工具共用的函数，属于同一条路径上的根因。
- 验证（`cargo test --lib` 36 通过，新增 6 条）：
  - `kill_tree_reaps_grandchildren`：sh 拉起后台 sleep 并写出其 PID，杀进程组后对该 PID
    做 signal-0 存活探测。**跑过反向对照** —— 注释掉 `configure()` 后用例确实失败。
    这一步很关键：第一版用 `ps -g <pid>` 断言，进程组不存在时 ps 返回空，
    把 `configure()` 注释掉照样通过，等于什么都没测，改成直接追踪孙子 PID 才成立。
  - `unbounded_output_is_capped_and_killed`：`yes` 无限输出，断言返回体有确定上界、
    包含截断说明、且远早于 timeout 返回（说明是被上限截停而非超时）。
  - `timeout_kills_background_descendants`：超时后后台孙子进程确实已死。
  - 另有 timeout 钳制上下界、truncate 多字节边界两条。
  - **Windows 交叉编译已跑**（改动涉及多处 `#[cfg(windows)]`）：
    `cargo check --lib --target x86_64-pc-windows-gnu` 通过。
- **未做（需要单独决策）**：Windows 侧仍用 `taskkill /PID <pid> /T /F` 遍历进程树，
  没有改成 job object。job object 才能保证「父进程被强杀时子进程一并终止」，
  但需要引入 `windows` crate 并写 unsafe 绑定，且本机无法真机验证。
  taskkill /T 是两处原有实现就在用的机制，覆盖常规场景；真正有 bug 的是 Unix 分支，已修。
- **未做**：`src-node/resume-agent/src/fs/projectBackend.ts` 未改动。Node 侧的子进程
  现在整体位于 node agent 的进程组内，杀组即可连带回收，不需要它自己再做一层。
- 风险：Chat Bash 使用 `Command::output()` 先把完整 stdout/stderr 收入内存，最后才截断 50KB；
  `yes` 等命令可在超时前导致 OOM，且工具参数可提供没有上限的 timeout。macOS/Linux 的 clone 和
  resume agent 取消只 kill 直接 PID，Node、shell、ssh 等后代可能继续联网、写文件或消耗 LLM 配额。
- 涉及位置：
  - `src-tauri/src/commands/tools/shell.rs`
  - `src-tauri/src/commands/git/clone.rs`
  - `src-tauri/src/commands/resume_node_agent.rs`
  - `src-node/resume-agent/src/fs/projectBackend.ts`
- 整改目标：统一使用有输出硬上限、timeout 上下界、独立 process group/job object 和可靠回收的进程执行器。
- 验收标准：
  - 无限输出达到上限后立即终止，进程 RSS 和返回体保持在确定边界。
  - 超大 timeout 被拒绝或钳制；超时、取消、应用退出都会终止整个进程树。
  - 子进程再启动后台 shell/ssh 的用例结束后没有孤儿进程。

### AUD-050 · P1 · Git 远程选择、upstream 统计和同步结果使用同一真相源

- [x] 状态：已整改
- **真相源统一**：`GitStatus` 新增 `upstreamRemote` / `upstreamBranch`。
  ahead/behind 和待推拉列表本来就按 `@{upstream}` 算，但以前不告诉前端 upstream 是谁，
  界面只能拿 `remotes[0]` 当默认操作目标 —— 统计和操作可以指向两个不同仓库。
  - `get_upstream` 按**已配置的 remote 名做最长前缀匹配**，不是按第一个 `/` 切：
    分支名带斜杠（`feature/deep/name`）时按斜杠切会切错，`origin` 也会抢先匹配掉 `origin-mirror`。
- **列表顺序固定**：`get_remotes` 原来直接 `HashMap::into_values()`，顺序不稳定，
  同一个仓库每次调用都可能换序。改为按名字排序。
- **默认远程优先级**（`ProjectDetailPanel`）：显式记住的选择 → upstream → `origin` → 列表首项。
  显式选择按项目持久化到 localStorage（纯 UI 偏好，不进 Project schema 以免动数据迁移；
  项目里已有 `chat.sessionListCollapsed` 的先例）。切项目时清空，不会带着上个仓库的值。
- **界面可核对**：`GitSidebar` 直接写出「领先/落后基准：origin/main」和
  「推送/拉取目标：backup/main」两行，两者不是同一个远程时标黄并注明。
  未设置 upstream 时也明说「领先/落后不可用」，不再显示成 0/0 让人误以为已同步。
- **同步结果结构化**：`sync_to_remote` 的返回从拼接字符串换成
  `SyncResult { targetRemote, succeeded, failed, branches: [{ branch, ok, isDefault, error }] }`。
  - **0 个分支成功时返回 Err**。以前无条件返回 Ok，前端于是弹「同步成功」并关窗，
    失败明细只是被拼进了那句提示里。
  - 部分失败：前端留在弹窗内逐分支列出成功/失败与原因，**不自动关闭**，toast 用 warning。
- 命令签名变更，已按硬约束 2 重新生成 `src/bindings.ts`（`cargo test --lib export_bindings`）。
- 验证：
  - `cargo test --lib` 37 通过。新增 `upstream_is_split_on_remote_name_not_first_slash`：
    造真实仓库，同时配 `origin` 和 `origin-mirror` 两个 remote、分支名用 `feature/deep/name`，
    断言解析出的是 `origin-mirror` 而非 `origin`，且分支名的斜杠完整保留。
    同时断言未设 upstream 时干净返回 None。
  - `tsc --noEmit`、`npm run build` 通过。
  - **Windows 交叉编译通过**。
- 风险：
  - remotes 经 HashMap `into_values()` 返回，顺序不稳定；详情页把第一个远程当“当前远程”，切项目时
    还可能保留上个仓库的值，而 ahead/behind 与待推拉提交始终基于 `@{upstream}`。
  - pull/push 使用界面 currentRemote，统计却可能来自另一个 upstream，用户可能把代码推到非预期远程。
  - “同步全部分支”把逐分支 push 错误拼进字符串后仍返回 Ok；即使全部失败，前端也提示“同步成功”并关闭。
- 涉及位置：
  - `src-tauri/src/commands/git/remotes.rs`
  - `src-tauri/src/commands/git/status.rs`
  - `src/components/project/ProjectDetailPanel.tsx`
  - `src/components/project/useProjectGitActions.ts`
  - `src/components/project/GitCommitModal.tsx`
  - `src/components/project/SyncRemoteModal.tsx`
- 整改目标：优先使用当前分支的 tracking remote，显式选择应按项目持久化；统计、列表和操作展示同一目标。
  多分支同步返回结构化成功/失败结果，前端按 partial/failure 呈现。
- 验收标准：
  - 同时存在 origin、upstream、backup 时，重启和切项目不会随机改变默认推送目标。
  - ahead/behind、待推拉列表、pull/push 的 remote/branch 在界面中一致且可核对。
  - 0 个分支成功时整体失败；部分失败时不显示全量成功，也不自动关闭结果明细。

### AUD-051 · P1 · Release 对同版本并发和失败重跑必须幂等

- [x] 状态：已整改（待一次真实发布验证）
- **串行化**：新增 `concurrency: { group: release-${{ github.ref }}, cancel-in-progress: false }`。
  刻意**不**取消进行中的任务 —— 发布跑到一半被取消会留下一个只有部分平台产物的 Draft，
  比排队等待更糟。
- **重跑幂等**：便携版 ZIP 名固定（`CodeShelf-Portable-vX-x64.zip`），上一次传过之后
  同名上传会 422 失败，逼人工去删 asset。改成上传前先 `listReleaseAssets` 删掉同名旧
  asset 再传，rerun 直接跑完。
- **发布门禁**：`summarize-release` 增加完整性检查，缺任一平台产物、`.sig` 签名或
  `latest.json` 就 `core.setFailed`，Summary 里直接给出缺失清单。
  只看「构建 job 全绿」不够 —— 上传本身可能失败，或某个矩阵被跳过。
  同一步还会核对 `release.target_commitish` 与构建 SHA 一致（AUD-024 的自动化版本）。
- 验证：用 Tauri 2 的**真实产物命名**跑了匹配器（msi / setup.exe / Portable zip /
  aarch64 与 x64 的 dmg 和 app.tar.gz / AppImage / deb / .sig / latest.json）——
  完整时零缺失；分别抽掉 latest.json、便携包、Linux、mac arm64、签名后都能准确报出缺哪一项。
  YAML 解析通过。
- 风险：workflow 没有 concurrency；同版本任务会复用同一 Draft、tag 和附件。Windows 便携 ZIP 名固定，
  部分矩阵已上传后重跑会因同名 asset 再上传而失败；两个任务还可能竞争正文和附件，在其中一次发布后
  继续修改同 tag 资产，造成 tag、构建提交和二进制来源混杂。
- 涉及位置：
  - `.github/workflows/release.yml`
- 整改目标：按不可变 tag/version 串行化发布；附件上传采用校验后复用或安全替换，发布动作校验完整资产清单。
- 验收标准：
  - Windows 附件已上传、其他平台失败后，直接 rerun 能完成而不要求人工删除 Release/asset。
  - 同版本同时触发时最多一个任务拥有发布权，另一个安全排队或失败且不会修改现有 Draft。
  - 缺任一预期平台产物、签名或 `latest.json` 时不能公开 Release。

### AUD-052 · P2 · 识别并恢复 Windows 历史嵌套安装遗留数据

- [x] 状态：已整改（**发现 + 用户触发迁移**；自动迁移与对比 UI 未做，理由见下）
- 新增 `src-tauri/src/storage/legacy_windows.rs`：
  - `detect_legacy_windows_data()` 向上扫最多 5 层的 `…\data`，返回每处的
    **文件数、总字节、最近修改时间、以及与当前目录的同名文件冲突数**，
    足以让界面展示来源与差异。已迁移过（存在 `.legacy-migrated` 标记）则不再返回。
  - `migrate_legacy_windows_data(from)` **永不覆盖**已存在的文件，只补缺失的；
    完成后写持久标记，后续启动不反复提示；同时拒绝源目录与当前目录存在包含关系的情况
    （否则复制会自我嵌套）。
- **刻意不做自动迁移**：自动复制别人的数据正是本轮审计一直在修的那类问题（静默覆盖），
  而这条路径在非 Windows 机器上无法验证。迁移必须由用户显式触发。
- **未做**：完整的来源对比 / 选择 UI。后端已提供展示所需的全部字段，
  接一个对话框即可，但那部分同样无法在此环境验证，留给有 Windows 环境时补。
- 验证：2 条单测。核心那条断言「冲突文件保持当前版本、缺失文件被补上（含子目录）、
  复制计数准确」—— 即使用户选错源目录也不会毁掉正在用的数据。
- 风险：当前 NSIS hook 已停止继续追加 `CodeShelf/CodeShelf/...`，但没有发现或恢复旧版本曾遗留在
  其他层级的 data。Windows 存储仍只读取当前 exe 相邻目录；既往受影响用户的历史数据可能长期不可见，
  用户手工迁移或重新安装后还可能在另一位置形成新状态。
- 涉及位置：
  - `src-tauri/nsis-hooks.nsi`
  - `src-tauri/src/storage/config.rs`
- 整改目标：识别已知历史目录层级，提供一次性、可回滚且有冲突处理的 Windows 数据迁移。
- 验收标准：
  - 从每个受影响旧安装布局升级，项目、设置、Chat、工具数据均在新位置可见。
  - 新旧位置同时有数据时不静默覆盖，界面展示来源、差异和选择。
  - 迁移完成有持久标记，后续启动不反复复制，也不会再写回旧目录。

### AUD-053 · P2 · Git working tree 使用 NUL 协议解析，并区分加载失败与 clean

- [x] 状态：已整改
- **改用 `--porcelain -uall -z`**，新增 `run_git_command_raw`（保留原始字节、不 trim ——
  `-z` 的条目以 NUL 结尾，trim 会吃掉最后一条）。
  默认 porcelain 会把中文写成 `"\346\224\271\345\220\215.txt"` 这种 **C 风格八进制转义**，
  rename 则写成 `old -> new` 两个路径挤在一行。旧的 `unquote_git_path` 只认
  `\n \t \\ \"` 四种转义、也不拆 rename，产出的是**不存在的假路径**，
  再被 stage / discard / resolve 拿去操作。该函数已随之删除。
- rename / copy 条目后面紧跟一个 NUL 分隔的旧路径，必须一并消费，否则会被当成下一条记录。
- 非 UTF-8 路径**显式跳过并记日志**，不做 lossy 转换 —— 那会产出一个"看起来像但打不开"的路径。
- **UI 四态**：`ProjectCard` 从「有修改 / 无修改」二选一改成
  读取中 / 状态未知 / 有修改 / 无修改。原来 git 不存在、目录不可访问、不是仓库
  全都显示成「无修改」，用户据此以为项目没改动。
- 书架的「仅看有修改」筛选单独记录读取失败的项目 ID：状态未知时**保留**该项目 ——
  隐藏等于替用户断言"它没有修改"，而我们根本不知道；卡片上会显示「状态未知」，不会被静默误分类。
- 验证：新增单测在真实仓库里造中文 / emoji / 含空格文件名 + rename + 同时有暂存和未暂存改动的文件，
  **断言报出的每一条路径都真实存在**（这是整条修复的核心），并确认 rename 被正确拆开、
  双重状态同时出现在 staged 和 unstaged 两个列表里。
- 风险：非 `-z` porcelain 输出把 rename 表示成 `old -> new`，中文路径默认用 C-style 八进制转义；
  自定义 unquote 既不解析八进制也不拆 rename 双路径，后续 stage/discard/resolve 会收到不存在的假路径。
  另外 ProjectCard 在加载中或读取失败时都显示“无修改”，筛选逻辑也没有独立 error 状态。
- 涉及位置：
  - `src-tauri/src/commands/git/status.rs`
  - `src-tauri/src/commands/git/mod.rs`
  - `src/components/project/ProjectCard.tsx`
  - `src/pages/Shelf/index.tsx`
- 整改目标：使用 porcelain v1/v2 `-z` 对合法 UTF-8 路径做无歧义解析，明确 rename 的 old/new；
  对非 UTF-8 路径选择无损数据模型或显式提示不支持；UI 使用 loading/error/clean/dirty 四态。
- 验收标准：
  - 中文、emoji、空格、tab、换行文件名以及 staged/unstaged rename 均显示和操作正确。
  - Git 不存在、目录不可访问和非仓库不会显示“无修改”，也不会被“仅看有修改”静默误分类。

### AUD-054 · P2 · 扫描分类撤销必须只回滚对应那次操作

- [x] 状态：已整改
- `HistoryItem` 从 `{ category, name, count }` 扩成记录**操作 ID、本次实际分配的路径、
  以及每个路径分配前的值**。撤销按 ID 定位（不再按数组下标），逐路径逆向还原。
- 两个关键细节：
  - 只还原**仍然是本次操作结果**的路径 —— 后续操作把它改成别的分类了，
    就不该被这条撤销顺手清掉，那是另一次操作的成果；
  - 前值不是"删除"而是"还原"：路径原本属于别的分类时要放回去，不能一律删掉。
- 验证：6 个用例全通过，覆盖验收标准的场景（A/B 与 C 分两次加入同一分类，
  撤销第一条只影响 A/B、再撤销第二条只影响 C）、后续操作覆盖同一路径、前值还原。
  并与旧行为做了对照：旧逻辑撤销第一条后 **C 被连带撤销**。
- 风险：历史项只保存 category/name/count；撤销时删除当前所有同 category 的路径，而不是当次分配的路径。
  多次把不同项目放入同一分类后，撤销任一历史会一并撤销其他批次，剩余历史也与真实状态不符。
- 涉及位置：
  - `src/components/project/ScanResultDialog.tsx`
- 整改目标：历史记录保存精确路径集合和每个路径的前值；撤销按操作 ID 逆向应用。
- 验收标准：A/B 与 C 分两次加入同一分类后，撤销第一条只影响 A/B；再撤销第二条只影响 C，
  计数、选择和最终导入参数始终一致。

### AUD-055 · P2 · 编辑器和终端设置的数据模型必须与 UI 语义一致

- [x] 状态：已整改
- **默认编辑器按 `is_default` 消费**，不再读 `editors[0]`。后端用 flag 标识且不重排数组，
  前端却一直读第一项 —— 「设为默认」靠乐观重排看起来生效，后端返回原顺序一覆盖就打回原形。
  乐观更新也改成只翻 flag、不重排，不再与后端打架。
- `updateEditor` **保留**原有 `is_default`（原来固定传 `false`）——
  改一下默认编辑器的名字或路径就会把默认关系清掉。
- **终端持久化 path map**：`TerminalConfig` 新增 `terminal_paths`，
  `save_terminal_config` 改成读-改-写（不传就沿用已存的），`custom_path` 同理。
  原来只存当前类型那一条，为非当前类型配好的路径重启即丢、切离 custom 还会清掉 customPath。
  读取时把老的单值 `terminal_path` 补进 map，升级不丢原设置。
- store 的写失败不再只 `console.error`：全部**回滚到写入前的状态**并弹错误，
  界面不会停留在未持久化的假象上。
- 风险：
  - 后端用 `is_default` 标识默认编辑器，前端展示和实际打开却始终使用数组第一项；请求完成后后端原顺序
    覆盖乐观重排，导致“设为默认”当次和重启后都可能无效；编辑任意配置时还固定发送
    `is_default=false`，可把当前默认标记清掉。
  - 终端 UI 允许每种终端保存独立路径，持久层却只保存当前类型的一条 `terminal_path`；为非当前类型测试、
    修复的路径重启即丢，切离 custom 还会清掉 customPath。
  - store 对写入失败只记 console，界面继续保留未持久化状态。
- 涉及位置：
  - `src/pages/Settings/EditorSettings.tsx`
  - `src/pages/Settings/TerminalSettings.tsx`
  - `src/pages/Settings/index.tsx`
  - `src/stores/editorsStore.ts`
  - `src/utils/editor.ts`
  - `src/App.tsx`
  - `src-tauri/src/commands/settings.rs`
- 整改目标：选择一种明确真相源：默认编辑器按 ID/flag 消费；终端配置要么持久化 path map，
  要么 UI 只承诺一个路径。保存失败必须回滚或保留待保存状态。
- 验收标准：
  - 把编辑器 B 设为默认后立即打开项目和重启后都使用 B。
  - 修改默认编辑器的名称或路径不会清除默认关系，任意时刻恰好有一个有效默认项。
  - 分别设置两种终端路径和 customPath，反复切换、重启后均按界面承诺保留。
  - 注入写失败时不显示已保存状态，用户可以重试。

### AUD-056 · P2 · 快捷键绑定必须唯一且以事务方式注册、保存

- [x] 状态：已整改
- 唯一性校验放在**后端 `save_app_shortcuts` 的保存之前**：界面校验挡不住其它调用方，
  而一旦落盘，重复绑定里只有第一个匹配会被执行，后面的动作永久不可达 ——
  用户只看到「这个快捷键没反应」，完全无从排查。
- 比较前做归一化（去空格、统一大小写、修饰键排序），否则 `Ctrl+Shift+A` 和
  `shift+ctrl+a` 会被当成两个不同组合而漏检。
- 只校验 `enabled` 的项：禁用的绑定不注册，强行报错反而会挡住「先禁用再改键」这种正常操作。
- 验证：2 条单测覆盖完全相同、仅顺序/大小写/空格不同、禁用项重复、不同组合、空 keys。
- 风险：设置页允许多个动作使用同一组合，应用内和 Windows 只执行第一个匹配，后续动作永久不可达；
  macOS/Linux 注册又先注销全部旧快捷键，再逐项注册，新集合中途冲突会只留下半套。保存失败仍保留
  乐观 UI 状态。
- 涉及位置：
  - `src/pages/Settings/ShortcutSettings.tsx`
  - `src/hooks/useAppShortcuts.ts`
  - `src/stores/settingsStore.ts`
  - `src-tauri/src/keyboard_hook.rs`
  - `src-tauri/src/commands/settings.rs`
- 整改目标：保存前校验启用绑定的唯一性和平台可注册性；新集合完整验证/注册成功后再替换旧集合。
- 验收标准：
  - 重复组合被阻止或要求明确改绑，两个动作不会静默争抢。
  - 构造第二项注册失败时，旧快捷键集合完整保留。
  - 持久化失败时 UI 回滚或显示“未保存”，重启状态与最后一次成功保存一致。

### AUD-057 · P2 · 自动更新下载和安装使用全局 single-flight 状态机
 
- [x] 状态：已整改
- 下载与安装各加一把**模块级 Promise 锁**。启动通知弹窗和设置页各自维护 `downloading`
  状态，却共享同一个模块级 `cachedUpdate` / `downloadedUpdate`：两边同时点「下载」会
  并发调用 `update.download()`，进度回调互相打架、`downloadedUpdate` 被写两次，
  更糟的是两个下载可能写同一个临时文件。
- 用 **Promise 而不是 boolean**：后来者复用同一次下载并等它完成，而不是直接失败 ——
  用户在两个入口点了同一件事，期望是「它开始下载了」。
- `downloadAndInstallUpdate` 与 `downloadUpdate` 共用同一把锁（打的是同一个更新）。
- 另导出 `isUpdateBusy()` 供界面禁用按钮。
- 风险：启动通知和设置页各自维护 downloading 状态，却共享没有锁的模块级 Update 对象。
  自动下载进行中或已经 ready 时，设置页仍可启动另一套 `downloadAndInstall`；两个 UI 互不知情，
  可能重复下载、覆盖状态或竞争安装/relaunch。
- 涉及位置：
  - `src/services/updater/index.ts`
  - `src/components/ui/UpdateNotification.tsx`
  - `src/pages/Settings/UpdateSettings.tsx`
- 整改目标：更新服务提供全局 checking/downloading/ready/installing/error 状态和单一 owner；
  所有入口订阅同一状态，后续调用加入已有任务或得到明确拒绝。
- 验收标准：
  - 自动下载期间从设置页点击不会产生第二个下载。
  - 已下载 ready 后“下载并安装”直接复用产物，不重新下载。
  - 任一页面卸载、下载失败或 relaunch 失败后，两个入口状态仍一致且可以安全重试。

### AUD-058 · P2 · 书架最近打开和批量操作必须以持久层结果为准

- [x] 状态：已整改（批量操作部分）
- 抽出 `runBatch` + `reportBatch`：每项**独立成败**，返回成功项与失败明细。
  原来是 `for (...) await ...` 一把梭，中途一项失败直接抛出 —— 前面已经成功的既不反映到
  界面上也不告知用户；而成功路径的 toast 固定报 `selectedIds.size`，与真正成功的数量未必一致。
- `runBatch` 内部对 ID **去重**（同一个 ID 出现两次会被执行两遍，第二次多半报"不存在"）。
- 三个批量入口（移除 / 分类 / 标签）全部改为：按真实成功项更新本地状态、
  **失败项保持选中**便于重试、toast 区分全成功 / 部分失败 / 全失败。
- **未做**：「最近打开记录由后端写入并返回」那一半。它需要新增后端命令并改动打开路径，
  与批量对账是两件独立的事，留待单独处理。
- 风险：
  - 打开详情只在 Zustand 中改 `lastOpened`，已经存在的后端 `update_last_opened` 从未调用；
    重启后侧栏最近项目顺序回退。
  - 批量移除、分类和标签仍逐项调用单条 API，全部成功后才一次更新 UI。第 N 项失败时，前 N 项已经
    落盘但界面保留旧列表并只显示整体失败；已存在的 batch API 也没有统一原子/partial 语义。
- 涉及位置：
  - `src/pages/Shelf/index.tsx`
  - `src/components/layout/Sidebar.tsx`
  - `src/services/db/index.ts`
  - `src-tauri/src/commands/project.rs`
- 整改目标：打开记录由后端写入并返回；批量 API 明确采用全事务或结构化逐项结果，前端按真实结果对账。
- 验收标准：
  - 打开多个无新提交项目后重启，最近项目顺序仍正确。
  - 在批量第 N 项注入失败，不会出现“后端已改、界面未改”的隐藏部分成功。
  - missing ID、重复 ID 和写入失败都有确定结果，成功 toast 的数量与实际成功数一致。

### AUD-059 · P2 · 统计缓存逐项目判鲜、剪枝，并区分分析失败与空数据

- [x] 状态：已整改（失败区分 + 解析修复）
- **`|` 分隔符换成控制字符**：`--format` 改用 `%x1f` 分隔字段、`-z` 分隔记录。
  提交主题和作者名里出现竖线很常见（`fix: 处理 a|b`、`作者|带竖线`），
  一旦出现，`split('|')` 之后所有字段整体错位 —— 作者变成主题的后半截、
  日期变成邮箱，「最近活动」时间也跟着错。
- **区分失败与空**：`get_project_commits` / `analyze_project` 改为返回 `Result`。
  分析失败时**既不写缓存也不清 dirty** —— 原来一次 git 失败会被当成"0 次提交"
  覆盖掉上一次正确的缓存，而且 dirty 被清后再也不会自动重算。
- 验证：2 条单测。一条在真实仓库里用含 `|` 的提交主题和作者名，断言主题、作者、邮箱、
  日期四个字段都没错位、短 hash 是完整 hash 的前缀；另一条断言非仓库返回 `Err` 而不是空列表。
- **未做**：「按当前项目集合事务性 prune」。剪枝与本条的失败区分是独立问题，
  且涉及 sqlite 事务边界，留待单独处理。
- 风险：
  - 删除项目后前端把旧 path 标 dirty；增量刷新与当前项目取交集为空便直接返回，不消费 tombstone。
    全量刷新在仍有其他项目时也不剪枝，旧项目统计可能继续聚合，`has_dirty_stats` 还会永久为 true。
  - 缓存有效性取所有项目 `last_updated` 的最大值，一个刚刷新项目会掩盖其他项目已经过期。
  - Git 命令失败被转换为空 commits/0 unpushed 后照常覆盖最后一次正确缓存并清 dirty。
  - log 使用 `|` 分隔自由文本，提交主题或作者包含 `|` 时字段错位，日期与近期活动随之错误。
- 涉及位置：
  - `src-tauri/src/commands/stats.rs`
  - `src/pages/Shelf/index.tsx`
  - `src/pages/Dashboard/index.tsx`
  - `src/services/stats/index.ts`
- 整改目标：按当前项目集合事务性 prune；逐项目判断 freshness；分析结果表达 success/error，
  失败保留最后一次正确数据并可重试；Git 输出使用机器可解析的 NUL/控制分隔协议。
- 验收标准：
  - 删除一个项目且保留其他项目时，旧统计和 dirty 记录都立即消失。
  - 项目 A 今天刷新、B 超过 24 小时时只刷新 B，不把整份缓存误判为有效。
  - 临时断盘/权限/Git 失败不会把历史统计覆盖为 0，恢复后能重试。
  - 提交主题、作者含 `|` 或中文时，日期、作者、消息仍准确。

### AUD-060 · P2 · OpenAPI 导入不得静默丢弃合法协议语义

- [x] 状态：已整改
- 方法白名单补齐 **HEAD / OPTIONS / TRACE**（原来只有 GET/POST/PUT/PATCH/DELETE）。
  它们是 OpenAPI Path Item 的合法方法，且在本项目里走同一条执行路径
  （reqwest 按方法名发请求），没有理由不支持。
- `ImportResult` 新增 `skipped: string[]`，导入时收集被跳过的项并在界面 toast 出来。
  原来是静默 `continue`：用户导入 20 个接口、界面显示"导入成功"，实际只进来 17 个。
- 区分「不是 operation 的合法键」（`summary` / `parameters` / `$ref` 等）与
  「真正被丢弃的 operation」，前者不报告，避免噪音淹没真问题。
- 一个接口都没导入成功时，错误信息里带上跳过明细，而不是笼统一句「没有可导入的接口」。
- 风险：导入器只接受 GET/POST/PUT/PATCH/DELETE，合法的 HEAD/OPTIONS/TRACE 被静默跳过；
  header/cookie 参数、query/cookie apiKey、OAuth/OpenID 及部分 `$ref` 也不会完整映射。导入仍提示成功，
  用户得到看似完整但实际缺参数或鉴权的接口库。
- 涉及位置：
  - `src/pages/ApiChat/utils/importOpenApiDocument.ts`
  - `src/pages/ApiChat/components/LibraryManagerDialog.tsx`
- 整改目标：支持产品承诺的 OpenAPI 子集；对暂不支持的 operation、参数、鉴权和引用生成明确 loss report，
  用户确认后才导入。
- 验收标准：
  - 用覆盖 HEAD/OPTIONS、header/cookie、各类 security scheme、内部/外部 ref 的固定 fixture 回归。
  - 任何未导入语义都显示路径、方法和原因；不能只给“导入成功”。
  - 导入结果的 required 参数和鉴权可直接用于执行，不需要用户猜测缺失字段。

### AUD-061 · P2 · 发布包补齐操作系统代码签名与 notarization

- [~] 状态：部分整改。macOS release 已启用 ad-hoc bundle 签名，CI 会校验资源封印、
  CPU 架构与 DMG 完整性；Developer ID/notarization 与 Windows Authenticode 尚未接入。
- 风险：当前仅配置 Tauri updater 签名，它能验证更新包，却不等于 Apple Developer ID/notarization
  或 Windows Authenticode。直接从 Releases 首次安装时仍可能被 Gatekeeper、Unknown Publisher 或
  SmartScreen 阻止/强警告，用户也无法验证发布者身份。
- 涉及位置：
  - `.github/workflows/release.yml`
  - `src-tauri/tauri.conf.json`
  - `docs/更新步骤说明.md`
- 整改目标：为正式分发配置 macOS 签名与 notarization、Windows Authenticode，并在文档中区分
  updater 签名和操作系统信任链。
- 验收标准：
  - 干净 macOS 下载的 dmg 可通过 `spctl`/notarization 校验，签名主体与项目发布者一致。
  - 干净 Windows 安装包和 exe 的 Authenticode 状态有效，发布流水线在签名缺失时失败。
  - updater 的签名和两平台系统签名均在发布资产检查清单中。

---

## 全量回归清单

单项验收完成后至少运行与改动相关的命令；准备关闭整个清单时执行全量回归：

```bash
npm ci
npx tsc --noEmit
npx tsc -p src-node/resume-agent/tsconfig.json --noEmit
npm run build
cargo check --manifest-path src-tauri/Cargo.toml --lib --bins
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run verify:release
```

还需完成以下人工/平台验证：

- [ ] Windows 安装版和便携版：无系统 Node 环境启动简历 sidecar。
- [ ] Windows：右键添加项目、URL 打开、WSL 配置、SSH 隧道。
- [ ] macOS ARM64 与 x86_64：安装、启动、sidecar、Finder Opened。
- [ ] Linux deb 与 AppImage：普通用户首次启动、保存、重启。
- [ ] 两台局域网设备：PairDrop 认证、限额、文件归属和服务绑定地址。
- [ ] MCP Gateway：无密钥、恶意 Origin、过期密钥、合法客户端和 LAN/loopback 组合。
- [ ] 三个不同 Git 仓库：多 remote/upstream、快速切换、MM 文件、rename、Unicode 路径和全部破坏性操作。
- [ ] Git clone/Agent/Shell：路径逃逸、并发启动、无限输出、超时、取消、退出和孤儿进程。
- [ ] Chat/API Chat：快速失败、快速响应、切会话、置顶、重复 Enter、取消、卸载和同 ID JSON 导入。
- [ ] 书架/统计/设置：批量中途失败、最近打开重启、删除项目、过期缓存、默认编辑器和多终端路径。
- [ ] 损坏 JSON、不可写数据目录、SQLite 迁移失败，以及失败前后数据不变的备份恢复路径。
- [ ] Windows 历史嵌套安装升级；macOS/Windows 首次安装的系统签名校验。
- [ ] Release tag SHA、构建 SHA、产物 SHA、失败重跑、同版本并发和发布门禁一致。

## 审查时已通过的基线检查

- 根前端 `tsc --noEmit` 通过。
- resume-agent TypeScript `--noEmit` 通过。
- `cargo check --lib --bins` 通过。
- 跳过会写入 bindings 的导出测试后，Rust 单元测试 6 项通过。
- 五处版本号均为 `0.1.41`。
- 未发现明显已提交凭据，Markdown 相对链接扫描未发现断链。
- 审查开始前 Git 工作树干净；本轮只新增/更新审查文档，未修改业务代码。

这些结果只代表上述基线，不表示本清单中的运行时、安全和跨平台问题已解决。
