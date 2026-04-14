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

      reject(new Error(stderr || `PowerShell failed with code ${code}`))
    })
  })
}
