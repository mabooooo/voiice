import path from 'node:path'
import { runPowerShell } from './powershell.mjs'

const ALLOWED_ACTIONS = new Set([
  'focus_current',
  'close_current',
  'input_text',
  'open_app',
  'send_shortcut',
  'move_mouse_to_center',
  'left_click_current_position',
  'click_at',
])

const SHORTCUT_MAP = {
  'cmd+w': '^w',
  'ctrl+w': '^w',
  'alt+f4': '%{F4}',
}

function buildForegroundWindowScript() {
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BridgeWin32 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@
`
}

async function focusFrontWindow() {
  const script = `
${buildForegroundWindowScript()}
$hwnd = [BridgeWin32]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { throw "No foreground window" }
[BridgeWin32]::ShowWindowAsync($hwnd, 5) | Out-Null
[BridgeWin32]::SetForegroundWindow($hwnd) | Out-Null
Write-Output "focus_current"
`

  return runPowerShell(script)
}

async function closeFrontWindow() {
  const script = `
${buildForegroundWindowScript()}
$hwnd = [BridgeWin32]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { throw "No foreground window" }
[BridgeWin32]::PostMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
Write-Output "close_current"
`

  return runPowerShell(script)
}

async function inputText(text) {
  const encodedText = Buffer.from(String(text ?? ''), 'utf8').toString('base64')
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$wshell = New-Object -ComObject WScript.Shell
$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedText}'))

# 输入文本统一走剪贴板粘贴，避开逐字模拟输入在中文输入法下的偏差。
[System.Windows.Forms.Clipboard]::SetText($text)
Start-Sleep -Milliseconds 140
$wshell.SendKeys('^v')
Write-Output "input_text"
`

  return runPowerShell(script)
}

async function openApp(name) {
  if (name !== 'WeChat') {
    throw new Error(`open_app 目前仅允许白名单应用 WeChat，收到: ${name}`)
  }

  // 这里只放白名单应用的候选路径，后续可以切换为原生守护进程统一托管。
  const script = `
$candidates = @(
  "$env:ProgramFiles\\Tencent\\WeChat\\WeChat.exe",
  "\${env:ProgramFiles(x86)}\\Tencent\\WeChat\\WeChat.exe",
  "$env:LOCALAPPDATA\\Tencent\\WeChat\\WeChat.exe",
  "WeChat.exe"
)

foreach ($candidate in $candidates) {
  try {
    if ($candidate -eq "WeChat.exe") {
      Start-Process -FilePath $candidate -ErrorAction Stop
      Write-Output "open_app:WeChat"
      exit 0
    }

    if (Test-Path $candidate) {
      Start-Process -FilePath $candidate -ErrorAction Stop
      Write-Output "open_app:WeChat"
      exit 0
    }
  } catch {}
}

throw "Unable to launch WeChat"
`

  return runPowerShell(script)
}

async function sendShortcut(shortcut) {
  const mappedShortcut = SHORTCUT_MAP[shortcut]
  if (!mappedShortcut) {
    throw new Error(`send_shortcut 仅允许: ${Object.keys(SHORTCUT_MAP).join(', ')}`)
  }

  const script = `
$wshell = New-Object -ComObject WScript.Shell
Start-Sleep -Milliseconds 120
$wshell.SendKeys('${mappedShortcut}')
Write-Output "send_shortcut:${shortcut}"
`

  return runPowerShell(script)
}

async function moveMouseToCenter() {
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BridgeMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
}
"@
Add-Type -AssemblyName System.Windows.Forms
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$x = [int]($bounds.Width / 2)
$y = [int]($bounds.Height / 2)
[BridgeMouse]::SetCursorPos($x, $y) | Out-Null
Write-Output "move_mouse_to_center:$x,$y"
`

  return runPowerShell(script)
}

async function leftClickCurrentPosition() {
  // 鼠标点击只暴露给手动测试，不接入语音解析，避免误触发。
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BridgeMouseClick {
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
[BridgeMouseClick]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[BridgeMouseClick]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Write-Output "left_click_current_position"
`

  return runPowerShell(script)
}

async function clickAt(x, y) {
  const px = Math.round(Number(x) || 0)
  const py = Math.round(Number(y) || 0)
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BridgeClickAt {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
# 鼠标点击先声明 DPI aware，避免高缩放桌面下坐标被系统虚拟化后点偏。
[BridgeClickAt]::SetProcessDPIAware() | Out-Null
[BridgeClickAt]::SetCursorPos(${px}, ${py}) | Out-Null
Start-Sleep -Milliseconds 40
[BridgeClickAt]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[BridgeClickAt]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Write-Output "click_at:${px},${py}"
`

  return runPowerShell(script)
}

async function executeStep(step) {
  if (!step?.action || !ALLOWED_ACTIONS.has(step.action)) {
    throw new Error(`动作不在白名单中: ${JSON.stringify(step)}`)
  }

  switch (step.action) {
    case 'focus_current':
      return focusFrontWindow()
    case 'close_current':
      return closeFrontWindow()
    case 'input_text':
      return inputText(step.args?.text ?? '')
    case 'open_app':
      return openApp(step.args?.name ?? '')
    case 'send_shortcut':
      return sendShortcut(step.args?.shortcut ?? '')
    case 'move_mouse_to_center':
      return moveMouseToCenter()
    case 'left_click_current_position':
      return leftClickCurrentPosition()
    case 'click_at':
      return clickAt(step.args?.x, step.args?.y)
    default:
      throw new Error(`未支持的动作: ${step.action}`)
  }
}

export async function executeActionPlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new Error('plan 不能为空')
  }

  const results = []

  for (const step of plan) {
    const result = await executeStep(step)
    results.push({
      action: step.action,
      stdout: result.stdout,
      stderr: result.stderr,
    })

    // 打开应用后通常需要给桌面一点时间，后续动作才更稳定。
    if (step.action === 'open_app') {
      await new Promise((resolve) => setTimeout(resolve, 1200))
    } else {
      await new Promise((resolve) => setTimeout(resolve, 180))
    }
  }

  return {
    ok: true,
    count: results.length,
    results,
    cwd: path.resolve('.'),
  }
}
