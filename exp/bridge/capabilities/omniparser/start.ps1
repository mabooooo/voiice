param(
  [string]$BindHost = "127.0.0.1",
  [int]$Port = 8000,
  [string]$Device = "cuda"
)

$ErrorActionPreference = "Stop"

$CapabilityRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalRoot = Join-Path $CapabilityRoot ".local"
$VenvRoot = Join-Path $LocalRoot ".venv"
$PythonPath = Join-Path $VenvRoot "Scripts\python.exe"
$ServerPath = Join-Path $CapabilityRoot "service\server.py"

if (-not (Test-Path $PythonPath)) {
  throw "Project-local OmniParser venv is missing. Run setup.ps1 first."
}

$env:PIP_CACHE_DIR = Join-Path $LocalRoot "cache\pip"
$env:HF_HOME = Join-Path $LocalRoot "cache\hf"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $LocalRoot "cache\hf\hub"
$env:EASYOCR_MODULE_PATH = Join-Path $LocalRoot "cache\easyocr"
$env:TEMP = Join-Path $LocalRoot "cache\tmp"
$env:TMP = $env:TEMP

New-Item -ItemType Directory -Force -Path $env:PIP_CACHE_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $env:HF_HOME | Out-Null
New-Item -ItemType Directory -Force -Path $env:HUGGINGFACE_HUB_CACHE | Out-Null
New-Item -ItemType Directory -Force -Path $env:EASYOCR_MODULE_PATH | Out-Null
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null

Write-Host "Start OmniParser detect-only server" -ForegroundColor Cyan
Write-Host "Host: $BindHost"
Write-Host "Port: $Port"
Write-Host "Device: $Device"

& $PythonPath $ServerPath --host $BindHost --port $Port --device $Device
