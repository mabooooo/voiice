import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

function formatJson(value) {
  return JSON.stringify(value, null, 2)
}

function formatFocusedWindowLabel(item) {
  if (!item) {
    return '当前未识别到焦点窗口'
  }

  return `${item.shortId} · ${item.appName || 'Unknown App'} - ${item.title}`
}

// 窗口列表中的单项卡片只负责展示简要信息，并用视觉高亮标记当前焦点窗口。
function WindowListItem({ item, onOpen }) {
  return (
    <button
      type="button"
      className={`window-item ${item.isFocused ? 'window-item--focused' : ''}`}
      onClick={() => onOpen(item.handle)}
    >
      <span className="window-item__title">
        <span className="window-item__short-id">{item.shortId}</span>
        <span>{item.appName || 'Unknown App'} - {item.title}</span>
      </span>
      <span className="window-item__meta">{item.bounds?.x},{item.bounds?.y} · {item.bounds?.width}x{item.bounds?.height}</span>
      <span className="window-item__meta">
        state: {item.state || 'unknown'}
        {item.isFocused ? <span className="window-item__focus-badge">当前焦点</span> : null}
      </span>
    </button>
  )
}

export function WindowManagementPanel({ onLog }) {
  const [windowSnapshot, setWindowSnapshot] = useState({ items: [], focusedWindow: null, updatedAt: null })
  const [selectedWindow, setSelectedWindow] = useState(null)
  const [windowDialogOpen, setWindowDialogOpen] = useState(false)
  const [windowMoveForm, setWindowMoveForm] = useState({ x: '', y: '', width: '', height: '' })
  const [windowBusy, setWindowBusy] = useState(false)
  const [automationBusy, setAutomationBusy] = useState(false)
  const [windowAutomation, setWindowAutomation] = useState(null)

  useEffect(() => {
    refreshWindows()
  }, [])

  function appendWindowLog(message) {
    onLog?.(message)
  }

  function syncMoveForm(item) {
    setWindowMoveForm({
      x: String(item?.bounds?.x ?? ''),
      y: String(item?.bounds?.y ?? ''),
      width: String(item?.bounds?.width ?? ''),
      height: String(item?.bounds?.height ?? ''),
    })
  }

  // 窗口快照由主进程维护，这里只做拉取与展示，确保 UI 和 LLM 使用同一份前台状态。
  async function refreshWindows() {
    try {
      const snapshot = await window.bridgeApi.refreshWindows()
      setWindowSnapshot(snapshot)
      appendWindowLog(`窗口列表已刷新，共 ${snapshot.items.length} 个窗口。`)
    } catch (error) {
      appendWindowLog(`刷新窗口列表失败: ${error.message || error}`)
    }
  }

  // 详情弹窗在打开前重新拉一次详情，避免用户操作旧快照。
  async function openWindowDetail(handle) {
    setWindowBusy(true)
    try {
      const detail = await window.bridgeApi.getWindowDetail(handle)
      setSelectedWindow(detail.item)
      setWindowAutomation(null)
      syncMoveForm(detail.item)
      setWindowDialogOpen(true)
    } catch (error) {
      appendWindowLog(`读取窗口详情失败: ${error.message || error}`)
    } finally {
      setWindowBusy(false)
    }
  }

  // 窗口动作都从这里统一发往主进程，便于后续继续扩展 resize、pin 等动作。
  async function runWindowAction(action) {
    if (!selectedWindow?.handle) return

    setWindowBusy(true)
    try {
      const payload = {
        action,
        handle: selectedWindow.handle,
        processId: selectedWindow.processId,
      }

      if (action === 'move') {
        payload.bounds = {
          x: Number(windowMoveForm.x),
          y: Number(windowMoveForm.y),
          width: Number(windowMoveForm.width),
          height: Number(windowMoveForm.height),
        }
      }

      const result = await window.bridgeApi.windowAction(payload)
      appendWindowLog(`窗口动作执行完成: ${formatJson(result)}`)

      const snapshot = await window.bridgeApi.refreshWindows()
      setWindowSnapshot(snapshot)

      if (action === 'close') {
        setWindowDialogOpen(false)
        setSelectedWindow(null)
        return
      }

      const detail = await window.bridgeApi.getWindowDetail(selectedWindow.handle)
      setSelectedWindow(detail.item)
      syncMoveForm(detail.item)
    } catch (error) {
      appendWindowLog(`窗口动作执行失败: ${error.message || error}`)
    } finally {
      setWindowBusy(false)
    }
  }

  // UI Automation 当前只做被动读取，便于先验证结构和字段，再决定是否开放主动操作。
  async function loadWindowAutomation() {
    if (!selectedWindow?.handle) return

    setAutomationBusy(true)
    try {
      const result = await window.bridgeApi.getWindowAutomation({
        handle: selectedWindow.handle,
        options: {
          maxDepth: 4,
          maxChildren: 40,
          textPreviewLength: 200,
        },
      })
      setWindowAutomation(result.automation)
      appendWindowLog(`已获取窗口 UI Automation：${selectedWindow.shortId || selectedWindow.handle}`)
    } catch (error) {
      appendWindowLog(`获取窗口 UI Automation 失败: ${error.message || error}`)
    } finally {
      setAutomationBusy(false)
    }
  }

  return (
    <>
      <section className="side-section">
        <div className="side-section__row">
          <div className="subpanel__title">窗口列表</div>
          <Button variant="secondary" size="sm" onClick={refreshWindows} disabled={windowBusy}>手动刷新</Button>
        </div>
        <div className="window-focus-summary">
          <div className="window-focus-summary__label">当前焦点窗口</div>
          <div className="window-focus-summary__value">{formatFocusedWindowLabel(windowSnapshot.focusedWindow)}</div>
        </div>
        <div className="helper-text">{windowSnapshot.updatedAt ? `上次更新: ${windowSnapshot.updatedAt}` : '尚未加载窗口列表'}</div>
        <ScrollArea className="window-list">
          <div className="list-stack">
            {windowSnapshot.items.map((item) => (
              <WindowListItem key={item.handle} item={item} onOpen={openWindowDetail} />
            ))}
          </div>
        </ScrollArea>
      </section>

      <Dialog open={windowDialogOpen} onOpenChange={setWindowDialogOpen}>
        <DialogHeader>
          <DialogTitle>{selectedWindow?.title || '窗口详情'}</DialogTitle>
          <DialogDescription>查看当前窗口的应用信息与位置，并执行焦点、关闭、移动等已开放接口。</DialogDescription>
        </DialogHeader>
        <div className="dialog-grid">
          <section className="subpanel">
            <div className="subpanel__title">基本信息</div>
            <pre className="console-block console-block--compact">{formatJson(selectedWindow || {})}</pre>
          </section>
          <section className="subpanel">
            <div className="subpanel__title">移动窗口</div>
            <div className="move-grid">
              <Input value={windowMoveForm.x} onChange={(event) => setWindowMoveForm((current) => ({ ...current, x: event.target.value }))} placeholder="x" />
              <Input value={windowMoveForm.y} onChange={(event) => setWindowMoveForm((current) => ({ ...current, y: event.target.value }))} placeholder="y" />
              <Input value={windowMoveForm.width} onChange={(event) => setWindowMoveForm((current) => ({ ...current, width: event.target.value }))} placeholder="width" />
              <Input value={windowMoveForm.height} onChange={(event) => setWindowMoveForm((current) => ({ ...current, height: event.target.value }))} placeholder="height" />
            </div>
          </section>
          <section className="subpanel dialog-grid__full">
            <div className="side-section__row">
              <div className="subpanel__title">UI Automation（只读）</div>
              <Button variant="secondary" size="sm" onClick={loadWindowAutomation} disabled={automationBusy || windowBusy}>
                {automationBusy ? '获取中...' : '获取UI'}
              </Button>
            </div>
            <div className="helper-text">
              返回当前窗口的 UIA 控件树与常用 Pattern 状态，不执行点击、输入或滚动等主动操作。
            </div>
            <ScrollArea className="window-automation-view">
              <pre className="console-block console-block--compact">
                {formatJson(windowAutomation || { mode: 'passive', status: '尚未获取 UI Automation' })}
              </pre>
            </ScrollArea>
          </section>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => runWindowAction('focus')} disabled={windowBusy}>调起 / 聚焦</Button>
          <Button variant="secondary" onClick={() => runWindowAction('move')} disabled={windowBusy}>移动窗口</Button>
          <Button onClick={() => runWindowAction('close')} disabled={windowBusy}>关闭窗口</Button>
        </DialogFooter>
      </Dialog>
    </>
  )
}
