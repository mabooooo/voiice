param(
  [string]$PythonExe = "python",
  [string]$Device = "cuda",
  [string]$TorchChannel = "cu124",
  [string]$WeightRepo = "microsoft/OmniParser-v2.0",
  [string]$WeightSubdir = "icon_detect"
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
$EasyOcrCache = Join-Path $CacheRoot "easyocr"
$TempRoot = Join-Path $CacheRoot "tmp"
$WeightsRoot = Join-Path $LocalRoot "weights"
$WeightModelPath = Join-Path $WeightsRoot "$WeightSubdir\model.pt"

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
New-Item -ItemType Directory -Force -Path $EasyOcrCache | Out-Null
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
New-Item -ItemType Directory -Force -Path $WeightsRoot | Out-Null

$env:PIP_CACHE_DIR = $PipCacheDir
$env:HF_HOME = $HfHome
$env:HUGGINGFACE_HUB_CACHE = $HfHubCache
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

$NormalizedDevice = $Device.Trim().ToLower()
Write-Step "Install PyTorch runtime"
if ($NormalizedDevice -eq "cpu") {
  & $PipPath install torch torchvision --index-url https://download.pytorch.org/whl/cpu
}
else {
  & $PipPath install torch torchvision --index-url "https://download.pytorch.org/whl/$TorchChannel"
}

Write-Step "Install detect-only runtime dependencies"
& $PipPath install -r $RequirementsPath

if (-not (Test-Path $WeightModelPath)) {
  Write-Step "Download icon_detect weights"
  & $HfCliPath download $WeightRepo --repo-type model --include "$WeightSubdir/*" --local-dir $WeightsRoot
}
else {
  Write-Step "Reuse downloaded icon_detect weights"
}

Write-Step "Detect-only OmniParser setup complete"
Write-Host "Python: $PythonPath"
Write-Host "Device: $NormalizedDevice"
Write-Host "Model: $WeightModelPath"
Write-Host "Cache: $CacheRoot"
Write-Host "Start script: $(Join-Path $CapabilityRoot 'start.ps1')"
