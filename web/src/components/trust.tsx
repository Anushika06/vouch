import {
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock3,
  EyeOff,
  Globe,
  Hourglass,
  Mail,
  Puzzle,
  ShieldAlert,
  User,
  UserCheck,
  Wrench,
  XCircle,
} from 'lucide-react'
import type { ReactNode } from 'react'
import {
  STATUS_HELP,
  STATUS_LABEL,
  TRUST_LABEL,
  TRUST_LONG,
  TYPE_LABEL,
  cx,
  flagLabel,
  isHttp,
  demoSiteHref,
  parsePrincipal,
  techniqueLabel,
} from '../lib/format'
import type { HiddenText, MemType, Status, Trust } from '../lib/types'
import { Hover } from './ui'

const DOT: Record<Trust, string> = { GREEN: 'bg-green', YELLOW: 'bg-yellow', RED: 'bg-red' }
const RAIL: Record<Trust, string> = { GREEN: 'border-l-green', YELLOW: 'border-l-yellow', RED: 'border-l-red' }
const INK: Record<Trust, string> = { GREEN: 'text-green-ink', YELLOW: 'text-yellow-ink', RED: 'text-red-ink' }
const TINT: Record<Trust, string> = {
  GREEN: 'bg-green/10 border-green/30',
  YELLOW: 'bg-yellow/10 border-yellow/35',
  RED: 'bg-red/10 border-red/30',
}
const WORD: Record<Trust, string> = { GREEN: 'Green', YELLOW: 'Yellow', RED: 'Red' }

export const trustRail = (t: Trust | null | undefined) => (t ? RAIL[t] : 'border-l-line')
export const trustInk = (t: Trust | null | undefined) => (t ? INK[t] : 'text-muted')
export const trustTint = (t: Trust | null | undefined) => (t ? TINT[t] : 'bg-raised border-line')

export function TrustDot({ trust, className }: { trust: Trust | null | undefined; className?: string }) {
  if (!trust) return <span className={cx('inline-block h-2 w-2 rounded-full bg-faint', className)} aria-hidden />
  return (
    <span
      className={cx('inline-block h-2 w-2 shrink-0 rounded-full', DOT[trust], className)}
      aria-label={`${WORD[trust]} trust`}
      role="img"
    />
  )
}

export function TrustBadge({
  trust,
  detail = false,
  size = 'md',
  title,
}: {
  trust: Trust | null | undefined
  detail?: boolean
  size?: 'sm' | 'md'
  title?: string
}) {
  if (!trust) return null
  return (
    <span
      title={title ?? TRUST_LONG[trust]}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium',
        TINT[trust],
        INK[trust],
        size === 'sm' ? 'h-5 px-1.5 text-[11px]' : 'h-6 px-2 text-[12px]',
      )}
    >
      <span className={cx('h-1.5 w-1.5 rounded-full', DOT[trust])} aria-hidden />
      {WORD[trust]}
      {detail && <span className="font-normal opacity-80">· {TRUST_LABEL[trust]}</span>}
    </span>
  )
}

const STATUS_ICON: Record<Status, typeof Circle> = {
  active: CircleDot,
  claim: Circle,
  corroborated_claim: CheckCircle2,
  pending_approval: Clock3,
  rejected: XCircle,
  disputed: ArrowRightLeft,
  expired: Hourglass,
  superseded: ArrowRightLeft,
}

const STATUS_STYLE: Record<Status, string> = {
  active: 'border-line-strong text-fg bg-raised',
  claim: 'border-dashed border-line-strong text-muted',
  corroborated_claim: 'border-line-strong text-fg',
  pending_approval: 'border-accent/45 text-accent bg-accent/10',
  rejected: 'border-line text-faint line-through decoration-faint/60',
  disputed: 'border-line-strong text-muted',
  expired: 'border-line text-faint',
  superseded: 'border-line text-faint',
}

export function StatusPill({ status, size = 'md' }: { status: Status; size?: 'sm' | 'md' }) {
  const Icon = STATUS_ICON[status] ?? Circle
  return (
    <span
      title={STATUS_HELP[status]}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-full border font-medium',
        STATUS_STYLE[status] ?? 'border-line text-muted',
        size === 'sm' ? 'h-5 px-1.5 text-[11px]' : 'h-6 px-2 text-[12px]',
      )}
    >
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />
      <span className="no-underline">{STATUS_LABEL[status] ?? status}</span>
    </span>
  )
}

export function TypeTag({ type }: { type: MemType | string }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-raised px-1.5 text-[11px] font-medium text-muted">
      {TYPE_LABEL[type as MemType] ?? type}
    </span>
  )
}

const PRINCIPAL_ICON: Record<string, typeof Globe> = {
  domain: Globe,
  contact: UserCheck,
  sender: Mail,
  user: User,
  skill: Puzzle,
  tool: Wrench,
  assistant: Bot,
}

export function SourceChip({
  principal,
  trust,
  refUrl,
  size = 'md',
  className,
}: {
  principal: string | null | undefined
  trust?: Trust | null
  refUrl?: string | null
  size?: 'sm' | 'md'
  className?: string
}) {
  const p = parsePrincipal(principal)
  const Icon = PRINCIPAL_ICON[p.kind] ?? Globe
  const body = (
    <>
      <Icon className={cx('shrink-0', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5', trust ? INK[trust] : 'text-faint')} aria-hidden />
      <span className={cx('truncate', p.kind !== 'user' && 'font-mono tracking-[-0.01em]', size === 'sm' ? 'text-[11px]' : 'text-[11.5px]')}>
        {p.value}
      </span>
    </>
  )
  const cls = cx(
    'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border border-line bg-sunken text-fg/90',
    size === 'sm' ? 'h-5 px-1.5' : 'h-6 px-2',
    className,
  )
  const title = `${p.raw || 'unknown source'}${refUrl ? `\n${refUrl}` : ''}`
  if (refUrl && isHttp(refUrl))
    return (
      <a href={demoSiteHref(refUrl)} target="_blank" rel="noreferrer" title={title} className={cx(cls, 'hover:border-line-strong')}>
        {body}
      </a>
    )
  return (
    <span title={title} className={cls}>
      {body}
    </span>
  )
}

export function FlagChip({ flag, tone = 'red' }: { flag: string; tone?: 'red' | 'neutral' }) {
  return (
    <span
      className={cx(
        'inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-medium',
        tone === 'red' ? 'border-red/25 bg-red/[0.07] text-red-ink' : 'border-line bg-raised text-muted',
      )}
    >
      {flagLabel(flag)}
    </span>
  )
}

export function FlagRow({ flags, tone = 'red' }: { flags: string[] | undefined; tone?: 'red' | 'neutral' }) {
  if (!flags?.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <FlagChip key={f} flag={f} tone={tone} />
      ))}
    </div>
  )
}

/** Text that was invisible to a human on the page, revealed. */
export function HiddenReveal({ hidden, compact = false }: { hidden: HiddenText[] | undefined; compact?: boolean }) {
  if (!hidden?.length) return null
  return (
    <div className="space-y-2">
      {hidden.map((h, i) => (
        <div key={i} className="rounded-lg border border-red/35 bg-red/[0.06]">
          <div className="flex items-center gap-1.5 border-b border-red/20 px-3 py-1.5 text-[12px] font-medium text-red-ink">
            <EyeOff className="h-3.5 w-3.5" aria-hidden />
            Invisible to you on the page <span className="font-mono text-[11px] opacity-80">({h.technique})</span>
          </div>
          <p className={cx('px-3 py-2 text-[13px] leading-relaxed text-fg', compact && 'line-clamp-3')}>{h.text}</p>
        </div>
      ))}
    </div>
  )
}

export function TechniqueNote({ technique }: { technique: string | null | undefined }) {
  if (!technique) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-red/30 bg-red/[0.07] px-1.5 text-[11px] font-medium text-red-ink">
      <EyeOff className="h-3 w-3" aria-hidden /> Hidden via {techniqueLabel(technique)}
    </span>
  )
}

/** Hover card describing where a piece of text came from. */
export function ProvenanceCard({
  trust,
  source,
  refUrl,
  extra,
}: {
  trust: Trust
  source?: string
  refUrl?: string
  extra?: ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <TrustBadge trust={trust} detail size="sm" />
      </div>
      {source && (
        <div>
          <div className="mb-1 text-[11px] text-faint">Source</div>
          <SourceChip principal={source} trust={trust} />
        </div>
      )}
      {refUrl && (
        <div>
          <div className="mb-1 text-[11px] text-faint">Reference</div>
          {isHttp(refUrl) ? (
            <a href={demoSiteHref(refUrl)} target="_blank" rel="noreferrer" className="break-all font-mono text-[11.5px] text-accent hover:underline">
              {refUrl}
            </a>
          ) : (
            <span className="break-all font-mono text-[11.5px] text-muted">{refUrl}</span>
          )}
        </div>
      )}
      {trust === 'RED' && (
        <p className="flex items-start gap-1.5 text-[11.5px] text-muted">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-ink" />
          Quoted from an untrusted source. Vouch shows it but never acts on it.
        </p>
      )}
      {extra}
    </div>
  )
}

export function TrustSpan({
  trust,
  source,
  refUrl,
  children,
}: {
  trust: Trust
  source?: string
  refUrl?: string
  children: ReactNode
}) {
  return (
    <Hover className={cx('seg', `seg-${trust}`)} card={<ProvenanceCard trust={trust} source={source} refUrl={refUrl} />}>
      {children}
      <sup className="ml-0.5 inline-flex -translate-y-px align-super">
        <TrustDot trust={trust} className="h-[5px] w-[5px]" />
      </sup>
    </Hover>
  )
}
