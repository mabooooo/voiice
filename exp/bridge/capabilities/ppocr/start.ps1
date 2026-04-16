param(
  [string]$BindHost = "127.0.0.1",
  [int]$Port = 8020,
  [string]$Device = "gpu"
)

$ErrorActionPreference = "Stop"

$CapabilityRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalRoot = Join-Path $CapabilityRoot ".local"
$VenvRoot = Join-Path $LocalRoot ".venv"
$PythonPath = Join-Path $VenvRoot "Scripts\python.exe"
$ServerPath = Join-Path $CapabilityRoot "service\server.py"

if (-not (Test-Path $PythonPath)) {
  throw "Project-local PP-OCR venv is missing. Run setup.ps1 first."
}

$env:PIP_CACHE_DIR = Join-Path $LocalRoot "cache\pip"
$env:TEMP = Join-Path $LocalRoot "cache\tmp"
$env:TMP = $env:TEMP
$env:PADDLE_HOME = Join-Path $LocalRoot "cache\paddle"
$env:PADDLE_PDX_CACHE_HOME = Join-Path $LocalRoot "cache\paddlex"
$env:HOME = $LocalRoot
$env:USERPROFILE = $LocalRoot
$env:XDG_CACHE_HOME = Join-Path $LocalRoot "cache"
$env:PADDLE_PDX_MODEL_SOURCE = "BOS"
$env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = "True"

New-Item -ItemType Directory -Force -Path $env:PIP_CACHE_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
New-Item -ItemType Directory -Force -Path $env:PADDLE_HOME | Out-Null
New-Item -ItemType Directory -Force -Path $env:PADDLE_PDX_CACHE_HOME | Out-Null
New-Item -ItemType Directory -Force -Path $env:XDG_CACHE_HOME | Out-Null

Write-Host "Start PP-OCRv5 mobile server" -ForegroundColor Cyan
Write-Host "Host: $BindHost"
Write-Host "Port: $Port"
Write-Host "Device: $Device"

& $PythonPath $ServerPath --host $BindHost --port $Port --device $Device
