# 安装与隔离试用

要求 Node 24.12.0 或更高、Pi 1.2.0。先运行 `npm ci --ignore-scripts`、`npm run verify`、`npm run verify:sdk`。SDK 检查使用隔离目录，不验证账号与订阅，也不发起模型请求。

## 独立 Pi 配置目录

在项目根目录运行；这个过程写入新的试用目录，不覆盖活动配置。

```powershell
$trial = Join-Path $env:TEMP ('zhenzhi-workflow-trial-' + [guid]::NewGuid().ToString('N'))
$env:PI_CODING_AGENT_DIR = $trial
pi install .
pi
# /workflow-status --json
# /workflow-task status
# /workflow-dev 描述一个小任务
# /theme 选择 zhenzhi-calm
```

使用模型前自行为试用配置认证；不要提交或向本项目复制认证。完成后在同一终端执行 `Remove-Item Env:PI_CODING_AGENT_DIR`。已有 Pi 进程需要重新加载扩展或重新启动，环境变量只影响新进程。运行真实工作器是另一项显式动作，可能产生模型费用。

## Windows 权限适配器（可选）

默认包不加载 Windows 权限适配器。需要 PowerShell 7，`pwsh` 必须在 PATH；也可通过 `PWSH_PATH` 指向安装的可执行文件。

在隔离配置中，检查 `examples/permission-config.json` 的规则，再保存为该配置目录下的 `extensions/pi-permission-system/config.json`。不要覆盖已有文件；只在明确采用后进行合并。先在本包根目录完成 `npm ci --ignore-scripts`，再通过 `pi -e ./managed/extensions/windows-policy/index.ts` 加载适配器。它已经包装上游权限插件，避免再加载同一插件一次。适配器引用固定版本包的 Pi 扩展入口；上游根导出是服务 API，因此升级依赖时必须重新做 SDK 加载验证。

规则使用 `yoloMode: false`：普通开发可自动执行，危险操作按实际命令和目标询问。规则是一个起点；测试本项目的命令规范化与 SDK 加载不等于所有系统命令已被穷尽验证。这不替代 Pi 自己的信任机制或操作系统隔离。

## 采用活动配置

先备份实际配置、核对当前扩展集合和重复命令，再按项目授权部署。公开包不提供自动覆盖个人 Provider、MCP、Key、模型默认值或全局 AGENTS 的安装脚本。控制器默认状态目录为 `~/.pi/zhenzhi-workflow-state`，与私人 WF7 的旧状态分开；没有隐式状态迁移。
