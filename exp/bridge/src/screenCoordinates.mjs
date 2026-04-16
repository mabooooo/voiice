// 屏幕 / 窗口 / 截图 像素空间统一换算。
//
// 约定：
//   - OCR bbox、image width/height 都是“物理像素”（窗口截图 PS 里已 SetProcessDpiAware）。
//   - windowItem.bounds / display.bounds 是“逻辑像素”（Electron screen API、未声明 DPI 感知的 PS）。
//   - display.nativeOrigin 是“物理像素”（Electron 明确给出的原生物理原点）。
//   - relativeRect 是 [0,1] 的归一化比例，相对窗口逻辑尺寸。
//
// 使用者：main.mjs（截图 / OCR / 空间记忆）、voiceActionRouter.mjs（候选换算）。

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

// 居中点，统一一下避免各处重复写 (x1+x2)/2。
export function rectCenter(rect) {
  if (!rect) return null
  const width = Number.isFinite(rect.width) ? rect.width : 0
  const height = Number.isFinite(rect.height) ? rect.height : 0
  const x = Number.isFinite(rect.x) ? rect.x : (rect.left ?? 0)
  const y = Number.isFinite(rect.y) ? rect.y : (rect.top ?? 0)
  return {
    x: x + width / 2,
    y: y + height / 2,
  }
}

// 窗口截图里一块矩形 -> 所有常用空间。
//   rect          图像像素（物理）
//   windowBounds  窗口矩形（逻辑）
//   imageSize     截图尺寸（物理）
//   displayBounds 承载显示器的 bounds（逻辑，用来生成 overlay 相对坐标）
//
// 返回值字段：
//   scaleX/Y            DPI 缩放系数 (物理/逻辑)
//   windowLocalPhysical 窗口内物理像素矩形 = 直接可喂 clickWindowLocalPoint
//   windowLocalLogical  窗口内逻辑像素矩形
//   globalLogical       全局屏幕空间的逻辑矩形 = 供 findBestWindowForPoint / 记忆回写
//   overlay             相对 display.bounds 原点的逻辑矩形 = 供透明高亮层
export function mapWindowImageRect({ rect, windowBounds, imageSize, displayBounds }) {
  if (!rect || !windowBounds?.width || !windowBounds?.height || !imageSize?.width || !imageSize?.height) {
    return null
  }

  const scaleX = imageSize.width / Math.max(1, windowBounds.width)
  const scaleY = imageSize.height / Math.max(1, windowBounds.height)
  const physicalWidth = Math.max(1, rect.width)
  const physicalHeight = Math.max(1, rect.height)
  const logicalWidth = Math.max(1, physicalWidth / scaleX)
  const logicalHeight = Math.max(1, physicalHeight / scaleY)

  const windowLocalPhysical = {
    left: rect.x,
    top: rect.y,
    width: physicalWidth,
    height: physicalHeight,
  }
  const windowLocalLogical = {
    left: rect.x / scaleX,
    top: rect.y / scaleY,
    width: logicalWidth,
    height: logicalHeight,
  }
  const globalLogical = {
    left: windowBounds.x + windowLocalLogical.left,
    top: windowBounds.y + windowLocalLogical.top,
    width: logicalWidth,
    height: logicalHeight,
  }
  const overlay = displayBounds
    ? {
      left: globalLogical.left - displayBounds.x,
      top: globalLogical.top - displayBounds.y,
      width: logicalWidth,
      height: logicalHeight,
    }
    : null

  return {
    scaleX,
    scaleY,
    windowLocalPhysical,
    windowLocalLogical,
    globalLogical,
    overlay,
  }
}

// 整屏截图里一块矩形 -> 全局逻辑 + overlay + 物理点击坐标。
//   rect      图像像素（物理）
//   display   Electron Display 对象（需要 bounds + nativeOrigin）
//   imageSize 截图尺寸（物理）
//
// 返回值字段：
//   scaleFactor         DPI 缩放系数 (物理/逻辑)
//   globalLogical       全局屏幕空间的逻辑矩形
//   overlay             相对 display.bounds 原点的逻辑矩形
//   globalPhysicalClick bbox 中心的全局物理点 = 直接可喂 clickAt
export function mapFullScreenImageRect({ rect, display, imageSize }) {
  if (!rect || !display?.bounds?.width || !imageSize?.width || !imageSize?.height) {
    return null
  }

  const scaleFactor = imageSize.width / Math.max(1, display.bounds.width)
  const origin = display.nativeOrigin || display.bounds
  const logicalWidth = Math.max(1, rect.width / scaleFactor)
  const logicalHeight = Math.max(1, rect.height / scaleFactor)

  const overlay = {
    left: rect.x / scaleFactor,
    top: rect.y / scaleFactor,
    width: logicalWidth,
    height: logicalHeight,
  }
  const globalLogical = {
    left: display.bounds.x + overlay.left,
    top: display.bounds.y + overlay.top,
    width: logicalWidth,
    height: logicalHeight,
  }
  const center = rectCenter(rect)
  const globalPhysicalClick = {
    x: origin.x + center.x,
    y: origin.y + center.y,
  }

  return {
    scaleFactor,
    globalLogical,
    overlay,
    globalPhysicalClick,
  }
}

// 归一化窗口相对矩形 -> 窗口内逻辑矩形。minSize 兜底让搜索区域不会坍缩成 0。
export function relativeRectToWindowLocal(relativeRect, windowBounds, options = {}) {
  if (!relativeRect || !windowBounds?.width || !windowBounds?.height) {
    return null
  }
  const minSize = Math.max(0, Number(options.minSize) || 0)
  return {
    x: relativeRect.x * windowBounds.width,
    y: relativeRect.y * windowBounds.height,
    width: Math.max(minSize, relativeRect.width * windowBounds.width),
    height: Math.max(minSize, relativeRect.height * windowBounds.height),
  }
}

// 全局逻辑矩形 -> 窗口相对矩形 [0..1]，供空间记忆保存。
export function globalLogicalRectToRelative(logicalRect, windowBounds) {
  if (!logicalRect || !windowBounds?.width || !windowBounds?.height) {
    return null
  }
  return {
    x: clamp((logicalRect.left - windowBounds.x) / windowBounds.width, 0, 1),
    y: clamp((logicalRect.top - windowBounds.y) / windowBounds.height, 0, 1),
    width: clamp(logicalRect.width / windowBounds.width, 0, 1),
    height: clamp(logicalRect.height / windowBounds.height, 0, 1),
  }
}

// 把 mapWindowImageRect / mapFullScreenImageRect 的结果拉平成候选里“点击相关”的字段。
// voiceActionRouter 直接消费这个，不再关心 coordinateSpace。
export function buildClickTargetFromSpaces(spaces, { windowHandle } = {}) {
  if (!spaces) return null

  if (spaces.windowLocalPhysical) {
    const center = rectCenter({
      x: spaces.windowLocalPhysical.left,
      y: spaces.windowLocalPhysical.top,
      width: spaces.windowLocalPhysical.width,
      height: spaces.windowLocalPhysical.height,
    })
    return {
      windowHandle: windowHandle || null,
      localClickX: Math.round(center.x),
      localClickY: Math.round(center.y),
      // 全局逻辑坐标仅用于 findBestWindowForPoint / 记忆回写，不直接点击。
      clickX: Math.round(spaces.globalLogical.left + spaces.globalLogical.width / 2),
      clickY: Math.round(spaces.globalLogical.top + spaces.globalLogical.height / 2),
    }
  }

  if (spaces.globalPhysicalClick) {
    return {
      windowHandle: null,
      localClickX: null,
      localClickY: null,
      clickX: Math.round(spaces.globalPhysicalClick.x),
      clickY: Math.round(spaces.globalPhysicalClick.y),
    }
  }

  return null
}
