const bridgeApi = window.bridgeApi

const state = {
  filePath: '',
  matchedPlan: [],
  recorder: null,
  recordedChunks: [],
  mediaStream: null,
}

const configStatus = document.querySelector('#configStatus')
const audioPath = document.querySelector('#audioPath')
const promptInput = document.querySelector('#promptInput')
const streamToggle = document.querySelector('#streamToggle')
const autoExecuteToggle = document.querySelector('#autoExecuteToggle')
const transcriptOutput = document.querySelector('#transcriptOutput')
const planOutput = document.querySelector('#planOutput')
const timingOutput = document.querySelector('#timingOutput')
const usageOutput = document.querySelector('#usageOutput')
const logOutput = document.querySelector('#logOutput')
const analyzeButton = document.querySelector('#analyzeButton')
const executeButton = document.querySelector('#executeButton')
const recordButton = document.querySelector('#recordButton')
const stopButton = document.querySelector('#stopButton')
const recordingState = document.querySelector('#recordingState')

function appendLog(message) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  logOutput.textContent = `[${time}] ${message}\n${logOutput.textContent}`.trim()
}

function renderConfig(status) {
  configStatus.textContent = JSON.stringify(status, null, 2)
}

function renderAnalysis(result) {
  transcriptOutput.textContent = result.transcript || ''
  planOutput.textContent = JSON.stringify(result.matched, null, 2)
  timingOutput.textContent = JSON.stringify(result.timing, null, 2)
  usageOutput.textContent = JSON.stringify(result.usage, null, 2)
  state.matchedPlan = result.matched.plan || []
  executeButton.disabled = state.matchedPlan.length === 0
}

async function runAnalyze() {
  if (!state.filePath) {
    appendLog('请先选择音频文件，或者先录音。')
    return
  }

  analyzeButton.disabled = true
  appendLog(`开始分析音频: ${state.filePath}`)

  try {
    const result = await bridgeApi.analyzeAudio({
      filePath: state.filePath,
      stream: streamToggle.checked,
      prompt: promptInput.value.trim(),
    })

    renderAnalysis(result)
    appendLog(`转写完成，匹配到 ${state.matchedPlan.length} 个白名单动作。`)

    if (autoExecuteToggle.checked && state.matchedPlan.length > 0) {
      appendLog('已开启自动执行，开始执行动作。')
      const execution = await bridgeApi.executePlan({ plan: state.matchedPlan })
      appendLog(`执行完成: ${JSON.stringify(execution, null, 2)}`)
    }
  } catch (error) {
    appendLog(`分析失败: ${error.message || error}`)
  } finally {
    analyzeButton.disabled = false
  }
}

async function pickAudioFile() {
  const filePath = await bridgeApi.pickAudioFile()
  if (!filePath) {
    return
  }

  state.filePath = filePath
  audioPath.value = filePath
  appendLog(`已选择音频文件: ${filePath}`)
}

async function startRecording() {
  try {
    state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    state.recordedChunks = []
    state.recorder = new MediaRecorder(state.mediaStream)

    state.recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) {
        state.recordedChunks.push(event.data)
      }
    })

    state.recorder.addEventListener('stop', async () => {
      const blob = new Blob(state.recordedChunks, { type: state.recorder.mimeType || 'audio/webm' })
      const arrayBuffer = await blob.arrayBuffer()
      const tempPath = await bridgeApi.saveRecording({
        bytes: Array.from(new Uint8Array(arrayBuffer)),
        mimeType: blob.type,
      })

      state.filePath = tempPath
      audioPath.value = tempPath
      recordingState.textContent = `已导入录音: ${tempPath}`
      appendLog(`录音已保存到临时文件: ${tempPath}`)

      state.mediaStream?.getTracks().forEach((track) => track.stop())
      state.mediaStream = null
      state.recorder = null
      state.recordedChunks = []
      recordButton.disabled = false
      stopButton.disabled = true
    })

    state.recorder.start()
    recordingState.textContent = '录音中...'
    recordButton.disabled = true
    stopButton.disabled = false
    appendLog('已开始录音。')
  } catch (error) {
    appendLog(`录音失败: ${error.message || error}`)
  }
}

function stopRecording() {
  if (!state.recorder || state.recorder.state !== 'recording') {
    return
  }

  state.recorder.stop()
  recordingState.textContent = '正在处理录音...'
  appendLog('已停止录音，正在保存临时文件。')
}

async function executeCurrentPlan(plan) {
  if (!plan || plan.length === 0) {
    appendLog('当前没有可执行的动作。')
    return
  }

  appendLog(`开始执行 ${plan.length} 个动作。`)
  try {
    const result = await bridgeApi.executePlan({ plan })
    appendLog(`执行完成: ${JSON.stringify(result, null, 2)}`)
  } catch (error) {
    appendLog(`执行失败: ${error.message || error}`)
  }
}

async function boot() {
  const status = await bridgeApi.getConfigStatus()
  renderConfig(status)
  appendLog('Bridge 已启动。')
}

document.querySelector('#pickAudioButton').addEventListener('click', pickAudioFile)
analyzeButton.addEventListener('click', runAnalyze)
executeButton.addEventListener('click', () => executeCurrentPlan(state.matchedPlan))
recordButton.addEventListener('click', startRecording)
stopButton.addEventListener('click', stopRecording)

document.querySelectorAll('[data-plan]').forEach((button) => {
  button.addEventListener('click', () => {
    const plan = JSON.parse(button.getAttribute('data-plan'))
    executeCurrentPlan(plan)
  })
})

document.querySelector('#typeTextButton').addEventListener('click', () => {
  const text = document.querySelector('#typeTextInput').value.trim()
  if (!text) {
    appendLog('请先填写要发送的文本。')
    return
  }

  executeCurrentPlan([
    {
      action: 'type_text_to_focused_input',
      args: { text },
    },
  ])
})

boot().catch((error) => {
  appendLog(`初始化失败: ${error.message || error}`)
})
