import { cn } from '@/lib/cn'

export function Input({ className, ...props }) {
  return <input className={cn('ui-input', className)} {...props} />
}
