# pythinker 命令

`pythinker` 是 Pythinker Code CLI 的主命令，用于在终端中启动一次交互式会话。不带任何参数运行时，它会在当前工作目录下开启一个新会话；配合不同的 flag，可以续上历史会话、跳过审批、从 Plan 模式开始，或者指定自定义的 Skills 目录。

```sh
pythinker [options]
pythinker <subcommand> [options]
```

## 主命令选项

所有 flag 都是可选的，直接运行 `pythinker` 即可进入交互式会话：

| 选项 | 简写 | 说明 |
| --- | --- | --- |
| `--version` | `-V` | 打印版本号并退出 |
| `--help` | `-h` | 显示帮助信息并退出 |
| `--session [id]` | `-S` | 恢复一个会话。带 ID 时直接打开指定会话；不带 ID 时进入交互式选择器 |
| `--continue` | `-C` | 继续当前工作目录下最近一次的会话，无需手动指定 ID |
| `--model <model>` | `-m` | 为本次启动指定模型别名。省略时新会话使用配置文件中的 `default_model` |
| `--prompt <prompt>` | `-p` | 非交互执行单次 prompt，并把 Assistant 输出流式写到 stdout。该模式不会打开 TUI |
| `--output-format <format>` | | 设置非交互输出格式，支持 `text` 与 `stream-json`。仅可与 `--prompt` 一起使用，默认 `text` |
| `--yolo` | `-y` | 自动批准普通工具调用，跳过审批请求 |
| `--auto` | | 以 auto 权限模式启动；工具审批自动处理，Agent 不会向用户提问 |
| `--plan` | | 以 Plan 模式启动新会话，AI 会优先使用只读工具进行探索和规划 |
| `--skills-dir <dir>` | | 从指定目录加载 Skills，替换自动发现的用户和项目目录。可重复传入 |

`-r` / `--resume` 是 `--session` 的隐藏别名；`--yes` 和 `--auto-approve` 是 `--yolo` 的隐藏别名，在帮助信息中不显示。

::: warning 注意
`--yolo` 会跳过普通工具调用的人工确认，包括文件写入和 Shell 命令执行，请只在受信任的工作目录下使用。Plan 模式的退出审批不会被 `--yolo` 跳过；Plan 模式下的 `Bash` 按普通放行规则处理。
:::

### flag 冲突规则

以下组合会在启动时被拒绝：

- `--continue` 与 `--session` 互斥——两者都表示"恢复历史会话"
- `--yolo` 和 `--auto` 互斥——两种权限模式互斥
- `--prompt` 不能与 `--yolo`、`--auto` 或 `--plan` 同时使用——非交互模式固定使用 `auto` 权限
- `--output-format` 只能与 `--prompt` 一起使用

恢复会话时，可以通过 `--auto`、`--yolo` 或 `--plan` 覆盖原会话保存的权限或计划模式。例如，`pythinker --continue --auto` 会恢复最近会话并切换到 auto 权限模式。

## 典型用法

直接运行开启新会话：

```sh
pythinker
```

从上次中断的地方继续（自动找到当前目录最近的会话）：

```sh
pythinker --continue
```

从历史会话列表中挑选，或直接指定已知 ID：

```sh
pythinker --session
pythinker --session 01HZ...XYZ
```

跳过审批确认，适合已知安全的批处理任务：

```sh
pythinker --yolo
```

让 Agent 自行处理一切，不再向用户提问：

```sh
pythinker --auto
```

先阅读代码、产出实现计划，而不是立刻动手修改文件：

```sh
pythinker --plan
```

### 自定义 Skills 目录

有两种方式指定 Skills 目录，语义不同：

- **`--skills-dir <dir>`**（CLI flag）：**替换**自动发现的用户和项目目录，仅对本次启动生效。可重复传入以叠加多个目录：

  ```sh
  pythinker --skills-dir /path/to/team-skills --skills-dir ./local-skills
  ```

- **`extra_skill_dirs`**（`config.toml`）：**叠加**到自动发现的目录之上，长期生效，适合配置团队共享 Skills。详见 [Agent Skills](../customization/skills.md)。

## 非交互执行

在脚本或 CI 中运行单次 prompt 时，使用 `-p`：

```sh
pythinker -p "Summarize the current repository status"
```

输出采用 transcript 样式：thinking 内容和 Assistant 正文都以 `• ` 开头，换行后两个空格缩进。Assistant 正文输出到 stdout；thinking、工具进度和"恢复会话"提示输出到 stderr。`-p` 模式不会请求人工审批，普通工具调用按 `auto` 权限策略处理，静态 deny 规则仍然生效。

临时切换模型：

```sh
pythinker -m pythinker-code/kimi-for-coding -p "Explain the latest diff"
```

需要结构化读取输出时，使用 `stream-json` 格式——stdout 每行都是一个 JSON 对象：

```sh
pythinker -p "List changed files" --output-format stream-json
```

`stream-json` 模式下，普通回复输出 Assistant 消息；模型调用工具时，先输出带 `tool_calls` 的 Assistant 消息，再输出对应的 Tool 消息，最后继续输出后续 Assistant 消息。thinking 内容不会写入 JSONL；工具进度和恢复会话提示仍写到 stderr。

## 子命令

`pythinker` 提供以下子命令：`login`（非交互式登录）、`acp`（ACP IDE 模式）、`server`（运行并管理本地 REST/WebSocket/web 服务）、`web`（`pythinker server run --open` 的别名）、`doctor`（校验配置文件）、`export`（导出会话）、`migrate`（迁移旧版数据）、`upgrade`（检查更新）、`provider`（管理供应商）。

### `pythinker login`

通过 RFC 8628 device-code 流程登录 Pythinker Code OAuth，无需进入 TUI。命令会发起一次 device authorization 请求，将验证地址和用户码打印到 stderr，然后轮询直到浏览器侧完成授权。生成的 token 写入与 TUI `/login` 相同的本地位置，下次启动 `pythinker` 时会自动加载。

```sh
pythinker login
```

该子命令没有任何 flag。在轮询期间随时按 `Ctrl-C` 可取消登录；取消或失败时退出码为 `1`，成功为 `0`。

### `pythinker acp`

把 Pythinker Code CLI 切换到 ACP（Agent Client Protocol）模式，在标准输入/输出上以 JSON-RPC 形式与 IDE 对话，让编辑器直接驱动 pythinker 的会话和工具调用。通常不需要手动运行——IDE 会把它作为子进程入口启动。配置方式见[在 IDE 中使用](../guides/ides.md)，技术细节见 [pythinker acp 参考](./pythinker-acp.md)。

```sh
pythinker acp
```

### `pythinker server`

运行并管理本地 Pythinker 服务 —— 同一个进程同时挂载 REST + WebSocket API 与 web UI。父命令拆成按需入口 (`run`) 与 OS 级生命周期管理 (`install`、`uninstall`、`start`、`stop`、`restart`、`status`)。`pythinker server run` 会确保一个后台守护进程在运行、健康后返回；如需把服务挂在当前终端，请加 `--foreground`。

服务运行时，`GET /openapi.json` 会返回 REST OpenAPI 文档，`GET /asyncapi.json` 会返回本地 WebSocket 协议的 AsyncAPI 文档。

```sh
pythinker server run                # 启动或复用一个后台守护进程
pythinker server run --foreground   # 挂在当前终端前台运行
pythinker server install            # 注册到 launchd / systemd / schtasks
pythinker server start              # 启动 OS 管理的服务
pythinker server status             # 查看安装与运行状态
```

#### `pythinker server run`

| 选项 | 说明 |
| --- | --- |
| `--port <port>` | 绑定端口；默认 `58627` |
| `--log-level <level>` | 按所选级别开启服务日志；默认不输出 |
| `--debug-endpoints` | 挂载 `/api/v1/debug/*` 调试路由（默认关闭） |
| `--foreground` | 前台运行，不 spawn 后台守护进程 |
| `--open` | 服务健康后用默认浏览器打开 web UI |

`pythinker server run` 只绑定本机 loopback 地址。默认会 spawn 一个后台守护进程（多次运行会复用同一个），健康后即退出；守护进程在最后一个 web 客户端断开后自行关闭。加 `--foreground` 则在当前进程中运行——保持挂在终端，在 `SIGINT` / `SIGTERM` 时干净退出。

#### `pythinker server install`

把服务注册成 OS 管理的进程，开机自启、崩溃后自动重启。根据当前平台选择对应后端：

- **macOS**：写 LaunchAgent plist 到 `~/Library/LaunchAgents/ai.pymodel.pythinker-server.plist`，并通过 `launchctl bootstrap gui/<uid>` 启动。
- **Linux**：写 `--user` systemd unit 到 `~/.config/systemd/user/pythinker-server.service`，并执行 `systemctl --user enable --now`。
- **Windows**：通过 `schtasks /Create /XML` 注册名为 `PythinkerServer` 的计划任务。

| 选项 | 说明 |
| --- | --- |
| `--port <port>` | 被托管的服务绑定端口；默认 `58627` |
| `--log-level <level>` | 写入生成 unit 的日志级别 |
| `--force` | 已安装时强制覆盖 |
| `--json` | 用 JSON 替代人类可读输出 |

本机地址、选定的端口和日志级别会写入 `~/.pythinker-code/server/install.json`，即便服务停掉 `pythinker server status` 也能读到。

#### 生命周期子命令

| 命令 | 说明 |
| --- | --- |
| `pythinker server uninstall` | 停止并移除 OS 服务定义。幂等。 |
| `pythinker server start` | 启动 OS 管理的服务。未安装时会报错。 |
| `pythinker server stop` | 停止 OS 管理的服务。 |
| `pythinker server restart` | 重启 OS 管理的服务。 |
| `pythinker server status` | 打印 installed / running / pid / port / log-path；`--json` 用于脚本。 |

#### `pythinker web`

`pythinker server run --open` 的别名：前台跑服务，健康后立即用默认浏览器打开 web UI。加 `--no-open` 等价于纯 `pythinker server run`。

```sh
pythinker web                        # 前台 + 自动打开浏览器
pythinker web --no-open              # 等价于 `pythinker server run`
```

`--port`、`--log-level`、`--debug-endpoints` 与 `pythinker server run` 完全一致。

### `pythinker doctor`

校验 `config.toml` 和 `tui.toml`，不会启动 TUI，也不会修改任一文件。默认检查 `PYTHINKER_CODE_HOME` 下的文件；未设置该环境变量时检查 `~/.pythinker-code`。默认路径缺失时会显示为跳过，因为内置默认值仍可生效。

```sh
pythinker doctor
```

| 命令 | 说明 |
| --- | --- |
| `pythinker doctor` | 校验默认 `config.toml` 和 `tui.toml` |
| `pythinker doctor config [path]` | 只校验 `config.toml`；传入 `path` 时使用该文件而不是默认文件 |
| `pythinker doctor tui [path]` | 只校验 `tui.toml`；传入 `path` 时使用该文件而不是默认文件 |

显式传入路径时，文件必须存在。所有被检查的文件都有效或被跳过时，退出码为 `0`；任何指定文件缺失或配置无效时，退出码为 `1`。

```sh
# 检查默认配置文件
pythinker doctor

# 只检查默认运行时配置
pythinker doctor config

# 替换正式 TUI 配置前，先检查候选文件
pythinker doctor tui ./tui.toml
```

### `pythinker export`

把一个会话打包成 ZIP 文件，便于分享、归档或提交问题反馈。

```sh
pythinker export [sessionId] [options]
```

| 参数 / 选项 | 简写 | 说明 |
| --- | --- | --- |
| `sessionId` | | 要导出的会话 ID。省略时自动选择当前工作目录下最近一次的会话，并要求确认 |
| `--output <path>` | `-o` | 输出 ZIP 文件路径。省略时写入当前目录下的默认文件名 |
| `--yes` | `-y` | 跳过默认会话的确认提示，直接导出 |
| `--no-include-global-log` | | 不打包全局诊断日志。默认包含 |

导出包含目标会话目录内的所有文件。全局诊断日志（`~/.pythinker-code/logs/pythinker-code.log`）默认包含，因为它可能含有其他会话或项目的事件；不想分享时加 `--no-include-global-log`。

```sh
# 导出当前工作目录最近一次会话，跳过确认
pythinker export -y

# 导出指定会话到自定义路径
pythinker export 01HZ...XYZ -o ./bug-report.zip

# 排除全局诊断日志
pythinker export 01HZ...XYZ -o ./bug-report.zip --no-include-global-log
```

### `pythinker migrate`

将旧版 pythinker-cli 的本地数据迁移到 pythinker-code，包括历史会话和配置文件。纯交互式运行，会引导你完成全流程。

```sh
pythinker migrate
```

完整迁移说明见[从 pythinker-cli 迁移](../guides/migration.md)。

### `pythinker upgrade`

立即检查最新版本并展示更新提示，选择操作后退出。

```sh
pythinker upgrade
```

对全局 npm、pnpm、yarn、bun 以及 macOS / Linux native 安装，`pythinker upgrade` 会展示更新选项；选择 `Install update now` 后运行对应的前台安装命令。当前安装方式无法自动升级时（如 Windows native 安装），改为打印手动更新命令。

### `pythinker vis`

在浏览器中启动会话可视化工具，直观查看一次会话的全过程。命令会启动一个指向本地会话的进程内服务器，打印访问地址并打开浏览器，持续运行直到你按下 `Ctrl-C`。

```sh
pythinker vis [sessionId] [options]
```

| 参数 / 选项 | 说明 |
| --- | --- |
| `sessionId` | 直接打开指定会话的可视化页面。省略时打开列出所有会话的首页 |
| `--port <number>` | 绑定的端口。默认自动挑选一个空闲端口 |
| `--host <host>` | 绑定的主机。默认 `127.0.0.1` |
| `--no-open` | 不自动打开浏览器，仅打印访问地址 |

```sh
# 启动可视化工具并在浏览器中打开首页
pythinker vis

# 直接打开指定会话
pythinker vis 01HZ...XYZ

# 绑定固定主机和端口且不打开浏览器（例如在远程主机上）
pythinker vis --host 0.0.0.0 --port 8123 --no-open
```

### `pythinker provider`

在 shell 中管理供应商，相当于 TUI 中 `/provider` 的非交互版本。适合脚本化部署、CI 初始化，以及在新机器上一行完成配置。

```sh
pythinker provider <action> [options]
```

包含五个动作：

#### `pythinker provider add <url>`

从自定义 registry（`api.json`）批量导入所有供应商。命令会拉取 registry，为每个条目创建 `[providers.<id>]` 和 `[models.<alias>]`，并写入 `source` 元数据，使 TUI 下次启动时自动刷新同一 registry 地址下的供应商和模型。

| 参数 / 选项 | 说明 |
| --- | --- |
| `<url>` | Registry 地址 |
| `--api-key <key>` | 访问 registry 时携带的 Bearer token。未传时回退到环境变量 `PYTHINKER_REGISTRY_API_KEY`，必填 |

```sh
pythinker provider add https://registry.example.com/v1/models/api.json --api-key YOUR_KEY

# 或通过环境变量（适合 CI / .envrc）
PYTHINKER_REGISTRY_API_KEY=YOUR_KEY pythinker provider add https://registry.example.com/v1/models/api.json
```

如果某个 provider id 已存在，会先删除再重新写入。不会自动设置默认模型，后续可用 `-m` 或 TUI 内的 `/model` 选择。

#### `pythinker provider remove <providerId>`

删除指定供应商及其所有模型 alias。如果被删除的供应商正好是 `default_model` 所属，则同时清空 `default_model`。

```sh
pythinker provider remove kohub
```

#### `pythinker provider list`

按行打印每个已配置的供应商，含类型、模型数量、来源。加 `--json` 可输出原始的 `providers` 和 `models` 表，便于程序化处理。

```sh
pythinker provider list
pythinker provider list --json | jq '.providers | keys'
```

#### `pythinker provider catalog list [providerId]`

在不修改任何配置的情况下浏览公开的 [models.dev](https://models.dev/) 模型目录。不传参数时列出所有供应商及协议类型和模型数量；传 `providerId` 时列出该供应商下所有模型的上下文窗口和能力。

| 参数 / 选项 | 说明 |
| --- | --- |
| `[providerId]` | 可选，要查看的供应商 id |
| `--filter <substring>` | 按 id 或 name 大小写不敏感子串过滤 |
| `--url <url>` | 覆盖 catalog 地址，默认 `https://models.dev/api.json` |
| `--json` | 以 JSON 形式输出匹配片段 |

```sh
pythinker provider catalog list
pythinker provider catalog list --filter anthropic
pythinker provider catalog list anthropic
```

#### `pythinker provider catalog add <providerId>`

按 id 从 catalog 直接导入一个已知供应商，协议类型、base URL、模型信息均由 catalog 提供，只需提供 API key。

| 参数 / 选项 | 说明 |
| --- | --- |
| `<providerId>` | catalog 中的供应商 id，如 `anthropic`、`openai` |
| `--api-key <key>` | 供应商 API key。未传时回退到 `PYTHINKER_REGISTRY_API_KEY`，必填 |
| `--default-model <modelId>` | 可选，导入后把 `default_model` 设为 `<providerId>/<modelId>` |
| `--url <url>` | 覆盖 catalog 地址，默认 `https://models.dev/api.json` |

```sh
pythinker provider catalog list anthropic          # 先看可选的模型
pythinker provider catalog add anthropic --api-key sk-ant-... --default-model claude-opus-4-7
```

## 下一步

- [斜杠命令](./slash-commands.md) — 交互式 TUI 内的控制命令速查
- [配置文件](../configuration/config-files.md) — `default_model`、权限模式等启动参数的持久化配置
- [Agent Skills](../customization/skills.md) — `--skills-dir` 加载的 Skill 文件格式
