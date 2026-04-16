import fsPromises from 'node:fs/promises'

const STORE_VERSION = 1

function buildEmptyStore() {
  return {
    version: STORE_VERSION,
    updatedAt: null,
    apps: {},
  }
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeWindowTitle(value) {
  return normalizeText(value)
    .replace(/\d+/g, '#')
}

function sanitizeSegment(value, fallback) {
  const normalized = normalizeText(value).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || fallback
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

// 应用级存储先把“命名 / habits / windows / memories”骨架搭起来，后续再逐步扩展策略。
export class AppSpatialMemoryStore {
  constructor(options = {}) {
    this.filePath = options.filePath
    this.data = buildEmptyStore()
  }

  async load() {
    if (!this.filePath) {
      throw new Error('缺少空间记忆文件路径。')
    }

    try {
      const content = await fsPromises.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(content)
      this.data = {
        version: STORE_VERSION,
        updatedAt: parsed?.updatedAt || null,
        apps: parsed?.apps && typeof parsed.apps === 'object' ? parsed.apps : {},
      }
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.data = buildEmptyStore()
        await this.save()
        return
      }
      throw error
    }
  }

  async save() {
    if (!this.filePath) {
      throw new Error('缺少空间记忆文件路径。')
    }

    const nextData = {
      ...this.data,
      version: STORE_VERSION,
      updatedAt: new Date().toISOString(),
    }
    const tempPath = `${this.filePath}.tmp`
    await fsPromises.writeFile(tempPath, JSON.stringify(nextData, null, 2), 'utf8')
    await fsPromises.rename(tempPath, this.filePath)
    this.data = nextData
  }

  buildStats() {
    const apps = Object.values(this.data.apps || {})
    let windowCount = 0
    let memoryCount = 0

    for (const app of apps) {
      const windows = Object.values(app?.windows || {})
      windowCount += windows.length
      for (const windowProfile of windows) {
        memoryCount += Object.keys(windowProfile?.memories || {}).length
      }
    }

    return {
      appCount: apps.length,
      windowCount,
      memoryCount,
      updatedAt: this.data.updatedAt,
      filePath: this.filePath,
    }
  }

  buildAppId(windowItem) {
    return sanitizeSegment(
      windowItem?.processPath || windowItem?.appName || windowItem?.className || 'unknown-app',
      'unknown-app',
    )
  }

  buildWindowKey(windowItem) {
    return `${this.buildAppId(windowItem)}::${sanitizeSegment(normalizeWindowTitle(windowItem?.title), 'window')}`
  }

  // 每个应用都保留命名与习惯字段，便于后续继续加别名、偏好窗口等策略。
  ensureAppProfile(windowItem) {
    const appId = this.buildAppId(windowItem)
    if (!this.data.apps[appId]) {
      this.data.apps[appId] = {
        appId,
        appName: windowItem?.appName || '',
        processPath: windowItem?.processPath || '',
        naming: {
          aliases: [],
        },
        habits: {},
        windows: {},
      }
    }

    const appProfile = this.data.apps[appId]
    if (windowItem?.appName && !appProfile.appName) appProfile.appName = windowItem.appName
    if (windowItem?.processPath && !appProfile.processPath) appProfile.processPath = windowItem.processPath
    return appProfile
  }

  ensureWindowProfile(windowItem) {
    const appProfile = this.ensureAppProfile(windowItem)
    const windowKey = this.buildWindowKey(windowItem)
    if (!appProfile.windows[windowKey]) {
      appProfile.windows[windowKey] = {
        windowKey,
        title: windowItem?.title || '',
        className: windowItem?.className || '',
        memories: {},
      }
    }

    const windowProfile = appProfile.windows[windowKey]
    if (windowItem?.title) windowProfile.title = windowItem.title
    if (windowItem?.className) windowProfile.className = windowItem.className
    return { appProfile, windowProfile }
  }

  getMemory(windowItem, keyword) {
    if (!windowItem || !keyword) return null
    const appProfile = this.data.apps[this.buildAppId(windowItem)]
    const windowProfile = appProfile?.windows?.[this.buildWindowKey(windowItem)]
    if (!windowProfile) return null
    return windowProfile.memories?.[normalizeText(keyword)] || null
  }

  // 记忆只保存相对窗口的位置与尺寸，避免窗口移动或缩放后立即失效。
  async rememberSelection(payload = {}) {
    const windowItem = payload.window
    const keyword = normalizeText(payload.keyword)
    const relativeRect = payload.relativeRect

    if (!windowItem || !keyword || !relativeRect) {
      return null
    }

    const { windowProfile } = this.ensureWindowProfile(windowItem)
    const current = windowProfile.memories[keyword] || {}
    windowProfile.memories[keyword] = {
      keyword,
      labelText: String(payload.labelText || ''),
      lastBackend: String(payload.backend || ''),
      lastMode: String(payload.mode || ''),
      hitCount: Number(current.hitCount || 0) + 1,
      updatedAt: new Date().toISOString(),
      relativeRect: {
        x: clamp01(relativeRect.x),
        y: clamp01(relativeRect.y),
        width: clamp01(relativeRect.width),
        height: clamp01(relativeRect.height),
      },
      windowSnapshot: {
        title: windowItem.title || '',
        appName: windowItem.appName || '',
        bounds: windowItem.bounds || null,
      },
    }
    await this.save()
    return windowProfile.memories[keyword]
  }
}
