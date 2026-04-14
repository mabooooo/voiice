import { runPowerShell } from './powershell.mjs'

function buildWindowAutomationScript(handle, options = {}) {
  const safeHandle = String(handle).replace(/'/g, '')
  const maxDepth = Math.max(1, Number(options.maxDepth ?? 4))
  const maxChildren = Math.max(1, Number(options.maxChildren ?? 40))
  const textPreviewLength = Math.max(0, Number(options.textPreviewLength ?? 200))

  return `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$hWnd = [IntPtr][Int64]'${safeHandle}'
if ($hWnd -eq [IntPtr]::Zero) {
  throw "Invalid window handle"
}

$root = [System.Windows.Automation.AutomationElement]::FromHandle($hWnd)
if ($null -eq $root) {
  throw "UI Automation root not found for handle ${safeHandle}"
}

$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

function Convert-BoundingRectangle($rect) {
  if ($null -eq $rect) {
    return $null
  }

  if ([double]::IsNaN($rect.Width) -or [double]::IsNaN($rect.Height)) {
    return $null
  }

  return [PSCustomObject]@{
    x = [Math]::Round($rect.X, 2)
    y = [Math]::Round($rect.Y, 2)
    width = [Math]::Round($rect.Width, 2)
    height = [Math]::Round($rect.Height, 2)
  }
}

function Get-ControlTypeName($controlType) {
  if ($null -eq $controlType) {
    return ""
  }

  $programmaticName = $controlType.ProgrammaticName
  if ([string]::IsNullOrWhiteSpace($programmaticName)) {
    return ""
  }

  return ($programmaticName -replace '^ControlType\\.', '')
}

function Try-GetPattern($element, $pattern) {
  $patternObject = $null
  if ($element.TryGetCurrentPattern($pattern, [ref]$patternObject)) {
    return $patternObject
  }

  return $null
}

function Get-PatternSnapshot($element) {
  $patterns = [ordered]@{}

  $invokePattern = Try-GetPattern $element ([System.Windows.Automation.InvokePattern]::Pattern)
  $patterns.invoke = [PSCustomObject]@{
    supported = ($null -ne $invokePattern)
  }

  $valuePattern = Try-GetPattern $element ([System.Windows.Automation.ValuePattern]::Pattern)
  if ($null -ne $valuePattern) {
    $patterns.value = [PSCustomObject]@{
      supported = $true
      isReadOnly = $valuePattern.Current.IsReadOnly
      value = $valuePattern.Current.Value
    }
  } else {
    $patterns.value = [PSCustomObject]@{
      supported = $false
    }
  }

  $selectionItemPattern = Try-GetPattern $element ([System.Windows.Automation.SelectionItemPattern]::Pattern)
  if ($null -ne $selectionItemPattern) {
    $patterns.selectionItem = [PSCustomObject]@{
      supported = $true
      isSelected = $selectionItemPattern.Current.IsSelected
    }
  } else {
    $patterns.selectionItem = [PSCustomObject]@{
      supported = $false
    }
  }

  $expandCollapsePattern = Try-GetPattern $element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
  if ($null -ne $expandCollapsePattern) {
    $patterns.expandCollapse = [PSCustomObject]@{
      supported = $true
      state = $expandCollapsePattern.Current.ExpandCollapseState.ToString()
    }
  } else {
    $patterns.expandCollapse = [PSCustomObject]@{
      supported = $false
    }
  }

  $windowPattern = Try-GetPattern $element ([System.Windows.Automation.WindowPattern]::Pattern)
  if ($null -ne $windowPattern) {
    $patterns.window = [PSCustomObject]@{
      supported = $true
      canMaximize = $windowPattern.Current.CanMaximize
      canMinimize = $windowPattern.Current.CanMinimize
      isModal = $windowPattern.Current.IsModal
      isTopmost = $windowPattern.Current.IsTopmost
      windowVisualState = $windowPattern.Current.WindowVisualState.ToString()
      windowInteractionState = $windowPattern.Current.WindowInteractionState.ToString()
    }
  } else {
    $patterns.window = [PSCustomObject]@{
      supported = $false
    }
  }

  $scrollPattern = Try-GetPattern $element ([System.Windows.Automation.ScrollPattern]::Pattern)
  if ($null -ne $scrollPattern) {
    $patterns.scroll = [PSCustomObject]@{
      supported = $true
      horizontallyScrollable = $scrollPattern.Current.HorizontallyScrollable
      verticallyScrollable = $scrollPattern.Current.VerticallyScrollable
      horizontalScrollPercent = $scrollPattern.Current.HorizontalScrollPercent
      verticalScrollPercent = $scrollPattern.Current.VerticalScrollPercent
    }
  } else {
    $patterns.scroll = [PSCustomObject]@{
      supported = $false
    }
  }

  $textPattern = Try-GetPattern $element ([System.Windows.Automation.TextPattern]::Pattern)
  if ($null -ne $textPattern) {
    $textPreview = ""
    try {
      $textPreview = $textPattern.DocumentRange.GetText(${textPreviewLength}).Trim()
    } catch {}

    $patterns.text = [PSCustomObject]@{
      supported = $true
      preview = $textPreview
    }
  } else {
    $patterns.text = [PSCustomObject]@{
      supported = $false
    }
  }

  return [PSCustomObject]$patterns
}

function Get-UiAutomationNode($element, $walker, $currentDepth) {
  if ($null -eq $element) {
    return $null
  }

  $nativeWindowHandle = 0
  try { $nativeWindowHandle = $element.Current.NativeWindowHandle } catch {}

  # 控件树读取只保留常用字段，减少无关噪音并控制返回体积。
  $node = [ordered]@{
    name = ""
    automationId = ""
    className = ""
    controlType = ""
    localizedControlType = ""
    frameworkId = ""
    nativeWindowHandle = $nativeWindowHandle
    isEnabled = $false
    hasKeyboardFocus = $false
    boundingRectangle = $null
    patterns = $null
    children = @()
    childrenTruncated = $false
  }

  try { $node.name = $element.Current.Name } catch {}
  try { $node.automationId = $element.Current.AutomationId } catch {}
  try { $node.className = $element.Current.ClassName } catch {}
  try { $node.controlType = Get-ControlTypeName $element.Current.ControlType } catch {}
  try { $node.localizedControlType = $element.Current.LocalizedControlType } catch {}
  try { $node.frameworkId = $element.Current.FrameworkId } catch {}
  try { $node.isEnabled = $element.Current.IsEnabled } catch {}
  try { $node.hasKeyboardFocus = $element.Current.HasKeyboardFocus } catch {}
  try { $node.boundingRectangle = Convert-BoundingRectangle $element.Current.BoundingRectangle } catch {}
  try { $node.patterns = Get-PatternSnapshot $element } catch { $node.patterns = [PSCustomObject]@{} }

  if ($currentDepth -ge ${maxDepth}) {
    return [PSCustomObject]$node
  }

  $children = New-Object System.Collections.Generic.List[object]
  $child = $walker.GetFirstChild($element)
  $childCount = 0

  # 控制最大深度和单层节点数，避免某些复杂窗口把 UI 树撑得过大。
  while ($null -ne $child) {
    if ($childCount -ge ${maxChildren}) {
      $node.childrenTruncated = $true
      break
    }

    $children.Add((Get-UiAutomationNode $child $walker ($currentDepth + 1))) | Out-Null
    $childCount += 1
    $child = $walker.GetNextSibling($child)
  }

  $node.children = $children
  return [PSCustomObject]$node
}

$tree = Get-UiAutomationNode $root $walker 0
[PSCustomObject]@{
  handle = '${safeHandle}'
  mode = 'passive'
  options = [PSCustomObject]@{
    maxDepth = ${maxDepth}
    maxChildren = ${maxChildren}
    textPreviewLength = ${textPreviewLength}
  }
  tree = $tree
} | ConvertTo-Json -Depth 16
`
}

async function parseJsonOutput(result) {
  return result.stdout ? JSON.parse(result.stdout) : null
}

// UI Automation 先只开放被动读取，后续若要执行动作再单独加主动接口。
export async function getWindowAutomationTree(handle, options = {}) {
  const result = await runPowerShell(buildWindowAutomationScript(handle, options))
  return parseJsonOutput(result)
}
