import { spawn } from 'node:child_process'

function buildEncodedCommand(script) {
  // 用 UTF-16LE 编码传给 PowerShell，避免命令本身在中文环境下被转码污染。
  const wrappedScript = `
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
${script}
`

  return Buffer.from(wrappedScript, 'utf16le').toString('base64')
}

function decodeCliXmlEntities(text) {
  return text
    .replace(/_x000D__x000A_/g, '\n')
    .replace(/_x000D_/g, '\r')
    .replace(/_x000A_/g, '\n')
}

function sanitizePowerShellError(rawText) {
  const text = decodeCliXmlEntities(String(rawText || '')).trim()
  if (!text) {
    return ''
  }

  if (!text.includes('<Objs') && !text.includes('#< CLIXML')) {
    return text
  }

  // 只提取 PowerShell 错误正文，避免把 CLIXML 和进度噪音直接抛给界面。
  const errorMessages = [...text.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)]
    .map((item) => item[1].trim())
    .filter(Boolean)
    .filter((item) => !item.includes('正在准备首次使用模块'))

  if (errorMessages.length > 0) {
    return errorMessages.join('\n')
  }

  return text
    .replace(/#<\s*CLIXML/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const encodedCommand = buildEncodedCommand(script)
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
      {
        windowsHide: true,
      },
    )

    let stdout = ''
    let stderr = ''

    // 显式按 UTF-8 解码，和 PowerShell 输出编码保持一致。
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
        return
      }

      const cleanedError = sanitizePowerShellError(stderr || stdout)
      reject(new Error(cleanedError || `PowerShell failed with code ${code}`))
    })
  })
}
