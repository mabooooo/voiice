import fsPromises from 'node:fs/promises'
import path from 'node:path'

import { app } from 'electron'

import { captureDesktopScreenshots } from '../src/desktopCapture.mjs'

async function assertFilesExist(items) {
  for (const item of items) {
    await fsPromises.access(item.savedPath)
  }
}

async function run() {
  const outputDir = path.join(process.cwd(), '.runtime', 'desktop-captures-smoke')

  const fullResult = await captureDesktopScreenshots({
    outputDir,
    compressed: false,
  })
  const compressedResult = await captureDesktopScreenshots({
    outputDir,
    compressed: true,
    maxHeight: 720,
  })

  if (fullResult.displayCount === 0) {
    throw new Error('未检测到任何显示器截图结果。')
  }

  if (fullResult.displayCount !== compressedResult.displayCount) {
    throw new Error('全尺寸截图与压缩截图的显示器数量不一致。')
  }

  if (compressedResult.items.some(item => item.height > 720)) {
    throw new Error('压缩截图高度超过 720。')
  }

  await assertFilesExist(fullResult.items)
  await assertFilesExist(compressedResult.items)

  console.log(JSON.stringify({
    ok: true,
    displayCount: fullResult.displayCount,
    fullOutputDir: fullResult.outputDir,
    fullItems: fullResult.items.map(item => ({
      displayIndex: item.displayIndex,
      size: `${item.width}x${item.height}`,
      savedPath: item.savedPath,
    })),
    compressedItems: compressedResult.items.map(item => ({
      displayIndex: item.displayIndex,
      size: `${item.width}x${item.height}`,
      savedPath: item.savedPath,
    })),
  }, null, 2))
}

app.whenReady().then(async () => {
  try {
    await run()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
