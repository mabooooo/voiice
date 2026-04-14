import path from 'node:path'
import { runPowerShell } from './powershell.mjs'

const ALLOWED_ACTIONS = new Set([
  'focus_front_window',
  'close_front_window',
  'type_text_to_focused_input',
  'open_app',
  'send_shortcut',
  'move_mouse_to_center',
  'left_click_current_position',
])

const SHORTCUT_MAP = {
  'cmd+w': '^w',
  'ctrl+w': '^w',
  'alt+f4': '%{F4}',
}

function escapeSendKeysLiteral(text) {
  // SendKeys 对特殊字符敏感，这里转义为字面量，避免误触发快捷键。
  return text.replace(/[+^%~(){}\[\]]/g, (char) => `{${char}}`)
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
Write-Output "focus_front_window"
`

  return runPowerShell(script)
}

async function closeFrontWindow() {
  const script = `
${buildForegroundWindowScript()}
$hwnd = [BridgeWin32]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { throw "No foreground window" }
[BridgeWin32]::PostMessage($hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
Write-Output "close_front_window"
`

  return runPowerShell(script)
}

async function typeTextToFocusedInput(text) {
  const escapedText = escapeSendKeysLiteral(text)
  const script = `
$wshell = New-Object -ComObject WScript.Shell
Start-Sleep -Milliseconds 120
$wshell.SendKeys('${escapedText}')
Write-Output "type_text_to_focused_input"
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

async function executeStep(step) {
  if (!step?.action || !ALLOWED_ACTIONS.has(step.action)) {
    throw new Error(`动作不在白名单中: ${JSON.stringify(step)}`)
  }

  switch (step.action) {
    case 'focus_front_window':
      return focusFrontWindow()
    case 'close_front_window':
      return closeFrontWindow()
    case 'type_text_to_focused_input':
      return typeTextToFocusedInput(step.args?.text ?? '')
    case 'open_app':
      return openApp(step.args?.name ?? '')
    case 'send_shortcut':
      return sendShortcut(step.args?.shortcut ?? '')
    case 'move_mouse_to_center':
      return moveMouseToCenter()
    case 'left_click_current_position':
      return leftClickCurrentPosition()
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
