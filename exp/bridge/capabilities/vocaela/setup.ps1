param(
  [string]$PythonExe = "python",
  [string]$Device = "gpu",
  [string]$CudaChannel = "cu124",
  [string]$ModelRepo = "vocaela/Vocaela-2-500M-1024R2"
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
$TempRoot = Join-Path $CacheRoot "tmp"
$ModelsRoot = Join-Path $LocalRoot "models"
$ModelPath = Join-Path $ModelsRoot "Vocaela-2-500M-1024R2"

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
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
New-Item -ItemType Directory -Force -Path $ModelsRoot | Out-Null

# 这里统一收敛缓存路径到项目内部，避免 pip / HF 的默认行为把大体积文件落到 %USERPROFILE%。
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

# Vocaela-2-500M-1024R2 是 PyTorch 权重，SmolVLM2 在 4.49+ 才支持 AutoModelForImageTextToText。
# 这里的 torch wheel 通道与 sensevoice 保持一致（cu124），减少显卡驱动组合出现歧义的面。
Write-Step "Install PyTorch wheels"
$NormalizedDevice = $Device.Trim().ToLower()
if ($NormalizedDevice -eq "gpu" -or $NormalizedDevice -eq "cuda") {
  & $PipPath install --upgrade torch==2.6.0 torchvision==0.21.0 --index-url "https://download.pytorch.org/whl/$CudaChannel"
}
else {
  & $PipPath install --upgrade torch==2.6.0 torchvision==0.21.0 --index-url "https://download.pytorch.org/whl/cpu"
}

Write-Step "Install Vocaela runtime dependencies"
& $PipPath install -r $RequirementsPath

if (-not (Test-Path (Join-Path $ModelPath "config.json"))) {
  Write-Step "Download Vocaela-2-500M-1024R2 weights"
  # 模型体积约 1GB，这里显式落到 capabilities 内的 models/，后面 server 端再直接从该路径加载。
  & $HfCliPath download $ModelRepo --repo-type model --local-dir $ModelPath
}
else {
  Write-Step "Reuse downloaded Vocaela-2-500M-1024R2 weights"
}

Write-Step "Vocaela setup complete"
Write-Host "Python: $PythonPath"
Write-Host "Device: $NormalizedDevice"
Write-Host "Model:  $ModelPath"
Write-Host "Cache:  $CacheRoot"
Write-Host "Start script: $(Join-Path $CapabilityRoot 'start.ps1')"
