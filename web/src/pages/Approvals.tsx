import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, Check, FlaskConical, Lightbulb, ShieldCheck, X } from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useLoad } from '../lib/app'
import { cx, shortPrincipal, timeAgo } from '../lib/format'
import type { ApprovalSource, Memory } from '../lib/types'
import { PageShell } from '../components/Layout'
import { PendingActionCard } from '../components/PendingActionCard'
import { FlagRow, HiddenReveal, SourceChip, StatusPill, TechniqueNote, TrustBadge, TypeTag, trustRail } from '../components/trust'
import { ErrorNote, PageHeader, Section, SkeletonList, Spinner } from '../components/ui'

type Decision = 'approve' | 'approve_trust_source' | 'reject'

function MemoryApprovalCard({
  m,
  source,
  conflict,
  onDone,
}: {
  m: Memory
  source?: ApprovalSource
  conflict?: Memory
  onDone: (id: string, d: Decision) => void
}) {
  const { toast, refreshSession } = useApp()
  const [busy, setBusy] = useState<Decision | null>(null)
  const [done, setDone] = useState<Decision | null>(null)
  const p = m.provenance?.[0]
  const gd = m.gate_decision
  const suggestReject = gd?.suggestion === 'reject'
  const principal = shortPrincipal(p?.principal)

  const decide = async (d: Decision) => {
    setBusy(d)
    try {
      await api.decideMemory(m.id, d)
      setDone(d)
      toast({
        tone: d === 'reject' ? 'info' : 'success',
        title: d === 'reject' ? 'Rejected. Vouch will never recall it.' : d === 'approve' ? 'Approved. It now counts as yours.' : `Approved, and ${principal} is now trusted`,
      })
      refreshSession()
      setTimeout(() => onDone(m.id, d), 900)
    } finally {
      setBusy(null)
    }
  }

  if (done)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-muted animate-fade-in">
        {done === 'reject' ? <X className="h-4 w-4" /> : <Check className="h-4 w-4 text-accent" />}
        {done === 'reject' ? 'Rejected' : 'Approved'}: <span className="truncate">{m.content}</span>
      </div>
    )

  return (
    <article className={cx('overflow-hidden rounded-xl border border-line border-l-[3px] bg-surface', trustRail(m.trust))}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
        <TrustBadge trust={m.trust} detail size="sm" />
        <TypeTag type={m.type} />
        {p && <SourceChip principal={p.principal} trust={p.trust} refUrl={p.ref} size="sm" />}
        {p?.hidden_technique && <TechniqueNote technique={p.hidden_technique} />}
        <span className="ml-auto text-[11.5px] text-faint">{timeAgo(m.created_at)}</span>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div>
          <div className="mb-1 text-[12px] text-muted">Wants Vouch to remember</div>
          <p className="text-[15px] font-medium leading-relaxed">{m.content}</p>
        </div>

        {conflict && (
          <div className="rounded-lg border border-line bg-sunken p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] text-muted">
              <ArrowDown className="h-3.5 w-3.5" /> Would overwrite what you told Vouch
            </div>
            <div className={cx('rounded-md border border-line border-l-[3px] bg-surface px-3 py-2', trustRail(conflict.effective_trust ?? conflict.trust))}>
              <div className="mb-1 flex items-center gap-1.5">
                <TrustBadge trust={conflict.effective_trust ?? conflict.trust} size="sm" />
                <StatusPill status={conflict.status} size="sm" />
              </div>
              <p className="text-[13.5px]">{conflict.content}</p>
            </div>
          </div>
        )}

        {(source || p?.excerpt) && (
          <div className="space-y-2">
            <div className="text-[12px] text-muted">
              Source {source?.title ? <span className="text-fg/85">· {source.title}</span> : null}
            </div>
            {p?.excerpt && !source?.hidden?.some((h) => h.text.includes(p.excerpt.slice(0, 60))) && (
              <p className="border-l-2 border-line pl-3 text-[13px] italic leading-relaxed text-muted">“{p.excerpt}”</p>
            )}
            {source?.hidden && source.hidden.length > 0 && <HiddenReveal hidden={source.hidden} />}
          </div>
        )}

        {gd && (
          <div className="space-y-2">
            {gd.detector_flags.length > 0 && <FlagRow flags={gd.detector_flags} />}
            <p className="text-[12.5px] text-muted">{gd.reason}</p>
          </div>
        )}

        {gd?.suggestion && (
          <div
            className={cx(
              'flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px]',
              suggestReject ? 'bg-red/[0.07] text-red-ink' : 'bg-accent/[0.08] text-accent',
            )}
          >
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Vouch suggests you <span className="font-semibold">{gd.suggestion}</span> this.
              {suggestReject && ' It came from a source you haven’t approved and tries to change how Vouch acts.'}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-sunken/50 px-4 py-3">
        <button className={cx('btn', suggestReject && 'btn-primary')} onClick={() => decide('reject')} disabled={!!busy}>
          {busy === 'reject' ? <Spinner className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />} Reject
        </button>
        <button className={cx('btn', !suggestReject && gd?.suggestion === 'approve' && 'btn-primary')} onClick={() => decide('approve')} disabled={!!busy}>
          {busy === 'approve' ? <Spinner className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />} Approve
        </button>
        {p && p.principal !== 'user' && (
          <button className="btn btn-ghost" onClick={() => decide('approve_trust_source')} disabled={!!busy}>
            {busy === 'approve_trust_source' ? <Spinner className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Approve & trust <span className="font-mono text-[11.5px]">{principal}</span>
          </button>
        )}
      </div>
    </article>
  )
}

function AllClear() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-surface px-6 py-14 text-center">
      <div className="hairline-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(circle_at_center,black,transparent_70%)]" aria-hidden />
      <div className="relative">
        <svg width="76" height="76" viewBox="0 0 76 76" className="mx-auto mb-5" aria-hidden>
          <circle cx="38" cy="38" r="36" className="fill-raised stroke-line-strong" strokeWidth="1" />
          <circle cx="38" cy="38" r="28" className="fill-none stroke-line" strokeDasharray="2 4" />
          <path d="M26 39.5 34.5 48 51 30" fill="none" stroke="#22c55e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 className="text-[20px] font-semibold tracking-[-0.02em]">Nothing is waiting for you</h2>
        <p className="mx-auto mt-2 max-w-[48ch] text-[13.5px] text-muted">
          No web page, email or skill is trying to change what Vouch remembers or does. When one does, it lands here instead of in memory.
        </p>
        <Link to="/lab" className="btn mt-6">
          <FlaskConical className="h-3.5 w-3.5" /> Try an attack in the Attack Lab
        </Link>
      </div>
    </div>
  )
}

export default function ApprovalsPage() {
  const { data, setData, error, loading, reload } = useLoad(() => api.approvals(), [])
  const drop = (id: string) =>
    setData((d) => (d ? { ...d, memories: d.memories.filter((m) => m.id !== id), disputed: d.disputed.filter((m) => m.id !== id) } : d))
  const empty = data && !data.memories.length && !data.actions.length && !data.disputed.length

  return (
    <PageShell>
      <PageHeader
        title="Approvals"
        description="Memory writes and actions that came from sources you haven’t approved. Nothing here affects what Vouch believes or does until you decide."
        actions={
          <button className="btn" onClick={() => reload()}>
            Refresh
          </button>
        }
      />
      {error && <ErrorNote message={error} onRetry={() => reload()} />}
      {loading && !data && <SkeletonList rows={3} className="h-56" />}
      {empty && <AllClear />}
      {data && !empty && (
        <>
          {data.actions.length > 0 && (
            <Section title="Paused actions" count={data.actions.length} description="Vouch stopped these before they ran because a value came from an untrusted source.">
              <div className="space-y-3">
                {data.actions.map((a) => (
                  <PendingActionCard key={a.id} action={a} onResolved={() => setTimeout(() => reload(true), 900)} />
                ))}
              </div>
            </Section>
          )}
          {data.memories.length > 0 && (
            <Section title="Memory writes" count={data.memories.length} description="Each one shows its source, including any text that was hidden from you on the page.">
              <div className="space-y-4">
                {data.memories.map((m) => (
                  <MemoryApprovalCard
                    key={m.id}
                    m={m}
                    source={data.sources[m.provenance?.[0]?.ref ?? '']}
                    conflict={m.gate_decision?.conflict_with ? data.conflicts[m.gate_decision.conflict_with] : undefined}
                    onDone={drop}
                  />
                ))}
              </div>
            </Section>
          )}
          {data.disputed.length > 0 && (
            <Section title="Disputed" count={data.disputed.length} description="These contradict something you told Vouch. Your version stays in charge unless you approve the change.">
              <div className="space-y-4">
                {data.disputed.map((m) => (
                  <MemoryApprovalCard
                    key={m.id}
                    m={m}
                    source={data.sources[m.provenance?.[0]?.ref ?? '']}
                    conflict={m.gate_decision?.conflict_with ? data.conflicts[m.gate_decision.conflict_with] : undefined}
                    onDone={drop}
                  />
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </PageShell>
  )
}
