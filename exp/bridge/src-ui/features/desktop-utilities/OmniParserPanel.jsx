import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

function formatLatency(seconds) {
  if (!Number.isFinite(seconds)) return '-'
  return `${(seconds * 1000).toFixed(0)} ms`
}

function formatParsedContent(value) {
  return JSON.stringify(value || [], null, 2)
}

export function OmniParserPanel({ onLog }) {
  const [probeBusy, setProbeBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [probeState, setProbeState] = useState({
    ready: false,
    baseURL: '',
    message: '尚未检测',
    device: '',
  })
  const [result, setResult] = useState(null)
  const renderedResult = useMemo(() => formatParsedContent(result?.parsedContentList), [result])

  useEffect(() => { handleProbe() }, [])

  // 面板初始化时先探活，尽量让用户在点击测试前就知道服务是否已启动。
  async function handleProbe() {
    setProbeBusy(true)
    try {
      const nextState = await window.bridgeApi.probeOmniParser()
      setProbeState({
        ready: true,
        baseURL: nextState.baseURL,
        message: nextState.payload?.message || '服务可用',
        device: nextState.payload?.device || '',
      })
      onLog?.(`OmniParser 服务可用：${nextState.baseURL}`)
    } catch (error) {
      const message = String(error.message || error)
      setProbeState({
        ready: false,
        baseURL: '',
        message,
        device: '',
      })
      onLog?.(`OmniParser 服务不可用：${message}`)
    } finally {
      setProbeBusy(false)
    }
  }

  // 测试按钮会先截取主屏，再把图片送给本地 OmniParser 服务做解析。
  async function handleTest() {
    setTestBusy(true)
    try {
      const nextResult = await window.bridgeApi.testOmniParser()
      setResult(nextResult)
      setProbeState((current) => ({
        ...current,
        ready: true,
        baseURL: nextResult.baseURL || current.baseURL,
      }))
      onLog?.(`OmniParser 测试完成：识别 ${nextResult.elementCount} 个元素，截图 ${nextResult.capture?.targetDisplay?.savedPath || nextResult.imagePath}，标注图 ${nextResult.annotatedImagePath || '未保存'}`)
    } catch (error) {
      onLog?.(`OmniParser 测试失败: ${error.message || error}`)
    } finally {
      setTestBusy(false)
    }
  }

  return (
    <section className="subpanel">
      <div className="side-section__row">
        <div>
          <div className="subpanel__title">OmniParser</div>
          <div className="helper-text">自动抓取主屏截图，并调用本地检测版 OmniParser 服务解析桌面元素。</div>
        </div>
        <div className="desktop-capture-actions">
          <Button variant="secondary" onClick={handleProbe} disabled={probeBusy || testBusy}>
            {probeBusy ? '检测中...' : '检测服务'}
          </Button>
          <Button onClick={handleTest} disabled={testBusy || probeBusy}>
            {testBusy ? '测试中...' : '测试 OmniParser'}
          </Button>
        </div>
      </div>
      <div className="helper-text">
        状态：{probeState.ready ? '已连接' : '未连接'}
        {probeState.baseURL ? ` · ${probeState.baseURL}` : ''}
        {probeState.device ? ` · ${probeState.device}` : ''}
      </div>
      <div className="helper-text">{probeState.message}</div>
      {result ? (
        <div className="omniparser-grid">
          <article className="omniparser-card">
            <div className="subpanel__title">解析截图</div>
            {result.somImageDataUrl ? (
              <img className="omniparser-preview" src={result.somImageDataUrl} alt="OmniParser 标注结果" />
            ) : (
              <div className="helper-text">暂无标注图。</div>
            )}
            <div className="helper-text">
              推理延迟：{formatLatency(result.serviceLatencySeconds)} · 本地总耗时：{result.localLatencyMs} ms
            </div>
            <div className="helper-text">
              元素数量：{result.elementCount} · 截图路径：{result.capture?.targetDisplay?.savedPath || result.imagePath}
            </div>
            <div className="helper-text">
              标注图路径：{result.annotatedImagePath || '未保存'}
            </div>
          </article>
          <article className="omniparser-card">
            <div className="subpanel__title">解析结果</div>
            <ScrollArea className="subpanel__body omniparser-result-scroll">
              <pre className="console-block">{renderedResult}</pre>
            </ScrollArea>
          </article>
        </div>
      ) : null}
    </section>
  )
}
