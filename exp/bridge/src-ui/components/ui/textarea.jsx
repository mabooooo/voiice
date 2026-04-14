import { cn } from '@/lib/cn'

export function Textarea({ className, ...props }) {
  return <textarea className={cn('ui-textarea', className)} {...props} />
}
