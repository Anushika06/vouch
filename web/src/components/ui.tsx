import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Copy, Loader2, X } from 'lucide-react'
import { cx } from '../lib/format'

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={cx('animate-spin', className)} aria-hidden />
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />
}

export function SkeletonList({ rows = 4, className = 'h-16' }: { rows?: number; className?: string }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={className} />
      ))}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] leading-tight">{title}</h1>
          {description && <p className="mt-1.5 max-w-[68ch] text-[13.5px] text-muted text-pretty">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="text-[14px] font-medium">{title}</p>
      {children && <div className="mt-1.5 max-w-[52ch] text-[13px] text-muted text-pretty">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-red/30 bg-red/5 px-3 py-2 text-[13px] text-red-ink">
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Section({
  title,
  count,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode
  count?: number
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cx('mb-8', className)}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="section-title flex items-center gap-2">
            {title}
            {count !== undefined && <span className="tnum rounded-md bg-raised px-1.5 text-[11px] font-medium text-muted">{count}</span>}
          </h2>
          {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ overlays */

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 'max-w-[560px]',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  width?: string
}) {
  useEscape(open, onClose)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) panel.current?.focus()
  }, [open])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/45 animate-fade-in" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={cx(
          'relative flex h-full w-full flex-col border-l border-line bg-surface shadow-pop outline-none animate-slide-in-right',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-[-0.01em]">{title}</div>
            {subtitle && <div className="mt-0.5 text-[12.5px] text-muted">{subtitle}</div>}
          </div>
          <button className="btn btn-ghost btn-sm -mr-1 h-7 w-7 px-0" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  tone = 'default',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  tone?: 'default' | 'danger'
}) {
  useEscape(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />
      <div
        className={cx(
          'relative w-full max-w-[460px] rounded-2xl border bg-surface shadow-pop animate-rise',
          tone === 'danger' ? 'border-red/40' : 'border-line',
        )}
      >
        <div className="px-5 pb-2 pt-5 text-[15px] font-semibold tracking-[-0.01em]">{title}</div>
        <div className="px-5 pb-5 text-[13.5px] text-muted">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** A hover/focus card rendered in a portal so it never gets clipped by scrolling containers. */
export function Hover({
  children,
  card,
  className,
  as = 'span',
}: {
  children: ReactNode
  card: ReactNode
  className?: string
  as?: 'span' | 'div'
}) {
  const ref = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null)
  const timer = useRef<number>()
  const cardRef = useRef<HTMLDivElement>(null)

  const show = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), 90)
  }, [])
  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(false), 120)
  }, [])

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const above = r.top > 220
    setPos({ x: r.left + Math.min(r.width, 320) / 2, y: above ? r.top : r.bottom, above })
  }, [open])

  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el || !pos) return
    const w = el.offsetWidth
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, pos.x - w / 2))
    el.style.left = `${left}px`
  }, [pos])

  const Tag = as as 'span'
  return (
    <>
      <Tag
        ref={ref as React.Ref<HTMLSpanElement>}
        className={className}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        tabIndex={0}
      >
        {children}
      </Tag>
      {open &&
        pos &&
        createPortal(
          <div
            ref={cardRef}
            onMouseEnter={show}
            onMouseLeave={hide}
            className="fixed z-[70] w-max max-w-[340px] rounded-xl border border-line bg-surface p-3 text-[12.5px] text-fg shadow-pop animate-fade-in"
            style={pos.above ? { top: pos.y - 8, transform: 'translateY(-100%)' } : { top: pos.y + 8 }}
            role="tooltip"
          >
            {card}
          </div>,
          document.body,
        )}
    </>
  )
}

/* ------------------------------------------------------------------ controls */

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T
  onChange: (v: T) => void
  items: { value: T; label: ReactNode; count?: number }[]
  className?: string
}) {
  return (
    <div role="tablist" className={cx('inline-flex rounded-lg border border-line bg-sunken p-0.5', className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors',
            value === it.value ? 'bg-surface text-fg shadow-card ring-1 ring-line' : 'text-muted hover:text-fg',
          )}
        >
          {it.label}
          {it.count !== undefined && it.count > 0 && <span className="tnum text-[11px] text-faint">{it.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Collapsible({
  title,
  children,
  defaultOpen = false,
  className,
  right,
}: {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
  right?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <button
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted hover:text-fg"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
          {title}
        </button>
        {right}
      </div>
      {open && <div className="mt-2 animate-fade-in">{children}</div>}
    </div>
  )
}

export function TagInput({
  values,
  onChange,
  placeholder,
  validate,
  mono = true,
}: {
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  validate?: (v: string) => string | null
  mono?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const add = () => {
    const v = draft.trim()
    if (!v) return
    const e = validate?.(v) ?? null
    if (e) {
      setErr(e)
      return
    }
    if (!values.map((x) => x.toLowerCase()).includes(v.toLowerCase())) onChange([...values, v])
    setDraft('')
    setErr(null)
  }
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && !draft && values.length) {
      onChange(values.slice(0, -1))
    }
  }
  return (
    <div>
      <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border border-line bg-sunken px-2 py-1.5 focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/20">
        {values.map((v) => (
          <span
            key={v}
            className={cx(
              'inline-flex items-center gap-1 rounded-md border border-line bg-surface py-0.5 pl-2 pr-1 text-[12px]',
              mono && 'font-mono text-[11.5px]',
            )}
          >
            {v}
            <button
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="rounded p-0.5 text-faint hover:bg-raised hover:text-fg"
              aria-label={`Remove ${v}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setErr(null)
          }}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={values.length ? '' : placeholder}
          className="min-w-[160px] flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-faint"
        />
      </div>
      {err && <p className="mt-1 text-[12px] text-red-ink">{err}</p>}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="inline-flex items-center gap-1 rounded px-1 text-[11px] text-faint hover:text-fg"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        })
      }}
      aria-label={label}
      title={label}
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  )
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-raised',
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

export function KeyVal({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5 text-[13px]">
      <div className="text-muted">{k}</div>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}
