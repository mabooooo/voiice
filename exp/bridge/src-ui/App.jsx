import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { CornerIndicatorPanel } from '@/features/desktop-utilities/CornerIndicatorPanel'
import { DesktopCapturePanel } from '@/features/desktop-utilities/DesktopCapturePanel'

// 主控制台页面：负责串起音频输入、动作执行、窗口管理和设置页切换。
const ACTIVE_MENU = { developer: 'developer', settings: 'settings' }
const STORAGE_KEYS = {
  activeMenu: 'voice-bridge-active-menu',
  microphoneId: 'voice-bridge-microphone-id',
}

const SPECIAL_SHORTCUT_LABELS = {
  AltLeft: '左 Alt', AltRight: '右 Alt', ShiftLeft: '左 Shift', ShiftRight: '右 Shift',
  ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl', MetaLeft: '左 Win', MetaRight: '右 Win',
  Space: 'Space', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'Backspace',
  Delete: 'Delete', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
}

const MANUAL_ACTIONS = [
  { label: 'focus_current', plan: [{ action: 'focus_current' }] },
  { label: 'close_current', plan: [{ action: 'close_current' }] },
  { label: 'open_app("WeChat")', plan: [{ action: 'open_app', args: { name: 'WeChat' } }] },
  { label: 'send_shortcut("cmd+w")', plan: [{ action: 'send_shortcut', args: { shortcut: 'cmd+w' } }] },
]

const PRIVILEGED_ACTIONS = [
  { label: 'move_mouse_to_center', plan: [{ action: 'move_mouse_to_center' }] },
  { label: 'left_click_current_position', plan: [{ action: 'left_click_current_position' }] },
]

function formatJson(value) { return JSON.stringify(value, null, 2) }
function buildAudioConstraints(deviceId) {
  const constraints = {
    autoGainControl: false,
    noiseSuppression: false,
    echoCancellation: false,
    channelCount: 1,
  }
  if (deviceId) constraints.deviceId = { exact: deviceId }
  return constraints
}
function isHeadsetMicrophoneLabel(label) {
  return /headset|hands-free|bluetooth|耳机|耳麦|蓝牙/i.test(label || '')
}
function getPrimaryShortcutLabel(code) {
  if (!code) return '未设置'
  if (SPECIAL_SHORTCUT_LABELS[code]) return SPECIAL_SHORTCUT_LABELS[code]
  if (code.startsWith('Key')) return code.slice(3).toUpperCase()
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

function normalizeShortcutModifiers(code, modifiers) {
  const normalized = {
    alt: Boolean(modifiers?.alt), ctrl: Boolean(modifiers?.ctrl),
    shift: Boolean(modifiers?.shift), meta: Boolean(modifiers?.meta),
  }
  if (code?.startsWith('Alt')) normalized.alt = false
  if (code?.startsWith('Control')) normalized.ctrl = false
  if (code?.startsWith('Shift')) normalized.shift = false
  if (code?.startsWith('Meta')) normalized.meta = false
  return normalized
}

function buildShortcutLabel(candidate) {
  if (!candidate?.code) return '未设置'
  const modifiers = normalizeShortcutModifiers(candidate.code, candidate.modifiers)
  const tokens = []
  if (modifiers.ctrl) tokens.push('Ctrl')
  if (modifiers.shift) tokens.push('Shift')
  if (modifiers.alt) tokens.push('Alt')
  if (modifiers.meta) tokens.push('Win')
  tokens.push(getPrimaryShortcutLabel(candidate.code))
  return tokens.join(' + ')
}

function buildShortcutCandidate(event) {
  const code = event.code || ''
  if (!code) return null
  return {
    code,
    modifiers: normalizeShortcutModifiers(code, {
      alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey,
    }),
    label: buildShortcutLabel({
      code,
      modifiers: { alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey },
    }),
  }
}

function formatActionList(items) {
  if (!Array.isArray(items) || items.length === 0) return '无'
  return items.map((item) => {
    if (item.action === 'open_app') return `open_app(${item.args?.name ?? ''})`
    if (item.action === 'send_shortcut') return `send_shortcut(${item.args?.shortcut ?? ''})`
      if (item.action === 'input_text') return `input_text(${item.args?.text ?? ''})`
      if (item.action === 'focus_current') return 'focus_current()'
      if (item.action === 'close_current') return 'close_current()'
      if (item.action === 'focus_window' || item.action === 'close_window') return `${item.action}(${item.args?.shortId ?? item.args?.handle ?? ''})`
      return item.action
    }).join(', ')
}

// 窗口列表中的单项卡片，只负责展示简要信息并打开详情弹窗。
function WindowListItem({ item, onOpen }) {
  return (
    <button type="button" className="window-item" onClick={() => onOpen(item.handle)}>
      <span className="window-item__title">
        <span className="window-item__short-id">{item.shortId}</span>
        <span>{item.appName || 'Unknown App'} - {item.title}</span>
      </span>
      <span className="window-item__meta">{item.bounds?.x},{item.bounds?.y} · {item.bounds?.width}x{item.bounds?.height}</span>
      <span className="window-item__meta">state: {item.state || 'unknown'}</span>
    </button>
  )
}

// 左侧导航仅切换页面上下文，不承载具体业务逻辑。
function Navigation({ activeMenu, onSelect }) {
  return (
    <aside className="nav-rail">
      <div className="nav-rail__brand">
        <div className="nav-rail__eyebrow">Voice Bridge</div>
        <div className="nav-rail__title">实验控制台</div>
      </div>
      <div className="nav-rail__items">
        <button type="button" className={`nav-item ${activeMenu === ACTIVE_MENU.developer ? 'nav-item--active' : ''}`} onClick={() => onSelect(ACTIVE_MENU.developer)}>
          <span className="nav-item__label">开发者模式</span>
          <span className="nav-item__meta">音频、动作、窗口调试</span>
        </button>
        <button type="button" className={`nav-item ${activeMenu === ACTIVE_MENU.settings ? 'nav-item--active' : ''}`} onClick={() => onSelect(ACTIVE_MENU.settings)}>
          <span className="nav-item__label">设置</span>
          <span className="nav-item__meta">快捷键、麦克风输入设备</span>
        </button>
      </div>
    </aside>
  )
}

export function App() {
  const [configStatus, setConfigStatus] = useState('读取配置中...')
  const [activeMenu, setActiveMenu] = useState(() => localStorage.getItem(STORAGE_KEYS.activeMenu) || ACTIVE_MENU.developer)
  const [audioPath, setAudioPath] = useState('')
  const [stream, setStream] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [plan, setPlan] = useState([])
  const [timing, setTiming] = useState({})
  const [usage, setUsage] = useState({})
  const [manualCommand, setManualCommand] = useState('')
  const [typeText, setTypeText] = useState('')
  const [recordingState, setRecordingState] = useState('未录音')
  const [logs, setLogs] = useState(['等待操作...'])
  const [busy, setBusy] = useState(false)
  const [recorder, setRecorder] = useState(null)
  const [mediaStream, setMediaStream] = useState(null)
  const [recordedChunks, setRecordedChunks] = useState([])
  const [windowSnapshot, setWindowSnapshot] = useState({ items: [], updatedAt: null })
  const [selectedWindow, setSelectedWindow] = useState(null)
  const [windowDialogOpen, setWindowDialogOpen] = useState(false)
  const [windowMoveForm, setWindowMoveForm] = useState({ x: '', y: '', width: '', height: '' })
  const [windowBusy, setWindowBusy] = useState(false)
  const [autoAnalyzeAfterStop, setAutoAnalyzeAfterStop] = useState(false)
  const [availableMicrophones, setAvailableMicrophones] = useState([])
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState(() => localStorage.getItem(STORAGE_KEYS.microphoneId) || '')
  const [shortcutState, setShortcutState] = useState({
    provider: 'uiohook-napi', enabled: false, error: '', shortcut: null, shortcutLabel: '右 Alt', lastDetectedLabel: '', lastTriggeredAt: '',
  })
  const [shortcutDraft, setShortcutDraft] = useState({ code: 'AltRight', modifiers: { alt: false, ctrl: false, shift: false, meta: false }, label: '右 Alt' })
  const [shortcutCaptureActive, setShortcutCaptureActive] = useState(false)
  const [shortcutHint, setShortcutHint] = useState('点击下方输入框后，按下希望用于开始/停止录音的按键。')
  const selectedInputDeviceIdRef = useRef(localStorage.getItem(STORAGE_KEYS.microphoneId) || '')
  const availableMicrophonesRef = useRef([])
  const recorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const autoAnalyzeAfterStopRef = useRef(false)
  const shortcutStateRef = useRef({ provider: 'uiohook-napi', enabled: false, error: '', shortcut: null, shortcutLabel: '右 Alt', lastDetectedLabel: '', lastTriggeredAt: '' })
  const meterContextRef = useRef(null)
  const meterAnalyserRef = useRef(null)
  const meterFrameRef = useRef(0)
  const meterSourceRef = useRef(null)
  const meterDataRef = useRef(null)
  const meterLastPushRef = useRef(0)

  const canExecutePlan = plan.length > 0
  const renderedPlan = useMemo(() => formatJson(plan), [plan])

  useEffect(() => { localStorage.setItem(STORAGE_KEYS.activeMenu, activeMenu) }, [activeMenu])
  useEffect(() => {
    selectedInputDeviceIdRef.current = selectedInputDeviceId
    localStorage.setItem(STORAGE_KEYS.microphoneId, selectedInputDeviceId)
  }, [selectedInputDeviceId])
  useEffect(() => { availableMicrophonesRef.current = availableMicrophones }, [availableMicrophones])
  useEffect(() => { recorderRef.current = recorder }, [recorder])
  useEffect(() => { mediaStreamRef.current = mediaStream }, [mediaStream])
  useEffect(() => { autoAnalyzeAfterStopRef.current = autoAnalyzeAfterStop }, [autoAnalyzeAfterStop])
  useEffect(() => { shortcutStateRef.current = shortcutState }, [shortcutState])

  // 所有异步动作统一写入顶部日志，便于追踪当前实验链路。
  function appendLog(message) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    setLogs((current) => [`[${time}] ${message}`, ...current].slice(0, 80))
  }

  function updateSelectedInputDeviceId(nextDeviceId) {
    selectedInputDeviceIdRef.current = nextDeviceId
    setSelectedInputDeviceId(nextDeviceId)
  }

  function getSelectedMicrophoneLabel(deviceId) {
    if (!deviceId) return '系统默认输入设备'
    return availableMicrophonesRef.current.find(item => item.deviceId === deviceId)?.label || '已选设备'
  }

  // 刷新输入设备时优先保留显式选择，避免录音过程中切回别的麦克风。
  async function refreshMicrophoneDevices(preferredDeviceId) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const inputs = devices.filter((item) => item.kind === 'audioinput').map((item, index) => ({
        deviceId: item.deviceId,
        label: item.label || `麦克风 ${index + 1}`,
      }))
      setAvailableMicrophones(inputs)
      const desiredDeviceId = preferredDeviceId ?? selectedInputDeviceIdRef.current
      if (inputs.length === 0) { updateSelectedInputDeviceId(''); return }
      // 设备刷新时优先保留用户显式选择的输入设备，避免回退到默认设备。
      if (desiredDeviceId && inputs.some((item) => item.deviceId === desiredDeviceId)) {
        updateSelectedInputDeviceId(desiredDeviceId)
        return
      }
      // 未显式选择设备时保持“系统默认输入设备”，避免应用误锁定到耳机麦并触发声卡模式切换。
      updateSelectedInputDeviceId('')
    } catch (error) {
      appendLog(`读取麦克风列表失败: ${error.message || error}`)
    }
  }

  useEffect(() => {
    window.bridgeApi.getConfigStatus().then((status) => {
      setConfigStatus(formatJson(status))
      if (status.shortcut) {
        setShortcutState(status.shortcut)
        if (status.shortcut.shortcut) setShortcutDraft(status.shortcut.shortcut)
      }
    }).catch((error) => setConfigStatus(`读取失败: ${error.message || error}`))

    window.bridgeApi.getShortcutState().then((state) => {
      setShortcutState(state)
      if (state.shortcut) setShortcutDraft(state.shortcut)
    }).catch((error) => appendLog(`读取快捷键配置失败: ${error.message || error}`))

    refreshWindows()
    refreshMicrophoneDevices()

    const handleDeviceChange = () => { refreshMicrophoneDevices() }
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange)

    const unsubscribeToggle = window.bridgeApi.onRecordingToggle(async ({ recording, shortcutLabel }) => {
      appendLog(`${shortcutLabel || '全局快捷键'}已触发，${recording ? '开始录音' : '停止录音'}。`)
      if (recording) await startRecording(true)
      else stopRecording(true, { recorder: recorderRef.current, mediaStream: mediaStreamRef.current })
    })
    const unsubscribeShortcutState = window.bridgeApi.onShortcutState((state) => setShortcutState(state))

    return () => {
      unsubscribeToggle()
      unsubscribeShortcutState()
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange)
    }
  }, [])

  useEffect(() => {
    if (!shortcutCaptureActive) return undefined
    // 捕获模式下直接监听整页按键，避免修饰键因焦点切换而丢失。
    const handler = (event) => handleShortcutFieldKeyDown(event)
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [shortcutCaptureActive])

  useEffect(() => () => { stopAudioMeter() }, [])

  function syncMoveForm(item) {
    setWindowMoveForm({
      x: String(item?.bounds?.x ?? ''),
      y: String(item?.bounds?.y ?? ''),
      width: String(item?.bounds?.width ?? ''),
      height: String(item?.bounds?.height ?? ''),
    })
  }

  // 窗口快照完全由主进程维护，前端只在这里拉取最新副本。
  async function refreshWindows() {
    try {
      const snapshot = await window.bridgeApi.refreshWindows()
      setWindowSnapshot(snapshot)
      appendLog(`窗口列表已刷新，共 ${snapshot.items.length} 个窗口。`)
    } catch (error) {
      appendLog(`刷新窗口列表失败: ${error.message || error}`)
    }
  }

  // 详情弹窗进入前先拉一次窗口详情，避免列表数据过旧。
  async function openWindowDetail(handle) {
    setWindowBusy(true)
    try {
      const detail = await window.bridgeApi.getWindowDetail(handle)
      setSelectedWindow(detail.item)
      syncMoveForm(detail.item)
      setWindowDialogOpen(true)
    } catch (error) {
      appendLog(`读取窗口详情失败: ${error.message || error}`)
    } finally {
      setWindowBusy(false)
    }
  }

  // 窗口动作统一走同一入口，焦点/移动/关闭都复用这条链路。
  async function runWindowAction(action) {
    if (!selectedWindow?.handle) return
    setWindowBusy(true)
    try {
      const payload = { action, handle: selectedWindow.handle, processId: selectedWindow.processId }
      if (action === 'move') {
        payload.bounds = {
          x: Number(windowMoveForm.x), y: Number(windowMoveForm.y),
          width: Number(windowMoveForm.width), height: Number(windowMoveForm.height),
        }
      }
      const result = await window.bridgeApi.windowAction(payload)
      appendLog(`窗口动作执行完成: ${formatJson(result)}`)
      await refreshWindows()
      if (action === 'close') {
        setWindowDialogOpen(false)
        setSelectedWindow(null)
      } else {
        const detail = await window.bridgeApi.getWindowDetail(selectedWindow.handle)
        setSelectedWindow(detail.item)
        syncMoveForm(detail.item)
      }
    } catch (error) {
      appendLog(`窗口动作执行失败: ${error.message || error}`)
    } finally {
      setWindowBusy(false)
    }
  }

  async function pickAudioFile() {
    const filePath = await window.bridgeApi.pickAudioFile()
    if (!filePath) return
    setAudioPath(filePath)
    appendLog(`已选择音频文件: ${filePath}`)
  }

  // 设置页里录入快捷键时，直接用浏览器键盘事件构造候选值。
  function handleShortcutFieldKeyDown(event) {
    event.preventDefault()
    event.stopPropagation()
    // 设置面板直接读取浏览器键盘事件，给用户即时看到“识别到的是哪一个键”。
    const nextCandidate = buildShortcutCandidate(event)
    if (!nextCandidate) {
      setShortcutHint('未识别到有效按键，请重试。')
      return
    }
    setShortcutDraft(nextCandidate)
    setShortcutCaptureActive(false)
    setShortcutHint(`已识别按键：${nextCandidate.label}，保存后会立即切换到新的全局录音键。`)
  }

  async function saveShortcutDraft() {
    try {
      const state = await window.bridgeApi.updateShortcut(shortcutDraft)
      setShortcutState(state)
      setShortcutDraft(state.shortcut)
      setShortcutHint(`快捷键已更新：${state.shortcutLabel}。`)
      appendLog(`录音快捷键已切换为 ${state.shortcutLabel}。`)
    } catch (error) {
      const message = String(error.message || error)
      setShortcutHint(`保存失败：${message}`)
      appendLog(`更新录音快捷键失败: ${message}`)
    }
  }

  // 音频分析是录音和文件导入的公共收口，避免两条状态机分叉。
  async function analyzeAudioFile(filePath) {
    if (!filePath) {
      appendLog('请先选择音频文件，或者先录音。')
      return
    }

    // 文件分析与录音后自动分析都走同一条链路，避免两份状态机分叉。
    setBusy(true)
    setAudioPath(filePath)
    appendLog(`开始分析音频: ${filePath}`)
    window.bridgeApi.notifyOverlayState({ status: 'waiting', title: '识别中', subtitle: '等待服务器返回...' })

    try {
      const result = await window.bridgeApi.analyzeAudio({ filePath, stream })
      setTranscript(result.transcript || '')
      setPlan(result.matched?.plan || [])
      setTiming(result.timing || {})
      setUsage(result.usage || {})
      appendLog(`转写完成，匹配到 ${(result.matched?.plan || []).length} 个白名单动作：${formatActionList(result.matched?.plan || [])}`)
      if ((result.matched?.plan || []).length > 0) {
        await executePlan(result.matched.plan, {
          stt: result.matched?.stt || result.transcript,
        })
      }
      else {
        window.bridgeApi.notifyOverlayState({
          status: 'executing',
          title: '已返回',
          subtitle: result.matched?.stt || result.transcript || '未匹配到动作',
          autoResetMs: 4000,
        })
      }
    } catch (error) {
      appendLog(`分析失败: ${error.message || error}`)
      window.bridgeApi.notifyOverlayState({
        status: 'executing', title: '执行失败', subtitle: String(error.message || error), autoResetMs: 4000,
      })
    } finally {
      setBusy(false)
    }
  }

  async function analyzeAudio() { return analyzeAudioFile(audioPath) }

  // 音量计只负责给 overlay 提供轻量级实时反馈，不参与录音结果本身。
  function stopAudioMeter() {
    if (meterFrameRef.current) {
      cancelAnimationFrame(meterFrameRef.current)
      meterFrameRef.current = 0
    }
    try { meterSourceRef.current?.disconnect() } catch {}
    meterSourceRef.current = null
    meterAnalyserRef.current = null
    meterDataRef.current = null
    meterLastPushRef.current = 0
    if (meterContextRef.current) {
      meterContextRef.current.close().catch(() => {})
      meterContextRef.current = null
    }
  }

  // 录音中的可视化反馈通过 AnalyserNode 采样，节流后再推送给主进程。
  function startAudioMeter(nextStream, subtitle) {
    stopAudioMeter()
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return
    const audioContext = new AudioContextClass()
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 128
    analyser.smoothingTimeConstant = 0.78
    const source = audioContext.createMediaStreamSource(nextStream)
    source.connect(analyser)
    meterContextRef.current = audioContext
    meterAnalyserRef.current = analyser
    meterSourceRef.current = source
    meterDataRef.current = new Uint8Array(analyser.frequencyBinCount)

    const tick = () => {
      if (!meterAnalyserRef.current || !meterDataRef.current) return
      meterAnalyserRef.current.getByteFrequencyData(meterDataRef.current)
      const total = meterDataRef.current.reduce((sum, value) => sum + value, 0)
      const level = Math.min(1, total / (meterDataRef.current.length * 160))
      const now = performance.now()
      // 音量反馈只做轻量节流，避免录音时向主进程推送过高频率的 IPC。
      if (now - meterLastPushRef.current >= 80) {
        meterLastPushRef.current = now
        window.bridgeApi.notifyOverlayState({ status: 'listening', title: '录音中', subtitle, level })
      }
      meterFrameRef.current = requestAnimationFrame(tick)
    }

    meterFrameRef.current = requestAnimationFrame(tick)
  }

  // 白名单动作执行统一从这里出发，便于保持日志和 overlay 展示一致。
  async function executePlan(nextPlan, options = {}) {
    if (!nextPlan || nextPlan.length === 0) {
      appendLog('当前没有可执行的动作。')
      return
    }
    appendLog(`开始执行 ${nextPlan.length} 个动作。`)
    try {
      const result = await window.bridgeApi.executePlan({ plan: nextPlan })
      appendLog(`执行完成: ${formatJson(result)}`)
      window.bridgeApi.notifyOverlayState({
        status: 'executing',
        title: '已执行',
        subtitle: options.stt || formatActionList(nextPlan),
        autoResetMs: 4000,
      })
    } catch (error) {
      appendLog(`执行失败: ${error.message || error}`)
      window.bridgeApi.notifyOverlayState({
        status: 'executing', title: '执行失败', subtitle: String(error.message || error), autoResetMs: 4000,
      })
    }
  }

  // 手动文本指令只做“文本 -> plan”的调试入口，不走音频链路。
  async function parseAndExecuteManualCommand() {
    if (!manualCommand.trim()) {
      appendLog('请先输入文本指令。')
      return
    }
    try {
      const matched = await window.bridgeApi.matchTranscript(manualCommand.trim())
      setTranscript(manualCommand.trim())
      setPlan(matched.plan || [])
      setTiming({})
      setUsage({})
      appendLog(`文本指令已匹配 ${(matched.plan || []).length} 个动作：${formatActionList(matched.plan || [])}`)
      if ((matched.plan || []).length > 0) await executePlan(matched.plan, { stt: matched.stt || manualCommand.trim() })
    } catch (error) {
      appendLog(`文本指令匹配失败: ${error.message || error}`)
    }
  }

  // 录音启动时同时初始化浏览器录制器、音量计和停止后的自动分析逻辑。
  async function startRecording(triggeredByShortcut = false) {
    try {
      if (recorderRef.current && recorderRef.current.state === 'recording') return
      const currentDeviceId = selectedInputDeviceIdRef.current
      const currentMicrophoneLabel = getSelectedMicrophoneLabel(currentDeviceId)
      const streamRef = await navigator.mediaDevices.getUserMedia({
        // 录音约束尽量保持原始输入，减少浏览器自动增益对耳机音量和音色的二次干预。
        audio: buildAudioConstraints(currentDeviceId),
      })
      refreshMicrophoneDevices(currentDeviceId)

      const chunks = []
      const mediaRecorder = new MediaRecorder(streamRef)
      const listeningSubtitle = triggeredByShortcut ? `再次按 ${shortcutStateRef.current.shortcutLabel || '快捷键'} 停止` : '正在监听语音...'

      if (isHeadsetMicrophoneLabel(currentMicrophoneLabel)) {
        appendLog(`当前使用的输入设备看起来是耳机麦克风：${currentMicrophoneLabel}。如果听歌时音量异常，建议改成系统默认或外置麦克风。`)
      }

      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data)
      })

      mediaRecorder.addEventListener('stop', async () => {
        // 录音结束后落盘，后续仍复用统一的音频分析链路。
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' })
        const arrayBuffer = await blob.arrayBuffer()
        const tempPath = await window.bridgeApi.saveRecording({
          bytes: Array.from(new Uint8Array(arrayBuffer)),
          mimeType: blob.type,
        })
        setAudioPath(tempPath)
        setRecordingState(`已导入录音: ${tempPath}`)
        appendLog(`录音已保存到临时文件: ${tempPath}`)
        stopAudioMeter()
        streamRef.getTracks().forEach((track) => track.stop())
        setMediaStream(null)
        setRecorder(null)
        setRecordedChunks([])
        window.bridgeApi.notifyOverlayState({ status: 'waiting', title: '识别中', subtitle: '等待服务器返回...' })

        if (autoAnalyzeAfterStopRef.current || triggeredByShortcut) {
          setAutoAnalyzeAfterStop(false)
          autoAnalyzeAfterStopRef.current = false
          setTimeout(() => { analyzeAudioFile(tempPath) }, 10)
        }
      })

      setRecordedChunks(chunks)
      setMediaStream(streamRef)
      setRecorder(mediaRecorder)
      setRecordingState(currentDeviceId
        ? `录音中... 输入设备：${currentMicrophoneLabel}`
        : '录音中...')
      startAudioMeter(streamRef, listeningSubtitle)
      mediaRecorder.start()
      appendLog('已开始录音。')
      window.bridgeApi.notifyOverlayState({ status: 'listening', title: '录音中', subtitle: listeningSubtitle, level: 0 })
    } catch (error) {
      appendLog(`录音失败: ${error.message || error}`)
      window.bridgeApi.notifyOverlayState({
        status: 'executing', title: '录音失败', subtitle: String(error.message || error), autoResetMs: 4000,
      })
    }
  }

  // 停止录音只负责收尾与落盘，真正的识别在 stop 回调后继续执行。
  function stopRecording(triggeredByShortcut = false, runtime = {}) {
    const activeRecorder = runtime.recorder || recorderRef.current
    const activeMediaStream = runtime.mediaStream || mediaStreamRef.current
    if (!activeRecorder || activeRecorder.state !== 'recording') return
    setAutoAnalyzeAfterStop(triggeredByShortcut)
    autoAnalyzeAfterStopRef.current = triggeredByShortcut
    stopAudioMeter()
    activeRecorder.stop()
    setRecordingState('正在处理录音...')
    activeMediaStream?.getTracks().forEach((track) => track.stop())
    appendLog(`已停止录音，当前分片数: ${recordedChunks.length}`)
    window.bridgeApi.notifyOverlayState({ status: 'waiting', title: 'Brewing...', subtitle: '=.=', level: 0 })
  }

  // 设置页承载环境级配置，例如全局快捷键与输入设备。
  function renderSettingsPage() {
    return (
      <div className="settings-layout">
        <Card>
          <CardHeader>
            <div><div className="section-label">Settings</div><CardTitle>全局录音键</CardTitle></div>
            <CardDescription>使用原生键盘钩子采集按键，并显示当前是否已经生效。</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="settings-card">
              <div className="settings-card__row">
                <div className="settings-status">
                  <span className={`settings-status__dot ${shortcutState.enabled ? 'settings-status__dot--ok' : ''}`} />
                  <span>{shortcutState.enabled ? '全局键盘钩子已启用' : '全局键盘钩子不可用'}</span>
                </div>
                <span className="helper-text">{shortcutState.provider}</span>
              </div>
              <div className="shortcut-capture">
                <button type="button" className={`shortcut-capture__field ${shortcutCaptureActive ? 'shortcut-capture__field--capturing' : ''}`} onClick={() => {
                  setShortcutCaptureActive(true)
                  setShortcutHint('请直接按下目标按键或组合键，例如右 Alt、Ctrl + Space。')
                }}>
                  <span className="shortcut-capture__label">{shortcutDraft.label || '点击后开始识别按键'}</span>
                  <span className="shortcut-capture__hint">{shortcutCaptureActive ? '正在识别...' : '点击以重新录入'}</span>
                </button>
                <div className="helper-text">{shortcutHint}</div>
                <div className="helper-text">
                  当前生效：{shortcutState.shortcutLabel || '未设置'}
                  {shortcutState.lastTriggeredAt ? ` · 最近触发：${shortcutState.lastTriggeredAt}` : ''}
                </div>
                {shortcutState.lastDetectedLabel ? <div className="helper-text">主进程最近识别到：{shortcutState.lastDetectedLabel}</div> : null}
                {shortcutState.error ? <div className="helper-text">错误：{shortcutState.error}</div> : null}
                <Button  onClick={saveShortcutDraft}>保存并启用按键</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div><div className="section-label">Audio</div><CardTitle>麦克风输入设备</CardTitle></div>
            <CardDescription>录音时会优先使用这里选中的输入设备。</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <label className="field">
              <span className="field__label">输入设备</span>
              <select className="ui-select" value={selectedInputDeviceId} onChange={(event) => updateSelectedInputDeviceId(event.target.value)}>
                <option value="">系统默认输入设备</option>
                {availableMicrophones.map((item) => <option key={item.deviceId} value={item.deviceId}>{item.label}</option>)}
              </select>
            </label>
            <div className="row">
              <Button variant="secondary" onClick={refreshMicrophoneDevices}>刷新设备列表</Button>
              <Button onClick={() => startRecording(false)}>使用当前设备测试录音</Button>
            </div>
            <div className="helper-text">
              当前选择：{availableMicrophones.find((item) => item.deviceId === selectedInputDeviceId)?.label || '系统默认输入设备'}
            </div>
            <div className="helper-text">
              带麦耳机在录音时可能切到通话模式并改变播放音量。若出现异常，优先保持“系统默认输入设备”或改用外置麦克风。
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // 开发者页聚合主要实验链路：输入、分析、桌面工具和右侧手动操作区。
  function renderDeveloperPage() {
    return (
      <div className="developer-layout">
        <div className="app-main">
          <Card className="hero-card">
            <CardHeader className="hero-card__header">
              <div>
                <div className="eyebrow">Bridge / Windows Electron</div>
                <CardTitle className="hero-title">开发者模式</CardTitle>
                <CardDescription className="hero-description">当前页面聚合音频输入、意图分析、白名单动作执行和窗口调度能力，作为独立实验台使用。</CardDescription>
              </div>
              <div className="runtime-box">
                <div className="runtime-box__title">Runtime</div>
                <ScrollArea className="runtime-box__scroll">
                  <pre className="console-block console-block--compact">{configStatus}</pre>
                </ScrollArea>
              </div>
            </CardHeader>
          </Card>

          <div className="content-grid">
            <Card>
              <CardHeader>
                <div><div className="section-label">Input</div><CardTitle>音频输入</CardTitle></div>
                <div className="switch-group"><Switch checked={stream} onCheckedChange={setStream} /><span>流式转写</span></div>
              </CardHeader>
              <CardContent className="stack">
                <label className="field">
                  <span className="field__label">音频文件</span>
                  <div className="row">
                    <Input value={audioPath} placeholder="选择 mp3 / wav / webm ..." readOnly />
                    <Button variant="secondary" onClick={pickAudioFile}>选择文件</Button>
                  </div>
                </label>
                <div className="field">
                  <span className="field__label">麦克风测试</span>
                  <div className="row">
                    <Button onClick={() => startRecording(false)} disabled={Boolean(recorder) && recorder.state === 'recording'}>开始录音</Button>
                    <Button variant="secondary" onClick={() => stopRecording(false)} disabled={!recorder || recorder.state !== 'recording'}>停止并导入</Button>
                  </div>
                  <div className="helper-text">{recordingState}</div>
                </div>
              </CardContent>
              <CardFooter className="footer-actions">
                <Button className="footer-actions__grow" onClick={analyzeAudio} disabled={busy}>{busy ? '分析中...' : '转写并匹配动作'}</Button>
                <div className="helper-text">识别完成后将直接执行，无需二次批准。当前全局录音键：{shortcutState.shortcutLabel || '未设置'}。</div>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <div><div className="section-label">Analysis</div><CardTitle>分析结果</CardTitle></div>
                <Button variant="secondary" disabled={!canExecutePlan} onClick={() => executePlan(plan)}>执行白名单动作</Button>
              </CardHeader>
              <CardContent className="stack">
                <div className="analysis-grid">
                  <section className="subpanel">
                    <div className="subpanel__title">Transcript</div>
                    <ScrollArea className="subpanel__body"><pre className="console-block">{transcript}</pre></ScrollArea>
                  </section>
                  <section className="subpanel">
                    <div className="subpanel__title">Matched Plan</div>
                    <ScrollArea className="subpanel__body"><pre className="console-block">{renderedPlan}</pre></ScrollArea>
                  </section>
                </div>
                <div className="analysis-grid analysis-grid--small">
                  <section className="subpanel"><div className="subpanel__title">Timing</div><pre className="console-block console-block--compact">{formatJson(timing)}</pre></section>
                  <section className="subpanel"><div className="subpanel__title">Usage</div><pre className="console-block console-block--compact">{formatJson(usage)}</pre></section>
                </div>
                <DesktopCapturePanel onLog={appendLog} />
                <section className="subpanel">
                  <div className="subpanel__title">Execution Log</div>
                  <ScrollArea className="subpanel__body subpanel__body--log"><pre className="console-block">{logs.join('\n')}</pre></ScrollArea>
                </section>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="sidebar-card">
          <CardHeader className="sidebar-card__header">
            <div className="section-label">Manual Controls</div>
            <CardTitle>实验操作区</CardTitle>
            <CardDescription>手动动作、文本指令和系统窗口列表都集中在这里。</CardDescription>
          </CardHeader>
          <CardContent className="sidebar-stack">
            <section className="side-section">
              <div className="subpanel__title">白名单动作</div>
              <div className="list-stack">{MANUAL_ACTIONS.map((item) => <Button key={item.label} variant="secondary" className="button-list" onClick={() => executePlan(item.plan)}>{item.label}</Button>)}</div>
            </section>
            <section className="side-section">
              <div className="subpanel__title">手动文本指令</div>
              <Textarea rows={4} value={manualCommand} onChange={(event) => setManualCommand(event.target.value)} placeholder="例如：打开微信，然后输入你好" />
              <Button className="button-wide" onClick={parseAndExecuteManualCommand}>解析文本并执行</Button>
            </section>
            <section className="side-section">
              <div className="subpanel__title">直接输入文本</div>
              <Input value={typeText} onChange={(event) => setTypeText(event.target.value)} placeholder="输入要发送到当前焦点输入框的文本" />
              <Button variant="secondary" className="button-wide" onClick={() => executePlan([{ action: 'input_text', args: { text: typeText.trim() } }])}>input_text</Button>
            </section>
            <section className="side-section">
              <div className="subpanel__title">高权限测试（仅手动）</div>
              <div className="list-stack">{PRIVILEGED_ACTIONS.map((item) => <Button key={item.label} variant="secondary" className="button-list" onClick={() => executePlan(item.plan)}>{item.label}</Button>)}</div>
            </section>
            <CornerIndicatorPanel onLog={appendLog} />
            <section className="side-section">
              <div className="side-section__row">
                <div className="subpanel__title">窗口列表</div>
                <Button variant="secondary" size="sm" onClick={refreshWindows} disabled={windowBusy}>手动刷新</Button>
              </div>
              <div className="helper-text">{windowSnapshot.updatedAt ? `上次更新: ${windowSnapshot.updatedAt}` : '尚未加载窗口列表'}</div>
              <ScrollArea className="window-list">
                <div className="list-stack">{windowSnapshot.items.map((item) => <WindowListItem key={item.handle} item={item} onOpen={openWindowDetail} />)}</div>
              </ScrollArea>
            </section>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="app-shell dark">
      <div className="workspace-layout">
        <Navigation activeMenu={activeMenu} onSelect={setActiveMenu} />
        <main className="workspace-content">
          {activeMenu === ACTIVE_MENU.developer ? renderDeveloperPage() : renderSettingsPage()}
        </main>
      </div>

      <Dialog open={windowDialogOpen} onOpenChange={setWindowDialogOpen}>
        <DialogHeader>
          <DialogTitle>{selectedWindow?.title || '窗口详情'}</DialogTitle>
          <DialogDescription>查看当前窗口的应用信息与位置，并执行焦点、关闭、移动等已开放接口。</DialogDescription>
        </DialogHeader>
        <div className="dialog-grid">
          <section className="subpanel">
            <div className="subpanel__title">基本信息</div>
            <pre className="console-block console-block--compact">{formatJson(selectedWindow || {})}</pre>
          </section>
          <section className="subpanel">
            <div className="subpanel__title">移动窗口</div>
            <div className="move-grid">
              <Input value={windowMoveForm.x} onChange={(event) => setWindowMoveForm((current) => ({ ...current, x: event.target.value }))} placeholder="x" />
              <Input value={windowMoveForm.y} onChange={(event) => setWindowMoveForm((current) => ({ ...current, y: event.target.value }))} placeholder="y" />
              <Input value={windowMoveForm.width} onChange={(event) => setWindowMoveForm((current) => ({ ...current, width: event.target.value }))} placeholder="width" />
              <Input value={windowMoveForm.height} onChange={(event) => setWindowMoveForm((current) => ({ ...current, height: event.target.value }))} placeholder="height" />
            </div>
          </section>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => runWindowAction('focus')} disabled={windowBusy}>调起 / 聚焦</Button>
          <Button variant="secondary" onClick={() => runWindowAction('move')} disabled={windowBusy}>移动窗口</Button>
          <Button onClick={() => runWindowAction('close')} disabled={windowBusy}>关闭窗口</Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
