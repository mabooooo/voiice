param(
  [string]$PythonExe = "python",
  [string]$Device = "gpu",
  [string]$CudaChannel = "cu118"
)

$ErrorActionPreference = "Stop"

$CapabilityRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LocalRoot = Join-Path $CapabilityRoot ".local"
$VenvRoot = Join-Path $LocalRoot ".venv"
$PythonPath = Join-Path $VenvRoot "Scripts\python.exe"
$PipPath = Join-Path $VenvRoot "Scripts\pip.exe"
$RequirementsPath = Join-Path $CapabilityRoot "requirements.windows.txt"
$CacheRoot = Join-Path $LocalRoot "cache"
$PipCacheDir = Join-Path $CacheRoot "pip"
$TempRoot = Join-Path $CacheRoot "tmp"
$PaddleHome = Join-Path $CacheRoot "paddle"
$PaddleXHome = Join-Path $CacheRoot "paddlex"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

Write-Step "Prepare local directories"
New-Item -ItemType Directory -Force -Path $LocalRoot | Out-Null
New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
New-Item -ItemType Directory -Force -Path $PipCacheDir | Out-Null
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
New-Item -ItemType Directory -Force -Path $PaddleHome | Out-Null
New-Item -ItemType Directory -Force -Path $PaddleXHome | Out-Null

$env:PIP_CACHE_DIR = $PipCacheDir
$env:TEMP = $TempRoot
$env:TMP = $TempRoot
$env:PADDLE_HOME = $PaddleHome
$env:PADDLE_PDX_CACHE_HOME = $PaddleXHome
$env:HOME = $LocalRoot
$env:USERPROFILE = $LocalRoot
$env:XDG_CACHE_HOME = $CacheRoot
$env:PADDLE_PDX_MODEL_SOURCE = "BOS"
$env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = "True"

if (-not (Test-Path $PythonPath)) {
  Write-Step "Create project-local venv"
  & $PythonExe -m venv $VenvRoot
}
else {
  Write-Step "Reuse project-local venv"
}

Write-Step "Upgrade pip toolchain"
& $PythonPath -m pip install --upgrade pip setuptools wheel

Write-Step "Install Paddle runtime"
# 注意：paddleocr 3.0.3 / paddlex 3.0.3 只兼容 paddlepaddle 3.0.0。
# 更高版本（如 3.3.x）会在 MKLDNN 路径上抛 ConvertPirAttribute2RuntimeAttribute 异常，
# 迫使 enable_mkldnn=False，CPU OCR 会慢 5 倍以上。版本必须锁死在 requirements 里。
$NormalizedDevice = $Device.Trim().ToLower()
& $PipPath uninstall -y paddlepaddle paddlepaddle-gpu | Out-Null
if ($NormalizedDevice -eq "gpu") {
  & $PipPath install "paddlepaddle-gpu==3.0.0" -i "https://www.paddlepaddle.org.cn/packages/stable/$CudaChannel/" --extra-index-url https://pypi.org/simple
}
else {
  & $PipPath install "paddlepaddle==3.0.0" -i https://www.paddlepaddle.org.cn/packages/stable/cpu/ --extra-index-url https://pypi.org/simple
}

Write-Step "Install PP-OCR runtime dependencies"
& $PipPath install -r $RequirementsPath --extra-index-url https://pypi.org/simple

Write-Step "Warm up PP-OCRv5 mobile models"
$WarmupScript = @"
from paddleocr import PaddleOCR

# 通过一次轻量初始化预下载 det/rec 模型，避免首次点击测试时再走下载。
ocr = PaddleOCR(
    text_detection_model_name="PP-OCRv5_mobile_det",
    text_recognition_model_name="PP-OCRv5_mobile_rec",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    enable_mkldnn=False,
    device="$NormalizedDevice",
)
print("Warmup complete:", type(ocr).__name__)
"@
$WarmupScriptPath = Join-Path $TempRoot "warmup-ppocr.py"
Set-Content -Path $WarmupScriptPath -Value $WarmupScript -Encoding UTF8
& $PythonPath $WarmupScriptPath
Remove-Item -LiteralPath $WarmupScriptPath -Force -ErrorAction SilentlyContinue

Write-Step "PP-OCR setup complete"
Write-Host "Python: $PythonPath"
Write-Host "Device: $NormalizedDevice"
Write-Host "Cache: $CacheRoot"
Write-Host "Start script: $(Join-Path $CapabilityRoot 'start.ps1')"
