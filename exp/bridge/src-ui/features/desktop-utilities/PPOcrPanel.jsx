import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

function formatLatency(seconds) {
  if (!Number.isFinite(seconds)) return '-'
  return `${(seconds * 1000).toFixed(0)} ms`
}

function formatOcrLines(value) {
  return JSON.stringify(value || [], null, 2)
}

export function PPOcrPanel({ onLog }) {
  const [probeBusy, setProbeBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [probeState, setProbeState] = useState({
    ready: false,
    baseURL: '',
    message: '尚未检测',
    device: '',
    models: '',
  })
  const [result, setResult] = useState(null)
  const renderedResult = useMemo(() => formatOcrLines(result?.ocrLines), [result])

  useEffect(() => { handleProbe() }, [])

  // 面板初始化先探活，避免用户点测试后才发现本地 OCR 服务没启动。
  async function handleProbe() {
    setProbeBusy(true)
    try {
      const nextState = await window.bridgeApi.probePPOcr()
      setProbeState({
        ready: true,
        baseURL: nextState.baseURL,
        message: nextState.payload?.message || '服务可用',
        device: nextState.payload?.device || '',
        models: [nextState.payload?.detModel, nextState.payload?.recModel].filter(Boolean).join(' + '),
      })
      onLog?.(`PP-OCR 服务可用：${nextState.baseURL}`)
    } catch (error) {
      const message = String(error.message || error)
      setProbeState({
        ready: false,
        baseURL: '',
        message,
        device: '',
        models: '',
      })
      onLog?.(`PP-OCR 服务不可用：${message}`)
    } finally {
      setProbeBusy(false)
    }
  }

  // 测试按钮会截取主屏并调用本地 PP-OCR，然后展示标注图与识别行结果。
  async function handleTest() {
    setTestBusy(true)
    try {
      const nextResult = await window.bridgeApi.testPPOcr()
      setResult(nextResult)
      setProbeState((current) => ({
        ...current,
        ready: true,
        baseURL: nextResult.baseURL || current.baseURL,
      }))
      onLog?.(`PP-OCR 测试完成：识别 ${nextResult.lineCount} 行文本，截图 ${nextResult.capture?.targetDisplay?.savedPath || nextResult.imagePath}`)
    } catch (error) {
      onLog?.(`PP-OCR 测试失败: ${error.message || error}`)
    } finally {
      setTestBusy(false)
    }
  }

  return (
    <section className="subpanel">
      <div className="side-section__row">
        <div>
          <div className="subpanel__title">PP-OCRv5 Mobile</div>
          <div className="helper-text">自动抓取主屏截图，用更轻量的 OCR 替代 OmniParser 做文本区域检测与识别。</div>
        </div>
        <div className="desktop-capture-actions">
          <Button variant="secondary" onClick={handleProbe} disabled={probeBusy || testBusy}>
            {probeBusy ? '检测中...' : '检测服务'}
          </Button>
          <Button onClick={handleTest} disabled={testBusy || probeBusy}>
            {testBusy ? '测试中...' : '测试 PP-OCR'}
          </Button>
        </div>
      </div>
      <div className="helper-text">
        状态：{probeState.ready ? '已连接' : '未连接'}
        {probeState.baseURL ? ` · ${probeState.baseURL}` : ''}
        {probeState.device ? ` · ${probeState.device}` : ''}
      </div>
      <div className="helper-text">
        模型：{probeState.models || '未返回'}
      </div>
      <div className="helper-text">{probeState.message}</div>
      {result ? (
        <div className="omniparser-grid">
          <article className="omniparser-card">
            <div className="subpanel__title">识别摘要</div>
            <div className="helper-text">
              推理延迟：{formatLatency(result.serviceLatencySeconds)} · 本地总耗时：{result.localLatencyMs} ms
            </div>
            <div className="helper-text">
              文本行数：{result.lineCount} · 截图路径：{result.capture?.targetDisplay?.savedPath || result.imagePath}
            </div>
          </article>
          <article className="omniparser-card">
            <div className="subpanel__title">识别结果</div>
            <ScrollArea className="subpanel__body omniparser-result-scroll">
              <pre className="console-block">{renderedResult}</pre>
            </ScrollArea>
          </article>
        </div>
      ) : null}
    </section>
  )
}
