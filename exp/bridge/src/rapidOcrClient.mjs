import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const RAPIDOCR_SCRIPT_PATH = path.join(process.cwd(), '.runtime', 'rapidocr_test.py')
const PPOCR_PYTHON_PATH = path.join(process.cwd(), 'capabilities', 'ppocr', '.local', '.venv', 'Scripts', 'python.exe')

function runPython(command, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`RapidOCR 请求超时: ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
        return
      }
      reject(new Error(String(stderr || stdout || `RapidOCR failed with code ${code}`).trim()))
    })
  })
}

function buildTempJsonPath(imagePath) {
  const parsed = path.parse(imagePath)
  return path.join(parsed.dir, `${parsed.name}-rapidocr.json`)
}

// RapidOCR 直接复用本地测试脚本，保持和你手工验证时一致的 det+rec 参数。
export async function testRapidOcrWithImage(imagePath, options = {}) {
  if (!imagePath) {
    throw new Error('缺少截图路径，无法执行 RapidOCR。')
  }
  await fsPromises.access(RAPIDOCR_SCRIPT_PATH)
  await fsPromises.access(PPOCR_PYTHON_PATH)

  const outputJsonPath = buildTempJsonPath(imagePath)
  const startedAt = Date.now()
  await runPython(
    PPOCR_PYTHON_PATH,
    [
      RAPIDOCR_SCRIPT_PATH,
      imagePath,
      '',
      outputJsonPath,
      options.version || 'v5',
      String(options.threads || 8),
    ],
    options.timeoutMs || 120000,
  )

  const payload = JSON.parse(await fsPromises.readFile(outputJsonPath, 'utf8'))
  await fsPromises.unlink(outputJsonPath).catch(() => {})

  return {
    ok: true,
    mode: 'rapidocr-ppocrv5-mobile',
    localLatencyMs: Date.now() - startedAt,
    serviceLatencySeconds: Array.isArray(payload.latenciesMs) && payload.latenciesMs.length > 0
      ? payload.latenciesMs[payload.latenciesMs.length - 1] / 1000
      : null,
    lineCount: payload.lineCount || 0,
    ocrLines: payload.lines || [],
    raw: payload,
  }
}
