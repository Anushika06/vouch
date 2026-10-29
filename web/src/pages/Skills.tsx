import { useState } from 'react'
import {
  Ban,
  Box,
  CheckCircle2,
  FileCode2,
  FolderLock,
  Globe,
  Hash,
  Play,
  Puzzle,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useLoad } from '../lib/app'
import { cx, fmtDateTime, timeAgo } from '../lib/format'
import type { ScanFinding, SkillManifest, SkillRow, SkillRun, TurnResult } from '../lib/types'
import { MemoryEventChips, Segments } from '../components/Answer'
import { PageShell } from '../components/Layout'
import { CopyButton, Dialog, ErrorNote, PageHeader, Section, SkeletonList, Spinner, Switch } from '../components/ui'

const SEV: Record<string, string> = {
  high: 'border-red/40 bg-red/10 text-red-ink',
  medium: 'border-[#f97316]/40 bg-[#f97316]/10 text-[#ea7a2a]',
  low: 'border-line bg-raised text-muted',
}

const VERDICT: Record<string, { cls: string; icon: typeof ShieldCheck; label: string }> = {
  malicious: { cls: 'border-red/45 bg-red/10 text-red-ink', icon: ShieldAlert, label: 'Malicious' },
  suspicious: { cls: 'border-[#f97316]/45 bg-[#f97316]/10 text-[#ea7a2a]', icon: ShieldAlert, label: 'Suspicious' },
  benign: { cls: 'border-line-strong bg-raised text-fg', icon: ShieldCheck, label: 'Benign' },
}

function Perm({ icon: Icon, label, items }: { icon: typeof Globe; label: string; items: string[] }) {
  return (
    <div className="flex items-start gap-2 text-[12.5px]">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
      <span className="w-14 shrink-0 text-muted">{label}</span>
      {items.length ? (
        <span className="flex min-w-0 flex-wrap gap-1">
          {items.map((x) => (
            <span key={x} className="rounded border border-line bg-sunken px-1.5 font-mono text-[11px]">
              {x}
            </span>
          ))}
        </span>
      ) : (
        <span className="text-faint">none</span>
      )}
    </div>
  )
}

function Findings({ scan }: { scan: ScanFinding[] }) {
  if (!scan.length) return <p className="text-[12.5px] text-muted">The static scan found nothing the manifest doesn’t declare.</p>
  const order = { high: 0, medium: 1, low: 2 } as Record<string, number>
  return (
    <ul className="space-y-1.5">
      {[...scan]
        .sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3))
        .map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-[12.5px]">
            <span className={cx('mt-px inline-flex h-5 w-[58px] shrink-0 items-center justify-center rounded-md border text-[11px] font-medium capitalize', SEV[f.severity])}>
              {f.severity}
            </span>
            <div className="min-w-0">
              <span className="break-words">{f.detail}</span>
              <span className="ml-1.5 font-mono text-[11px] text-faint">
                {f.file}:{f.line}
              </span>
            </div>
          </li>
        ))}
    </ul>
  )
}

function ReviewPanel({ row, onApprove, onReject, busy }: { row: SkillRow; onApprove: () => void; onReject: () => void; busy: string | null }) {
  const v = VERDICT[row.review?.verdict ?? ''] ?? VERDICT.suspicious
  return (
    <div className="space-y-4 border-t border-line bg-sunken/50 px-4 py-4 animate-fade-in">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium">
          <FileCode2 className="h-3.5 w-3.5 text-muted" /> Static scan
          <span className="tnum text-faint">{row.scan.length}</span>
        </div>
        <Findings scan={row.scan} />
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px] font-medium">
          <ShieldCheck className="h-3.5 w-3.5 text-muted" /> Model security review
          {row.review?.model && <span className="font-mono text-[11px] font-normal text-faint">{row.review.model}</span>}
          {row.review?.deep && <span className="rounded bg-raised px-1.5 text-[10.5px] font-normal text-muted">Ultra review</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx('inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-semibold', v.cls)}>
            <v.icon className="h-3.5 w-3.5" /> {v.label}
          </span>
          {row.review?.risk && <span className="text-[12px] text-muted">{row.review.risk} risk</span>}
        </div>
        {row.review?.explanation && <p className="mt-2 text-[12.5px] leading-relaxed text-fg/85">{row.review.explanation}</p>}
        {row.review?.note && <p className="mt-1 text-[12px] text-muted">{row.review.note}</p>}
        {!!row.review?.undeclared_capabilities?.length && (
          <div className="mt-2">
            <div className="mb-1 text-[11.5px] text-faint">Does things the manifest doesn’t declare</div>
            <ul className="list-inside list-disc space-y-0.5 text-[12px] text-muted marker:text-faint">
              {row.review.undeclared_capabilities.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-[11.5px] text-muted">
        <Hash className="h-3.5 w-3.5 text-faint" /> Pinned to
        <span className="truncate font-mono text-[11px] text-fg/80" title={row.hash}>
          sha256:{row.hash.slice(0, 20)}…
        </span>
        <CopyButton text={row.hash} label="Copy hash" />
      </div>
      <p className="text-[11.5px] text-faint">If any file changes after you approve, the pin breaks and Vouch refuses to run it.</p>
      <div className="flex flex-wrap gap-2">
        <button className={cx('btn', row.review?.verdict !== 'benign' && 'btn-primary')} onClick={onReject} disabled={!!busy}>
          {busy === 'reject' ? <Spinner className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />} Reject and remove
        </button>
        <button className={cx('btn', row.review?.verdict === 'benign' ? 'btn-primary' : 'btn-danger')} onClick={onApprove} disabled={!!busy}>
          {busy === 'approve' ? <Spinner className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {row.review?.verdict === 'malicious' ? 'Install anyway…' : 'Approve install'}
        </button>
      </div>
    </div>
  )
}

function RunsList({ runs }: { runs: SkillRun[] }) {
  if (!runs.length) return null
  return (
    <ul className="space-y-2">
      {runs.map((r) => (
        <li key={r.id} className="rounded-lg border border-line bg-sunken px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <Box className="h-3.5 w-3.5 text-faint" />
            <span className="font-mono text-[11.5px]">{r.sandbox}</span>
            <span className="ml-auto text-faint">{timeAgo(r.created_at)}</span>
          </div>
          {r.log.blocked.length > 0 && (
            <div className="mt-2 space-y-1">
              {r.log.blocked.map((b, i) => (
                <div key={i} className="flex min-w-0 items-center gap-2 text-[12px] text-red-ink">
                  <Ban className="h-3 w-3 shrink-0" />
                  <span className="shrink-0 whitespace-nowrap">Blocked {b.kind.replace('_', ' ')}</span>
                  <span className="min-w-0 truncate font-mono text-[11px]" title={b.detail}>{b.detail}</span>
                </div>
              ))}
            </div>
          )}
          {r.log.unblocked.length > 0 && (
            <div className="mt-2 space-y-1">
              {r.log.unblocked.map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px] text-muted">
                  <Globe className="h-3 w-3 shrink-0" />
                  Not blocked: {b.kind.replace('_', ' ')}
                  <span className="truncate font-mono text-[11px]">{b.detail}</span>
                </div>
              ))}
            </div>
          )}
          {r.output && (
            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap border-t border-line pt-2 font-mono text-[11px] leading-relaxed text-muted">{r.output}</pre>
          )}
        </li>
      ))}
    </ul>
  )
}

function SkillCard({
  m,
  row,
  runs,
  onChanged,
}: {
  m: SkillManifest
  row?: SkillRow
  runs: SkillRun[]
  onChanged: () => void
}) {
  const { toast, refreshSession } = useApp()
  const [deep, setDeep] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [ack, setAck] = useState(false)
  const [result, setResult] = useState<TurnResult | null>(null)
  const status = row?.status
  const installed = status === 'installed'

  const go = async (k: string, fn: () => Promise<unknown>) => {
    setBusy(k)
    try {
      await fn()
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  const approve = (override = false) =>
    go('approve', async () => {
      const r = await api.approveSkill(m.name, override)
      if (r.error) {
        setConfirm(true)
        return
      }
      setConfirm(false)
      toast({ tone: override ? 'info' : 'success', title: `${m.name} installed`, body: 'It runs sandboxed, pinned to the hash you approved, and its output is red.' })
    })

  const blocked = result?.trace.filter((t) => t.kind === 'skill').flatMap((t) => (t.blocked as { kind: string; detail: string }[]) ?? []) ?? []

  return (
    <article className={cx('card flex flex-col overflow-hidden', status === 'pending_approval' && 'ring-1 ring-accent/30')}>
      <div className="flex-1 px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-raised">
            <Puzzle className="h-4 w-4 text-muted" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-mono text-[13.5px] font-medium">{m.name}</h3>
              <span className="text-[11.5px] text-faint">v{m.version}</span>
              {installed && (
                <span className="inline-flex h-5 items-center gap-1 rounded-full border border-line-strong px-1.5 text-[11px] text-fg">
                  <CheckCircle2 className="h-3 w-3" /> Installed
                </span>
              )}
              {status === 'pending_approval' && (
                <span className="inline-flex h-5 items-center rounded-full border border-accent/45 bg-accent/10 px-1.5 text-[11px] text-accent">Awaiting your review</span>
              )}
            </div>
            <p className="mt-1 text-[13px] text-muted">{m.description}</p>
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <div className="text-[11.5px] text-faint">Declared permissions</div>
          <Perm icon={Globe} label="Network" items={m.permissions.network} />
          <Perm icon={FolderLock} label="Files" items={m.permissions.files} />
          <Perm icon={Wrench} label="Tools" items={m.permissions.tools} />
        </div>
      </div>

      {!row && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <label className="flex items-center gap-2 text-[12.5px] text-muted">
            <Switch checked={deep} onChange={setDeep} label="Ultra review" />
            Deep review with Nemotron Ultra
          </label>
          <button className="btn btn-primary" onClick={() => go('install', () => api.installSkill(m.name, deep))} disabled={!!busy}>
            {busy === 'install' ? <Spinner className="h-3.5 w-3.5" /> : null}
            {busy === 'install' ? 'Scanning and reviewing…' : 'Install'}
          </button>
        </div>
      )}

      {row && status === 'pending_approval' && (
        <ReviewPanel
          row={row}
          busy={busy}
          onApprove={() => (row.review?.verdict === 'malicious' ? setConfirm(true) : approve(false))}
          onReject={() => go('reject', () => api.rejectSkill(m.name).then(() => toast({ tone: 'info', title: `${m.name} rejected and removed` })))}
        />
      )}

      {installed && (
        <div className="space-y-3 border-t border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn btn-primary"
              disabled={!!busy}
              onClick={() =>
                go('run', async () => {
                  setResult(await api.runSkill(m.name))
                  refreshSession()
                })
              }
            >
              {busy === 'run' ? <Spinner className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} Run
            </button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => go('reject', () => api.rejectSkill(m.name))}>
              Uninstall
            </button>
            <span className="ml-auto text-[11.5px] text-faint">installed {fmtDateTime(row!.installed_at)}</span>
          </div>
          {result && (
            <div className="space-y-2.5 rounded-lg border border-line bg-sunken px-3 py-3 animate-rise">
              <Segments segments={result.segments} className="text-[13px]" />
              {blocked.length > 0 && (
                <div className="space-y-1">
                  {blocked.map((b, i) => (
                    <div key={i} className="flex min-w-0 items-center gap-2 text-[12px] text-red-ink">
                      <Ban className="h-3 w-3 shrink-0" />
                      <span className="shrink-0 whitespace-nowrap">Sandbox blocked {b.kind.replace('_', ' ')}</span>
                      <span className="min-w-0 truncate font-mono text-[11px]" title={b.detail}>{b.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              <MemoryEventChips events={result.memory_events} />
            </div>
          )}
          {runs.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11.5px] text-faint">Recent runs</div>
              <RunsList runs={runs.slice(0, 3)} />
            </div>
          )}
        </div>
      )}

      <Dialog
        open={confirm}
        onClose={() => {
          setConfirm(false)
          setAck(false)
        }}
        tone="danger"
        title={`Install ${m.name} anyway?`}
        footer={
          <>
            <button className="btn" onClick={() => setConfirm(false)}>
              Keep it out
            </button>
            <button className="btn border-transparent bg-red text-white hover:bg-red hover:brightness-110" disabled={!ack || !!busy} onClick={() => approve(true)}>
              {busy === 'approve' && <Spinner className="h-3.5 w-3.5" />} Install anyway
            </button>
          </>
        }
      >
        <p>The security review judged this skill malicious. It will still run inside the sandbox, which blocks undeclared network and file access, and its output is treated as untrusted.</p>
        <label className="mt-4 flex items-start gap-2.5 text-fg">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--trust-red))]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span className="text-[13px]">I understand this skill was flagged as malicious and I want to install it anyway.</span>
        </label>
      </Dialog>
    </article>
  )
}

export default function SkillsPage() {
  const { data, error, loading, reload } = useLoad(() => api.skills(), [])
  const rows = new Map((data?.installed ?? []).map((r) => [r.name, r]))
  const runsBy = (n: string) => (data?.runs ?? []).filter((r) => r.name === n)
  const extra = (data?.installed ?? []).filter((r) => !data?.catalog.some((c) => c.name === r.name))

  return (
    <PageShell wide>
      <PageHeader
        title="Skills"
        description="Add abilities to Vouch safely. Every install is statically scanned, reviewed by a model, pinned to a hash and approved by you. Runs are sandboxed and their output is red."
      />
      {error && <ErrorNote message={error} onRetry={() => reload()} />}
      {loading && !data && <SkeletonList rows={3} className="h-48" />}
      {data && (
        <>
          <Section title="Catalog" count={data.catalog.length} description="One of these is not what it claims to be. Install it and see what the review finds.">
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...data.catalog, ...extra.map((r) => r.manifest)].map((m) => (
                <SkillCard key={m.name} m={m} row={rows.get(m.name)} runs={runsBy(m.name)} onChanged={() => reload(true)} />
              ))}
            </div>
          </Section>
        </>
      )}
    </PageShell>
  )
}
