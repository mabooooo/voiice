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
// 连续听写采集器：renderer 只负责 PCM 采集，断句/ASR/路由都放到主进程。
import { startDictationPcmCapture } from '@/lib/dictation/pcmCapture'

// 主控制台页面：负责串起音频输入、动作执行、窗口管理和设置页切换。
const ACTIVE_MENU = { developer: 'developer', settings: 'settings' }
const STORAGE_KEYS = {
  activeMenu: 'voice-bridge-active-menu',
  microphoneId: 'voice-bridge-microphone-id',
  provider: 'voice-bridge-provider',
  senseVoiceEnabled: 'voice-bridge-sensevoice-enabled',
  voiceOcrBackend: 'voice-bridge-voice-ocr-backend',
  spatialMemoryEnabled: 'voice-bridge-spatial-memory-enabled',
  dictationEnabled: 'voice-bridge-dictation-enabled',
  preferredLanguage: 'voice-bridge-preferred-language',
}
const PROVIDER_OPTIONS = [
  { value: 'qwen', label: 'Qwen' },
  { value: 'xiaomi', label: 'Xiaomi MiMo' },
]
const DEFAULT_VOICE_OCR_PROFILE = 'omniparser-gpu'
const VOICE_OCR_OPTIONS = [
  { value: 'omniparser-gpu', backend: 'omniparser', label: 'OmniParser - GPU', hint: '当前默认。窗口截图 + EasyOCR/icon_detect，优先走 GPU。' },
  { value: 'omniparser-cpu', backend: 'omniparser', label: 'OmniParser - CPU', hint: '与 GPU 同链路，适合无 CUDA 环境排障。' },
  { value: 'ppocr-gpu', backend: 'ppocr', label: 'PP-OCR - GPU', hint: 'Paddle OCR 走 GPU，适合已有 CUDA 11.8/12.3 的机器。' },
  { value: 'ppocr-cpu', backend: 'ppocr', label: 'PP-OCR - CPU', hint: '兼容性优先，性能最稳但速度较慢。' },
]
const VOICE_OCR_OPTION_MAP = Object.fromEntries(VOICE_OCR_OPTIONS.map((item) => [item.value, item]))
// 首选语言：默认 auto 让 SenseVoice 自己 LID，
// 固定到单语言（zh/en/...）在纯单语场景下能多拿 1~3% 的精度，但会降低中英混说的鲁棒性。
const PREFERRED_LANGUAGE_OPTIONS = [
  { value: 'auto', label: '自动识别 (auto)', hint: '默认。适合中英混说或语言不确定的场景。' },
  { value: 'zh', label: '中文 (zh)', hint: '日常只说中文时固定，准确率略高。偶发英文词可能音译。' },
  { value: 'en', label: 'English (en)', hint: '日常只说英文时固定。' },
  { value: 'ja', label: '日本語 (ja)', hint: '日常只说日语时固定。' },
  { value: 'ko', label: '한국어 (ko)', hint: '日常只说韩语时固定。' },
  { value: 'yue', label: '粤语 (yue)', hint: '日常只说粤语时固定。' },
]
// FSM 阶段对应的中文提示，仅用于 UI 显示与 overlay 副标题。
const DICTATION_PHASE_LABEL = {
  idle: '等待说话',
  pre: '疑似语音',
  in: '正在说话',
  post: '等待句末',
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
function normalizeVoiceOcrSelection(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (VOICE_OCR_OPTION_MAP[normalized]) return normalized
  if (normalized === 'omniparser') return 'omniparser-gpu'
  if (normalized === 'ppocr') return 'ppocr-gpu'
  return DEFAULT_VOICE_OCR_PROFILE
}
function getVoiceOcrOption(value) {
  return VOICE_OCR_OPTION_MAP[normalizeVoiceOcrSelection(value)] || VOICE_OCR_OPTION_MAP[DEFAULT_VOICE_OCR_PROFILE]
}
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
  const [voiceOcrBackend, setVoiceOcrBackend] = useState(() => normalizeVoiceOcrSelection(localStorage.getItem(STORAGE_KEYS.voiceOcrBackend)))
  const [spatialMemoryEnabled, setSpatialMemoryEnabled] = useState(() => localStorage.getItem(STORAGE_KEYS.spatialMemoryEnabled) !== 'false')
  // 连续听写开关：关闭时保持原始"按键开始→按键结束→整段上传"链路；打开后快捷键切换常驻听写。
  const [dictationEnabled, setDictationEnabled] = useState(() => localStorage.getItem(STORAGE_KEYS.dictationEnabled) === 'true')
  const [preferredLanguage, setPreferredLanguage] = useState(() => localStorage.getItem(STORAGE_KEYS.preferredLanguage) || 'auto')
  const [dictationActive, setDictationActive] = useState(false)
  const [dictationPhase, setDictationPhase] = useState('idle')
  const [dictationStatus, setDictationStatus] = useState('未启动')
  const [transcript, setTranscript] = useState('')
  const [plan, setPlan] = useState([])
  const [timing, setTiming] = useState({})
  const [usage, setUsage] = useState({})
  const [senseVoiceBusy, setSenseVoiceBusy] = useState(false)
  const [ocrServiceBusy, setOcrServiceBusy] = useState(false)
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
  const voiceOcrBackendRef = useRef(normalizeVoiceOcrSelection(localStorage.getItem(STORAGE_KEYS.voiceOcrBackend)))
  const spatialMemoryEnabledRef = useRef(localStorage.getItem(STORAGE_KEYS.spatialMemoryEnabled) !== 'false')
  // dictation 相关 ref，避免快捷键回调里拿到过期 state。
  const dictationEnabledRef = useRef(localStorage.getItem(STORAGE_KEYS.dictationEnabled) === 'true')
  const dictationActiveRef = useRef(false)
  const dictationHandleRef = useRef(null)
  const preferredLanguageRef = useRef(localStorage.getItem(STORAGE_KEYS.preferredLanguage) || 'auto')
  const shortcutStateRef = useRef({ provider: 'uiohook-napi', enabled: false, error: '', shortcut: null, shortcutLabel: '右 Alt', lastDetectedLabel: '', lastTriggeredAt: '' })
  const meterContextRef = useRef(null)
  const meterAnalyserRef = useRef(null)
  const meterFrameRef = useRef(0)
  const meterSourceRef = useRef(null)
  const meterDataRef = useRef(null)
  const meterLastPushRef = useRef(0)
  const localAsrTestRecorderRef = useRef(null)
  const localAsrTestMediaStreamRef = useRef(null)
  const settingsHydratedRef = useRef(false)

  const canExecutePlan = plan.length > 0
  const renderedPlan = useMemo(() => formatJson(plan), [plan])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.activeMenu, activeMenu)
    if (!settingsHydratedRef.current) return
    void window.bridgeApi.updateAppSettings({ activeMenu }).catch(() => {})
  }, [activeMenu])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.provider, selectedProvider)
    if (!settingsHydratedRef.current) return
    void window.bridgeApi.updateAppSettings({ provider: selectedProvider }).catch(() => {})
  }, [selectedProvider])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.senseVoiceEnabled, String(senseVoiceEnabled))
    if (!settingsHydratedRef.current) return
    void window.bridgeApi.updateAppSettings({ senseVoiceEnabled }).catch(() => {})
  }, [senseVoiceEnabled])
  // 语音点选 OCR 后端单独持久化，便于在快速链路和兼容链路之间切换。
  useEffect(() => {
    voiceOcrBackendRef.current = voiceOcrBackend
    localStorage.setItem(STORAGE_KEYS.voiceOcrBackend, voiceOcrBackend)
    if (!settingsHydratedRef.current) return
    void window.bridgeApi.updateAppSettings({ voiceOcrBackend }).catch(() => {})
  }, [voiceOcrBackend])
  // 空间记忆只作用于本地点选链路，单独持久化避免影响其他分析入口。
  useEffect(() => {
    spatialMemoryEnabledRef.current = spatialMemoryEnabled
    localStorage.setItem(STORAGE_KEYS.spatialMemoryEnabled, String(spatialMemoryEnabled))
    if (!settingsHydratedRef.current) return
    void window.bridgeApi.updateAppSettings({ spatialMemoryEnabled }).catch(() => {})
  }, [spatialMemoryEnabled])
  // 听写开关改变时：关闭立刻停掉当前会话，开启时仅写入偏好，真正的启动发生在快捷键触发。
  useEffect(() => {
    dictationEnabledRef.current = dictationEnabled
    localStorage.setItem(STORAGE_KEYS.dictationEnabled, String(dictationEnabled))
    if (settingsHydratedRef.current) {
      void window.bridgeApi.updateAppSettings({ dictationEnabled }).catch(() => {})
    }
    if (!dictationEnabled && dictationActiveRef.current) {
      void stopDictationMode('setting-off')
    }
  }, [dictationEnabled])
  useEffect(() => {
    preferredLanguageRef.current = preferredLanguage
    localStorage.setItem(STORAGE_KEYS.preferredLanguage, preferredLanguage)
    if (!settingsHydratedRef.current) return
    void window.bridgeApi.updateAppSettings({ preferredLanguage }).catch(() => {})
  }, [preferredLanguage])
  useEffect(() => {
    selectedInputDeviceIdRef.current = selectedInputDeviceId
    localStorage.setItem(STORAGE_KEYS.microphoneId, selectedInputDeviceId)
    if (!settingsHydratedRef.current) return
    void window.bridgeApi.updateAppSettings({ microphoneId: selectedInputDeviceId }).catch(() => {})
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

  // 连续听写采集仍在 renderer，采集侧日志继续转发到主进程终端方便排查。
  function forwardVoiceDebugLog(message) {
    try {
      window.bridgeApi.voiceLog?.({ message })
    } catch {}
  }

  // 主进程听写事件统一从这里回填 UI，避免 renderer 再维护一套句子状态机。
  function handleDictationEvent(event = {}) {
    if (!event?.type) return

    if (event.type === 'phase') {
      const nextPhase = event.phase || 'idle'
      setDictationPhase(nextPhase)
      return
    }

    if (event.type === 'queued') {
      appendLog(`句 #${event.seq} 已送主进程断句，时长 ${Math.round(event.durationMs || 0)}ms。`)
      window.bridgeApi.notifyOverlayState({
        status: 'waiting',
        title: `识别句 #${event.seq}`,
        subtitle: `${Math.round(event.durationMs || 0)}ms · ${preferredLanguageRef.current}`,
      })
      return
    }

    if (event.type === 'result') {
      setTranscript(event.transcript || '')
      appendLog(`句 #${event.seq} ASR="${event.transcript || ''}" → ${event.action || 'no-trigger'} · phase=${event.phase || 'idle'}`)
      if (dictationActiveRef.current) {
        window.bridgeApi.notifyOverlayState({
          status: 'listening',
          title: '连续听写中',
          subtitle: `上一句：${event.transcript || '(空)'}`,
          level: 0.15,
        })
      }
      return
    }

    if (event.type === 'dropped') {
      appendLog(`主进程丢弃短句：${Math.round(event.durationMs || 0)}ms · reason=${event.reason || 'unknown'}`)
      return
    }

    if (event.type === 'error') {
      appendLog(`连续听写出错: ${event.message || 'unknown error'}`)
      window.bridgeApi.notifyOverlayState({
        status: 'executing',
        title: '连续听写出错',
        subtitle: String(event.message || 'unknown error'),
        autoResetMs: 4000,
      })
      return
    }

    if (event.type === 'stopped') {
      setDictationPhase('idle')
      setDictationStatus('已停止')
    }
  }

  function updateSelectedInputDeviceId(nextDeviceId) {
    selectedInputDeviceIdRef.current = nextDeviceId
    setSelectedInputDeviceId(nextDeviceId)
  }

  function getSelectedMicrophoneLabel(deviceId) {
    if (!deviceId) return '系统默认输入设备'
    return availableMicrophonesRef.current.find(item => item.deviceId === deviceId)?.label || '已选设备'
  }

  // 运行时配置里包含主进程托管服务状态，切换 OCR 后端后需要主动刷新一次。
  async function refreshRuntimeConfig() {
    const status = await window.bridgeApi.getConfigStatus()
    setRuntimeConfig(status)
    setConfigStatus(formatJson(status))
    if (status.shortcut) {
      setShortcutState(status.shortcut)
      if (status.shortcut.shortcut) setShortcutDraft(status.shortcut.shortcut)
    }
    return status
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
    window.bridgeApi.getAppSettings().then((settings) => {
      // 启动时先用主进程落盘的设置回填，再允许后续变更写回磁盘。
      setActiveMenu(settings.activeMenu || ACTIVE_MENU.developer)
      setSelectedProvider(settings.provider || 'qwen')
      setSenseVoiceEnabled(Boolean(settings.senseVoiceEnabled))
      setVoiceOcrBackend(normalizeVoiceOcrSelection(settings.voiceOcrBackend))
      setSpatialMemoryEnabled(settings.spatialMemoryEnabled !== false)
      setDictationEnabled(Boolean(settings.dictationEnabled))
      setPreferredLanguage(settings.preferredLanguage || 'auto')
      updateSelectedInputDeviceId(settings.microphoneId || '')
      settingsHydratedRef.current = true
      return refreshRuntimeConfig()
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
      // 连续听写开启时：按键切换主进程听写会话；关闭时维持原始"按键开始 / 再按结束"整段上传链路。
      if (dictationEnabledRef.current) {
        if (recording) {
          appendLog(`${shortcutLabel || '全局快捷键'}已触发，进入连续听写。`)
          await startDictationMode(true)
        } else {
          appendLog(`${shortcutLabel || '全局快捷键'}已触发，退出连续听写。`)
          await stopDictationMode('shortcut')
        }
        return
      }
      appendLog(`${shortcutLabel || '全局快捷键'}已触发，${recording ? '开始录音' : '停止录音'}。`)
      if (recording) await startRecording(true)
      else stopRecording(true, { recorder: recorderRef.current, mediaStream: mediaStreamRef.current })
    })
    const unsubscribeShortcutState = window.bridgeApi.onShortcutState((state) => setShortcutState(state))
    const unsubscribeVoiceLog = window.bridgeApi.onVoiceLog?.(({ message }) => appendLog(message)) || (() => {})
    const unsubscribeDictationEvent = window.bridgeApi.onDictationEvent?.((event) => handleDictationEvent(event)) || (() => {})

    return () => {
      unsubscribeToggle()
      unsubscribeShortcutState()
      unsubscribeVoiceLog()
      unsubscribeDictationEvent()
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange)
      if (dictationHandleRef.current) {
        void stopDictationMode('unmount')
      }
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

  // 渲染卸载时兜底回收常驻听写的 AudioContext 和 getUserMedia track，避免后台麦克风泄漏。
  useEffect(() => () => {
    if (dictationHandleRef.current) {
      dictationHandleRef.current.stop({ flushReason: 'unmount' }).catch(() => {})
      dictationHandleRef.current = null
      dictationActiveRef.current = false
    }
  }, [])

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

  // OCR 服务切换统一按 profile 生效，设置页、连续听写和开发者测试共用一份选择。
  async function applyCurrentOcrService() {
    try {
      setOcrServiceBusy(true)
      const profile = normalizeVoiceOcrSelection(voiceOcrBackendRef.current)
      const option = getVoiceOcrOption(profile)
      const result = await window.bridgeApi.applyOcrService({ profile })
      await refreshRuntimeConfig()
      appendLog(`已应用 OCR 服务：${option.label}。PP-OCR=${result.ppocr?.status || 'unknown'}(${result.ppocr?.device || '-'})，OmniParser=${result.omniparser?.status || 'unknown'}(${result.omniparser?.device || '-'})。`)
    } catch (error) {
      appendLog(`切换 OCR 服务失败: ${error.message || error}`)
    } finally {
      setOcrServiceBusy(false)
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

  // 右 Alt 链路专用：本地 ASR + 语音 FSM，不再走云端 LLM 动作解析。
  async function routeVoiceAudio(filePath, { languageOverride } = {}) {
    if (!filePath) return
    const currentVoiceOcrBackend = voiceOcrBackendRef.current
    const currentSpatialMemoryEnabled = spatialMemoryEnabledRef.current
    const currentLanguage = languageOverride ?? preferredLanguageRef.current
    appendLog(`语音路由开始：${filePath} · OCR=${currentVoiceOcrBackend} · 空间记忆=${currentSpatialMemoryEnabled ? 'on' : 'off'} · lang=${currentLanguage}`)
    try {
      const result = await window.bridgeApi.voiceHandleAudio({
        filePath,
        ocrBackend: currentVoiceOcrBackend,
        spatialMemoryEnabled: currentSpatialMemoryEnabled,
        language: currentLanguage,
      })
      const transcript = result?.transcript || ''
      setTranscript(transcript)
      const phase = result?.state?.phase || 'idle'
      const action = result?.routed?.action || (result?.routed?.handled ? 'handled' : 'no-trigger')
      appendLog(`ASR="${transcript}" → ${action} · phase=${phase}`)
      return { transcript, action, phase }
    } catch (error) {
      appendLog(`语音路由失败: ${error.message || error}`)
      window.bridgeApi.notifyOverlayState({
        status: 'executing', title: '语音路由失败', subtitle: String(error.message || error), autoResetMs: 4000,
      })
      return null
    }
  }

  async function startDictationMode(triggeredByShortcut = false) {
    if (dictationActiveRef.current) return
    dictationActiveRef.current = true
    setDictationActive(true)
    setDictationStatus('初始化主进程听写中...')
    setDictationPhase('idle')
    const deviceId = selectedInputDeviceIdRef.current
    const microphoneLabel = getSelectedMicrophoneLabel(deviceId)
    if (isHeadsetMicrophoneLabel(microphoneLabel)) {
      appendLog(`连续听写使用耳机麦克风：${microphoneLabel}。如果声卡切到通话模式音量异常，建议改用系统默认输入。`)
    }
    window.bridgeApi.notifyOverlayState({
      status: 'listening',
      title: '连续听写就绪',
      subtitle: triggeredByShortcut ? '再按同一快捷键结束' : '等待你开口',
      level: 0,
    })

    try {
      // 先在主进程里创建会话，再开始持续推 PCM，避免 renderer 先采到数据却没有接收端。
      const session = await window.bridgeApi.dictationStartSession({
        language: preferredLanguageRef.current,
        ocrBackend: voiceOcrBackendRef.current,
        spatialMemoryEnabled: spatialMemoryEnabledRef.current,
      })
      const handle = await startDictationPcmCapture({
        deviceId,
        logger: (message) => {
          appendLog(message)
          forwardVoiceDebugLog(message)
        },
        onChunk: (samples) => {
          window.bridgeApi.dictationPushChunk({
            sessionId: session.sessionId,
            sampleRate: session.sampleRate || 16000,
            samples,
          })
        },
        onLevel: (level) => {
          if (!dictationActiveRef.current) return
          window.bridgeApi.notifyOverlayState({
            status: 'listening',
            title: '连续听写中',
            subtitle: triggeredByShortcut ? '再按同一快捷键结束' : '等待你开口',
            level,
          })
        },
        onError: (error) => {
          appendLog(`连续听写采集出错: ${error.message || error}`)
          forwardVoiceDebugLog(`连续听写采集出错: ${error.message || error}`)
        },
      })
      dictationHandleRef.current = {
        ...handle,
        sessionId: session.sessionId,
      }
      appendLog(`连续听写已开启，主进程会话=${session.sessionId}，首选语言=${preferredLanguageRef.current}，输入设备=${microphoneLabel}。`)
    } catch (error) {
      // 启动中任一步失败都立刻回收主进程会话，避免残留半开状态。
      await window.bridgeApi.dictationStopSession({ reason: 'start-failed' }).catch(() => {})
      appendLog(`连续听写启动失败: ${error.message || error}`)
      dictationActiveRef.current = false
      setDictationActive(false)
      setDictationStatus(`启动失败: ${error.message || error}`)
      window.bridgeApi.notifyOverlayState({
        status: 'executing', title: '听写启动失败', subtitle: String(error.message || error), autoResetMs: 4000,
      })
    }
  }

  async function stopDictationMode(reason = 'manual') {
    const handle = dictationHandleRef.current
    dictationActiveRef.current = false
    setDictationActive(false)
    if (handle) {
      try {
        await handle.stop()
        await window.bridgeApi.dictationStopSession({
          sessionId: handle.sessionId,
          reason,
        })
      } catch (error) {
        appendLog(`停止连续听写出错: ${error.message || error}`)
      }
    } else {
      await window.bridgeApi.dictationStopSession({ reason }).catch(() => {})
    }
    dictationHandleRef.current = null
    setDictationStatus('已停止')
    setDictationPhase('idle')
    window.bridgeApi.notifyOverlayState({ status: 'idle', title: 'Voice Bridge', subtitle: '' })
    appendLog(`连续听写已停止 (${reason})。`)
  }

  function toggleDictationEnabled() {
    setDictationEnabled((current) => !current)
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
          // 右 Alt 链路：云端 LLM 动作解析暂时屏蔽，只走本地 SenseVoice → 语音 FSM（点击/打开 + 数字选择）。
          setTimeout(() => { routeVoiceAudio(tempPath) }, 10)
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
            <div><div className="section-label">Continuous Dictation</div><CardTitle>连续听写</CardTitle></div>
            <CardDescription>关闭时保持"按键开始 → 再按结束 → 整段上传"原始链路；开启时快捷键切换主进程连续听写会话，自动断句分别送 ASR。</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="settings-card">
              <div className="settings-card__row">
                <div className="settings-status">
                  <span className={`settings-status__dot ${dictationEnabled ? 'settings-status__dot--ok' : ''}`} />
                  <span>{dictationEnabled ? '连续听写模式已启用' : '连续听写模式未启用（原始整段模式）'}</span>
                </div>
                <button
                  type="button"
                  className={`ui-switch ${dictationEnabled ? 'ui-switch--checked' : ''}`}
                  aria-pressed={dictationEnabled}
                  onClick={toggleDictationEnabled}
                >
                  <span className="ui-switch__thumb" />
                </button>
              </div>
              <div className="helper-text">链路：getUserMedia → renderer 16k PCM 分块 → main 连续听写会话 → 每句 WAV → SenseVoice → voiceRouter。</div>
              <div className="helper-text">关闭时，按下录音键开始到再次按下结束之前，本地不做任何处理，只收集为完整一段后再上传。</div>
              <div className="helper-text">
                当前：{dictationActive ? `监听中 · 阶段=${DICTATION_PHASE_LABEL[dictationPhase] || dictationPhase}` : dictationStatus}
              </div>
              <div className="helper-text">
                当前断句：主进程按噪声基线、自适应能量阈值和句尾静音时间做轻量判定；后续若需要，再把更强的 VAD 补回主进程。
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div><div className="section-label">Preferred Language</div><CardTitle>首选语言</CardTitle></div>
            <CardDescription>SenseVoice 识别时使用的语言偏好。日常单语时固定能多拿 1~3% 精度；中英混说建议保持 auto。</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <label className="field">
              <span className="field__label">语言</span>
              <select
                className="ui-select"
                value={preferredLanguage}
                onChange={(event) => setPreferredLanguage(event.target.value)}
              >
                {PREFERRED_LANGUAGE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
            <div className="helper-text">
              {PREFERRED_LANGUAGE_OPTIONS.find((item) => item.value === preferredLanguage)?.hint || ''}
            </div>
            <div className="helper-text">切换实时生效：下一句识别就会按这里的语言走 SenseVoice。</div>
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
            <div><div className="section-label">Local OCR</div><CardTitle>语音点选 OCR 后端</CardTitle></div>
            <CardDescription>右 Alt 语音点选链路统一改为“后端 + 设备”四档；默认走 OmniParser GPU，且 OmniParser 当前固定走当前窗口截图。</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="settings-card">
              <div className="settings-card__row">
                <div className="settings-status">
                  <span className="settings-status__dot settings-status__dot--ok" />
                  <span>当前使用 {getVoiceOcrOption(voiceOcrBackend).label}</span>
                </div>
                <select className="ui-select" value={voiceOcrBackend} onChange={(event) => setVoiceOcrBackend(event.target.value)}>
                  {VOICE_OCR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="helper-text">
                当前说明：{getVoiceOcrOption(voiceOcrBackend).hint}
              </div>
              <div className="helper-text">
                支持选项：{Array.isArray(runtimeConfig?.voiceOcr?.options) ? runtimeConfig.voiceOcr.options.map((item) => item.label).join(' / ') : VOICE_OCR_OPTIONS.map((item) => item.label).join(' / ')}
              </div>
              <div className="helper-text">
                主进程当前 profile：{runtimeConfig?.voiceOcr?.profile || DEFAULT_VOICE_OCR_PROFILE}
              </div>
              <div className="helper-text">PP-OCR 服务：{runtimeConfig?.ppocr?.managed?.status || 'idle'} · device={runtimeConfig?.ppocr?.managed?.device || '-'}{runtimeConfig?.ppocr?.managed?.lastError ? ` · ${runtimeConfig.ppocr.managed.lastError}` : ''}</div>
              <div className="helper-text">OmniParser 服务：{runtimeConfig?.omniparser?.managed?.status || 'idle'} · device={runtimeConfig?.omniparser?.managed?.device || '-'}{runtimeConfig?.omniparser?.managed?.lastError ? ` · ${runtimeConfig.omniparser.managed.lastError}` : ''}</div>
              <div className="row">
                <Button variant="secondary" onClick={applyCurrentOcrService} disabled={ocrServiceBusy}>
                  {`启动 ${getVoiceOcrOption(voiceOcrBackend).label} 服务`}
                </Button>
                <Button variant="secondary" onClick={() => refreshRuntimeConfig().catch((error) => appendLog(`刷新 OCR 状态失败: ${error.message || error}`))} disabled={ocrServiceBusy}>
                  刷新 OCR 状态
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div><div className="section-label">Spatial Memory</div><CardTitle>空间记忆</CardTitle></div>
            <CardDescription>开启后，本地点选会记住“关键词 -&gt; 窗口内相对位置”，下次优先在当前前台窗口的小区域内做 OCR。</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="settings-card">
              <div className="settings-card__row">
                <div className="settings-status">
                  <span className={`settings-status__dot ${spatialMemoryEnabled ? 'settings-status__dot--ok' : ''}`} />
                  <span>{spatialMemoryEnabled ? '空间记忆已启用' : '空间记忆未启用'}</span>
                </div>
                <button
                  type="button"
                  className={`ui-switch ${spatialMemoryEnabled ? 'ui-switch--checked' : ''}`}
                  aria-pressed={spatialMemoryEnabled}
                  onClick={() => setSpatialMemoryEnabled((current) => !current)}
                >
                  <span className="ui-switch__thumb" />
                </button>
              </div>
              <div className="helper-text">工作方式：命中当前前台窗口里的历史记忆时，只截小区域做 OCR；失败后自动回退到原来的整屏截图链路。</div>
              <div className="helper-text">
                当前已记录：{runtimeConfig?.spatialMemory?.memoryCount ?? 0} 条记忆 / {runtimeConfig?.spatialMemory?.windowCount ?? 0} 个窗口 / {runtimeConfig?.spatialMemory?.appCount ?? 0} 个应用
              </div>
              <div className="helper-text">
                存储位置：{runtimeConfig?.spatialMemory?.filePath || '未初始化'}
              </div>
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
