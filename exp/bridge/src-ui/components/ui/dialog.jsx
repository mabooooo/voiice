import { cn } from '@/lib/cn'

export function Dialog({ open, onOpenChange, children }) {
  if (!open) {
    return null
  }

  return (
    <div className="ui-dialog">
      <button className="ui-dialog__overlay" type="button" onClick={() => onOpenChange?.(false)} />
      <div className="ui-dialog__content">{children}</div>
    </div>
  )
}

export function DialogHeader({ className, ...props }) {
  return <div className={cn('ui-dialog__header', className)} {...props} />
}

export function DialogTitle({ className, ...props }) {
  return <h3 className={cn('ui-dialog__title', className)} {...props} />
}

export function DialogDescription({ className, ...props }) {
  return <p className={cn('ui-dialog__description', className)} {...props} />
}

export function DialogFooter({ className, ...props }) {
  return <div className={cn('ui-dialog__footer', className)} {...props} />
}
