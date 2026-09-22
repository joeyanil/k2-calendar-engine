import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Four hierarchy levels, doc 20 §5. Hover/active states use portal-scoped
// CSS vars (motion-duration/ease) rather than hardcoded durations, so a
// button dropped into any [data-portal] scope automatically gets that
// portal's motion character — no per-portal Button variant needed.
// Ported verbatim from k2-ui-foundation-test.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,transform] disabled:pointer-events-none disabled:opacity-40 [transition-duration:var(--motion-duration)] [transition-timing-function:var(--motion-ease)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  {
    variants: {
      level: {
        primary: 'bg-primary text-primary-foreground hover:brightness-95',
        secondary: 'border-[1.5px] border-border bg-transparent text-foreground hover:bg-card',
        ghost:
          // was text-primary — brand-primary as literal text color measured
          // 2.08:1 on Student, 3.11:1 on Main Admin — both fail WCAG AA.
          // text-foreground keeps every portal's ghost button reliably
          // readable; brand-primary still does its job via bg-card on hover.
          'bg-transparent text-foreground hover:bg-card',
        danger: 'bg-error text-white hover:brightness-95',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-sm px-3',
        lg: 'h-11 rounded-lg px-8',
        icon: 'h-9 w-9', // doc 20 §5: 36×36 min hit target for icon buttons
      },
    },
    defaultVariants: { level: 'primary', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  loadingText?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, level, size, asChild = false, loading, loadingText, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ level, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {loadingText ?? children}
          </>
        ) : (
          children
        )}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
