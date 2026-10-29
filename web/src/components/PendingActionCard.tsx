import { useState } from 'react'
import { Ban, CheckCircle2, CirclePause, Paperclip, Send, ShieldAlert } from 'lucide-react'
import { api } from '../lib/api'
import { useApp } from '../lib/app'
import { asList, cx, shortPrincipal } from '../lib/format'
import type { PendingAction, Shield, TaintItem } from '../lib/types'
import { SourceChip } from './trust'
import { Spinner } from './ui'

const TOOL_LABEL: Record<string, string> = {
  send_email: 'Send email',
  create_event: 'Create calendar event',
  create_task: 'Create reminder',
  http_post: 'POST to a URL',
}

const RECIPIENT_ARGS = ['to', 'cc', 'bcc', 'attendees']

function TaintedValue({ value, item }: { value: string; item?: TaintItem }) {
  if (!item) return <span className="font-mono text-[12px]">{value}</span>
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-red/40 bg-red/10 px-1.5 py-px font-mono text-[12px] text-red-ink">
      <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden />
      {value}
    </span>
  )
}

function findTaint(taint: TaintItem[], arg: string, value: string) {
  const v = value.toLowerCase()
  return taint.find((t) => (t.arg === arg || t.arg.startsWith(`${arg}[`) || t.arg.startsWith(`${arg}.`)) && v.includes(String(t.value).toLowerCase()))
    ?? taint.find((t) => v === String(t.value).toLowerCase())
}

export type ActionOutcome = { status: 'executed' | 'rejected'; detail?: string }

export function PendingActionCard({
  action,
  shield = 'on',
  resolved: resolvedInit,
  onResolved,
  compact = false,
}: {
  action: PendingAction
  shield?: Shield
  resolved?: ActionOutcome | 'unknown' | null
  onResolved?: (o: ActionOutcome) => void
  compact?: boolean
}) {
  const { toast, refreshSession } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ActionOutcome | 'unknown' | null>(resolvedInit ?? null)
  const args = action.args ?? {}
  const taint = action.taint ?? []
  const hasRecipientTaint = taint.some((t) => RECIPIENT_ARGS.some((a) => t.arg === a || t.arg.startsWith(a)))

  const decide = async (decision: 'approve' | 'approve_clean' | 'reject') => {
    setBusy(decision)
    try {
      const r = await api.decideAction(action.id, decision, shield)
      if (r.error) {
        toast({ tone: 'error', title: 'Could not complete that', body: r.error })
        if (/no such pending/.test(r.error)) setOutcome('unknown')
        return
      }
      const to = asList(r.args?.to).join(', ')
      const o: ActionOutcome =
        r.status === 'rejected'
          ? { status: 'rejected' }
          : {
              status: 'executed',
              detail:
                action.tool === 'send_email'
                  ? `Sent to ${to || 'recipients'}${asList(r.args?.cc).length ? `, cc ${asList(r.args?.cc).join(', ')}` : ''}`
                  : 'Done',
            }
      setOutcome(o)
      onResolved?.(o)
      toast({
        tone: o.status === 'executed' ? 'success' : 'info',
        title: o.status === 'executed' ? (decision === 'approve_clean' ? 'Sent without the flagged recipients' : 'Approved and executed') : 'Action rejected',
        body: o.detail,
      })
      refreshSession()
    } finally {
      setBusy(null)
    }
  }

  const isEmail = action.tool === 'send_email'
  const field = (k: string, label: string) => {
    const vals = asList(args[k])
    if (!vals.length) return null
    return (
      <div className="grid grid-cols-[72px_1fr] items-start gap-2 py-1">
        <div className="pt-0.5 text-[12px] text-muted">{label}</div>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {vals.map((v) => (
            <TaintedValue key={v} value={v} item={findTaint(taint, k, v)} />
          ))}
        </div>
      </div>
    )
  }

  const pending = !outcome
  return (
    <div
      className={cx(
        'overflow-hidden rounded-xl border bg-surface',
        pending ? 'border-red/35 shadow-[0_0_0_3px_rgb(var(--trust-red)/0.06)]' : 'border-line',
      )}
    >
      <div className={cx('flex items-center justify-between gap-3 border-b px-4 py-2.5', pending ? 'border-red/20 bg-red/[0.05]' : 'border-line bg-sunken')}>
        <div className="flex min-w-0 items-center gap-2">
          {pending ? <CirclePause className="h-4 w-4 shrink-0 text-red-ink" /> : outcome !== 'unknown' && outcome?.status === 'executed' ? <CheckCircle2 className="h-4 w-4 text-muted" /> : <Ban className="h-4 w-4 text-muted" />}
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">
              {pending ? 'Paused for your confirmation' : outcome === 'unknown' ? 'Already resolved' : outcome.status === 'executed' ? 'Approved' : 'Rejected'}
              <span className="font-normal text-muted"> · {TOOL_LABEL[action.tool] ?? action.tool}</span>
            </div>
          </div>
        </div>
        <span className="hidden font-mono text-[11px] text-faint sm:inline">{action.id.slice(-8)}</span>
      </div>

      <div className="px-4 py-3">
        {isEmail ? (
          <div className="rounded-lg border border-line bg-sunken px-3 py-2">
            {field('to', 'To')}
            {field('cc', 'Cc')}
            {field('bcc', 'Bcc')}
            {args.subject ? (
              <div className="grid grid-cols-[72px_1fr] gap-2 py-1">
                <div className="text-[12px] text-muted">Subject</div>
                <div className="text-[13px] font-medium">{String(args.subject)}</div>
              </div>
            ) : null}
            {!compact && args.body ? (
              <p className="mt-1 whitespace-pre-wrap border-t border-line pt-2 text-[12.5px] leading-relaxed text-fg/85">{String(args.body)}</p>
            ) : null}
            {asList(args.attachments).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
                {asList(args.attachments).map((a) => (
                  <span key={a} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11.5px]">
                    <Paperclip className="h-3 w-3 text-faint" /> {a}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-sunken px-3 py-2">
            {Object.entries(args).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[96px_1fr] gap-2 py-1">
                <div className="font-mono text-[11.5px] text-muted">{k}</div>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {asList(v).length ? asList(v).map((x) => <TaintedValue key={x} value={x} item={findTaint(taint, k, x)} />) : <span className="text-faint">—</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {taint.length > 0 && (
          <ul className="mt-3 space-y-2">
            {taint.map((t, i) => (
              <li key={i} className="flex gap-2.5 text-[12.5px]">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-red" aria-hidden />
                <div className="min-w-0">
                  <span className="font-mono text-[12px] text-red-ink">{t.value}</span>
                  <span className="text-muted"> in </span>
                  <span className="font-mono text-[11.5px] text-muted">{t.arg}</span>
                  <p className="mt-0.5 text-fg/85">{t.reason}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-faint">
                    came from <SourceChip principal={t.source} trust={t.trust} size="sm" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {pending ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {hasRecipientTaint && (
              <button className="btn btn-primary" disabled={!!busy} onClick={() => decide('approve_clean')}>
                {busy === 'approve_clean' ? <Spinner className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                {isEmail ? 'Send without flagged recipients' : 'Run without flagged values'}
              </button>
            )}
            <button className="btn" disabled={!!busy} onClick={() => decide('reject')}>
              {busy === 'reject' ? <Spinner className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
              Reject
            </button>
            <button className="btn btn-danger" disabled={!!busy} onClick={() => decide('approve')}>
              {busy === 'approve' && <Spinner className="h-3.5 w-3.5" />}
              Approve anyway
            </button>
          </div>
        ) : (
          outcome !== 'unknown' &&
          outcome.detail && <p className="mt-3 text-[12.5px] text-muted">{outcome.detail}</p>
        )}
        {taint.length > 0 && pending && (
          <p className="mt-3 text-[11.5px] text-faint">
            Flagged values trace back to {Array.from(new Set(taint.map((t) => shortPrincipal(t.source)))).join(', ')}, not to anything you said.
          </p>
        )}
      </div>
    </div>
  )
}
