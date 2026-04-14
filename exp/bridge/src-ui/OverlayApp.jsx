import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="overlay-icon">
      <path
        fill="currentColor"
        d="m7.4 6 4.6 4.6L16.6 6 18 7.4 13.4 12 18 16.6 16.6 18 12 13.4 7.4 18 6 16.6 10.6 12 6 7.4 7.4 6Z"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="overlay-icon">
      <path fill="currentColor" d="m9.55 17.2-4.85-4.85 1.4-1.4 3.45 3.45 8.35-8.35 1.4 1.4-9.75 9.75Z" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="overlay-info-icon">
      <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="8" r="1.3" fill="currentColor" />
      <path fill="currentColor" d="M11.1 10.5h1.8V17h-1.8z" />
    </svg>
  )
}

function ListeningBars({ level = 0 }) {
  const bars = useMemo(() => {
    const eased = Math.max(0.08, Math.min(1, level))
    return [0.42, 0.68, 0.92, 0.75, 0.5].map((factor, index) => ({
      id: index,
      scale: 0.32 + eased * factor,
    }))
  }, [level])

  return (
    <div className="overlay-listening-bars" aria-hidden="true">
      {bars.map((bar) => (
        <span key={bar.id} style={{ transform: `scaleY(${bar.scale})` }} />
      ))}
    </div>
  )
}

function IdleMic() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="overlay-idle-icon">
      <path
        fill="currentColor"
        d="M12 15a3.5 3.5 0 0 0 3.5-3.5V7a3.5 3.5 0 1 0-7 0v4.5A3.5 3.5 0 0 0 12 15Zm6-3.5a1 1 0 1 0-2 0 4 4 0 1 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.59a6 6 0 0 0 5-5.91Z"
      />
    </svg>
  )
}

function ListeningView({ state }) {
  return (
    <div className="overlay-listening-shell">
      <div className="overlay-cap overlay-cap--muted">
        <CloseIcon />
      </div>
      <ListeningBars level={state.level || 0} />
      <div className="overlay-cap overlay-cap--bright">
        <CheckIcon />
      </div>
    </div>
  )
}

function WaitingView() {
  return (
    <div className="overlay-thinking-shell">
      <div className="overlay-thinking-tone" />
      <div className="overlay-thinking-copy">Thinking</div>
      <div className="overlay-thinking-mask" />
    </div>
  )
}

function ExecutingView({ state }) {
  return (
    <div className="overlay-result-card">
      <div className="overlay-result-card__header">
        <div className="overlay-result-card__title-wrap">
          <InfoIcon />
          <div className="overlay-result-card__title">{state.title || '已执行命令'}</div>
        </div>
        <CloseIcon />
      </div>
      <div className="overlay-result-card__body">{state.subtitle || '无返回内容'}</div>
    </div>
  )
}

export function OverlayApp() {
  const [overlayState, setOverlayState] = useState({
    status: 'idle',
    title: 'Voice Bridge',
    subtitle: '',
    level: 0,
  })
  const containerRef = useRef(null)

  useEffect(() => {
    return window.bridgeApi.onOverlayState((payload) => {
      setOverlayState((current) => ({
        ...current,
        ...payload,
      }))
    })
  }, [])

  useLayoutEffect(() => {
    if (!containerRef.current) {
      return
    }

    const element = containerRef.current
    const pushLayout = () => {
      const rect = element.getBoundingClientRect()
      window.bridgeApi.updateOverlayLayout({
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
      })
    }

    pushLayout()
    const observer = new ResizeObserver(pushLayout)
    observer.observe(element)
    return () => observer.disconnect()
  }, [overlayState])

  const overlayClassName = useMemo(() => {
    return `overlay-surface overlay-surface--${overlayState.status || 'idle'}`
  }, [overlayState.status])

  return (
    <div className="overlay-root">
      <div ref={containerRef} className={overlayClassName}>
        {overlayState.status === 'idle' ? (
          <div className="overlay-idle-dot-shell">
            <IdleMic />
          </div>
        ) : null}
        {overlayState.status === 'listening' ? <ListeningView state={overlayState} /> : null}
        {overlayState.status === 'waiting' ? <WaitingView state={overlayState} /> : null}
        {overlayState.status === 'executing' ? <ExecutingView state={overlayState} /> : null}
      </div>
    </div>
  )
}
