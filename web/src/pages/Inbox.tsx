import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  BookOpenCheck,
  CalendarPlus,
  Check,
  FileText,
  Inbox as InboxIcon,
  MailOpen,
  Paperclip,
  PenLine,
  Send,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useLoad } from '../lib/app'
import { cx, fmtDate, fmtDateTime, techniqueLabel, timeAgo, wallTime } from '../lib/format'
import type { Email, OutboxItem, ReaderOutput, Settings, Trust, TurnResult } from '../lib/types'
import { MemoryEventChips, Segments } from '../components/Answer'
import { PageShell } from '../components/Layout'
import { FlagRow, HiddenReveal, TrustBadge, TrustDot, TrustSpan, trustRail } from '../components/trust'
import { EmptyState, ErrorNote, PageHeader, SkeletonList, Spinner, TagInput, Tabs } from '../components/ui'

type Tab = 'inbox' | 'outbox' | 'calendar'
const OWN = 'asha@ashamenon.example'

function useTrusted(settings: Settings | null) {
  return useMemo(() => {
    const contacts = new Set([...(settings?.trusted_contacts ?? []), OWN].map((x) => x.toLowerCase()))
    const domains = (settings?.trusted_domains ?? []).map((d) => d.toLowerCase())
    return (addr: string) => {
      const a = addr.toLowerCase().trim()
      const dom = a.split('@')[1] ?? ''
      return contacts.has(a) || domains.some((d) => dom === d || dom.endsWith(`.${d}`))
    }
  }, [settings])
}

const FRAME: Record<Trust, string> = {
  RED: 'Untrusted content — Vouch reads this in quarantine',
  YELLOW: 'From a trusted contact — still checked before Vouch acts on it',
  GREEN: 'From you',
}

/* ------------------------------------------------------------------ composer */

interface Draft {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  attachments: string[]
  note?: string
  flags?: string[]
}

function Composer({ initial, isTrusted, onClose, onSent }: { initial: Draft; isTrusted: (a: string) => boolean; onClose: () => void; onSent: () => void }) {
  const { toast } = useApp()
  const [d, setD] = useState<Draft>(initial)
  const [sending, setSending] = useState(false)
  const files = useLoad(() => api.files(), [])
  const untrusted = [...d.to, ...d.cc, ...d.bcc].filter((a) => !isTrusted(a))
  const emailOk = (v: string) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'That doesn’t look like an email address')

  const send = async () => {
    setSending(true)
    try {
      await api.send({ to: d.to, cc: d.cc, bcc: d.bcc, subject: d.subject, body: d.body, attachments: d.attachments })
      toast({ tone: 'success', title: 'Sent to the Outbox', body: 'Nothing real leaves this demo: the Outbox shows exactly what would have been sent.' })
      onSent()
    } finally {
      setSending(false)
    }
  }

  const row = (label: string, key: 'to' | 'cc' | 'bcc') => (
    <div className="grid grid-cols-[52px_1fr] items-start gap-2">
      <span className="pt-2.5 text-[12.5px] text-muted">{label}</span>
      <TagInput values={d[key]} onChange={(v) => setD({ ...d, [key]: v })} placeholder="name@example.com" validate={emailOk} />
    </div>
  )

  return (
    <div className="card overflow-hidden animate-rise">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <PenLine className="h-4 w-4 text-muted" /> Reply
        </div>
        <button className="btn btn-ghost btn-sm h-7 w-7 px-0" onClick={onClose} aria-label="Close composer">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-2.5 p-4">
        {d.note && (
          <div className="rounded-lg bg-sunken px-3 py-2 text-[12.5px] text-muted">
            {d.note}
            {d.flags && d.flags.length > 0 && (
              <div className="mt-1.5">
                <FlagRow flags={d.flags} />
              </div>
            )}
          </div>
        )}
        {row('To', 'to')}
        {row('Cc', 'cc')}
        {row('Bcc', 'bcc')}
        <div className="grid grid-cols-[52px_1fr] items-center gap-2">
          <span className="text-[12.5px] text-muted">Subject</span>
          <input className="input" value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} />
        </div>
        <textarea className="textarea min-h-[160px] leading-relaxed" value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} aria-label="Body" />
        {files.data && files.data.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Paperclip className="h-3.5 w-3.5 text-faint" />
            {files.data.map((f) => {
              const on = d.attachments.includes(f.id)
              return (
                <button
                  key={f.id}
                  onClick={() => setD({ ...d, attachments: on ? d.attachments.filter((x) => x !== f.id) : [...d.attachments, f.id] })}
                  className={cx(
                    'inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11.5px] transition-colors',
                    on ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:text-fg',
                  )}
                  title={f.description}
                >
                  {on && <Check className="h-3 w-3" />}
                  {f.name}
                </button>
              )
            })}
          </div>
        )}
        {untrusted.length > 0 && (
          <p className="flex items-start gap-1.5 rounded-lg border border-red/30 bg-red/[0.06] px-3 py-2 text-[12.5px] text-red-ink">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-mono">{untrusted.join(', ')}</span> {untrusted.length === 1 ? 'is' : 'are'} not in your trusted contacts. Clicking Send is your
              decision, so Vouch will send it.
            </span>
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line bg-sunken/50 px-4 py-3">
        <button className="btn" onClick={onClose}>
          Discard
        </button>
        <button className="btn btn-primary" onClick={send} disabled={sending || !d.to.length}>
          {sending ? <Spinner className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />} Send
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ inbox */

function SummaryView({ r }: { r: Omit<ReaderOutput, 'visible_text'> }) {
  return (
    <div className="space-y-3">
      <p className="text-[13.5px] leading-relaxed">
        <TrustSpan trust={r.trust} source={r.principal} refUrl={r.ref}>
          {r.summary || 'No summary.'}
        </TrustSpan>
      </p>
      {r.flags.length > 0 && <FlagRow flags={r.flags} />}
      {r.instructions.length > 0 && (
        <div>
          <div className="mb-1 text-[12px] text-muted">Text addressed to an AI assistant (not acted on)</div>
          <ul className="space-y-1.5">
            {r.instructions.map((i, k) => (
              <li key={k} className="rounded-lg border border-red/25 bg-red/[0.05] px-3 py-2 text-[12.5px]">
                {i.text}
                {i.hidden && <span className="ml-1 text-[11px] text-faint">hidden via {techniqueLabel(i.hidden)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <HiddenReveal hidden={r.hidden} />
      {r.model && <p className="font-mono text-[11px] text-faint">read by {r.model}</p>}
    </div>
  )
}

function EmailDetail({ e, isTrusted, onSent }: { e: Email; isTrusted: (a: string) => boolean; onSent: () => void }) {
  const { refreshSession } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [read, setRead] = useState<TurnResult | null>(null)
  const [summary, setSummary] = useState<Omit<ReaderOutput, 'visible_text'> | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => {
    setRead(null)
    setSummary(null)
    setDraft(null)
  }, [e.id])

  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <TrustBadge trust={e.trust} detail size="sm" />
          <span className="ml-auto text-[12px] text-faint">{fmtDateTime(e.date)}</span>
        </div>
        <h2 className="mt-2 text-[18px] font-semibold tracking-[-0.015em]">{e.subject}</h2>
        <div className="mt-1 text-[13px]">
          <span className="font-medium">{e.from_name}</span> <span className="font-mono text-[12px] text-muted">&lt;{e.from_addr}&gt;</span>
        </div>
      </div>

      <div className={cx('overflow-hidden rounded-xl border', e.trust === 'RED' ? 'border-red/40' : e.trust === 'YELLOW' ? 'border-yellow/40' : 'border-green/40')}>
        <div
          className={cx(
            'flex items-center gap-2 px-3.5 py-1.5 text-[11.5px] font-medium',
            e.trust === 'RED' ? 'bg-red/10 text-red-ink' : e.trust === 'YELLOW' ? 'bg-yellow/10 text-yellow-ink' : 'bg-green/10 text-green-ink',
          )}
        >
          <TrustDot trust={e.trust} className="h-1.5 w-1.5" />
          {FRAME[e.trust]}
        </div>
        <div className={cx('whitespace-pre-wrap px-4 py-3.5 text-[13.5px] leading-relaxed')}>{e.body}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-primary"
          disabled={!!busy}
          onClick={() =>
            run('read', async () => {
              setRead(await api.readEmail(e.id))
              refreshSession()
            })
          }
        >
          {busy === 'read' ? <Spinner className="h-3.5 w-3.5" /> : <BookOpenCheck className="h-3.5 w-3.5" />} Read with Vouch
        </button>
        <button className="btn" disabled={!!busy} onClick={() => run('sum', async () => setSummary(await api.summarize(e.id)))}>
          {busy === 'sum' ? <Spinner className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />} Summarize
        </button>
        <button
          className="btn"
          disabled={!!busy}
          onClick={() =>
            run('draft', async () => {
              const r = await api.draft(e.id)
              setDraft({ to: r.to, cc: [], bcc: [], subject: r.subject, body: r.body, attachments: [], note: r.note, flags: r.flags })
            })
          }
        >
          {busy === 'draft' ? <Spinner className="h-3.5 w-3.5" /> : <PenLine className="h-3.5 w-3.5" />} Draft reply
        </button>
      </div>

      {read && (
        <div className="card space-y-3 p-4 animate-rise">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
            <BookOpenCheck className="h-3.5 w-3.5" /> Read through the quarantined reader and the Trust Gate
          </div>
          <Segments segments={read.segments} />
          {read.memory_events.length > 0 ? (
            <div>
              <div className="mb-1.5 text-[12px] text-muted">What it tried to save</div>
              <MemoryEventChips events={read.memory_events} />
            </div>
          ) : (
            <p className="text-[12.5px] text-faint">Nothing worth remembering.</p>
          )}
        </div>
      )}
      {summary && (
        <div className="card p-4 animate-rise">
          <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-muted">
            <Sparkles className="h-3.5 w-3.5" /> Summary from the quarantined reader
          </div>
          <SummaryView r={summary} />
        </div>
      )}
      {draft && <Composer initial={draft} isTrusted={isTrusted} onClose={() => setDraft(null)} onSent={() => { setDraft(null); onSent() }} />}
    </div>
  )
}

function InboxTab({ isTrusted, onSent }: { isTrusted: (a: string) => boolean; onSent: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api.inbox(), [])
  const [sel, setSel] = useState<string | null>(null)
  const cur = data?.find((e) => e.id === sel) ?? data?.[0] ?? null
  if (error) return <ErrorNote message={error} onRetry={() => reload()} />
  if (loading && !data) return <SkeletonList rows={6} className="h-14" />
  if (!data?.length) return <EmptyState icon={<InboxIcon className="h-6 w-6" />} title="Your inbox is empty" />
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <ul className="card max-h-[calc(100dvh-230px)] divide-y divide-line overflow-y-auto lg:sticky lg:top-4">
        {data.map((e) => (
          <li key={e.id}>
            <button
              onClick={() => setSel(e.id)}
              className={cx(
                'block w-full border-l-[3px] px-3.5 py-3 text-left transition-colors',
                trustRail(e.trust),
                cur?.id === e.id ? 'bg-raised' : 'hover:bg-raised/50',
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cx('min-w-0 flex-1 truncate text-[13px]', e.unread ? 'font-semibold' : 'text-fg/85')}>{e.from_name}</span>
                <span className="shrink-0 text-[11px] text-faint">{timeAgo(e.date)}</span>
              </div>
              <div className={cx('mt-0.5 truncate text-[12.5px]', e.unread ? 'text-fg' : 'text-muted')}>{e.subject}</div>
              <div className="mt-1 flex items-center gap-1.5">
                <TrustBadge trust={e.trust} size="sm" />
                {e.unread ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="unread" /> : null}
              </div>
            </button>
          </li>
        ))}
      </ul>
      {cur && <EmailDetail e={cur} isTrusted={isTrusted} onSent={onSent} />}
    </div>
  )
}

/* ------------------------------------------------------------------ outbox */

function OutboxCard({ o, isTrusted }: { o: OutboxItem; isTrusted: (a: string) => boolean }) {
  const [open, setOpen] = useState(false)
  const all: [string, string][] = [...o.to_addrs.map((a) => ['to', a] as [string, string]), ...o.cc.map((a) => ['cc', a] as [string, string]), ...o.bcc.map((a) => ['bcc', a] as [string, string])]
  const bad = all.filter(([, a]) => !isTrusted(a))
  return (
    <article className={cx('card overflow-hidden', bad.length && 'border-red/40')}>
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Send className="h-3.5 w-3.5 text-muted" />
          <span className="text-[14px] font-medium">{o.subject || '(no subject)'}</span>
          <span className="ml-auto text-[11.5px] text-faint">
            {o.origin === 'vouch' ? 'sent by the assistant' : o.origin === 'naive' ? 'sent by the naive assistant' : 'sent by you'} · {fmtDateTime(o.sent_at)}
          </span>
        </div>
        <div className="mt-2.5 space-y-1">
          {(['to', 'cc', 'bcc'] as const).map((k) => {
            const xs = all.filter(([kk]) => kk === k)
            if (!xs.length) return null
            return (
              <div key={k} className="grid grid-cols-[36px_1fr] gap-2 text-[12.5px]">
                <span className="text-muted">{k}</span>
                <div className="flex flex-wrap gap-1.5">
                  {xs.map(([, a]) => (
                    <span
                      key={a}
                      className={cx(
                        'rounded-md border px-1.5 py-px font-mono text-[11.5px]',
                        isTrusted(a) ? 'border-line bg-sunken text-fg/85' : 'border-red/40 bg-red/10 text-red-ink',
                      )}
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        {o.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {o.attachments.map((a) => (
              <span key={a} className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11.5px] text-muted">
                <FileText className="h-3 w-3" /> {a}
              </span>
            ))}
          </div>
        )}
        {bad.length > 0 && (
          <p className="mt-2.5 flex items-start gap-1.5 text-[12.5px] text-red-ink">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {bad.map(([, a]) => a).join(', ')} {bad.length === 1 ? 'is' : 'are'} not in your trusted contacts
            {o.attachments.length ? ` and received ${o.attachments.join(', ')}` : ''}.
          </p>
        )}
        <button className="mt-2 text-[12px] text-muted hover:text-fg" onClick={() => setOpen((x) => !x)}>
          {open ? 'Hide message' : 'Show message'}
        </button>
        {open && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-sunken px-3 py-2 text-[13px] leading-relaxed">{o.body}</p>}
      </div>
    </article>
  )
}

function OutboxTab({ isTrusted }: { isTrusted: (a: string) => boolean }) {
  const { data, error, loading, reload } = useLoad(() => api.outbox(), [])
  if (error) return <ErrorNote message={error} onRetry={() => reload()} />
  if (loading && !data) return <SkeletonList rows={3} className="h-28" />
  if (!data?.length)
    return (
      <EmptyState icon={<Send className="h-6 w-6" />} title="Nothing sent yet">
        Ask Vouch to send the October invoice to your accountant, then check here. Every email lands in this simulated Outbox; nothing real is sent.
      </EmptyState>
    )
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted">Exactly what was sent. Recipients outside your trusted contacts are marked red.</p>
      {data.map((o) => (
        <OutboxCard key={o.id} o={o} isTrusted={isTrusted} />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ calendar */

// datetime-local gives wall-clock "YYYY-MM-DDTHH:MM"; store it as Asha's local time (Asia/Kolkata), like the seed data.
function toIso(local: string) {
  return `${local.slice(0, 16)}:00+05:30`
}

function CalendarTab() {
  const { toast } = useApp()
  const { data, setData, error, loading, reload } = useLoad(() => api.calendar(), [])
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [attendees, setAttendees] = useState<string[]>([])
  const [location, setLocation] = useState('')
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const days = useMemo(() => {
    const g: [string, NonNullable<typeof data>['events']][] = []
    for (const e of data?.events ?? []) {
      const k = e.start.slice(0, 10)
      const last = g[g.length - 1]
      if (last && last[0] === k) last[1].push(e)
      else g.push([k, [e]])
    }
    return g
  }, [data])

  const add = async () => {
    if (!title.trim() || !start) return
    setAdding(true)
    try {
      await api.addEvent({ title: title.trim(), start: toIso(start), end: end ? toIso(end) : undefined, attendees, location })
      toast({ tone: 'success', title: 'Event added', body: 'Added by you, so it is green.' })
      setTitle('')
      setStart('')
      setEnd('')
      setAttendees([])
      setLocation('')
      setShowForm(false)
      reload(true)
    } finally {
      setAdding(false)
    }
  }

  const done = async (id: string) => {
    setData((d) => (d ? { ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, done: 1 } : t)) } : d))
    await api.taskDone(id)
  }

  if (error) return <ErrorNote message={error} onRetry={() => reload()} />
  if (loading && !data) return <SkeletonList rows={4} className="h-20" />
  const todayKey = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">Events</h2>
          <button className="btn btn-sm" onClick={() => setShowForm((s) => !s)}>
            <CalendarPlus className="h-3.5 w-3.5" /> Add event
          </button>
        </div>
        {showForm && (
          <div className="card mb-4 space-y-2.5 p-4 animate-rise">
            <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Event title" />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="label">Starts</span>
                <input type="datetime-local" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="label">Ends</span>
                <input type="datetime-local" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
            <input className="input" placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Location" />
            <TagInput values={attendees} onChange={setAttendees} placeholder="Attendees (press Enter after each)" />
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={add} disabled={adding || !title.trim() || !start}>
                {adding && <Spinner className="h-3.5 w-3.5" />} Add to calendar
              </button>
            </div>
          </div>
        )}
        {days.length === 0 ? (
          <EmptyState title="No events" />
        ) : (
          <div className="space-y-5">
            {days.map(([day, es]) => (
              <section key={day}>
                <div className={cx('mb-1.5 text-[12.5px] font-medium', day === todayKey ? 'text-accent' : 'text-muted')}>
                  {day === todayKey ? 'Today · ' : ''}
                  {fmtDate(`${day}T12:00:00`)}
                </div>
                <ul className="space-y-1.5">
                  {es.map((e) => (
                    <li key={e.id} className={cx('card border-l-[3px] px-3.5 py-2.5', trustRail(e.trust))}>
                      <div className="flex items-baseline gap-3">
                        <span className="tnum w-[92px] shrink-0 whitespace-nowrap font-mono text-[12px] text-muted">
                          {wallTime(e.start)}–{wallTime(e.end)}
                        </span>
                        <span className="min-w-0 flex-1 text-[13.5px] font-medium">{e.title}</span>
                        <TrustBadge trust={e.trust} size="sm" />
                      </div>
                      {(e.attendees.length > 0 || e.location) && (
                        <div className="mt-1 pl-[104px] text-[12px] text-muted">
                          {e.location}
                          {e.location && e.attendees.length > 0 && ' · '}
                          {e.attendees.length > 0 && <span className="font-mono text-[11.5px]">{e.attendees.join(', ')}</span>}
                        </div>
                      )}
                      {e.source !== 'user' && <div className="mt-0.5 pl-[104px] text-[11px] text-faint">added by {e.source}</div>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
      <div>
        <h2 className="section-title mb-3">Tasks</h2>
        <ul className="card divide-y divide-line">
          {(data?.tasks ?? []).map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <button
                onClick={() => !t.done && done(t.id)}
                className={cx(
                  'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-colors',
                  t.done ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong hover:border-accent',
                )}
                aria-label={t.done ? 'Done' : `Mark “${t.title}” done`}
                disabled={!!t.done}
              >
                {t.done ? <Check className="h-3 w-3" /> : null}
              </button>
              <div className="min-w-0 flex-1">
                <div className={cx('text-[13.5px]', t.done && 'text-faint line-through')}>{t.title}</div>
                <div className="text-[11.5px] text-faint">due {fmtDate(t.due)}</div>
              </div>
              <TrustDot trust={t.trust} />
            </li>
          ))}
          {!data?.tasks.length && <li className="px-3.5 py-6 text-center text-[13px] text-muted">No tasks</li>}
        </ul>
      </div>
    </div>
  )
}

export default function InboxPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'inbox'
  const settings = useLoad(() => api.settings(), [])
  const isTrusted = useTrusted(settings.data)
  return (
    <PageShell wide>
      <PageHeader
        title="Inbox & calendar"
        description="Asha’s simulated mailbox. Emails from people you trust are yellow, everyone else is red, and Vouch only ever reads them in quarantine."
        actions={
          <Tabs<Tab>
            value={tab}
            onChange={(t) => setParams(t === 'inbox' ? {} : { tab: t })}
            items={[
              { value: 'inbox', label: <><MailOpen className="h-3.5 w-3.5" /> Inbox</> },
              { value: 'outbox', label: <><Send className="h-3.5 w-3.5" /> Outbox</> },
              { value: 'calendar', label: <><CalendarPlus className="h-3.5 w-3.5" /> Calendar</> },
            ]}
          />
        }
      />
      {tab === 'inbox' && <InboxTab isTrusted={isTrusted} onSent={() => setParams({ tab: 'outbox' })} />}
      {tab === 'outbox' && <OutboxTab isTrusted={isTrusted} />}
      {tab === 'calendar' && <CalendarTab />}
    </PageShell>
  )
}
