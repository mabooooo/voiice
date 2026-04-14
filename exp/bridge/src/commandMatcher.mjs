const APP_ALIASES = {
  WeChat: ['微信', 'wechat', 'weixin'],
}

const SHORTCUT_ALIASES = {
  'cmd+w': ['cmd+w', 'command+w', '⌘+w', '关闭标签'],
  'ctrl+w': ['ctrl+w', 'control+w'],
  'alt+f4': ['alt+f4'],
}

function normalizeText(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[。！!？?]/g, '')
}

function splitTranscriptToSegments(transcript) {
  // 先按连接词拆句，便于把“打开微信，然后输入你好”拆成多个动作。
  return transcript
    .replace(/(然后|并且|再|接着|随后)/g, '|')
    .split(/[|,，；;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function cleanupTypedText(text) {
  return text.replace(/^[“"'`]+|[”"'`。！!？?]+$/g, '').trim()
}

function matchOpenApp(segment, normalizedSegment) {
  if (!normalizedSegment.includes('打开')) {
    return null
  }

  for (const [name, aliases] of Object.entries(APP_ALIASES)) {
    if (aliases.some((alias) => normalizedSegment.includes(alias.toLowerCase()))) {
      return {
        action: 'open_app',
        args: { name },
        source: segment,
      }
    }
  }

  return null
}

function matchCloseWindow(segment, normalizedSegment) {
  if (/(关闭|关掉).*(窗口|页面|标签|程序)/.test(normalizedSegment)) {
    return {
      action: 'close_front_window',
      source: segment,
    }
  }

  return null
}

function matchFocusWindow(segment, normalizedSegment) {
  if (/(聚焦|激活|切到|切换到).*(窗口|前台|当前)/.test(normalizedSegment)) {
    return {
      action: 'focus_front_window',
      source: segment,
    }
  }

  return null
}

function matchTypeText(segment, normalizedSegment) {
  const matched = segment.match(/(?:输入|打字|键入|写入)(.+)$/)
  if (!matched) {
    return null
  }

  const text = cleanupTypedText(matched[1])
  if (!text) {
    return null
  }

  return {
    action: 'type_text_to_focused_input',
    args: { text },
    source: segment,
  }
}

function matchShortcut(segment, normalizedSegment) {
  for (const [shortcut, aliases] of Object.entries(SHORTCUT_ALIASES)) {
    if (aliases.some((alias) => normalizedSegment.includes(alias))) {
      return {
        action: 'send_shortcut',
        args: { shortcut },
        source: segment,
      }
    }
  }

  return null
}

export function parseActionsFromTranscript(transcript) {
  const plan = []
  const unmatchedSegments = []
  const segments = splitTranscriptToSegments(transcript)

  for (const segment of segments) {
    const normalizedSegment = normalizeText(segment)
    const matchedAction =
      matchOpenApp(segment, normalizedSegment) ||
      matchCloseWindow(segment, normalizedSegment) ||
      matchFocusWindow(segment, normalizedSegment) ||
      matchTypeText(segment, normalizedSegment) ||
      matchShortcut(segment, normalizedSegment)

    if (matchedAction) {
      plan.push(matchedAction)
    } else {
      unmatchedSegments.push(segment)
    }
  }

  return {
    transcript,
    plan,
    unmatchedSegments,
    safe: unmatchedSegments.length === 0 && plan.length > 0,
  }
}
