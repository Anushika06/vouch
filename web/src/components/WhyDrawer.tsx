import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileSearch, GitCommitHorizontal, History, RotateCcw, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useLoad } from '../lib/app'
import { commitParts, cx, fmtDateTime, shortSha, techniqueLabel } from '../lib/format'
import type { Commit, Memory, Shield, WhyDoc } from '../lib/types'
import { FlagRow, HiddenReveal, SourceChip, StatusPill, TechniqueNote, TrustBadge, TypeTag, trustRail } from './trust'
import { Drawer, EmptyState, ErrorNote, SkeletonList, Spinner } from './ui'

function MemoryWhy({ memory, history, shield, onChange }: { memory: Memory; history: Commit[]; shield: Shield; onChange: (m: Memory) => void }) {
  const { toast, refreshSession } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const p = memory.provenance?.[0]
  const trust = memory.effective_trust ?? memory.trust
  const prev = history[1]
  const gone = ['rejected', 'superseded', 'expired'].includes(memory.status)

  const forget = async () => {
    setBusy('forget')
    try {
      const m = await api.forget(memory.id, shield)
      if (m && 'id' in m) onChange(m as Memory)
      toast({ tone: 'success', title: 'Forgotten', body: 'Vouch will not recall this memory again. The ledger keeps the history.' })
      refreshSession()
    } finally {
      setBusy(null)
    }
  }
  const revert = async () => {
    if (!prev) return
    setBusy('revert')
    try {
      const m = await api.revert(memory.id, prev.sha, shield)
      onChange(m)
      toast({ tone: 'success', title: 'Reverted', body: `Restored version ${shortSha(prev.sha)}.` })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={cx('rounded-xl border border-line border-l-[3px] bg-surface', trustRail(trust))}>
      <div className="space-y-2.5 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <TrustBadge trust={trust} size="sm" />
          <StatusPill status={memory.status} size="sm" />
          <TypeTag type={memory.type} />
          {memory.approved_by_user && <span className="text-[11px] text-muted">approved by you</span>}
        </div>
        <p className={cx('text-[13.5px] leading-relaxed', gone && 'text-muted line-through decoration-faint/60')}>{memory.content}</p>
        {p && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px] text-faint">Source</span>
            <SourceChip principal={p.principal} trust={p.trust} refUrl={p.ref} size="sm" />
            {p.hidden_technique && <TechniqueNote technique={p.hidden_technique} />}
          </div>
        )}
        {p?.excerpt && p.excerpt !== memory.content && (
          <p className="border-l-2 border-line pl-3 text-[12.5px] italic leading-relaxed text-muted">“{p.excerpt}”</p>
        )}
        {memory.gate_decision?.reason && (
          <p className="text-[12px] text-muted">
            <span className="text-faint">Trust Gate: </span>
            {memory.gate_decision.reason}
          </p>
        )}
        {history.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-faint">
              <History className="h-3 w-3" /> Ledger history
            </div>
            <ol className="space-y-0.5">
              {history.slice(0, 5).map((c) => (
                <li key={c.sha} className="flex items-baseline gap-2 text-[11.5px]">
                  <GitCommitHorizontal className="h-3 w-3 shrink-0 translate-y-0.5 text-faint" />
                  <span className="font-mono text-faint">{shortSha(c.sha)}</span>
                  <span className="truncate text-muted">
                    {commitParts(c.title).action}
                    {commitParts(c.title).tag && <span className="ml-1.5 font-mono text-[10.5px] text-faint">{commitParts(c.title).tag}</span>}
                  </span>
                  <span className="ml-auto shrink-0 text-faint">{fmtDateTime(c.time)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2">
        {!gone && (
          <button className="btn btn-sm btn-danger" onClick={forget} disabled={!!busy}>
            {busy === 'forget' ? <Spinner className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />} Forget
          </button>
        )}
        {prev && (
          <button className="btn btn-sm" onClick={revert} disabled={!!busy}>
            {busy === 'revert' ? <Spinner className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />} Revert to {shortSha(prev.sha)}
          </button>
        )}
        {shield === 'on' && (
          <Link to={`/memory?open=${memory.id}`} className="btn btn-sm btn-ghost ml-auto">
            Open in ledger
          </Link>
        )}
      </div>
    </div>
  )
}

function DocWhy({ doc }: { doc: WhyDoc }) {
  const r = doc.reader
  return (
    <div className={cx('rounded-xl border border-line border-l-[3px] bg-surface px-4 py-3', trustRail(doc.trust))}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <SourceChip principal={doc.principal} trust={doc.trust} refUrl={doc.ref} />
        <TrustBadge trust={doc.trust} size="sm" />
        <span className="text-[11.5px] text-faint">{doc.kind.replace('_', ' ')}</span>
      </div>
      {r?.title && <p className="text-[13px] font-medium">{r.title}</p>}
      {r?.summary && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{r.summary}</p>}
      {r?.flags?.length > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 text-[11.5px] text-faint">Reader flags</div>
          <FlagRow flags={r.flags} />
        </div>
      )}
      {r?.instructions?.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11.5px] text-faint">Instructions aimed at an AI, not acted on</div>
          <ul className="space-y-1.5">
            {r.instructions.map((ins, i) => (
              <li key={i} className="rounded-lg border border-red/25 bg-red/[0.05] px-3 py-2 text-[12.5px]">
                <p className="leading-relaxed">{ins.text}</p>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-faint">
                  {ins.hidden && <span>hidden via {techniqueLabel(ins.hidden)}</span>}
                  {ins.write_attempt && <span>· tried to write memory</span>}
                  <span>· found by {ins.source === 'both' ? 'detector and model' : ins.source}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r?.hidden?.length > 0 && (
        <div className="mt-3">
          <HiddenReveal hidden={r.hidden} />
        </div>
      )}
    </div>
  )
}

export function WhyDrawer({ turnId, shield, onClose }: { turnId: string | null; shield: Shield; onClose: () => void }) {
  const { data, setData, error, loading, reload } = useLoad(() => (turnId ? api.why(turnId, shield) : Promise.resolve(null)), [turnId, shield])
  return (
    <Drawer
      open={!!turnId}
      onClose={onClose}
      title="Why did Vouch say this?"
      subtitle={shield === 'off' ? 'Shield OFF: naive memory, no provenance kept' : 'Everything that shaped this answer, with where it came from'}
      width="max-w-[600px]"
    >
      {loading && <SkeletonList rows={4} className="h-28" />}
      {error && <ErrorNote message={error} onRetry={() => reload()} />}
      {data && (
        <div className="space-y-7">
          <section>
            <h3 className="section-title mb-1">Memories that shaped the answer</h3>
            <p className="mb-3 text-[12.5px] text-muted">Each one with its source and Trust Gate decision. Forgetting one stops it being recalled; the ledger keeps the history.</p>
            {data.memories.length === 0 ? (
              <EmptyState title="No stored memories were used" className="py-6">
                This answer came only from what you asked and what Vouch read this turn.
              </EmptyState>
            ) : (
              <div className="space-y-2.5">
                {data.memories.map(({ memory, history }) => (
                  <MemoryWhy
                    key={memory.id}
                    memory={memory}
                    history={history}
                    shield={shield}
                    onChange={(m) =>
                      setData((d) => (d ? { ...d, memories: d.memories.map((x) => (x.memory.id === m.id ? { ...x, memory: m } : x)) } : d))
                    }
                  />
                ))}
              </div>
            )}
          </section>
          <section>
            <h3 className="section-title mb-1 flex items-center gap-1.5">
              <FileSearch className="h-3.5 w-3.5 text-muted" /> What Vouch read this turn
            </h3>
            <p className="mb-3 text-[12.5px] text-muted">Read by the quarantined reader. Its text reaches the answer only as labelled quotes.</p>
            {data.docs.length === 0 ? (
              <EmptyState title="Nothing external was read" className="py-6" />
            ) : (
              <div className="space-y-2.5">
                {data.docs.map((d) => (
                  <DocWhy key={d.id} doc={d} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  )
}
