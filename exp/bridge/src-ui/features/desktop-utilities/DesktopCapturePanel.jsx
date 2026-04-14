import { useState } from 'react'

import { Button } from '@/components/ui/button'

// 桌面截图能力独立收口，后续可在任意页面复用，不依赖开发者模式本身。
const INITIAL_CAPTURE_STATE = {
  items: [],
  outputDir: '',
  createdAt: '',
  totalBytes: 0,
  displayCount: 0,
  compressed: false,
  format: '',
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

function DesktopCaptureList({ items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <div className="helper-text">尚未生成桌面截图。</div>
  }

  return (
    <div className="desktop-capture-grid">
      {items.map((item) => (
        <article key={`${item.displayId}-${item.savedPath}`} className="desktop-capture-card">
          <div className="desktop-capture-card__title">
            <span>{item.displayLabel}</span>
            {item.isPrimary ? <span className="desktop-capture-card__badge">主屏</span> : null}
          </div>
          <img className="desktop-capture-card__image" src={item.previewDataUrl} alt={item.displayLabel} />
          <div className="desktop-capture-card__meta">{item.width}x{item.height} · {formatBytes(item.byteLength)}</div>
          <div className="desktop-capture-card__path">{item.savedPath}</div>
        </article>
      ))}
    </div>
  )
}

export function DesktopCapturePanel({ onLog }) {
  const [captureState, setCaptureState] = useState(INITIAL_CAPTURE_STATE)
  const [captureBusy, setCaptureBusy] = useState(false)

  async function handleCapture(compressed) {
    setCaptureBusy(true)
    try {
      // 截图统一走主进程，避免 renderer 侧持有大图数据处理逻辑。
      const result = await window.bridgeApi.captureDesktopScreenshot({
        compressed,
        maxHeight: 640,
      })
      setCaptureState(result)
      onLog?.(`桌面截图已保存，共 ${result.displayCount} 张，输出目录: ${result.outputDir}`)
    } catch (error) {
      onLog?.(`桌面截图失败: ${error.message || error}`)
    } finally {
      setCaptureBusy(false)
    }
  }

  return (
    <section className="subpanel">
      <div className="side-section__row">
        <div>
          <div className="subpanel__title">Desktop Analysis</div>
          <div className="helper-text">检测到多屏时会按显示器分别保存，不会合成超大长图。</div>
        </div>
        <div className="desktop-capture-actions">
          <Button variant="secondary" onClick={() => handleCapture(false)} disabled={captureBusy}>
            {captureBusy ? '处理中...' : '截图保存'}
          </Button>
          <Button onClick={() => handleCapture(true)} disabled={captureBusy}>
            {captureBusy ? '处理中...' : '压缩截图 640P'}
          </Button>
        </div>
      </div>
      <div className="helper-text">
        {captureState.createdAt
          ? `最近输出：${captureState.createdAt} · ${captureState.displayCount} 屏 · ${captureState.format} · ${formatBytes(captureState.totalBytes)} · ${captureState.outputDir}`
          : '输出目录：exp/bridge/.runtime/desktop-captures'}
      </div>
      <DesktopCaptureList items={captureState.items} />
    </section>
  )
}
