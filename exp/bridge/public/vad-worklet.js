// AudioWorklet：把 AudioContext 默认的 128 采样 quantum 聚合成 512 采样帧（32ms @ 16kHz），
// 每帧通过 port.postMessage 推送给主线程的 VAD+FSM。保持逻辑极薄，避免 Worklet 线程阻塞。
class VadFrameProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // 512 采样 = Silero VAD 原生窗口尺寸，与采样率 16kHz 对齐。
    this.frameSize = 512
    this.buffer = new Float32Array(this.frameSize)
    this.writeOffset = 0
  }

  process(inputs, outputs) {
    const channel = inputs[0]?.[0]
    const output = outputs[0]?.[0]
    // 这条链路只借用 WebAudio 的拉流时钟，输出保持静音，避免把麦克风回放出来。
    if (output) {
      output.fill(0)
    }
    if (!channel || channel.length === 0) {
      return true
    }
    let readOffset = 0
    while (readOffset < channel.length) {
      const remaining = this.frameSize - this.writeOffset
      const takeCount = Math.min(remaining, channel.length - readOffset)
      this.buffer.set(channel.subarray(readOffset, readOffset + takeCount), this.writeOffset)
      this.writeOffset += takeCount
      readOffset += takeCount
      if (this.writeOffset >= this.frameSize) {
        // 一帧满了就拷贝一份立即送走，自身缓冲清零继续累积下一帧。
        this.port.postMessage(this.buffer.slice(0))
        this.writeOffset = 0
      }
    }
    return true
  }
}

registerProcessor('vad-frame-processor', VadFrameProcessor)
