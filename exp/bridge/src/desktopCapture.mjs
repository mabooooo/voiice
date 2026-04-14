import fsPromises from 'node:fs/promises'
import path from 'node:path'

import { desktopCapturer, screen } from 'electron'

function buildTimestampToken(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

function buildDisplayLabel(display, displayIndex) {
  const sizeLabel = `${display.size.width}x${display.size.height}`
  if (display.label) return `${display.label} · ${sizeLabel}`
  return `显示器 ${displayIndex} · ${sizeLabel}`
}

function buildThumbnailSize(displays, options) {
  const { compressed, maxHeight } = options
  if (compressed) {
    const width = Math.max(...displays.map((display) => {
      const sourceHeight = Math.max(1, Math.round(display.size.height * display.scaleFactor))
      const sourceWidth = Math.max(1, Math.round(display.size.width * display.scaleFactor))
      return Math.max(1, Math.round(sourceWidth * (maxHeight / sourceHeight)))
    }))

    return {
      width,
      height: maxHeight,
    }
  }

  return {
    width: Math.max(...displays.map(display => Math.max(1, Math.round(display.size.width * display.scaleFactor)))),
    height: Math.max(...displays.map(display => Math.max(1, Math.round(display.size.height * display.scaleFactor)))),
  }
}

async function readDisplaySnapshots(options) {
  const displays = screen.getAllDisplays().sort((left, right) => {
    if (left.bounds.x !== right.bounds.x) return left.bounds.x - right.bounds.x
    return left.bounds.y - right.bounds.y
  })
  const primaryDisplayId = screen.getPrimaryDisplay().id
  const thumbnailSize = buildThumbnailSize(displays, options)

  // 多屏场景只抓一次 source 列表，避免逐屏重复编码造成额外 CPU 开销。
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
    fetchWindowIcons: false,
  })

  const sourceByDisplayId = new Map(sources.map(source => [source.display_id, source]))
  return displays.map((display, index) => {
    const source = sourceByDisplayId.get(String(display.id))
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error(`未能获取显示器 ${index + 1} 的截图，请确认当前桌面会话可用。`)
    }

    return {
      id: display.id,
      index,
      isPrimary: display.id === primaryDisplayId,
      display,
      image: source.thumbnail,
    }
  })
}

function buildPreviewDataUrl(image) {
  const { width } = image.getSize()
  if (width <= 520) return image.toDataURL()
  return image.resize({ width: 520 }).toDataURL()
}

function buildCaptureFileName({ compressed, index, timestamp }) {
  return `desktop-${compressed ? '720p' : 'full'}-d${index + 1}-${timestamp}.${compressed ? 'jpg' : 'png'}`
}

function buildFinalImage(snapshot, options) {
  const { compressed, maxHeight } = options
  if (!compressed || snapshot.image.getSize().height <= maxHeight) {
    return snapshot.image
  }

  // 压缩模式只压高度，既能控体积，也能保留桌面布局结构。
  return snapshot.image.resize({ height: maxHeight })
}

function serializeCaptureItem(snapshot, finalImage, buffer, savedPath) {
  const { width, height } = finalImage.getSize()
  return {
    displayId: snapshot.id,
    displayIndex: snapshot.index + 1,
    isPrimary: snapshot.isPrimary,
    displayLabel: buildDisplayLabel(snapshot.display, snapshot.index + 1),
    savedPath,
    width,
    height,
    byteLength: buffer.length,
    previewDataUrl: buildPreviewDataUrl(finalImage),
  }
}

export async function captureDesktopScreenshots(options = {}) {
  const {
    outputDir,
    compressed = false,
    maxHeight = 720,
    jpegQuality = 82,
  } = options

  if (!outputDir) {
    throw new Error('缺少本地保存目录。')
  }

  const snapshots = await readDisplaySnapshots({ compressed, maxHeight })
  await fsPromises.mkdir(outputDir, { recursive: true })

  const timestamp = buildTimestampToken()
  const items = []

  for (const snapshot of snapshots) {
    const finalImage = buildFinalImage(snapshot, { compressed, maxHeight })
    const buffer = compressed ? finalImage.toJPEG(jpegQuality) : finalImage.toPNG()
    const savedPath = path.join(outputDir, buildCaptureFileName({
      compressed,
      index: snapshot.index,
      timestamp,
    }))

    await fsPromises.writeFile(savedPath, buffer)
    items.push(serializeCaptureItem(snapshot, finalImage, buffer, savedPath))
  }

  return {
    ok: true,
    compressed,
    outputDir,
    format: compressed ? 'JPG' : 'PNG',
    displayCount: items.length,
    totalBytes: items.reduce((sum, item) => sum + item.byteLength, 0),
    createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    items,
  }
}

export async function captureDesktopScreenshot(options = {}) {
  const result = await captureDesktopScreenshots(options)
  return {
    ...result,
    item: result.items[0] || null,
  }
}
