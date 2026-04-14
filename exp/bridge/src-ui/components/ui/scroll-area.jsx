import { cn } from '@/lib/cn'

export function ScrollArea({ className, ...props }) {
  return <div className={cn('ui-scroll-area', className)} {...props} />
}
