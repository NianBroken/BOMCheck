# 工具链安装在设备公共目录，源码目录只持有指向依赖的目录联接。
# 包清单与锁文件共同决定安装内容，不修改用户级npm配置。
# 设备级依赖准备入口，可显式指定工具链目录；省略时使用系统公共应用数据目录。
# 安装源来自项目锁文件，目录联接让项目使用相同依赖，不创建另一份项目级安装。
[CmdletBinding()]
param([string]$ToolchainDirectory)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
# 项目根目录依据脚本目录确定，不依赖当前终端所在位置。
$sourceDirectory = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ToolchainDirectory)) {
    $ToolchainDirectory = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'BOMCheckToolchain'
}
# 规范化两端路径后检查目录关系，工具链不能位于当前源码目录内。
$toolchainRoot = [System.IO.Path]::GetFullPath($ToolchainDirectory)
$sourceRoot = [System.IO.Path]::GetFullPath($sourceDirectory)
if ($toolchainRoot.StartsWith($sourceRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw '工具链目录必须位于源码目录以外的设备公共位置'
}
# 从已配置的系统命令查找 Node 和 npm，版本不满足直接报错，不使用另一套隐式运行时。
$nodeCommand = Get-Command node -ErrorAction Stop
$npmCommand = Get-Command npm.cmd -ErrorAction Stop
if ([Version](& $nodeCommand.Source -p 'process.versions.node') -lt [Version]'22.18.0') {
    throw '构建需要系统级Node.js 22.18.0或更高版本，以直接执行官方TypeScript打包模块'
}
# 创建设备公共目录并复制安装清单，npm ci 严格按锁文件安装并核对实际退出状态。
New-Item -ItemType Directory -Path $toolchainRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'package.json'), (Join-Path $sourceRoot 'package-lock.json') -Destination $toolchainRoot -Force
& $npmCommand.Source ci --prefix $toolchainRoot --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw '系统工具链安装失败' }
# 源码 node_modules 必须指向本工具链的目录联接；已有普通目录或其他目标不会被自动删除。
$dependencyTarget = Join-Path $toolchainRoot 'node_modules'
$dependencyLink = Join-Path $sourceRoot 'node_modules'
# 复用已经正确存在的联接，只有完全不存在时才创建新联接。
if (Test-Path -LiteralPath $dependencyLink) {
    $existing = Get-Item -LiteralPath $dependencyLink
    if ($existing.LinkType -ne 'Junction' -or $existing.Target -ne $dependencyTarget) {
        throw '源码目录中已有不同的依赖目录，请确认后自行移走，再运行环境脚本'
    }
}
else {
    New-Item -ItemType Junction -Path $dependencyLink -Target $dependencyTarget | Out-Null
}
# 构建入口直接解析设备工具链中的软件包，不依赖额外PATH配置。
Write-Output "系统工具链已就绪：$toolchainRoot"
