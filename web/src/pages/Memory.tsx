import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clock3, History, Plus, RotateCcw, ScrollText, Search, X } from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useLoad } from '../lib/app'
import { STATUS_LABEL, TYPE_LABEL, commitParts, cx, dayKey, fmtDate, fmtDateTime, shortSha, timeAgo } from '../lib/format'
import type { Commit, Memory, MemType, Status, Trust } from '../lib/types'
import { PageShell } from '../components/Layout'
import { MemoryDetail } from '../components/MemoryDetail'
import { SourceChip, StatusPill, TechniqueNote, TrustBadge, TypeTag, trustRail } from '../components/trust'
import { Dialog, EmptyState, ErrorNote, PageHeader, SkeletonList, Spinner } from '../components/ui'

const TRUST_TICK: Record<string, string> = { GREEN: 'bg-green', YELLOW: 'bg-yellow', RED: 'bg-red' }

function MemoryRow({ m, onOpen }: { m: Memory; onOpen: () => void }) {
  const trust = m.effective_trust ?? m.trust
  const p = m.provenance?.[0]
  const dim = ['rejected', 'superseded', 'expired'].includes(m.status)
  return (
    <button
      onClick={onOpen}
      className={cx(
        'group block w-full rounded-xl border border-line border-l-[3px] bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong hover:bg-raised/50',
        trustRail(trust),
      )}
    >
      <div className="flex items-start gap-4">
        <p className={cx('min-w-0 flex-1 text-[13.5px] leading-relaxed', dim && 'text-muted line-through decoration-faint/50')}>{m.content}</p>
        <span className="shrink-0 pt-0.5 text-[11px] text-faint" title={m.created_at}>
          {timeAgo(m.created_at)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <TrustBadge trust={trust} size="sm" />
        <StatusPill status={m.status} size="sm" />
        <TypeTag type={m.type} />
        {p && <SourceChip principal={p.principal} trust={p.trust} size="sm" />}
        {p?.hidden_technique && <TechniqueNote technique={p.hidden_technique} />}
        {m.approved_by_user && m.trust !== 'GREEN' && <span className="text-[11px] text-muted">approved by you</span>}
      </div>
    </button>
  )
}

function TimeTravel({
  log,
  idx,
  setIdx,
  onRollback,
}: {
  log: Commit[]
  idx: number
  setIdx: (i: number) => void
  onRollback: () => void
}) {
  // log arrives newest first; the slider runs oldest → newest.
  const asc = useMemo(() => [...log].reverse(), [log])
  const n = asc.length
  const cur = asc[idx]
  const atNow = idx === n - 1
  const parts = cur ? commitParts(cur.title) : null
  return (
    <div className="card mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-3.5">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted" />
          <span className="section-title">Time travel</span>
          <span className="text-[12px] text-muted">{n} commits in the ledger</span>
        </div>
        <div className="flex items-center gap-2">
          {!atNow && (
            <>
              <button className="btn btn-sm" onClick={() => setIdx(n - 1)}>
                <X className="h-3 w-3" /> Back to now
              </button>
              <button className="btn btn-sm btn-danger" onClick={onRollback}>
                <RotateCcw className="h-3 w-3" /> Roll back everything to here
              </button>
            </>
          )}
        </div>
      </div>
      <div className="px-4 pb-4">
        <div className="relative pt-1">
          <div className="flex h-7 items-end justify-between gap-px px-[6px]" aria-hidden>
            {asc.map((c, i) => {
              const tag = commitParts(c.title).tag ?? ''
              const t = tag.split('/')[1]
              return (
                <span
                  key={c.sha}
                  className={cx(
                    'min-w-[1px] max-w-[4px] flex-1 rounded-full transition-opacity',
                    TRUST_TICK[t] ?? 'bg-line-strong',
                    i <= idx ? 'opacity-90' : 'opacity-20',
                    i === idx ? 'h-7' : tag.includes('pending') || tag.includes('rejected') ? 'h-5' : 'h-3.5',
                  )}
                  title={c.title}
                />
              )
            })}
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, n - 1)}
            value={idx}
            onChange={(e) => setIdx(Number(e.target.value))}
            aria-label="Ledger position"
            aria-valuetext={cur ? `${fmtDateTime(cur.time)}: ${cur.title}` : undefined}
            className="mt-1.5 w-full cursor-pointer accent-[rgb(var(--accent))]"
          />
        </div>
        {cur && (
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12.5px]">
            <span className={cx('font-medium', atNow ? 'text-fg' : 'text-accent')}>{atNow ? 'Now' : fmtDateTime(cur.time)}</span>
            <span className="font-mono text-[11px] text-faint">{shortSha(cur.sha)}</span>
            <span className="text-muted">{parts?.action}</span>
            {parts?.tag && <span className="font-mono text-[11px] text-faint">{parts.tag}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

export default function MemoryPage() {
  const { toast, refreshSession } = useApp()
  const [params, setParams] = useSearchParams()
  const openId = params.get('open')
  const [q, setQ] = useState('')
  const [debQ, setDebQ] = useState('')
  const [type, setType] = useState('')
  const [trust, setTrust] = useState('')
  const [status, setStatus] = useState('')
  const [newMem, setNewMem] = useState('')
  const [adding, setAdding] = useState(false)
  const [idx, setIdx] = useState<number | null>(null)
  const [snap, setSnap] = useState<{ sha: string | null; memories: Memory[] } | null>(null)
  const [snapLoading, setSnapLoading] = useState(false)
  const [confirmRb, setConfirmRb] = useState(false)
  const [rolling, setRolling] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebQ(q), 250)
    return () => clearTimeout(t)
  }, [q])

  const list = useLoad(() => api.memories({ type, trust, status, q: debQ }), [type, trust, status, debQ])
  const log = useLoad(() => api.ledgerLog(400), [])
  const n = log.data?.length ?? 0
  const pos = idx ?? n - 1
  const atNow = !log.data || pos >= n - 1

  useEffect(() => {
    if (atNow || !log.data) {
      setSnap(null)
      return
    }
    const asc = [...log.data].reverse()
    const sha = asc[pos]?.sha
    if (!sha) return
    setSnapLoading(true)
    const t = setTimeout(() => {
      api
        .snapshot(sha)
        .then(setSnap)
        .finally(() => setSnapLoading(false))
    }, 180)
    return () => clearTimeout(t)
  }, [pos, atNow, log.data])

  const reloadAll = () => {
    list.reload(true)
    log.reload(true)
    setIdx(null)
  }

  const add = async () => {
    const text = newMem.trim()
    if (!text) return
    setAdding(true)
    try {
      const ev = await api.addMemory(text)
      setNewMem('')
      const e = ev[0]
      toast({
        tone: 'success',
        title: e?.action === 'duplicate' ? 'Already remembered' : 'Remembered',
        body: e ? `${e.memory.type.toLowerCase()} · green, because you typed it` : undefined,
      })
      reloadAll()
      refreshSession()
    } finally {
      setAdding(false)
    }
  }

  const rollback = async () => {
    if (!log.data) return
    const sha = [...log.data].reverse()[pos]?.sha
    if (!sha) return
    setRolling(true)
    try {
      const r = await api.rollback(sha)
      toast({ tone: 'success', title: 'Rolled back', body: `${r.changed} memor${r.changed === 1 ? 'y' : 'ies'} restored to ${shortSha(sha)}. Recorded as new commits.` })
      setConfirmRb(false)
      reloadAll()
      refreshSession()
    } finally {
      setRolling(false)
    }
  }

  const shown: Memory[] | null = useMemo(() => {
    if (snap && !atNow) {
      const ql = debQ.toLowerCase()
      return snap.memories
        .filter((m) => (!type || m.type === type) && (!trust || (m.effective_trust ?? m.trust) === trust) && (!status || m.status === status))
        .filter((m) => !ql || m.content.toLowerCase().includes(ql))
        .map((m) => ({ ...m, effective_trust: m.approved_by_user ? ('GREEN' as Trust) : m.trust }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    }
    return list.data ? [...list.data].sort((a, b) => b.created_at.localeCompare(a.created_at)) : null
  }, [snap, atNow, list.data, debQ, type, trust, status])

  const groups = useMemo(() => {
    const g: [string, Memory[]][] = []
    for (const m of shown ?? []) {
      const k = dayKey(m.created_at)
      const last = g[g.length - 1]
      if (last && last[0] === k) last[1].push(m)
      else g.push([k, [m]])
    }
    return g
  }, [shown])

  const filtered = !!(type || trust || status || debQ)
  const counts = useMemo(() => {
    const c = { GREEN: 0, YELLOW: 0, RED: 0 } as Record<Trust, number>
    for (const m of shown ?? []) c[(m.effective_trust ?? m.trust) as Trust]++
    return c
  }, [shown])

  const open = (id: string) => setParams({ open: id }, { replace: false })

  return (
    <PageShell>
      <PageHeader
        title="Memory ledger"
        description="Everything Vouch remembers, where each memory came from, and every change as a git commit you can inspect, revert or roll back."
      />

      <div className="card mb-4 flex items-center gap-2 p-1.5 pl-3">
        <Plus className="h-4 w-4 shrink-0 text-faint" />
        <input
          value={newMem}
          onChange={(e) => setNewMem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Tell Vouch something to remember, e.g. “I prefer window seats”"
          className="h-8 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint"
          aria-label="Add a memory"
        />
        <span className="hidden text-[11.5px] text-faint sm:inline">Saved as green</span>
        <button className="btn btn-primary" onClick={add} disabled={!newMem.trim() || adding}>
          {adding && <Spinner className="h-3.5 w-3.5" />} Remember
        </button>
      </div>

      {log.data && log.data.length > 1 && <TimeTravel log={log.data} idx={pos} setIdx={setIdx} onRollback={() => setConfirmRb(true)} />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memories" className="input pl-8" aria-label="Search memories" />
        </div>
        <select className="select" value={trust} onChange={(e) => setTrust(e.target.value)} aria-label="Trust">
          <option value="">Any trust</option>
          <option value="GREEN">Green</option>
          <option value="YELLOW">Yellow</option>
          <option value="RED">Red</option>
        </select>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">Any type</option>
          {(Object.keys(TYPE_LABEL) as MemType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setQ('')
              setType('')
              setTrust('')
              setStatus('')
            }}
          >
            Clear
          </button>
        )}
      </div>

      {!atNow && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-accent/35 bg-accent/[0.08] px-3 py-2 text-[12.5px] text-accent">
          <Clock3 className="h-3.5 w-3.5" />
          Viewing memory as it was {log.data && fmtDateTime([...log.data].reverse()[pos]?.time)}. Read-only until you roll back.
          {snapLoading && <Spinner className="ml-auto h-3.5 w-3.5" />}
        </div>
      )}

      {shown && shown.length > 0 && (
        <div className="mb-3 flex items-center gap-3 text-[12px] text-muted">
          <span className="tnum">{shown.length} memories</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green" />
            <span className="tnum">{counts.GREEN}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-yellow" />
            <span className="tnum">{counts.YELLOW}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red" />
            <span className="tnum">{counts.RED}</span>
          </span>
        </div>
      )}

      {list.error && <ErrorNote message={list.error} onRetry={() => list.reload()} />}
      {list.loading && !list.data && <SkeletonList rows={6} className="h-[76px]" />}
      {shown && shown.length === 0 && (
        <EmptyState icon={<ScrollText className="h-6 w-6" />} title={filtered ? 'No memories match these filters' : 'Nothing remembered yet'}>
          {filtered ? 'Try a different trust level or status, or clear the filters.' : 'Chat with Vouch or add a memory above. Everything it learns will show up here with its source.'}
        </EmptyState>
      )}

      <div className="space-y-6">
        {groups.map(([day, ms]) => (
          <section key={day}>
            <h2 className="sticky top-0 z-[1] -mx-1 mb-2 bg-bg/90 px-1 py-1 text-[12px] font-medium text-muted backdrop-blur">
              {fmtDate(`${day}T12:00:00`, { year: 'numeric' })}
            </h2>
            <div className="space-y-2">
              {ms.map((m) => (
                <MemoryRow key={m.id} m={m} onOpen={() => open(m.id)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <MemoryDetail
        memId={openId}
        onClose={() => setParams({}, { replace: false })}
        onChanged={reloadAll}
        onOpen={open}
      />

      <Dialog
        open={confirmRb}
        onClose={() => setConfirmRb(false)}
        tone="danger"
        title="Roll back every memory to this point?"
        footer={
          <>
            <button className="btn" onClick={() => setConfirmRb(false)}>
              Cancel
            </button>
            <button className="btn border-transparent bg-red text-white hover:bg-red hover:brightness-110" onClick={rollback} disabled={rolling}>
              {rolling && <Spinner className="h-3.5 w-3.5" />} Roll back
            </button>
          </>
        }
      >
        Every memory goes back to how it was at{' '}
        <span className="font-mono text-fg">{log.data ? shortSha([...log.data].reverse()[pos]?.sha ?? '') : ''}</span>. Memories created after it are
        marked superseded. Nothing is erased: the rollback is recorded as new commits, so you can undo it the same way.
      </Dialog>
    </PageShell>
  )
}
