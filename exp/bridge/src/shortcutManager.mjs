import fsPromises from 'node:fs/promises'

import { UiohookKey, uIOhook } from 'uiohook-napi'

const DEFAULT_SHORTCUT = {
  code: 'AltRight',
  label: '右 Alt',
  modifiers: {
    alt: false,
    ctrl: false,
    shift: false,
    meta: false,
  },
}

const KEYCODE_BY_CODE = {
  AltLeft: UiohookKey.Alt,
  AltRight: UiohookKey.AltRight,
  ShiftLeft: UiohookKey.Shift,
  ShiftRight: UiohookKey.ShiftRight,
  ControlLeft: UiohookKey.Ctrl,
  ControlRight: UiohookKey.CtrlRight,
  MetaLeft: UiohookKey.Meta,
  MetaRight: UiohookKey.MetaRight,
  Space: UiohookKey.Space,
  Enter: UiohookKey.Enter,
  Escape: UiohookKey.Escape,
  Tab: UiohookKey.Tab,
  Backspace: UiohookKey.Backspace,
  Delete: UiohookKey.Delete,
  ArrowUp: UiohookKey.ArrowUp,
  ArrowDown: UiohookKey.ArrowDown,
  ArrowLeft: UiohookKey.ArrowLeft,
  ArrowRight: UiohookKey.ArrowRight,
}

for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  KEYCODE_BY_CODE[`Key${letter}`] = UiohookKey[letter]
}

for (let index = 0; index <= 9; index += 1) {
  KEYCODE_BY_CODE[`Digit${index}`] = UiohookKey[String(index)]
}

for (let index = 1; index <= 12; index += 1) {
  KEYCODE_BY_CODE[`F${index}`] = UiohookKey[`F${index}`]
}

const SPECIAL_LABELS = {
  AltLeft: '左 Alt',
  AltRight: '右 Alt',
  ShiftLeft: '左 Shift',
  ShiftRight: '右 Shift',
  ControlLeft: '左 Ctrl',
  ControlRight: '右 Ctrl',
  MetaLeft: '左 Win',
  MetaRight: '右 Win',
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
}

function buildPrimaryLabel(code) {
  if (SPECIAL_LABELS[code]) {
    return SPECIAL_LABELS[code]
  }

  if (code.startsWith('Key')) {
    return code.slice(3).toUpperCase()
  }

  if (code.startsWith('Digit')) {
    return code.slice(5)
  }

  return code
}

function normalizeModifiers(code, modifiers) {
  const normalized = {
    alt: Boolean(modifiers?.alt),
    ctrl: Boolean(modifiers?.ctrl),
    shift: Boolean(modifiers?.shift),
    meta: Boolean(modifiers?.meta),
  }

  // 主键本身是修饰键时，不重复把自己计入组合修饰符。
  if (code.startsWith('Alt')) {
    normalized.alt = false
  }
  if (code.startsWith('Control')) {
    normalized.ctrl = false
  }
  if (code.startsWith('Shift')) {
    normalized.shift = false
  }
  if (code.startsWith('Meta')) {
    normalized.meta = false
  }

  return normalized
}

export function buildShortcutLabel(candidate) {
  if (!candidate?.code) {
    return '未设置'
  }

  const modifiers = normalizeModifiers(candidate.code, candidate.modifiers)
  const tokens = []

  if (modifiers.ctrl) {
    tokens.push('Ctrl')
  }
  if (modifiers.shift) {
    tokens.push('Shift')
  }
  if (modifiers.alt) {
    tokens.push('Alt')
  }
  if (modifiers.meta) {
    tokens.push('Win')
  }

  tokens.push(buildPrimaryLabel(candidate.code))
  return tokens.join(' + ')
}

function normalizeShortcutCandidate(candidate) {
  const code = String(candidate?.code || '').trim()
  const keycode = KEYCODE_BY_CODE[code]
  if (!code || !keycode) {
    throw new Error(`Unsupported shortcut code: ${code || 'unknown'}`)
  }

  const modifiers = normalizeModifiers(code, candidate?.modifiers)

  return {
    code,
    keycode,
    modifiers,
    label: buildShortcutLabel({ code, modifiers }),
  }
}

function buildEventLabel(event) {
  const entry = Object.entries(KEYCODE_BY_CODE).find(([, value]) => value === event.keycode)
  if (!entry) {
    return `keycode:${event.keycode}`
  }

  return buildShortcutLabel({
    code: entry[0],
    modifiers: {
      alt: Boolean(event.altKey),
      ctrl: Boolean(event.ctrlKey),
      shift: Boolean(event.shiftKey),
      meta: Boolean(event.metaKey),
    },
  })
}

export class GlobalShortcutManager {
  constructor({ configPath, onToggle, onStateChange }) {
    this.configPath = configPath
    this.onToggle = onToggle
    this.onStateChange = onStateChange
    this.currentShortcut = normalizeShortcutCandidate(DEFAULT_SHORTCUT)
    this.pressedKeys = new Set()
    this.comboArmed = false
    this.enabled = false
    this.error = ''
    this.lastTriggeredAt = ''
    this.lastDetectedLabel = ''

    this.handleKeydown = this.handleKeydown.bind(this)
    this.handleKeyup = this.handleKeyup.bind(this)
  }

  getState() {
    return {
      provider: 'uiohook-napi',
      enabled: this.enabled,
      error: this.error,
      shortcut: this.currentShortcut,
      shortcutLabel: this.currentShortcut.label,
      lastDetectedLabel: this.lastDetectedLabel,
      lastTriggeredAt: this.lastTriggeredAt,
    }
  }

  emitState() {
    this.onStateChange?.(this.getState())
  }

  async start() {
    await this.loadConfig()

    try {
      uIOhook.on('keydown', this.handleKeydown)
      uIOhook.on('keyup', this.handleKeyup)
      uIOhook.start()
      this.enabled = true
      this.error = ''
    } catch (error) {
      this.enabled = false
      this.error = String(error?.message || error)
    }

    this.emitState()
  }

  stop() {
    try {
      uIOhook.off('keydown', this.handleKeydown)
      uIOhook.off('keyup', this.handleKeyup)
      uIOhook.stop()
    } catch {}

    this.enabled = false
    this.emitState()
  }

  async loadConfig() {
    try {
      const content = await fsPromises.readFile(this.configPath, 'utf8')
      const parsed = JSON.parse(content)
      this.currentShortcut = normalizeShortcutCandidate(parsed)
    } catch {
      this.currentShortcut = normalizeShortcutCandidate(DEFAULT_SHORTCUT)
    }
  }

  async persistConfig() {
    const payload = {
      code: this.currentShortcut.code,
      modifiers: this.currentShortcut.modifiers,
      label: this.currentShortcut.label,
    }

    await fsPromises.writeFile(this.configPath, JSON.stringify(payload, null, 2), 'utf8')
  }

  async updateShortcut(candidate) {
    // 配置更新后立即落盘，并向前端回推“是否已经生效”状态。
    this.currentShortcut = normalizeShortcutCandidate(candidate)
    await this.persistConfig()
    this.error = ''
    this.emitState()
    return this.getState()
  }

  getExpectedKeycodes() {
    const expected = [this.currentShortcut.keycode]
    if (this.currentShortcut.modifiers.ctrl) {
      expected.push(UiohookKey.Ctrl)
      expected.push(UiohookKey.CtrlRight)
    }
    if (this.currentShortcut.modifiers.shift) {
      expected.push(UiohookKey.Shift)
      expected.push(UiohookKey.ShiftRight)
    }
    if (this.currentShortcut.modifiers.alt) {
      expected.push(UiohookKey.Alt)
      expected.push(UiohookKey.AltRight)
    }
    if (this.currentShortcut.modifiers.meta) {
      expected.push(UiohookKey.Meta)
      expected.push(UiohookKey.MetaRight)
    }

    return expected
  }

  matchesEvent(event) {
    const shortcut = this.currentShortcut
    if (event.keycode !== shortcut.keycode) {
      return false
    }

    // 组合键用事件上的修饰符做最终校验，避免误触发邻近按键。
    if (shortcut.modifiers.ctrl && !event.ctrlKey) {
      return false
    }
    if (shortcut.modifiers.shift && !event.shiftKey) {
      return false
    }
    if (shortcut.modifiers.alt && !event.altKey) {
      return false
    }
    if (shortcut.modifiers.meta && !event.metaKey) {
      return false
    }

    return true
  }

  handleKeydown(event) {
    this.pressedKeys.add(event.keycode)
    this.lastDetectedLabel = buildEventLabel(event)

    if (this.matchesEvent(event)) {
      this.comboArmed = true
      this.emitState()
    }
  }

  handleKeyup(event) {
    const shouldToggle = this.comboArmed && this.matchesEvent(event)
    this.pressedKeys.delete(event.keycode)
    this.comboArmed = false

    if (!shouldToggle) {
      return
    }

    this.lastTriggeredAt = new Date().toISOString()
    this.onToggle?.({
      shortcut: this.currentShortcut,
      triggeredLabel: this.currentShortcut.label,
    })
    this.emitState()
  }
}
