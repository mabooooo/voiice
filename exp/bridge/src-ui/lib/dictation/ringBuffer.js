// 轻量 Float32 环形缓冲区：只保存最近 N 个采样点的原始音频，
// FSM 从 IDLE 切到 IN_SPEECH 时把这里的尾部取出拼到句子前面做 pre-roll，避免吃字。
export class RingBuffer {
  constructor(capacitySamples) {
    this.capacity = capacitySamples
    this.buffer = new Float32Array(capacitySamples)
    this.writeOffset = 0
    this.filled = false
  }

  push(frame) {
    // 写入会溢出时分两段拷贝，越过末端的部分回到 0 继续写。
    const size = frame.length
    if (size >= this.capacity) {
      this.buffer.set(frame.subarray(size - this.capacity))
      this.writeOffset = 0
      this.filled = true
      return
    }
    const firstPart = Math.min(this.capacity - this.writeOffset, size)
    this.buffer.set(frame.subarray(0, firstPart), this.writeOffset)
    if (firstPart < size) {
      this.buffer.set(frame.subarray(firstPart), 0)
    }
    this.writeOffset = (this.writeOffset + size) % this.capacity
    if (!this.filled && this.writeOffset === 0) {
      this.filled = true
    }
  }

  // 按写入顺序吐出当前已缓存的所有采样点。
  drainAll() {
    if (!this.filled) {
      return this.buffer.slice(0, this.writeOffset)
    }
    const out = new Float32Array(this.capacity)
    const tail = this.capacity - this.writeOffset
    out.set(this.buffer.subarray(this.writeOffset), 0)
    out.set(this.buffer.subarray(0, this.writeOffset), tail)
    return out
  }

  clear() {
    this.writeOffset = 0
    this.filled = false
    this.buffer.fill(0)
  }
}
