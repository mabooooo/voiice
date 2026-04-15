import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { CornerIndicatorPanel } from '@/features/desktop-utilities/CornerIndicatorPanel'
import { DesktopCapturePanel } from '@/features/desktop-utilities/DesktopCapturePanel'
import { OmniParserPanel } from '@/features/desktop-utilities/OmniParserPanel'
import { PPOcrPanel } from '@/features/desktop-utilities/PPOcrPanel'
import { WindowManagementPanel } from '@/features/window-management/WindowManagementPanel'

// 主控制台页面：负责串起音频输入、动作执行、窗口管理和设置页切换。
const ACTIVE_MENU = { developer: 'developer', settings: 'settings' }
const STORAGE_KEYS = {
  activeMenu: 'voice-bridge-active-menu',
  microphoneId: 'voice-bridge-microphone-id',
  provider: 'voice-bridge-provider',
  senseVoiceEnabled: 'voice-bridge-sensevoice-enabled',
}
const PROVIDER_OPTIONS = [
  { value: 'qwen', label: 'Qwen' },
  { value: 'xiaomi', label: 'Xiaomi MiMo' },
]

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
function formatLatencyMs(value) {
  if (!Number.isFinite(value)) return '-'
  return `${Math.round(value)} ms`
}
function createSenseVoiceResultState(overrides = {}) {
  return {
    status: 'idle',
    text: '',
    timingMs: null,
    mode: '',
    convertedToWav: false,
    error: '',
    audioPath: '',
    stream: false,
    useVad: false,
    chunks: [],
    ...overrides,
  }
}
function formatSenseVoiceChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return '无分块结果'
  return chunks.map((item) => {
    return `#${item.index} [${item.start_ms}ms - ${item.end_ms}ms] ${item.latency_ms}ms\n${item.text || '(empty)'}`
  }).join('\n\n')
}
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
  const [runtimeConfig, setRuntimeConfig] = useState(null)
  const [activeMenu, setActiveMenu] = useState(() => localStorage.getItem(STORAGE_KEYS.activeMenu) || ACTIVE_MENU.developer)
  const [audioPath, setAudioPath] = useState('')
  const [selectedProvider, setSelectedProvider] = useState(() => localStorage.getItem(STORAGE_KEYS.provider) || 'qwen')
  const [senseVoiceEnabled, setSenseVoiceEnabled] = useState(() => localStorage.getItem(STORAGE_KEYS.senseVoiceEnabled) === 'true')
  const [transcript, setTranscript] = useState('')
  const [plan, setPlan] = useState([])
  const [timing, setTiming] = useState({})
  const [usage, setUsage] = useState({})
  const [senseVoiceBusy, setSenseVoiceBusy] = useState(false)
  const [senseVoiceProbe, setSenseVoiceProbe] = useState({
    ready: false,
    message: '尚未检测',
    baseURL: '',
    device: '',
  })
  const [senseVoiceResult, setSenseVoiceResult] = useState(createSenseVoiceResultState())
  const [localAsrTestBusy, setLocalAsrTestBusy] = useState(false)
  const [localAsrTestRecording, setLocalAsrTestRecording] = useState(false)
  const [localAsrTestStream, setLocalAsrTestStream] = useState(false)
  const [localAsrTestUseVad, setLocalAsrTestUseVad] = useState(false)
  const [localAsrTestResult, setLocalAsrTestResult] = useState(createSenseVoiceResultState())
  const [manualCommand, setManualCommand] = useState('')
  const [typeText, setTypeText] = useState('')
  const [recordingState, setRecordingState] = useState('未录音')
  const [logs, setLogs] = useState(['等待操作...'])
  const [busy, setBusy] = useState(false)
  const [recorder, setRecorder] = useState(null)
  const [mediaStream, setMediaStream] = useState(null)
  const [recordedChunks, setRecordedChunks] = useState([])
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
  const localAsrTestRecorderRef = useRef(null)
  const localAsrTestMediaStreamRef = useRef(null)

  const canExecutePlan = plan.length > 0
  const renderedPlan = useMemo(() => formatJson(plan), [plan])

  useEffect(() => { localStorage.setItem(STORAGE_KEYS.activeMenu, activeMenu) }, [activeMenu])
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.provider, selectedProvider) }, [selectedProvider])
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.senseVoiceEnabled, String(senseVoiceEnabled)) }, [senseVoiceEnabled])
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
      setRuntimeConfig(status)
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

    refreshMicrophoneDevices()
    probeSenseVoiceService()

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

  async function pickAudioFile() {
    const filePath = await window.bridgeApi.pickAudioFile()
    if (!filePath) return ''
    setAudioPath(filePath)
    appendLog(`已选择音频文件: ${filePath}`)
    return filePath
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

  // 设置页直接探活本地 SenseVoice 服务，便于确认本地识别能力是否已启动。
  async function probeSenseVoiceService() {
    try {
      const nextState = await window.bridgeApi.probeSenseVoice()
      setSenseVoiceProbe({
        ready: true,
        message: nextState.payload?.message || '服务可用',
        baseURL: nextState.baseURL,
        device: nextState.payload?.device || '',
      })
    } catch (error) {
      setSenseVoiceProbe({
        ready: false,
        message: String(error.message || error),
        baseURL: runtimeConfig?.sensevoice?.baseURL || '',
        device: '',
      })
    }
  }

  // 本地 ASR 测试和并行识别共用同一条非流式调用链路，保证结果展示一致。
  async function runSenseVoiceTranscription(filePath, options = {}) {
    if (!filePath) {
      appendLog('请先选择音频文件，或者先录音。')
      return
    }

    setSenseVoiceBusy(true)
    setSenseVoiceResult({
      status: 'running',
      text: '',
      timingMs: null,
      mode: 'sensevoice-small',
      convertedToWav: false,
      error: '',
      audioPath: filePath,
    })

    try {
      const result = await window.bridgeApi.transcribeSenseVoice({ filePath })
      setSenseVoiceResult({
        status: 'done',
        text: result.text || '',
        timingMs: Number.isFinite(result.localLatencyMs) ? result.localLatencyMs : null,
        mode: result.mode || 'sensevoice-small',
        convertedToWav: Boolean(result.convertedToWav),
        error: '',
        audioPath: result.audioPath || filePath,
      })
      setSenseVoiceProbe((current) => ({
        ...current,
        ready: true,
        baseURL: result.baseURL || current.baseURL,
      }))
      appendLog(`${options.label || 'SenseVoice 本地识别'}完成：${result.text || '空结果'}`)
    } catch (error) {
      const message = String(error.message || error)
      setSenseVoiceResult({
        status: 'error',
        text: '',
        timingMs: null,
        mode: 'sensevoice-small',
        convertedToWav: false,
        error: message,
        audioPath: filePath,
      })
      appendLog(`${options.label || 'SenseVoice 本地识别'}失败: ${message}`)
    } finally {
      setSenseVoiceBusy(false)
    }
  }

  // SenseVoice 本地识别与原有云端动作管道并行执行，避免拖慢动作落地。
  function startSenseVoiceTranscription(filePath) {
    if (!senseVoiceEnabled || !filePath) {
      return
    }

    void runSenseVoiceTranscription(filePath, { label: 'SenseVoice 并行本地识别' })
  }

  // 本地 ASR 测试收口到单独方法，确保开发者录音链路不影响产品主流程。
  async function transcribeLocalAsrTestFile(filePath, sessionOptions) {
    setLocalAsrTestResult(createSenseVoiceResultState({
      status: 'running',
      mode: 'sensevoice-small',
      audioPath: filePath,
      stream: sessionOptions.stream,
      useVad: sessionOptions.useVad,
    }))

    try {
      const result = await window.bridgeApi.transcribeSenseVoice({
        filePath,
        stream: sessionOptions.stream,
        useVad: sessionOptions.useVad,
        chunkDurationMs: 600,
      })
      setLocalAsrTestResult(createSenseVoiceResultState({
        status: 'done',
        text: result.text || '',
        timingMs: Number.isFinite(result.localLatencyMs) ? result.localLatencyMs : null,
        mode: result.mode || 'sensevoice-small',
        convertedToWav: Boolean(result.convertedToWav),
        error: '',
        audioPath: result.audioPath || filePath,
        stream: Boolean(result.stream),
        useVad: Boolean(result.useVad),
        chunks: Array.isArray(result.chunks) ? result.chunks : [],
      }))
      appendLog(`本地 ASR 测试完成：${result.text || '空结果'}`)
    } catch (error) {
      const message = String(error.message || error)
      setLocalAsrTestResult(createSenseVoiceResultState({
        status: 'error',
        mode: 'sensevoice-small',
        convertedToWav: false,
        error: message,
        audioPath: filePath,
        stream: sessionOptions.stream,
        useVad: sessionOptions.useVad,
      }))
      appendLog(`本地 ASR 测试失败: ${message}`)
    }
  }

  // 开发者模式点击后直接开始听写，停止后再独立调用本地 ASR 服务。
  async function startLocalAsrTestRecording() {
    try {
      if (localAsrTestRecorderRef.current?.state === 'recording') return
      const currentDeviceId = selectedInputDeviceIdRef.current
      const currentMicrophoneLabel = getSelectedMicrophoneLabel(currentDeviceId)
      const sessionOptions = {
        stream: localAsrTestStream,
        useVad: localAsrTestUseVad,
      }
      const streamRef = await navigator.mediaDevices.getUserMedia({
        // 本地 ASR 测试和主录音使用同一套输入约束，避免设备行为不一致。
        audio: buildAudioConstraints(currentDeviceId),
      })
      refreshMicrophoneDevices(currentDeviceId)

      const chunks = []
      const mediaRecorder = new MediaRecorder(streamRef)
      localAsrTestRecorderRef.current = mediaRecorder
      localAsrTestMediaStreamRef.current = streamRef

      if (isHeadsetMicrophoneLabel(currentMicrophoneLabel)) {
        appendLog(`本地 ASR 测试当前使用耳机麦克风：${currentMicrophoneLabel}。若系统音量异常，建议改为系统默认输入或外置麦克风。`)
      }

      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data)
      })

      mediaRecorder.addEventListener('stop', async () => {
        try {
          // 停止后先把录音落到临时文件，再复用现有本地 ASR IPC。
          const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' })
          const arrayBuffer = await blob.arrayBuffer()
          const tempPath = await window.bridgeApi.saveRecording({
            bytes: Array.from(new Uint8Array(arrayBuffer)),
            mimeType: blob.type,
          })
          appendLog(`本地 ASR 听写录音已保存: ${tempPath}`)
          await transcribeLocalAsrTestFile(tempPath, sessionOptions)
        } catch (error) {
          const message = String(error.message || error)
          setLocalAsrTestResult(createSenseVoiceResultState({
            status: 'error',
            mode: 'sensevoice-small',
            convertedToWav: false,
            error: message,
            stream: sessionOptions.stream,
            useVad: sessionOptions.useVad,
          }))
          appendLog(`本地 ASR 听写处理失败: ${message}`)
        } finally {
          // 开发者测试自己的录音资源在这里独立回收，避免污染产品录音状态。
          streamRef.getTracks().forEach((track) => track.stop())
          if (localAsrTestRecorderRef.current === mediaRecorder) localAsrTestRecorderRef.current = null
          if (localAsrTestMediaStreamRef.current === streamRef) localAsrTestMediaStreamRef.current = null
          setLocalAsrTestRecording(false)
          setLocalAsrTestBusy(false)
        }
      })

      setLocalAsrTestResult(createSenseVoiceResultState({
        status: 'recording',
        mode: 'sensevoice-small',
        stream: sessionOptions.stream,
        useVad: sessionOptions.useVad,
      }))
      setLocalAsrTestRecording(true)
      setLocalAsrTestBusy(false)
      mediaRecorder.start()
      appendLog(`本地 ASR 听写已开始，模式：${sessionOptions.stream ? '流式' : '非流式'}，VAD：${sessionOptions.useVad ? '开启' : '关闭'}。`)
    } catch (error) {
      const message = String(error.message || error)
      setLocalAsrTestRecording(false)
      setLocalAsrTestBusy(false)
      setLocalAsrTestResult(createSenseVoiceResultState({
        status: 'error',
        mode: 'sensevoice-small',
        convertedToWav: false,
        error: message,
        stream: localAsrTestStream,
        useVad: localAsrTestUseVad,
      }))
      appendLog(`本地 ASR 听写启动失败: ${message}`)
    }
  }

  // 再次点击按钮时只负责结束本次听写，识别逻辑在 stop 回调里继续执行。
  function stopLocalAsrTestRecording() {
    const activeRecorder = localAsrTestRecorderRef.current
    const activeStream = localAsrTestMediaStreamRef.current
    if (!activeRecorder || activeRecorder.state !== 'recording') return
    setLocalAsrTestRecording(false)
    setLocalAsrTestBusy(true)
    setLocalAsrTestResult((current) => createSenseVoiceResultState({
      ...current,
      status: 'running',
      mode: current.mode || 'sensevoice-small',
      stream: current.stream,
      useVad: current.useVad,
    }))
    activeRecorder.stop()
    activeStream?.getTracks().forEach((track) => track.stop())
    appendLog('本地 ASR 听写已结束，正在识别。')
  }

  // 开发者测试按钮是录音开关，不再要求用户先手动挑选音频文件。
  async function toggleLocalAsrTestRecording() {
    if (localAsrTestRecording) {
      stopLocalAsrTestRecording()
      return
    }
    if (localAsrTestBusy) return
    await startLocalAsrTestRecording()
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
    startSenseVoiceTranscription(filePath)
    window.bridgeApi.notifyOverlayState({ status: 'waiting', title: '识别中', subtitle: '等待服务器返回...' })

    try {
      const result = await window.bridgeApi.analyzeAudio({ filePath, provider: selectedProvider })
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
      const matched = await window.bridgeApi.matchTranscript({
        transcript: manualCommand.trim(),
        provider: selectedProvider,
      })
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
            <div><div className="section-label">Endpoint</div><CardTitle>模型端点</CardTitle></div>
            <CardDescription>在这里切换当前使用的多模态 provider。</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <label className="field">
              <span className="field__label">当前 endpoint</span>
              <select className="ui-select" value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value)}>
                {PROVIDER_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <div className="helper-text">
              当前模型：{runtimeConfig?.providers?.[selectedProvider]?.model || '未配置'}
            </div>
            <div className="helper-text">
              当前 baseURL：{runtimeConfig?.providers?.[selectedProvider]?.baseURL || '未配置'}
            </div>
            <div className="helper-text">
              配置状态：{runtimeConfig?.providers?.[selectedProvider]?.configured ? '已配置 API Key' : '缺少 API Key'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div><div className="section-label">Local STT</div><CardTitle>SenseVoice 本地识别</CardTitle></div>
            <CardDescription>开启后会在每次音频分析时并行执行本地转写，但不会替代原有动作解析管道。</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="settings-card">
              <div className="settings-card__row">
                <div className="settings-status">
                  <span className={`settings-status__dot ${senseVoiceProbe.ready ? 'settings-status__dot--ok' : ''}`} />
                  <span>{senseVoiceProbe.ready ? '本地服务已连接' : '本地服务未连接'}</span>
                </div>
                <button
                  type="button"
                  className={`ui-switch ${senseVoiceEnabled ? 'ui-switch--checked' : ''}`}
                  aria-pressed={senseVoiceEnabled}
                  onClick={() => setSenseVoiceEnabled((current) => !current)}
                >
                  <span className="ui-switch__thumb" />
                </button>
              </div>
              <div className="helper-text">开关状态：{senseVoiceEnabled ? '已启用并行本地识别' : '未启用'}</div>
              <div className="helper-text">服务地址：{senseVoiceProbe.baseURL || runtimeConfig?.sensevoice?.baseURL || '未配置'}</div>
              <div className="helper-text">
                托管状态：{runtimeConfig?.sensevoice?.managed?.status || 'unknown'}
                {runtimeConfig?.sensevoice?.managed?.pid ? ` · pid=${runtimeConfig.sensevoice.managed.pid}` : ''}
              </div>
              <div className="helper-text">设备：{senseVoiceProbe.device || 'cpu'}</div>
              <div className="helper-text">{senseVoiceProbe.message}</div>
              <div className="row">
                <Button variant="secondary" onClick={probeSenseVoiceService}>检测 SenseVoice 服务</Button>
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

          <div className="content-grid">
            <Card>
              <CardHeader>
                <div><div className="section-label">Input</div><CardTitle>音频输入</CardTitle></div>
                <div className="helper-text">固定使用非流式、非深度思考模式。</div>
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
              
              <CardHeader>
                <div><div className="section-label">Input</div><CardTitle>本地ASR</CardTitle></div>
              </CardHeader>
              <CardContent className="stack">
                <section className="subpanel">
                  <div className="side-section__row">
                    <div className="subpanel__title">Local ASR Test</div>
                    <div className="desktop-capture-actions">
                      <select className="ui-select local-asr-test__select" value={localAsrTestStream ? 'stream' : 'non-stream'} onChange={(event) => setLocalAsrTestStream(event.target.value === 'stream')} disabled={localAsrTestRecording || localAsrTestBusy}>
                        <option value="non-stream">非流式</option>
                        <option value="stream">流式</option>
                      </select>
                      <button
                        type="button"
                        className={`ui-switch ${localAsrTestUseVad ? 'ui-switch--checked' : ''}`}
                        aria-pressed={localAsrTestUseVad}
                        disabled={localAsrTestRecording || localAsrTestBusy}
                        onClick={() => setLocalAsrTestUseVad((current) => !current)}
                      >
                        <span className="ui-switch__thumb" />
                      </button>
                      <Button variant="secondary" onClick={toggleLocalAsrTestRecording} disabled={localAsrTestBusy && !localAsrTestRecording}>
                        {localAsrTestRecording ? '结束听写' : (localAsrTestBusy ? '识别中...' : '开始听写')}
                      </Button>
                    </div>
                  </div>
                  <div className="helper-text">
                    这是开发者独立测试入口。点击后直接开始麦克风听写，再次点击结束并触发本地 ASR。
                  </div>
                  <div className="helper-text">
                    模式：{localAsrTestResult.stream ? '流式' : '非流式'} · VAD：{localAsrTestResult.useVad ? '开启' : '关闭'} · 状态：{localAsrTestResult.status}
                    {localAsrTestResult.mode ? ` · ${localAsrTestResult.mode}` : ''}
                    {localAsrTestResult.timingMs !== null ? ` · ${formatLatencyMs(localAsrTestResult.timingMs)}` : ''}
                    {localAsrTestResult.convertedToWav ? ' · 已转 wav' : ''}
                  </div>
                  <div className="helper-text">
                    听写状态：{localAsrTestRecording ? '录音中' : (localAsrTestBusy ? '识别中' : '空闲')}
                  </div>
                  <div className="helper-text">
                    音频路径：{localAsrTestResult.audioPath || '暂无'}
                  </div>
                  <div className="helper-text">
                    产品并行状态：{senseVoiceEnabled ? (senseVoiceBusy ? '识别中' : senseVoiceResult.status) : '未启用'}
                  </div>
                  {localAsrTestResult.error ? <div className="helper-text">错误：{localAsrTestResult.error}</div> : null}
                  <ScrollArea className="subpanel__body">
                    <pre className="console-block">{localAsrTestResult.stream
                      ? (formatSenseVoiceChunks(localAsrTestResult.chunks) + (localAsrTestResult.text ? `\n\nFinal:\n${localAsrTestResult.text}` : ''))
                      : (localAsrTestResult.text || '点击“开始听写”执行独立本地 ASR 测试。')}
                    </pre>
                  </ScrollArea>
                </section>
                
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
                <OmniParserPanel onLog={appendLog} />
                <PPOcrPanel onLog={appendLog} />
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
            <WindowManagementPanel onLog={appendLog} />
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
    </div>
  )
}
