import { parseActionsFromTranscript } from '../src/commandMatcher.mjs'

const samples = [
  '关闭这个窗口',
  '打开微信，然后输入你好',
  '切换到当前窗口',
  '发送 cmd+w',
]

for (const sample of samples) {
  console.log(`\n[sample] ${sample}`)
  console.log(JSON.stringify(parseActionsFromTranscript(sample), null, 2))
}
