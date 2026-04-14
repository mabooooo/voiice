import { useState } from 'react'

import { Button } from '@/components/ui/button'

// 屏幕角标提示器独立成组件，后续可复用到引导、标注或桌面定位流程里。
export function CornerIndicatorPanel({ onLog }) {
  const [busy, setBusy] = useState(false)

  async function handleShowIndicators() {
    setBusy(true)
    try {
      // 指示器由主进程直接创建透明层窗口，避免页面端承担同步显示控制。
      const result = await window.bridgeApi.showCornerIndicators()
      onLog?.(`角标指示器已显示：${result.displayCount} 屏，共 ${result.indicatorCount} 个，${result.durationMs}ms 后自动消失。`)
    } catch (error) {
      onLog?.(`角标指示器触发失败: ${error.message || error}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="side-section">
      <div className="subpanel__title">屏幕指示器</div>
      <div className="helper-text">在每块屏幕的 25% / 75% 四角位置显示 300px 黄色边框，3 秒后自动消失。</div>
      <Button variant="secondary" className="button-wide" onClick={handleShowIndicators} disabled={busy}>
        {busy ? '触发中...' : '显示四角指示器'}
      </Button>
    </section>
  )
}
