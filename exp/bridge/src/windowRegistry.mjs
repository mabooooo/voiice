import { runPowerShell } from './powershell.mjs'

function buildWindowApiScript() {
  return `
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
public struct RECT {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
public static class BridgeWindowApi {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
"@
`
}

function buildListWindowsScript() {
  return `
${buildWindowApiScript()}
$items = New-Object System.Collections.Generic.List[object]

$callback = [EnumWindowsProc]{
  param($hWnd, $lParam)

  if (-not [BridgeWindowApi]::IsWindowVisible($hWnd)) {
    return $true
  }

  $titleLength = [BridgeWindowApi]::GetWindowTextLength($hWnd)
  if ($titleLength -le 0) {
    return $true
  }

  $titleBuilder = New-Object System.Text.StringBuilder ($titleLength + 1)
  [BridgeWindowApi]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity) | Out-Null
  $title = $titleBuilder.ToString().Trim()
  if ([string]::IsNullOrWhiteSpace($title)) {
    return $true
  }

  $classBuilder = New-Object System.Text.StringBuilder 256
  [BridgeWindowApi]::GetClassName($hWnd, $classBuilder, $classBuilder.Capacity) | Out-Null

  $rect = New-Object RECT
  [BridgeWindowApi]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 40 -or $height -le 40) {
    return $true
  }

  $processId = 0
  [BridgeWindowApi]::GetWindowThreadProcessId($hWnd, [ref]$processId) | Out-Null

  $processName = ""
  $processPath = ""
  try {
    $proc = Get-Process -Id $processId -ErrorAction Stop
    $processName = $proc.ProcessName
    try { $processPath = $proc.MainModule.FileName } catch {}
  } catch {}

  $items.Add([PSCustomObject]@{
    handle = ([Int64]$hWnd).ToString()
    title = $title
    appName = $processName
    processId = [int]$processId
    processPath = $processPath
    className = $classBuilder.ToString()
    bounds = [PSCustomObject]@{
      x = [int]$rect.Left
      y = [int]$rect.Top
      width = [int]$width
      height = [int]$height
    }
  }) | Out-Null

  return $true
}

[BridgeWindowApi]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
$items | Sort-Object appName, title | ConvertTo-Json -Depth 5
`
}

function buildWindowActionScript(action, handle, bounds, processId) {
  const safeHandle = String(handle).replace(/'/g, '')
  const x = Number(bounds?.x ?? 0)
  const y = Number(bounds?.y ?? 0)
  const width = Number(bounds?.width ?? 0)
  const height = Number(bounds?.height ?? 0)
  const safeProcessId = Number(processId ?? 0)

  const actionBody =
    action === 'focus'
      ? `
[BridgeWindowApi]::ShowWindowAsync($hWnd, 5) | Out-Null
[BridgeWindowApi]::SetForegroundWindow($hWnd) | Out-Null
`
      : action === 'close'
        ? `
# 关闭窗口时先尝试进程级优雅关闭，再回退到窗口消息关闭，兼容性更高。
[BridgeWindowApi]::ShowWindowAsync($hWnd, 5) | Out-Null
[BridgeWindowApi]::SetForegroundWindow($hWnd) | Out-Null
$closed = $false
if (${safeProcessId} -gt 0) {
  try {
    $proc = Get-Process -Id ${safeProcessId} -ErrorAction Stop
    $closed = $proc.CloseMainWindow()
    if ($closed) {
      Start-Sleep -Milliseconds 700
    }
  } catch {}
}
if ([BridgeWindowApi]::IsWindow($hWnd)) {
  [BridgeWindowApi]::PostMessage($hWnd, 0x0112, [IntPtr]0xF060, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 350
}
if ([BridgeWindowApi]::IsWindow($hWnd)) {
  [BridgeWindowApi]::PostMessage($hWnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
}
`
        : `
[BridgeWindowApi]::MoveWindow($hWnd, ${x}, ${y}, ${width}, ${height}, $true) | Out-Null
`

  return `
${buildWindowApiScript()}
$hWnd = [IntPtr][Int64]'${safeHandle}'
if ($hWnd -eq [IntPtr]::Zero) { throw "Invalid window handle" }
${actionBody}
[PSCustomObject]@{
  ok = $true
  action = '${action}'
  handle = '${safeHandle}'
  stillExists = [BridgeWindowApi]::IsWindow($hWnd)
} | ConvertTo-Json -Depth 3
`
}

async function parseJsonOutput(result) {
  return result.stdout ? JSON.parse(result.stdout) : []
}

export class WindowRegistry {
  constructor() {
    this.snapshot = []
    this.updatedAt = null
  }

  async refreshSnapshot() {
    // 手动刷新时重新抓取系统窗口，避免前端持有过期信息。
    const result = await runPowerShell(buildListWindowsScript())
    const snapshot = await parseJsonOutput(result)
    this.snapshot = Array.isArray(snapshot) ? snapshot : snapshot ? [snapshot] : []
    this.updatedAt = new Date().toISOString()
    return {
      items: this.snapshot,
      updatedAt: this.updatedAt,
    }
  }

  async listWindows() {
    if (this.snapshot.length === 0) {
      return this.refreshSnapshot()
    }

    return {
      items: this.snapshot,
      updatedAt: this.updatedAt,
    }
  }

  async getWindowDetail(handle) {
    const snapshot = await this.listWindows()
    const target = snapshot.items.find((item) => item.handle === String(handle))
    if (!target) {
      throw new Error(`Window not found: ${handle}`)
    }

    return {
      item: target,
      updatedAt: snapshot.updatedAt,
    }
  }

  async performWindowAction(payload) {
    const action = payload?.action
    const handle = payload?.handle
    if (!['focus', 'close', 'move'].includes(action)) {
      throw new Error(`Unsupported window action: ${action}`)
    }

    const result = await runPowerShell(buildWindowActionScript(action, handle, payload?.bounds, payload?.processId))
    const parsed = await parseJsonOutput(result)
    await this.refreshSnapshot()
    return parsed
  }
}
