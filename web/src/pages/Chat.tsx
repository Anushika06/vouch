import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, ChevronDown, HelpCircle, Send, ShieldCheck, ShieldOff, TriangleAlert } from 'lucide-react'
import { api } from '../lib/api'
import { useApp } from '../lib/app'
import { asList, cx, fmtTime } from '../lib/format'
import type { HistoryItem, Shield, TurnResult } from '../lib/types'
import { MemoryEventChips, Segments } from '../components/Answer'
import { Logo } from '../components/Layout'
import { PendingActionCard, type ActionOutcome } from '../components/PendingActionCard'
import { TraceTimeline } from '../components/Trace'
import { WhyDrawer } from '../components/WhyDrawer'
import { Skeleton, Spinner } from '../components/ui'

const SUGGESTIONS = [
  'Summarize this deal page for me: https://dealz-hub.example/laptop-deals',
  'Find me laptop deals under 80000',
  'Send the October invoice to my accountant',
  'Triage my inbox',
  'Reply to the Lumen accounts email',
  'Research this page for me: https://laptoplab.example/best-laptops-under-80000',
  'Is it true that the Aurora X14 weighs 1.2 kg? Check the sources.',
  'Run the expense-summary skill',
]

const STAGES_ON = [
  'Recalling trusted memories…',
  'Planning over handles…',
  'Reading in quarantine…',
  'Checking every value for taint…',
  'Passing new memories through the Trust Gate…',
  'Still working. Real models can take up to 40 seconds…',
]
const STAGES_OFF = ['Reading everything raw…', 'Acting on whatever it says…', 'Saving it all to memory…', 'Still working…']

type Msg =
  | { key: string; role: 'user'; text: string; at?: string }
  | { key: string; role: 'assistant'; turn: TurnResult }
  | { key: string; role: 'error'; text: string; retry: string }

function fromHistory(items: HistoryItem[]): Msg[] {
  return items.map((h, i) =>
    h.role === 'user'
      ? { key: `u-${h.turn_id}-${i}`, role: 'user', text: h.content, at: h.created_at }
      : { key: `a-${h.turn_id}-${i}`, role: 'assistant', turn: h },
  )
}

function ShieldToggle({ shield, onChange }: { shield: Shield; onChange: (s: Shield) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-line bg-sunken p-1" role="radiogroup" aria-label="Shield">
      <button
        role="radio"
        aria-checked={shield === 'on'}
        onClick={() => onChange('on')}
        className={cx(
          'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors',
          shield === 'on' ? 'bg-surface text-fg shadow-card ring-1 ring-line' : 'text-muted hover:text-fg',
        )}
      >
        <ShieldCheck className={cx('h-4 w-4', shield === 'on' ? 'text-green-ink' : 'text-faint')} />
        Shield on
        <span className="hidden text-[12px] font-normal text-muted sm:inline">· Vouch</span>
      </button>
      <button
        role="radio"
        aria-checked={shield === 'off'}
        onClick={() => onChange('off')}
        className={cx(
          'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors',
          shield === 'off' ? 'bg-red text-white shadow-card' : 'text-muted hover:text-fg',
        )}
      >
        <ShieldOff className="h-4 w-4" />
        Off
        <span className={cx('hidden text-[12px] font-normal sm:inline', shield === 'off' ? 'text-white/80' : 'text-muted')}>· naive</span>
      </button>
    </div>
  )
}

function Thinking({ shield }: { shield: Shield }) {
  const stages = shield === 'on' ? STAGES_ON : STAGES_OFF
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, stages.length - 1)), 2600)
    return () => clearInterval(t)
  }, [stages.length])
  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <div className="mt-0.5">
        <Logo size={26} />
      </div>
      <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex gap-1" aria-hidden>
            {[0, 1, 2].map((d) => (
              <span key={d} className="h-1.5 w-1.5 rounded-full bg-muted animate-pulse-dot" style={{ animationDelay: `${d * 0.16}s` }} />
            ))}
          </span>
          <span key={i} className="text-[13px] text-muted animate-fade-in" aria-live="polite">
            {stages[i]}
          </span>
        </div>
      </div>
    </div>
  )
}

function ExecutedLine({ turn, trusted }: { turn: TurnResult; trusted: Set<string> }) {
  const sends = turn.executed_actions?.filter((a) => a.tool === 'send_email') ?? []
  if (!sends.length) return null
  return (
    <div className="space-y-1.5">
      {sends.map((a, i) => {
        const rec = (k: string) => asList(a.args[k])
        const all = [...rec('to').map((r) => ['to', r]), ...rec('cc').map((r) => ['cc', r]), ...rec('bcc').map((r) => ['bcc', r])]
        const bad = all.filter(([, r]) => !trusted.has(r.toLowerCase()))
        return (
          <div
            key={i}
            className={cx(
              'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-[12.5px]',
              bad.length ? 'border-red/40 bg-red/[0.06]' : 'border-line bg-sunken',
            )}
          >
            <Send className={cx('h-3.5 w-3.5', bad.length ? 'text-red-ink' : 'text-muted')} />
            <span className="font-medium">Sent</span>
            <span className="text-muted">“{String(a.args.subject ?? '')}”</span>
            {all.map(([k, r]) => {
              const isBad = !trusted.has(r.toLowerCase())
              return (
                <span key={k + r} className={cx('font-mono text-[11.5px]', isBad ? 'text-red-ink' : 'text-muted')}>
                  <span className="text-faint">{k} </span>
                  {r}
                </span>
              )
            })}
            {bad.length > 0 && (
              <span className="flex w-full items-center gap-1.5 text-[12px] text-red-ink">
                <TriangleAlert className="h-3.5 w-3.5" />
                {bad.map(([, r]) => r).join(', ')} {bad.length === 1 ? 'is' : 'are'} not in your trusted contacts.
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AssistantMessage({
  turn,
  shield,
  trusted,
  stillPending,
  outcomes,
  onOutcome,
  onWhy,
}: {
  turn: TurnResult
  shield: Shield
  trusted: Set<string>
  stillPending: Set<string> | null
  outcomes: Record<string, ActionOutcome>
  onOutcome: (id: string, o: ActionOutcome) => void
  onWhy: (turnId: string) => void
}) {
  const [traceOpen, setTraceOpen] = useState(false)
  const naive = turn.mode === 'naive'
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5">
        <Logo size={26} />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div
          className={cx(
            'rounded-2xl rounded-tl-md border px-4 py-3',
            naive ? 'border-red/25 bg-red/[0.04]' : 'border-line bg-surface',
          )}
        >
          <Segments segments={turn.segments?.length ? turn.segments : [{ text: turn.answer, trust: null }]} />
        </div>

        <ExecutedLine turn={turn} trusted={trusted} />

        {turn.pending_actions?.map((pa) => (
          <PendingActionCard
            key={pa.id}
            action={pa}
            shield={shield}
            resolved={outcomes[pa.id] ?? (stillPending && !stillPending.has(pa.id) ? 'unknown' : null)}
            onResolved={(o) => onOutcome(pa.id, o)}
          />
        ))}

        <MemoryEventChips events={turn.memory_events} linkable={!naive} />
        {naive && turn.memory_events?.length > 0 && (
          <p className="-mt-1.5 text-[12px] text-red-ink">
            Saved as active and green, as if you had said it. Naive memory keeps no record of where it came from.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1">
          <button className="btn btn-ghost btn-sm" onClick={() => onWhy(turn.turn_id)}>
            <HelpCircle className="h-3.5 w-3.5" /> Why?
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setTraceOpen((o) => !o)} aria-expanded={traceOpen}>
            <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', !traceOpen && '-rotate-90')} />
            {naive ? 'What the naive assistant did' : 'How Vouch handled this'}
            <span className="tnum text-faint">{turn.trace?.length ?? 0}</span>
          </button>
          {turn.created_at && <span className="ml-auto text-[11px] text-faint">{fmtTime(turn.created_at)}</span>}
        </div>
        {traceOpen && (
          <div className="rounded-xl border border-line bg-sunken/60 px-4 py-3.5 animate-fade-in">
            <TraceTimeline trace={turn.trace} naive={naive} />
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyChat({ shield, onPick }: { shield: Shield; onPick: (s: string) => void }) {
  const { session } = useApp()
  const first = (session?.persona?.name ?? 'Asha Menon').split(' ')[0]
  const h = new Date().getHours()
  const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col px-1 pb-8 pt-[8vh]">
      <h2 className="text-[28px] font-semibold tracking-[-0.025em]">
        {greet}, {first}.
      </h2>
      <p className="mt-2 max-w-[60ch] text-[14px] text-muted">
        {shield === 'on'
          ? 'Ask for anything. Every sentence I write is marked with where it came from, and nothing I read can quietly change what I remember or do.'
          : 'Shield is off. This assistant reads pages raw, believes what they say and saves all of it to memory. Try the same prompts in both modes.'}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-2 rounded-xl border border-line bg-surface p-4 text-[12.5px] sm:grid-cols-3">
        {(
          [
            ['GREEN', 'Green', 'You said it, or you approved it.'],
            ['YELLOW', 'Yellow', 'A trusted contact or your own account.'],
            ['RED', 'Red', 'The web, strangers, skills. Quoted, never obeyed.'],
          ] as const
        ).map(([t, w, d]) => (
          <div key={t} className="flex gap-2.5">
            <span className={cx('seg mt-0.5 h-fit font-medium', `seg-${t}`)} style={{ cursor: 'default' }}>
              {w}
            </span>
            <span className="text-muted">{d}</span>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <div className="mb-2 text-[12.5px] text-muted">Try one of these</div>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="max-w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-left text-[13px] text-fg/90 transition-colors hover:border-line-strong hover:bg-raised"
            >
              <span className="line-clamp-2 break-words">{s}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function readShield(): Shield {
  try {
    return localStorage.getItem('vouch-chat-shield') === 'off' ? 'off' : 'on'
  } catch {
    return 'on'
  }
}

export default function ChatPage() {
  const { refreshSession } = useApp()
  const [shield, setShieldState] = useState<Shield>(readShield)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [loading, setLoading] = useState(true)
  const [waiting, setWaiting] = useState(false)
  const [draft, setDraft] = useState('')
  const [why, setWhy] = useState<string | null>(null)
  const [trusted, setTrusted] = useState<Set<string>>(new Set())
  const [stillPending, setStillPending] = useState<Set<string> | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, ActionOutcome>>({})
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  const setShield = (s: Shield) => {
    setShieldState(s)
    try {
      localStorage.setItem('vouch-chat-shield', s)
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setMsgs([])
    Promise.all([api.history(shield), api.approvals().catch(() => null), api.settings().catch(() => null)])
      .then(([h, a, s]) => {
        if (!alive) return
        setMsgs(fromHistory(h))
        setStillPending(a ? new Set(a.actions.map((x) => x.id)) : null)
        if (s) setTrusted(new Set([...s.trusted_contacts, 'asha@ashamenon.example'].map((x) => x.toLowerCase())))
      })
      .catch(() => alive && setMsgs([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [shield])

  const scrollDown = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      const el = scroller.current
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    })
  }, [])
  useEffect(() => scrollDown(!loading), [msgs.length, waiting, loading, scrollDown])

  const send = async (text: string) => {
    const t = text.trim()
    if (!t || waiting) return
    setDraft('')
    setMsgs((m) => [...m, { key: `u-local-${Date.now()}`, role: 'user', text: t, at: new Date().toISOString() }])
    setWaiting(true)
    try {
      const r = await api.chat(t, shield)
      setMsgs((m) => [...m, { key: `a-${r.turn_id}`, role: 'assistant', turn: r }])
      if (r.pending_actions?.length) setStillPending((s) => new Set([...(s ?? []), ...r.pending_actions.map((p) => p.id)]))
      refreshSession()
    } catch (e) {
      setMsgs((m) => [...m, { key: `e-${Date.now()}`, role: 'error', text: e instanceof Error ? e.message : 'Something went wrong', retry: t }])
    } finally {
      setWaiting(false)
      input.current?.focus()
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send(draft)
    }
  }

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [draft])

  const empty = !loading && msgs.length === 0 && !waiting
  const onOutcome = useCallback((id: string, o: ActionOutcome) => setOutcomes((x) => ({ ...x, [id]: o })), [])
  const off = shield === 'off'

  const header = useMemo(
    () => (
      <div className={cx('relative shrink-0 border-b', off ? 'border-red/40' : 'border-line')}>
        {off && <div className="hazard absolute inset-x-0 top-0 h-1" aria-hidden />}
        <div className="mx-auto flex w-full max-w-[880px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h1 className="text-[16px] font-semibold tracking-[-0.015em]">Chat</h1>
            <p className={cx('text-[12.5px]', off ? 'text-red-ink' : 'text-muted')}>
              {off ? 'Shield off: naive memory. Saves and obeys whatever it reads.' : 'Shield on: every memory checked at the Trust Gate.'}
            </p>
          </div>
          <ShieldToggle shield={shield} onChange={setShield} />
        </div>
      </div>
    ),
    [off, shield],
  )

  return (
    <div className={cx('flex min-h-0 flex-1 flex-col', off && 'bg-red/[0.025]')}>
      {header}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[880px] px-4 sm:px-6">
          {loading && (
            <div className="space-y-6 py-8">
              <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
              <Skeleton className="h-28 w-4/5 rounded-2xl" />
              <Skeleton className="ml-auto h-10 w-1/3 rounded-2xl" />
            </div>
          )}
          {empty && <EmptyChat shield={shield} onPick={(s) => send(s)} />}
          {!loading && msgs.length > 0 && (
            <div className="space-y-6 py-6">
              {msgs.map((m) =>
                m.role === 'user' ? (
                  <div key={m.key} className="flex justify-end">
                    <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-raised px-4 py-2.5 text-[14px] leading-relaxed ring-1 ring-line">
                      {m.text}
                    </div>
                  </div>
                ) : m.role === 'assistant' ? (
                  <AssistantMessage
                    key={m.key}
                    turn={m.turn}
                    shield={shield}
                    trusted={trusted}
                    stillPending={stillPending}
                    outcomes={outcomes}
                    onOutcome={onOutcome}
                    onWhy={setWhy}
                  />
                ) : (
                  <div key={m.key} className="flex items-start gap-3">
                    <div className="mt-0.5">
                      <Logo size={26} />
                    </div>
                    <div className="flex flex-1 flex-wrap items-center justify-between gap-3 rounded-2xl rounded-tl-md border border-red/30 bg-red/[0.05] px-4 py-3 text-[13px]">
                      <span className="text-red-ink">{m.text}</span>
                      <button className="btn btn-sm" onClick={() => send(m.retry)} disabled={waiting}>
                        Try again
                      </button>
                    </div>
                  </div>
                ),
              )}
              {waiting && <Thinking shield={shield} />}
            </div>
          )}
          {empty && waiting && <Thinking shield={shield} />}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4 pt-2 sm:px-6">
        <div className="mx-auto w-full max-w-[880px]">
          <div
            className={cx(
              'flex items-end gap-2 rounded-2xl border bg-surface p-2 pl-4 shadow-card transition-colors focus-within:ring-2',
              off ? 'border-red/40 focus-within:ring-red/20' : 'border-line focus-within:border-accent/60 focus-within:ring-accent/15',
            )}
          >
            <textarea
              ref={input}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              placeholder={off ? 'Message the naive assistant…' : 'Message Vouch…'}
              className="max-h-[180px] min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[14px] leading-relaxed outline-none placeholder:text-faint"
              aria-label="Message"
            />
            <button
              className={cx('btn h-9 w-9 shrink-0 rounded-xl px-0', off ? 'border-transparent bg-red text-white hover:bg-red' : 'btn-primary')}
              onClick={() => send(draft)}
              disabled={!draft.trim() || waiting}
              aria-label="Send"
            >
              {waiting ? <Spinner className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-faint">
            Enter to send · Shift+Enter for a new line · Emails go to a simulated Outbox, nothing real is sent
          </p>
        </div>
      </div>

      <WhyDrawer turnId={why} shield={shield} onClose={() => setWhy(null)} />
    </div>
  )
}
