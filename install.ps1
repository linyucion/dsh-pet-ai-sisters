<#
.SYNOPSIS
  One-click installer for dsh-pet AI Sisters Pack (Windows PowerShell).
  将七位 Q 版 AI 姐妹宠物包一键安装到 DeepSeek Harness 的 dsh-pet 目录并自动热重载。

.PARAMETER Pets
  Optional comma-separated list of pet IDs to install (default: all 7 sisters: gemini,kimi,chatgpt,claude,grok,qwen,glm).

.PARAMETER DshPetDir
  Optional override for ~/.dsh/dsh-pet directory.
#>
param(
    [string]$Pets = "all",
    [string]$DshPetDir = ""
)

$ErrorActionPreference = "Stop"

$AllIds = @("gemini", "kimi", "chatgpt", "claude", "grok", "qwen", "glm")
if ($Pets -eq "all" -or [string]::IsNullOrWhiteSpace($Pets)) {
    $Selected = $AllIds
} else {
    $Selected = $Pets.Split(",") | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $AllIds -contains $_ }
    if ($Selected.Count -eq 0) {
        Write-Error "未匹配到有效宠物 ID。可选值: $($AllIds -join ', ')"
        exit 1
    }
}

if ([string]::IsNullOrWhiteSpace($DshPetDir)) {
    $DshRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME ".dsh" }
    $DshPetDir = Join-Path $DshRoot "dsh-pet"
}

$TargetPetDir = Join-Path $DshPetDir "pet"
$SourcePetDir = Join-Path $PSScriptRoot "pet"

if (-not (Test-Path $SourcePetDir)) {
    Write-Error "找不到源码 pet/ 目录：$SourcePetDir"
    exit 1
}

New-Item -ItemType Directory -Force -Path $TargetPetDir | Out-Null

Write-Host "🐾 正在安装 dsh-pet AI 姐妹宠物包 -> $TargetPetDir" -ForegroundColor Cyan

foreach ($id in $Selected) {
    Copy-Item -Force (Join-Path $SourcePetDir "$id-config.json") $TargetPetDir
    Copy-Item -Force (Join-Path $SourcePetDir "$id-avatar.png") $TargetPetDir
    foreach ($sub in @("$id-animation", "$id-memes")) {
        $dstSub = Join-Path $TargetPetDir $sub
        if (Test-Path $dstSub) {
            Remove-Item -Recurse -Force $dstSub
        }
        Copy-Item -Recurse -Force (Join-Path $SourcePetDir $sub) $dstSub
    }
    Write-Host "  ✨ 已安装: $id" -ForegroundColor Green
}

# Auto-detect running dsh-pet server from logs.txt and hot-reload immediately
$LogFile = Join-Path $DshPetDir "logs.txt"
$Reloaded = $false
if (Test-Path $LogFile) {
    $TailLines = Get-Content -Path $LogFile -Tail 80 -ErrorAction SilentlyContinue
    $MatchedUrls = @()
    foreach ($line in $TailLines) {
        if ($line -match "(http://127\.0\.0\.1:\d+/dsh-pet-\d+)") {
            $MatchedUrls += $Matches[1]
        }
    }
    if ($MatchedUrls.Count -gt 0) {
        $BaseUrl = $MatchedUrls[-1]
        try {
            $null = Invoke-RestMethod -Method Post -Uri "$BaseUrl/reload" -TimeoutSec 4
            $Reloaded = $true
            Write-Host "🎉 已通知正在运行的 DeepSeek Harness (dsh-pet) 热重载，姐妹们马上登场！" -ForegroundColor Magenta
        } catch {
            # Port from an older session; user can open or refresh DeepSeek Harness
        }
    }
}

if (-not $Reloaded) {
    Write-Host "✅ 文件已就绪！打开 DeepSeek Harness（或在 dsh-pet 面板点一次重载）即可召唤全部姐妹登场~" -ForegroundColor Yellow
}
