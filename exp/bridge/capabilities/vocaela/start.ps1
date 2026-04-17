param(
  [string]$BindHost = "127.0.0.1",
  [int]$Port = 8030,
  [string]$Device = "gpu"
)

$ErrorActionPreference = "Stop"

$CapabilityRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalRoot = Join-Path $CapabilityRoot ".local"
$VenvRoot = Join-Path $LocalRoot ".venv"
$PythonPath = Join-Path $VenvRoot "Scripts\python.exe"
$ServerPath = Join-Path $CapabilityRoot "service\server.py"

if (-not (Test-Path $PythonPath)) {
  throw "Project-local Vocaela venv is missing. Run setup.ps1 first."
}

$env:PIP_CACHE_DIR = Join-Path $LocalRoot "cache\pip"
$env:HF_HOME = Join-Path $LocalRoot "cache\hf"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $LocalRoot "cache\hf\hub"
$env:TEMP = Join-Path $LocalRoot "cache\tmp"
$env:TMP = $env:TEMP

New-Item -ItemType Directory -Force -Path $env:PIP_CACHE_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $env:HF_HOME | Out-Null
New-Item -ItemType Directory -Force -Path $env:HUGGINGFACE_HUB_CACHE | Out-Null
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null

Write-Host "Start Vocaela-2-500M-1024R2 local server" -ForegroundColor Cyan
Write-Host "Host: $BindHost"
Write-Host "Port: $Port"
Write-Host "Device: $Device"

& $PythonPath $ServerPath --host $BindHost --port $Port --device $Device
