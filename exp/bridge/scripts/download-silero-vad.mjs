import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'

// 下载 Silero VAD 的 ONNX 模型并把 onnxruntime-web 的 wasm 同步到 public/ort，
// 让 renderer 在离线环境下也能在 file:// 协议下正常加载 WASM。
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const publicDir = path.join(projectRoot, 'public')
const ortDir = path.join(publicDir, 'ort')
const targetModelPath = path.join(publicDir, 'silero_vad.onnx')

// 官方仓库的 release 地址，多个镜像按顺序尝试。
const MODEL_MIRRORS = [
  'https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx',
  'https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx',
  'https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx',
]

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    const request = https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307) {
        file.close()
        fs.unlink(destPath, () => {})
        resolve(download(response.headers.location, destPath))
        return
      }
      if (response.statusCode !== 200) {
        file.close()
        fs.unlink(destPath, () => {})
        reject(new Error(`HTTP ${response.statusCode} for ${url}`))
        return
      }
      response.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    })
    request.on('error', (error) => {
      file.close()
      fs.unlink(destPath, () => {})
      reject(error)
    })
  })
}

async function ensureSileroModel() {
  if (fs.existsSync(targetModelPath)) {
    const stat = await fsPromises.stat(targetModelPath)
    if (stat.size > 500_000) {
      console.log(`[silero] 已存在模型，跳过下载: ${targetModelPath} (${stat.size} bytes)`)
      return
    }
    console.log(`[silero] 检测到异常小的旧模型，重新下载: ${stat.size} bytes`)
    await fsPromises.unlink(targetModelPath)
  }
  await fsPromises.mkdir(publicDir, { recursive: true })

  let lastError = null
  for (const url of MODEL_MIRRORS) {
    try {
      console.log(`[silero] 从 ${url} 下载...`)
      await download(url, targetModelPath)
      const stat = await fsPromises.stat(targetModelPath)
      if (stat.size < 500_000) {
        throw new Error(`下载文件过小 (${stat.size} bytes)，可能不是模型`)
      }
      console.log(`[silero] 已保存到 ${targetModelPath} (${stat.size} bytes)`)
      return
    } catch (error) {
      console.warn(`[silero] 下载失败: ${error.message}`)
      lastError = error
    }
  }
  throw lastError || new Error('无可用镜像')
}

async function copyOrtWasm() {
  // onnxruntime-web 的 wasm 通过 ort.env.wasm.wasmPaths 指向这里，
  // 必须放进 public/ort，构建后位于 renderer-dist/ort 才能被 file:// 加载。
  const sourceDir = path.join(projectRoot, 'node_modules', 'onnxruntime-web', 'dist')
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`缺少 onnxruntime-web 依赖，请先 npm install: ${sourceDir}`)
  }
  await fsPromises.mkdir(ortDir, { recursive: true })

  const entries = await fsPromises.readdir(sourceDir)
  const needed = entries.filter((name) => name.endsWith('.wasm') || name.endsWith('.mjs'))
  for (const name of needed) {
    const from = path.join(sourceDir, name)
    const to = path.join(ortDir, name)
    await fsPromises.copyFile(from, to)
  }
  console.log(`[silero] 已同步 ${needed.length} 个 onnxruntime-web 资源到 ${ortDir}`)
}

async function main() {
  await ensureSileroModel()
  await copyOrtWasm()
}

main().catch((error) => {
  console.error('[silero] 下载流程失败:', error.message || error)
  process.exitCode = 1
})
