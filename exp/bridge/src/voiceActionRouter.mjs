// 本地语音动作路由：维护一个极简 FSM。
// idle：等待“点击/打开/open/click X”触发词 → OCR 屏幕/窗口 → 列候选 → 进入 await_selection
// await_selection：等待数字（1-9 / 一 二 ... / 第几个） → 根据候选执行点击
//
// FSM 只存在主进程内存，依赖由 main.mjs 注入（截图、OCR、高亮、点击、日志）。
// 坐标换算全部封装在 src/screenCoordinates.mjs：路由器只关心"语义候选 -> 点击目标"。

import { buildClickTargetFromSpaces } from './screenCoordinates.mjs'

const TRIGGER_REGEX = /(点击|点一下|点下|打开|open|click)\s*[“”"'「『\[]?\s*([^“”"'」』\]。，,.!！?？\s]+)/i
const VERB_POLICY = {
  点击: { scope: 'full-screen' },
  点一下: { scope: 'full-screen' },
  点下: { scope: 'full-screen' },
  click: { scope: 'full-screen' },
  打开: { scope: 'focused-window' },
  open: { scope: 'focused-window' },
}  // scope: 'focused-window' | 'full-screen'

const CN_DIGIT_MAP = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  yi: 1, er: 2, san: 3, si: 4, wu: 5, liu: 6, qi: 7, ba: 8, jiu: 9,
}

const MAX_CANDIDATES = 9
const AWAIT_TIMEOUT_MS = 15000

// 先做语法抽取，再通过动词策略补上后续 OCR 范围。
export function extractTrigger(text) {
  if (!text) return null
  const match = TRIGGER_REGEX.exec(text)
  if (!match) return null
  const verb = String(match[1] || '').trim().toLowerCase()
  const keyword = String(match[2] || '').trim()
  if (!keyword) return null
  const policy = VERB_POLICY[verb] || { scope: 'full-screen' }
  return {
    keyword,
    raw: match[0],
    verb,
    scope: policy.scope,
  }
}

// OmniParser 当前只走“当前窗口截图”，其余后端继续按动词策略决定截图范围。
function resolveCaptureScope(trigger, backend) {
  return String(backend || '').toLowerCase() === 'omniparser'
    ? 'focused-window'
    : (trigger?.scope || 'full-screen')
}

export function extractSelectionIndex(text) {
  if (!text) return null
  const normalized = String(text).trim()

  // 阿拉伯数字：只认 1-9 的单个数字（短句）
  const arabic = /(?<!\d)([1-9])(?!\d)/.exec(normalized)
  if (arabic) return Number(arabic[1])

  // 中文“第X个/项”或裸中文数字
  const cn = /第?\s*(一|二|两|三|四|五|六|七|八|九)\s*(?:个|项|号)?/.exec(normalized)
  if (cn && CN_DIGIT_MAP[cn[1]]) return CN_DIGIT_MAP[cn[1]]

  return null
}

// 在 OCR 行里挑出包含关键词的候选；score = 完整包含优先 + 行面积较小优先（避免整页命中）。
export function pickCandidates(ocrLines, keyword, limit = MAX_CANDIDATES) {
  const needle = String(keyword || '').toLowerCase()
  if (!needle) return []

  const scored = []
  for (const line of Array.isArray(ocrLines) ? ocrLines : []) {
    const text = String(line?.text || '')
    if (!text) continue
    const hay = text.toLowerCase()
    const idx = hay.indexOf(needle)
    if (idx < 0) continue

    const bbox = line.bbox || []
    if (bbox.length < 4) continue
    const [x1, y1, x2, y2] = bbox
    const width = Math.max(0, x2 - x1)
    const height = Math.max(0, y2 - y1)
    if (width <= 0 || height <= 0) continue
    const area = width * height

    // 完整等于或短文本命中优先；长文本命中降权。
    const lengthPenalty = Math.max(0, text.length - needle.length)
    const score = -lengthPenalty - area / 100000 + (hay === needle ? 5 : 0)

    scored.push({
      text,
      bbox: [x1, y1, x2, y2],
      score,
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

export function createVoiceActionRouter(deps) {
  // deps: { captureAndOcr, captureAndOcrFocusedWindow, resolveSpatialMemoryCandidate, rememberSpatialSelection, highlightCandidates, clearIndicators, clickAt, clickWindowPoint, logger, notifyOverlay }
  let state = { phase: 'idle', candidates: [], keyword: '', timer: null }

  function log(msg) {
    try { deps.logger?.(msg) } catch {}
  }

  function reset(reason) {
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }
    state = { phase: 'idle', candidates: [], keyword: '', timer: null }
    try { deps.clearIndicators?.() } catch {}
    void reason
  }

  // 单候选和确认态共用点击执行，保证两条路径的 overlay 表现一致。
  async function clickCandidate(target, title) {
    deps.notifyOverlay?.({ status: 'executing', title, subtitle: target.text, autoResetMs: 3000 })
    if (target.windowHandle && Number.isFinite(target.localClickX) && Number.isFinite(target.localClickY)) {
      await deps.clickWindowPoint?.(target.windowHandle, target.localClickX, target.localClickY)
      return
    }
    await deps.clickAt?.(target.clickX, target.clickY)
  }

  // 点击完成后再异步回写空间记忆，不阻塞当前动作落地。
  async function persistSpatialMemory(keyword, target, options = {}) {
    if (!options.spatialMemoryEnabled || !keyword || !target) {
      if (!options.spatialMemoryEnabled) {
        log('[voice] spatial-memory disabled: skip save')
      } else {
        log('[voice] spatial-memory skip save: missing keyword or target')
      }
      return
    }

    try {
      await deps.rememberSpatialSelection?.({
        keyword,
        target,
        backend: options.backend,
        mode: options.mode || target.source || 'full-ocr',
      })
    } catch (error) {
      log(`[voice] spatial-memory save failed: ${error.message || error}`)
    }
  }

  function armTimeout() {
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => reset('timeout'), AWAIT_TIMEOUT_MS)
  }

  // 所有坐标空间由 ocr.mapImageRectToSpaces 负责（window OCR / 整屏 OCR 走同一接口）。
  // 路由器只把空间信息拼成候选需要的 { clickX/Y, localClickX/Y, logicalRect, overlayRect }。
  function mapOcrPicksToCandidates(ocr, picks) {
    const source = ocr.windowHandle ? 'focused-window-ocr' : 'full-ocr'
    return picks.map((item, index) => {
      const [x1, y1, x2, y2] = item.bbox
      const spaces = ocr.mapImageRectToSpaces?.({
        x: x1,
        y: y1,
        width: x2 - x1,
        height: y2 - y1,
      })
      if (!spaces) return null

      const clickTarget = buildClickTargetFromSpaces(spaces, { windowHandle: ocr.windowHandle })
      // 整屏 OCR 没有显示器相对的 overlay，用 globalLogical 减去 displayBounds 兜底。
      const overlay = spaces.overlay || (ocr.displayBounds
        ? {
          left: spaces.globalLogical.left - ocr.displayBounds.x,
          top: spaces.globalLogical.top - ocr.displayBounds.y,
          width: spaces.globalLogical.width,
          height: spaces.globalLogical.height,
        }
        : null)

      return {
        index: index + 1,
        text: item.text,
        bbox: item.bbox,
        source,
        ...clickTarget,
        logicalRect: spaces.globalLogical,
        overlayRect: overlay
          ? {
            left: Math.round(overlay.left),
            top: Math.round(overlay.top),
            width: Math.max(1, Math.round(overlay.width)),
            height: Math.max(1, Math.round(overlay.height)),
          }
          : null,
      }
    }).filter(Boolean)
  }

  async function handleTranscript(transcript, options = {}) {
    const text = String(transcript || '').trim()
    if (!text) {
      return { handled: false, reason: 'empty' }
    }

    if (state.phase === 'await_selection') {
      const idx = extractSelectionIndex(text)
      if (idx && idx >= 1 && idx <= state.candidates.length) {
        const target = state.candidates[idx - 1]
        log(`[voice] selection=${idx} -> click "${target.text}" @ (${target.clickX},${target.clickY})`)
        deps.notifyOverlay?.({ status: 'executing', title: `点击 ${idx}`, subtitle: target.text, autoResetMs: 3000 })
        try {
          await clickCandidate(target, `点击 ${idx}`)
          await persistSpatialMemory(state.keyword, target, {
            ...options,
            mode: target.source || 'selection',
          })
          reset('clicked')
          return { handled: true, action: 'click', index: idx, target }
        } catch (error) {
          log(`[voice] click failed: ${error.message || error}`)
          reset('click-error')
          return { handled: true, action: 'click-error', error: String(error.message || error) }
        }
      }

      // 可能是又说了新触发词，允许重入
      const triggerRetry = extractTrigger(text)
      if (triggerRetry) {
        reset('retrigger')
        log(`[voice] retrigger 新触发词，允许重入: "${text}"`)
      } else {
        return { handled: false, phase: 'await_selection', reason: 'no-digit' }
      }
    }

    // idle or just-reset: 检查触发词
    const trig = extractTrigger(text)
    if (!trig) {
      log(`[voice] no trigger in: "${text}"`)
      return { handled: false, reason: 'no-trigger' }
    }
    
    const backend = String(options.backend || 'omniparser').toLowerCase()
    const captureScope = resolveCaptureScope(trig, backend)

    log(`[voice] trigger "${trig.keyword}" → OCR...`)
    log(`[voice] route options: backend=${backend} spatialMemory=${options.spatialMemoryEnabled ? 'on' : 'off'} scope=${captureScope}`)
    deps.notifyOverlay?.({
      status: 'waiting',
      title: `定位“${trig.keyword}”`,
      subtitle: captureScope === 'focused-window' ? '识别当前窗口中...' : '识别屏幕中...',
    })

    if (options.spatialMemoryEnabled) {
      try {
        const memoryTarget = await deps.resolveSpatialMemoryCandidate?.({
          keyword: trig.keyword,
          backend: options.backend,
        })
        if (memoryTarget) {
          log(`[voice] spatial-memory direct click "${trig.keyword}" -> "${memoryTarget.text}"`)
          await clickCandidate(memoryTarget, '记忆点击')
          reset('clicked')
          return { handled: true, action: 'click', target: memoryTarget, fromMemory: true }
        }
      } catch (error) {
        log(`[voice] spatial-memory failed: ${error.message || error}`)
      }
    } else {
      log('[voice] spatial-memory disabled: skip lookup')
    }

    let ocr
    try {
      // OmniParser 目前统一走当前窗口截图；其余后端保持原有窗口/整屏分流。
      ocr = captureScope === 'focused-window'
        ? await deps.captureAndOcrFocusedWindow?.({ backend: options.backend })
        : await deps.captureAndOcr({ backend: options.backend })
    } catch (error) {
      log(`[voice] capture+ocr failed: ${error.message || error}`)
      deps.notifyOverlay?.({ status: 'executing', title: 'OCR 失败', subtitle: String(error.message || error), autoResetMs: 3500 })
      return { handled: true, action: 'ocr-error', error: String(error.message || error) }
    }

    const picks = pickCandidates(ocr.ocrLines, trig.keyword, MAX_CANDIDATES)
    if (picks.length === 0) {
      log(`[voice] no candidate for "${trig.keyword}" in ${ocr.ocrLines?.length || 0} lines`)
      deps.notifyOverlay?.({ status: 'executing', title: '未命中', subtitle: `${captureScope === 'focused-window' ? '当前窗口' : '屏幕'}上找不到“${trig.keyword}”`, autoResetMs: 3500 })
      reset('no-candidate')
      return { handled: true, action: 'no-candidate', keyword: trig.keyword }
    }

    const candidates = mapOcrPicksToCandidates(ocr, picks)

    // 只有一个候选时直接点击，避免多余的确认轮次。
    if (candidates.length === 1) {
      try {
        await clickCandidate(candidates[0], '直接点击')
        await persistSpatialMemory(trig.keyword, candidates[0], {
          ...options,
          mode: candidates[0].source || 'single',
        })
        reset('clicked')
        return { handled: true, action: 'click', index: 1, target: candidates[0], autoSelected: true }
      } catch (error) {
        log(`[voice] click failed: ${error.message || error}`)
        reset('click-error')
        return { handled: true, action: 'click-error', error: String(error.message || error) }
      }
    }

    try {
      await deps.highlightCandidates?.({ displayId: ocr.displayId, items: candidates })
    } catch (error) {
      log(`[voice] highlight failed: ${error.message || error}`)
    }

    state = {
      phase: 'await_selection',
      candidates,
      keyword: trig.keyword,
      timer: null,
    }
    armTimeout()
    deps.notifyOverlay?.({
      status: 'executing',
      title: `定位到 ${candidates.length} 项`,
      subtitle: `说出屏幕上备选项的序号${candidates.length}`,
      autoResetMs: AWAIT_TIMEOUT_MS,
    })
    return { handled: true, action: 'await_selection', keyword: trig.keyword, candidates }
  }

  return {
    handleTranscript,
    reset,
    getState: () => ({ phase: state.phase, candidateCount: state.candidates.length, keyword: state.keyword }),
  }
}
