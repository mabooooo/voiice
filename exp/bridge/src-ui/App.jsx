import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const MANUAL_ACTIONS = [
  {
    label: 'focus_front_window',
    plan: [{ action: 'focus_front_window' }],
  },
  {
    label: 'close_front_window',
    plan: [{ action: 'close_front_window' }],
  },
  {
    label: 'open_app("WeChat")',
    plan: [{ action: 'open_app', args: { name: 'WeChat' } }],
  },
  {
    label: 'send_shortcut("cmd+w")',
    plan: [{ action: 'send_shortcut', args: { shortcut: 'cmd+w' } }],
  },
]

const PRIVILEGED_ACTIONS = [
  {
    label: 'move_mouse_to_center',
    plan: [{ action: 'move_mouse_to_center' }],
  },
  {
    label: 'left_click_current_position',
    plan: [{ action: 'left_click_current_position' }],
  },
]

function formatJson(value) {
  return JSON.stringify(value, null, 2)
}

export function App() {
  const [configStatus, setConfigStatus] = useState('读取配置中...')
  const [audioPath, setAudioPath] = useState('')
  const [prompt, setPrompt] = useState('请只返回这段语音对应的操作意图文本，不要解释。')
  const [stream, setStream] = useState(false)
  const [autoExecute, setAutoExecute] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [plan, setPlan] = useState([])
  const [timing, setTiming] = useState({})
  const [usage, setUsage] = useState({})
  const [manualCommand, setManualCommand] = useState('')
  const [typeText, setTypeText] = useState('')
  const [recordingState, setRecordingState] = useState('未录音')
  const [logs, setLogs] = useState(['等待操作...'])
  const [busy, setBusy] = useState(false)
  const [recorder, setRecorder] = useState(null)
  const [mediaStream, setMediaStream] = useState(null)
  const [recordedChunks, setRecordedChunks] = useState([])

  const canExecutePlan = plan.length > 0

  function appendLog(message) {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    setLogs((current) => [`[${time}] ${message}`, ...current].slice(0, 60))
  }

  useEffect(() => {
    // 初始化时读取主进程状态，便于快速确认环境是否完整。
    window.bridgeApi
      .getConfigStatus()
      .then((status) => setConfigStatus(formatJson(status)))
      .catch((error) => setConfigStatus(`读取失败: ${error.message || error}`))
  }, [])

  const renderedPlan = useMemo(() => formatJson(plan), [plan])

  async function pickAudioFile() {
    const filePath = await window.bridgeApi.pickAudioFile()
    if (!filePath) {
      return
    }

    setAudioPath(filePath)
    appendLog(`已选择音频文件: ${filePath}`)
  }

  async function analyzeAudio() {
    if (!audioPath) {
      appendLog('请先选择音频文件，或者先录音。')
      return
    }

    setBusy(true)
    appendLog(`开始分析音频: ${audioPath}`)

    try {
      const result = await window.bridgeApi.analyzeAudio({
        filePath: audioPath,
        stream,
        prompt: prompt.trim(),
      })

      setTranscript(result.transcript || '')
      setPlan(result.matched?.plan || [])
      setTiming(result.timing || {})
      setUsage(result.usage || {})
      appendLog(`转写完成，匹配到 ${(result.matched?.plan || []).length} 个白名单动作。`)

      if (autoExecute && (result.matched?.plan || []).length > 0) {
        await executePlan(result.matched.plan)
      }
    } catch (error) {
      appendLog(`分析失败: ${error.message || error}`)
    } finally {
      setBusy(false)
    }
  }

  async function executePlan(nextPlan) {
    if (!nextPlan || nextPlan.length === 0) {
      appendLog('当前没有可执行的动作。')
      return
    }

    appendLog(`开始执行 ${nextPlan.length} 个动作。`)
    try {
      const result = await window.bridgeApi.executePlan({ plan: nextPlan })
      appendLog(`执行完成: ${formatJson(result)}`)
    } catch (error) {
      appendLog(`执行失败: ${error.message || error}`)
    }
  }

  async function parseAndExecuteManualCommand() {
    if (!manualCommand.trim()) {
      appendLog('请先输入文本指令。')
      return
    }

    try {
      const matched = await window.bridgeApi.matchTranscript(manualCommand.trim())
      setTranscript(manualCommand.trim())
      setPlan(matched.plan || [])
      setTiming({})
      setUsage({})
      appendLog(`文本指令已匹配 ${(matched.plan || []).length} 个动作。`)
      if ((matched.plan || []).length > 0) {
        await executePlan(matched.plan)
      }
    } catch (error) {
      appendLog(`文本指令匹配失败: ${error.message || error}`)
    }
  }

  async function startRecording() {
    try {
      const streamRef = await navigator.mediaDevices.getUserMedia({ audio: true })
      const chunks = []
      const mediaRecorder = new MediaRecorder(streamRef)

      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data)
        }
      })

      mediaRecorder.addEventListener('stop', async () => {
        // 录音结束后立即写入临时文件，方便复用既有分析链路。
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' })
        const arrayBuffer = await blob.arrayBuffer()
        const tempPath = await window.bridgeApi.saveRecording({
          bytes: Array.from(new Uint8Array(arrayBuffer)),
          mimeType: blob.type,
        })

        setAudioPath(tempPath)
        setRecordingState(`已导入录音: ${tempPath}`)
        appendLog(`录音已保存到临时文件: ${tempPath}`)
        streamRef.getTracks().forEach((track) => track.stop())
        setMediaStream(null)
        setRecorder(null)
        setRecordedChunks([])
      })

      setRecordedChunks(chunks)
      setMediaStream(streamRef)
      setRecorder(mediaRecorder)
      setRecordingState('录音中...')
      mediaRecorder.start()
      appendLog('已开始录音。')
    } catch (error) {
      appendLog(`录音失败: ${error.message || error}`)
    }
  }

  function stopRecording() {
    if (!recorder || recorder.state !== 'recording') {
      return
    }

    recorder.stop()
    setRecordingState('正在处理录音...')
    mediaStream?.getTracks().forEach((track) => track.stop())
    appendLog(`已停止录音，当前分片数: ${recordedChunks.length}`)
  }

  return (
    <div className="app-shell dark">
      <div className="app-layout">
        <div className="app-main">
          <Card className="hero-card">
            <CardHeader className="hero-card__header">
              <div>
                <div className="eyebrow">Bridge / Windows Electron</div>
                <CardTitle className="hero-title">语音控制桌面白名单动作</CardTitle>
                <CardDescription className="hero-description">
                  使用轻量 React 版 shadcn 风格组件，默认夜间模式，并将桌面控制严格限制在白名单之内。
                </CardDescription>
              </div>
              <div className="runtime-box">
                <div className="runtime-box__title">Runtime</div>
                <ScrollArea className="runtime-box__scroll">
                  <pre className="console-block console-block--compact">{configStatus}</pre>
                </ScrollArea>
              </div>
            </CardHeader>
          </Card>

          <div className="content-grid">
            <Card>
              <CardHeader>
                <div>
                  <div className="section-label">Input</div>
                  <CardTitle>音频输入</CardTitle>
                </div>
                <div className="switch-group">
                  <Switch checked={stream} onCheckedChange={setStream} />
                  <span>流式转写</span>
                </div>
              </CardHeader>
              <CardContent className="stack">
                <label className="field">
                  <span className="field__label">音频文件</span>
                  <div className="row">
                    <Input value={audioPath} placeholder="选择 mp3 / wav / webm ..." readOnly />
                    <Button variant="secondary" onClick={pickAudioFile}>
                      选择文件
                    </Button>
                  </div>
                </label>

                <label className="field">
                  <span className="field__label">转写提示词</span>
                  <Textarea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
                </label>

                <div className="field">
                  <span className="field__label">麦克风测试</span>
                  <div className="row">
                    <Button onClick={startRecording} disabled={Boolean(recorder) && recorder.state === 'recording'}>
                      开始录音
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={stopRecording}
                      disabled={!recorder || recorder.state !== 'recording'}
                    >
                      停止并导入
                    </Button>
                  </div>
                  <div className="helper-text">{recordingState}</div>
                </div>
              </CardContent>
              <CardFooter className="footer-actions">
                <Button className="footer-actions__grow" onClick={analyzeAudio} disabled={busy}>
                  {busy ? '分析中...' : '转写并匹配动作'}
                </Button>
                <div className="switch-group">
                  <Switch checked={autoExecute} onCheckedChange={setAutoExecute} />
                  <span>自动执行匹配结果</span>
                </div>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <div className="section-label">Analysis</div>
                  <CardTitle>分析结果</CardTitle>
                </div>
                <Button variant="secondary" disabled={!canExecutePlan} onClick={() => executePlan(plan)}>
                  执行白名单动作
                </Button>
              </CardHeader>
              <CardContent className="stack">
                <div className="analysis-grid">
                  <section className="subpanel">
                    <div className="subpanel__title">Transcript</div>
                    <ScrollArea className="subpanel__body">
                      <pre className="console-block">{transcript}</pre>
                    </ScrollArea>
                  </section>
                  <section className="subpanel">
                    <div className="subpanel__title">Matched Plan</div>
                    <ScrollArea className="subpanel__body">
                      <pre className="console-block">{renderedPlan}</pre>
                    </ScrollArea>
                  </section>
                </div>

                <div className="analysis-grid analysis-grid--small">
                  <section className="subpanel">
                    <div className="subpanel__title">Timing</div>
                    <pre className="console-block console-block--compact">{formatJson(timing)}</pre>
                  </section>
                  <section className="subpanel">
                    <div className="subpanel__title">Usage</div>
                    <pre className="console-block console-block--compact">{formatJson(usage)}</pre>
                  </section>
                </div>

                <section className="subpanel">
                  <div className="subpanel__title">Execution Log</div>
                  <ScrollArea className="subpanel__body subpanel__body--log">
                    <pre className="console-block">{logs.join('\n')}</pre>
                  </ScrollArea>
                </section>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="sidebar-card">
          <CardHeader className="sidebar-card__header">
            <div className="section-label">Manual Controls</div>
            <CardTitle>右侧动作列表</CardTitle>
            <CardDescription>
              手动白名单测试按钮和文本指令入口全部收进右侧容器，便于后续继续扩展。
            </CardDescription>
          </CardHeader>
          <CardContent className="sidebar-stack">
            <section className="side-section">
              <div className="subpanel__title">白名单动作</div>
              <div className="list-stack">
                {MANUAL_ACTIONS.map((item) => (
                  <Button
                    key={item.label}
                    variant="secondary"
                    className="button-list"
                    onClick={() => executePlan(item.plan)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </section>

            <section className="side-section">
              <div className="subpanel__title">手动文本指令</div>
              <Textarea
                rows={4}
                value={manualCommand}
                onChange={(event) => setManualCommand(event.target.value)}
                placeholder="例如：打开微信，然后输入你好"
              />
              <Button className="button-wide" onClick={parseAndExecuteManualCommand}>
                解析文本并执行
              </Button>
            </section>

            <section className="side-section">
              <div className="subpanel__title">直接输入文本</div>
              <Input
                value={typeText}
                onChange={(event) => setTypeText(event.target.value)}
                placeholder="输入要发送到当前焦点输入框的文本"
              />
              <Button
                variant="secondary"
                className="button-wide"
                onClick={() =>
                  executePlan([
                    {
                      action: 'type_text_to_focused_input',
                      args: { text: typeText.trim() },
                    },
                  ])
                }
              >
                type_text_to_focused_input
              </Button>
            </section>

            <section className="side-section">
              <div className="subpanel__title">高权限测试（仅手动）</div>
              <div className="list-stack">
                {PRIVILEGED_ACTIONS.map((item) => (
                  <Button
                    key={item.label}
                    variant="secondary"
                    className="button-list"
                    onClick={() => executePlan(item.plan)}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
