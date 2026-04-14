import { cn } from '@/lib/cn'

export function Card({ className, ...props }) {
  return <section className={cn('ui-card', className)} {...props} />
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('ui-card__header', className)} {...props} />
}

export function CardTitle({ className, ...props }) {
  return <h2 className={cn('ui-card__title', className)} {...props} />
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('ui-card__description', className)} {...props} />
}

export function CardContent({ className, ...props }) {
  return <div className={cn('ui-card__content', className)} {...props} />
}

export function CardFooter({ className, ...props }) {
  return <div className={cn('ui-card__footer', className)} {...props} />
}
