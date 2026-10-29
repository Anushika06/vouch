import { useState } from 'react'
import { ChevronRight, GitCommitHorizontal, Lock, RotateCcw, Scale, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useLoad } from '../lib/app'
import {
  GATE_ACTION_HELP,
  commitParts,
  cx,
  demoSiteHref,
  fmtDateTime,
  isHttp,
  shortSha,
  timeAgo,
} from '../lib/format'
import type { Commit, Corroboration, CorroborationSource, Memory } from '../lib/types'
import { FlagRow, SourceChip, StatusPill, TechniqueNote, TrustBadge, TypeTag, trustRail } from './trust'
import { Dialog, Drawer, ErrorNote, KeyVal, SkeletonList, Spinner } from './ui'

const DIFF_FIELDS: [string, (m: Memory) => unknown][] = [
  ['content', (m) => m.content],
  ['status', (m) => m.status],
  ['trust', (m) => m.trust],
  ['type', (m) => m.type],
  ['approved by you', (m) => m.approved_by_user],
  ['gate action', (m) => m.gate_decision?.action],
  ['superseded by', (m) => m.superseded_by],
  ['expires', (m) => m.expires_at?.slice(0, 10)],
  ['corroborated', (m) => m.corroboration?.upgraded],
]

function SnapshotDiff({ cur, prev }: { cur: Memory | null | undefined; prev: Memory | null | undefined }) {
  if (!cur) return <p className="text-[12px] text-faint">No snapshot stored for this commit.</p>
  if (!prev)
    return (
      <div className="rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-[11.5px] leading-relaxed">
        <div className="text-accent">+ created</div>
        <div className="text-muted">
          {cur.type} · {cur.trust} · {cur.status}
        </div>
      </div>
    )
  const rows = DIFF_FIELDS.map(([k, f]) => [k, f(prev), f(cur)] as const).filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b))
  if (!rows.length) return <p className="text-[12px] text-faint">Metadata only (timestamps, usage).</p>
  return (
    <div className="space-y-1 rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-[11.5px] leading-relaxed">
      {rows.map(([k, a, b]) => (
        <div key={k}>
          <span className="text-faint">{k}</span>
          <div className="pl-2 text-muted line-through decoration-faint/60">− {String(a ?? '∅')}</div>
          <div className="pl-2 text-fg">+ {String(b ?? '∅')}</div>
        </div>
      ))}
    </div>
  )
}

function CommitRow({
  c,
  prev,
  isHead,
  onRevert,
  busy,
}: {
  c: Commit
  prev?: Commit
  isHead: boolean
  onRevert: (sha: string) => void
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const parts = commitParts(c.title)
  return (
    <li className="relative pl-6">
      <span className="absolute left-0 top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-line bg-surface">
        <GitCommitHorizontal className="h-2.5 w-2.5 text-muted" />
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button className="inline-flex min-w-0 items-center gap-1 text-left text-[13px] font-medium hover:text-accent" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronRight className={cx('h-3.5 w-3.5 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
          <span className="truncate">{parts.action || 'commit'}</span>
        </button>
        {parts.tag && <span className="font-mono text-[10.5px] text-faint">{parts.tag}</span>}
        {isHead && <span className="rounded bg-raised px-1.5 text-[10.5px] font-medium text-muted">current</span>}
        <span className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[11px] text-faint">{shortSha(c.sha)}</span>
          <span className="text-[11px] text-faint" title={c.time}>
            {fmtDateTime(c.time)}
          </span>
        </span>
      </div>
      {open && (
        <div className="mt-2 space-y-2 animate-fade-in">
          <SnapshotDiff cur={c.snapshot} prev={prev?.snapshot} />
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
            {c.message}
          </pre>
        </div>
      )}
      {!isHead && c.snapshot && (
        <button className="btn btn-sm btn-ghost mt-1 -ml-2" onClick={() => onRevert(c.sha)} disabled={busy}>
          <RotateCcw className="h-3 w-3" /> Revert to this
        </button>
      )}
    </li>
  )
}

function SourceList({ title, items, tone }: { title: string; items: CorroborationSource[]; tone: 'support' | 'dispute' | 'filtered' }) {
  if (!items?.length) return null
  return (
    <div>
      <div className="mb-1 text-[12px] font-medium text-muted">
        {title} <span className="tnum text-faint">{items.length}</span>
      </div>
      <ul className="space-y-1">
        {items.map((s, i) => (
          <li key={i} className={cx('rounded-lg border px-3 py-1.5 text-[12px]', tone === 'filtered' ? 'border-dashed border-line text-faint' : 'border-line bg-sunken')}>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11.5px]">{s.domain ?? '—'}</span>
              {s.url && isHttp(s.url) && (
                <a href={demoSiteHref(s.url)} target="_blank" rel="noreferrer" className="truncate text-[11px] text-accent hover:underline">
                  {s.url}
                </a>
              )}
            </div>
            {s.excerpt && <p className="mt-0.5 line-clamp-2 text-muted">{s.excerpt}</p>}
            {s.reason && <p className="mt-0.5 text-faint">{String(s.reason)}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CorroborationView({ c }: { c: Corroboration }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="tnum font-medium">{c.independent_domains} independent source{c.independent_domains === 1 ? '' : 's'}</span>
        <span className="text-faint">·</span>
        <span className={c.upgraded ? 'text-fg' : 'text-muted'}>{c.upgraded ? 'Upgraded to corroborated' : 'Not upgraded'}</span>
        <span className="text-[11px] text-faint">checked {timeAgo(c.checked_at)}</span>
      </div>
      {c.note && <p className="text-[12.5px] text-muted">{c.note}</p>}
      <SourceList title="Supporting" items={c.supporting} tone="support" />
      <SourceList title="Disputing" items={c.disputing} tone="dispute" />
      <SourceList title="Filtered as same-origin or near-duplicate" items={c.filtered} tone="filtered" />
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="section-title mb-2.5">{title}</h3>
      {children}
    </section>
  )
}

export function MemoryDetail({
  memId,
  onClose,
  onChanged,
  onOpen,
}: {
  memId: string | null
  onClose: () => void
  onChanged?: () => void
  onOpen?: (id: string) => void
}) {
  const { toast, refreshSession } = useApp()
  const { data, error, loading, reload } = useLoad(() => (memId ? api.memory(memId) : Promise.resolve(null)), [memId])
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmRevert, setConfirmRevert] = useState<string | null>(null)
  const m = data?.memory
  const trust = m?.effective_trust ?? m?.trust

  const act = async (k: string, fn: () => Promise<unknown>, okTitle: string, okBody?: string) => {
    setBusy(k)
    try {
      await fn()
      toast({ tone: 'success', title: okTitle, body: okBody })
      await reload(true)
      onChanged?.()
      refreshSession()
    } finally {
      setBusy(null)
    }
  }

  const gd = m?.gate_decision
  const classifier = gd?.classifier ?? {}
  const isClaim = m && ['claim', 'corroborated_claim', 'disputed'].includes(m.status)

  return (
    <Drawer open={!!memId} onClose={onClose} title="Memory" subtitle={m ? <span className="font-mono text-[11.5px]">{m.id}</span> : undefined} width="max-w-[640px]">
      {loading && !data && <SkeletonList rows={5} className="h-24" />}
      {error && <ErrorNote message={error} onRetry={() => reload()} />}
      {m && data && (
        <div className="space-y-7">
          <div className={cx('rounded-xl border border-line border-l-[3px] bg-surface px-4 py-4', trustRail(trust))}>
            <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
              <TrustBadge trust={trust} detail size="sm" />
              <StatusPill status={m.status} size="sm" />
              <TypeTag type={m.type} />
              {m.subject && <span className="font-mono text-[11px] text-faint">{m.subject}</span>}
              {data.vaulted && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                  <Lock className="h-3 w-3" /> encrypted in the vault
                </span>
              )}
            </div>
            <p className="text-[15px] leading-relaxed">{m.content}</p>
            {m.trust !== trust && (
              <p className="mt-2 text-[12px] text-muted">
                Originally {m.trust.toLowerCase()}; counts as green because you approved it.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {!['rejected', 'superseded', 'expired'].includes(m.status) && (
                <button className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => act('forget', () => api.forget(m.id), 'Forgotten', 'It will not be recalled again. History stays in the ledger.')}>
                  {busy === 'forget' ? <Spinner className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />} Forget
                </button>
              )}
              {isClaim && (
                <button className="btn btn-sm" disabled={!!busy} onClick={() => act('corr', () => api.corroborate(m.id), 'Sources checked')}>
                  {busy === 'corr' ? <Spinner className="h-3 w-3" /> : <Scale className="h-3 w-3" />} Check sources
                </button>
              )}
            </div>
          </div>

          <Block title="Where it came from">
            <div className="space-y-2">
              {m.provenance.map((p, i) => (
                <div key={i} className={cx('rounded-lg border px-3 py-2.5', p.hidden_technique ? 'border-red/35 bg-red/[0.05]' : 'border-line bg-sunken')}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SourceChip principal={p.principal} trust={p.trust} refUrl={p.ref} size="sm" />
                    <TrustBadge trust={p.trust} size="sm" />
                    <span className="text-[11px] text-faint">{p.kind.replace('_', ' ')}</span>
                    {p.hidden_technique && <TechniqueNote technique={p.hidden_technique} />}
                    <span className="ml-auto text-[11px] text-faint">{fmtDateTime(p.captured_at)}</span>
                  </div>
                  {p.excerpt && <p className="mt-2 text-[13px] leading-relaxed">“{p.excerpt}”</p>}
                  {p.ref && !isHttp(p.ref) && <p className="mt-1 font-mono text-[11px] text-faint">ref {p.ref}</p>}
                  {p.excerpt_hash && <p className="mt-1 truncate font-mono text-[10.5px] text-faint">sha256 {p.excerpt_hash}</p>}
                </div>
              ))}
            </div>
          </Block>

          {gd && (
            <Block title="Trust Gate decision">
              <div className="rounded-lg border border-line bg-sunken px-3 py-2.5">
                <div className="text-[13px] font-medium">{GATE_ACTION_HELP[gd.action] ?? gd.action}</div>
                <p className="mt-0.5 text-[12.5px] text-muted">{gd.reason}</p>
                {gd.detector_flags.length > 0 && (
                  <div className="mt-2.5">
                    <FlagRow flags={gd.detector_flags} />
                  </div>
                )}
                <div className="mt-3 divide-y divide-line border-t border-line">
                  {gd.suggestion && <KeyVal k="Suggestion">{gd.suggestion === 'reject' ? 'Reject' : 'Approve'}</KeyVal>}
                  {gd.classified_type && <KeyVal k="Classified as">{gd.classified_type}</KeyVal>}
                  {gd.high_risk && <KeyVal k="Risk">High-risk type</KeyVal>}
                  {Object.keys(classifier).length > 0 && (
                    <KeyVal k="Classifier votes">
                      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11.5px]">
                        {Object.entries(classifier).map(([k, v]) => (
                          <span key={k}>
                            <span className="text-faint">{k}</span> {typeof v === 'number' ? v.toFixed(2) : String(v)}
                          </span>
                        ))}
                      </div>
                    </KeyVal>
                  )}
                  {gd.conflict_with && (
                    <KeyVal k="Conflicts with">
                      <button className="font-mono text-[11.5px] text-accent hover:underline" onClick={() => onOpen?.(gd.conflict_with!)}>
                        {gd.conflict_with}
                      </button>
                    </KeyVal>
                  )}
                  {m.created_by_model && <KeyVal k="Written by">{<span className="font-mono text-[11.5px]">{m.created_by_model}</span>}</KeyVal>}
                  {m.expires_at && <KeyVal k="Expires">{fmtDateTime(m.expires_at)}</KeyVal>}
                </div>
              </div>
            </Block>
          )}

          {m.corroboration && (
            <Block title="Corroboration">
              <CorroborationView c={m.corroboration} />
            </Block>
          )}

          <Block title={`Ledger history (${data.history.length})`}>
            <p className="-mt-1 mb-3 text-[12.5px] text-muted">Every change is a git commit. Expand one to see what changed; revert to any earlier version.</p>
            <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[7.5px] before:top-2 before:w-px before:bg-line">
              {data.history.map((c, i) => (
                <CommitRow key={c.sha} c={c} prev={data.history[i + 1]} isHead={i === 0} onRevert={setConfirmRevert} busy={!!busy} />
              ))}
            </ol>
          </Block>

          {data.used_in.filter(Boolean).length > 0 && (
            <Block title="Used in">
              <ul className="space-y-1">
                {data.used_in.filter(Boolean).map((t) => (
                  <li key={t!.id} className="flex items-baseline gap-2 text-[12.5px]">
                    <span className="truncate">“{t!.content}”</span>
                    <span className="ml-auto shrink-0 text-[11px] text-faint">{timeAgo(t!.created_at)}</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>
      )}
      <Dialog
        open={!!confirmRevert}
        onClose={() => setConfirmRevert(null)}
        title="Revert this memory?"
        footer={
          <>
            <button className="btn" onClick={() => setConfirmRevert(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const sha = confirmRevert!
                setConfirmRevert(null)
                act('revert', () => api.revert(m!.id, sha), 'Reverted', `Restored version ${shortSha(sha)}. The revert is itself a new commit.`)
              }}
            >
              Revert to {confirmRevert ? shortSha(confirmRevert) : ''}
            </button>
          </>
        }
      >
        The memory goes back to exactly how it was at that commit. Nothing is deleted: the revert is recorded as a new commit.
      </Dialog>
    </Drawer>
  )
}
