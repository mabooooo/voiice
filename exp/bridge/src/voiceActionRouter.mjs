// 本地语音动作路由：维护一个极简 FSM。
// idle：等待“点击/打开/open/click X”触发词 → OCR 屏幕 → 列候选 → 进入 await_selection
// await_selection：等待数字（1-9 / 一 二 ... / 第几个） → 根据候选执行点击
//
// FSM 只存在主进程内存，依赖由 main.mjs 注入（截图、OCR、高亮、点击、日志）。

const TRIGGER_REGEX = /(?:点击|点一下|点下|打开|open|click)\s*[“”"'「『\[]?\s*([^“”"'」』\]。，,.!！?？\s]+)/i

const CN_DIGIT_MAP = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  yi: 1, er: 2, san: 3, si: 4, wu: 5, liu: 6, qi: 7, ba: 8, jiu: 9,
}

const MAX_CANDIDATES = 9
const AWAIT_TIMEOUT_MS = 15000

export function extractTrigger(text) {
  if (!text) return null
  const match = TRIGGER_REGEX.exec(text)
  if (!match) return null
  const keyword = String(match[1] || '').trim()
  if (!keyword) return null
  return { keyword, raw: match[0] }
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
  // deps: { captureAndOcr, highlightCandidates, clearIndicators, clickAt, logger, notifyOverlay }
  let state = { phase: 'idle', candidates: [], keyword: '', timer: null }

  function log(msg) {
    try { deps.logger?.(msg) } catch {}
  }

  function reset(reason) {
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = null
    }
    if (state.phase !== 'idle') {
      log(`[voice] reset -> idle (${reason || ''})`)
    }
    state = { phase: 'idle', candidates: [], keyword: '', timer: null }
    try { deps.clearIndicators?.() } catch {}
  }

  function armTimeout() {
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => reset('timeout'), AWAIT_TIMEOUT_MS)
  }

  async function handleTranscript(transcript) {
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
          await deps.clickAt?.(target.clickX, target.clickY)
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
      } else {
        log(`[voice] await_selection ignored: "${text}"`)
        return { handled: false, phase: 'await_selection', reason: 'no-digit' }
      }
    }

    // idle or just-reset: 检查触发词
    const trig = extractTrigger(text)
    if (!trig) {
      log(`[voice] no trigger in: "${text}"`)
      return { handled: false, reason: 'no-trigger' }
    }

    log(`[voice] trigger "${trig.keyword}" → OCR...`)
    deps.notifyOverlay?.({ status: 'waiting', title: `定位“${trig.keyword}”`, subtitle: '识别屏幕中...' })

    let ocr
    try {
      ocr = await deps.captureAndOcr()
    } catch (error) {
      log(`[voice] capture/ocr failed: ${error.message || error}`)
      deps.notifyOverlay?.({ status: 'executing', title: 'OCR 失败', subtitle: String(error.message || error), autoResetMs: 3500 })
      return { handled: true, action: 'ocr-error', error: String(error.message || error) }
    }

    const picks = pickCandidates(ocr.ocrLines, trig.keyword, MAX_CANDIDATES)
    if (picks.length === 0) {
      log(`[voice] no candidate for "${trig.keyword}" in ${ocr.ocrLines?.length || 0} lines`)
      deps.notifyOverlay?.({ status: 'executing', title: '未命中', subtitle: `屏幕上找不到“${trig.keyword}”`, autoResetMs: 3500 })
      reset('no-candidate')
      return { handled: true, action: 'no-candidate', keyword: trig.keyword }
    }

    // 把候选的 bbox（图像像素）映射为：1) 屏幕指示层坐标（逻辑像素） 2) 全局物理点击坐标
    const candidates = picks.map((item, index) => {
      const [x1, y1, x2, y2] = item.bbox
      const cx = (x1 + x2) / 2
      const cy = (y1 + y2) / 2
      return {
        index: index + 1,
        text: item.text,
        bbox: item.bbox,
        overlayRect: {
          left: Math.round(x1 / ocr.scaleFactor),
          top: Math.round(y1 / ocr.scaleFactor),
          width: Math.max(1, Math.round((x2 - x1) / ocr.scaleFactor)),
          height: Math.max(1, Math.round((y2 - y1) / ocr.scaleFactor)),
        },
        clickX: Math.round(ocr.originX + cx),
        clickY: Math.round(ocr.originY + cy),
      }
    })

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
    log(`[voice] await_selection with ${candidates.length} candidates for "${trig.keyword}"`)
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
