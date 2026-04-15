param(
  [string]$PythonExe = "python",
  [string]$ModelRepo = "FunAudioLLM/SenseVoiceSmall"
)

$ErrorActionPreference = "Stop"

$CapabilityRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalRoot = Join-Path $CapabilityRoot ".local"
$VenvRoot = Join-Path $LocalRoot ".venv"
$PythonPath = Join-Path $VenvRoot "Scripts\python.exe"
$PipPath = Join-Path $VenvRoot "Scripts\pip.exe"
$HfCliPath = Join-Path $VenvRoot "Scripts\hf.exe"
$RequirementsPath = Join-Path $CapabilityRoot "requirements.windows.txt"
$CacheRoot = Join-Path $LocalRoot "cache"
$PipCacheDir = Join-Path $CacheRoot "pip"
$HfHome = Join-Path $CacheRoot "hf"
$HfHubCache = Join-Path $HfHome "hub"
$ModelScopeCache = Join-Path $CacheRoot "modelscope"
$TempRoot = Join-Path $CacheRoot "tmp"
$ModelsRoot = Join-Path $LocalRoot "models"
$ModelPath = Join-Path $ModelsRoot "SenseVoiceSmall"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

Write-Step "Prepare local directories"
New-Item -ItemType Directory -Force -Path $LocalRoot | Out-Null
New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
New-Item -ItemType Directory -Force -Path $PipCacheDir | Out-Null
New-Item -ItemType Directory -Force -Path $HfHome | Out-Null
New-Item -ItemType Directory -Force -Path $HfHubCache | Out-Null
New-Item -ItemType Directory -Force -Path $ModelScopeCache | Out-Null
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
New-Item -ItemType Directory -Force -Path $ModelsRoot | Out-Null

$env:PIP_CACHE_DIR = $PipCacheDir
$env:HF_HOME = $HfHome
$env:HUGGINGFACE_HUB_CACHE = $HfHubCache
$env:MODELSCOPE_CACHE = $ModelScopeCache
$env:TEMP = $TempRoot
$env:TMP = $TempRoot

if (-not (Test-Path $PythonPath)) {
  Write-Step "Create project-local venv"
  & $PythonExe -m venv $VenvRoot
}
else {
  Write-Step "Reuse project-local venv"
}

Write-Step "Upgrade pip toolchain"
& $PythonPath -m pip install --upgrade pip setuptools wheel

Write-Step "Install PyTorch wheels"
& $PipPath install --upgrade --force-reinstall torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124

Write-Step "Install SenseVoice runtime dependencies"
& $PipPath install -r $RequirementsPath

if (-not (Test-Path $ModelPath)) {
  Write-Step "Download SenseVoiceSmall model"
  & $HfCliPath download $ModelRepo --repo-type model --local-dir $ModelPath
}
else {
  Write-Step "Reuse downloaded SenseVoiceSmall model"
}

Write-Step "SenseVoice setup complete"
Write-Host "Python: $PythonPath"
Write-Host "Model: $ModelPath"
Write-Host "Cache: $CacheRoot"
Write-Host "Start script: $(Join-Path $CapabilityRoot 'start.ps1')"
