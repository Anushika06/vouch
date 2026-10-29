import { useEffect, useState } from 'react'
import { Download, RotateCcw, Save, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useLoad } from '../lib/app'
import { cx, num, usd } from '../lib/format'
import type { Settings } from '../lib/types'
import { PageShell } from '../components/Layout'
import { Dialog, ErrorNote, PageHeader, Section, SkeletonList, Spinner, TagInput } from '../components/ui'

const ROLE_WHY: [string, string, string][] = [
  ['chat', 'Nemotron 3.5 Lightning', 'The always-on loop: routing, answers, memory writing and the briefing headline.'],
  ['reader', 'Nemotron 3 Nano', 'The quarantined reader. Sees untrusted text, can only return typed fields.'],
  ['planner', 'Nemotron 3 Super', 'Plans over handles, never raw text, and gives second opinions at the Trust Gate.'],
  ['audit', 'Nemotron 3 Ultra', 'The nightly memory audit and deep skill security reviews.'],
  ['vl', 'Nemotron Super VL', 'Vision-language model, reserved for images and screenshots.'],
  ['embed', 'Qwen3-Embedding-8B', 'Memory recall embeddings. The only non-NVIDIA model.'],
]

const emailOk = (v: string) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? null : 'Enter a full email address')
const domainOk = (v: string) => (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v) ? null : 'Enter a domain like example.com')

type Lists = Pick<Settings, 'trusted_contacts' | 'trusted_domains' | 'followed_topics'>

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 py-5 md:grid-cols-[260px_minmax(0,1fr)] md:gap-8">
      <div>
        <div className="text-[13.5px] font-medium">{title}</div>
        <p className="mt-1 text-[12.5px] text-muted">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export default function SettingsPage() {
  const { toast, refreshSession, session } = useApp()
  const { data, setData, error, loading, reload } = useLoad(() => api.settings(), [])
  const [lists, setLists] = useState<Lists | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (data) setLists({ trusted_contacts: data.trusted_contacts, trusted_domains: data.trusted_domains, followed_topics: data.followed_topics })
  }, [data])

  const dirty = !!(data && lists && JSON.stringify(lists) !== JSON.stringify({ trusted_contacts: data.trusted_contacts, trusted_domains: data.trusted_domains, followed_topics: data.followed_topics }))

  const save = async () => {
    if (!lists) return
    setSaving(true)
    try {
      setData(await api.saveSettings(lists))
      toast({ tone: 'success', title: 'Settings saved', body: 'Email from these contacts and domains is now yellow.' })
    } finally {
      setSaving(false)
    }
  }

  const wipe = async (kind: 'delete' | 'reset') => {
    setBusy(kind)
    try {
      const r = kind === 'delete' ? await api.deleteAll() : await api.resetSession()
      toast({ tone: 'success', title: kind === 'delete' ? 'Everything deleted' : 'Demo reset', body: 'message' in r ? (r as { message: string }).message : 'Asha’s demo data has been restored.' })
      setConfirmDelete(false)
      setConfirmReset(false)
      setTyped('')
      await refreshSession()
      reload()
    } finally {
      setBusy(null)
    }
  }

  const usage = data?.usage
  return (
    <PageShell>
      <PageHeader title="Settings & privacy" description="Who Vouch trusts, which models do what, what it has cost, and your data." />
      {error && <ErrorNote message={error} onRetry={() => reload()} />}
      {loading && !data && <SkeletonList rows={4} className="h-24" />}
      {data && lists && (
        <>
          <Section
            title="Trust"
            actions={
              <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
                {saving ? <Spinner className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />} Save changes
              </button>
            }
          >
            <div className="card divide-y divide-line px-5">
              <Panel title="Trusted contacts" description="Their emails are yellow. Vouch still checks them before acting, because accounts get compromised.">
                <TagInput values={lists.trusted_contacts} onChange={(v) => setLists({ ...lists, trusted_contacts: v })} placeholder="name@example.com" validate={emailOk} />
              </Panel>
              <Panel title="Trusted domains" description="Everyone at these domains counts as a trusted contact. Leave empty unless you’re sure.">
                <TagInput values={lists.trusted_domains} onChange={(v) => setLists({ ...lists, trusted_domains: v })} placeholder="example.com" validate={domainOk} />
              </Panel>
              <Panel title="Followed topics" description="Searched each morning for your briefing. Results are always red.">
                <TagInput values={lists.followed_topics} onChange={(v) => setLists({ ...lists, followed_topics: v })} placeholder="Add a topic" mono={false} />
              </Panel>
            </div>
          </Section>

          <Section title="Model routing" description={`Each job goes to the smallest model that can do it safely. Provider: ${data.provider}.`}>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[620px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] text-muted">
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-3 py-2.5 font-medium">Model</th>
                    <th className="px-4 py-2.5 font-medium">Why this model</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLE_WHY.filter(([r]) => r in data.models || r !== 'vl').map(([role, family, why]) => (
                    <tr key={role} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-3 align-top font-mono text-[12px]">{role}</td>
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium">{family}</div>
                        <div className={cx('font-mono text-[11px]', data.models[role] ? 'text-muted' : 'text-faint')}>{data.models[role] ?? 'not resolved'}</div>
                      </td>
                      <td className="px-4 py-3 align-top text-muted">{why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Usage this session" description="Tokens and cost by role, metered on every call.">
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="card px-4 py-3">
                <div className="text-[12px] text-muted">Tokens</div>
                <div className="tnum mt-1 text-[20px] font-semibold">{num(usage?.total_tokens)}</div>
                {!!usage?.token_cap && <div className="text-[11.5px] text-faint">cap {num(usage.token_cap)}</div>}
              </div>
              <div className="card px-4 py-3">
                <div className="text-[12px] text-muted">Cost</div>
                <div className="tnum mt-1 text-[20px] font-semibold">{usd(usage?.total_cost)}</div>
                {session?.mock && <div className="text-[11.5px] text-faint">mock models are free</div>}
              </div>
              <div className="card px-4 py-3">
                <div className="text-[12px] text-muted">Tavily calls</div>
                <div className="tnum mt-1 text-[20px] font-semibold">{num(usage?.tavily_calls)}</div>
                <div className="text-[11.5px] text-faint">
                  {num(usage?.tavily_cache_hits)} cache hits{usage?.tavily_cap ? ` · cap ${usage.tavily_cap}` : ''}
                </div>
              </div>
            </div>
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[620px] text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-muted">
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-3 py-2.5 font-medium">Model</th>
                    <th className="px-3 py-2.5 text-right font-medium">Calls</th>
                    <th className="px-3 py-2.5 text-right font-medium">Tokens in</th>
                    <th className="px-3 py-2.5 text-right font-medium">Tokens out</th>
                    <th className="px-3 py-2.5 text-right font-medium">Avg latency</th>
                    <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(usage?.by_role ?? []).map((r) => (
                    <tr key={r.role + r.model} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2 font-mono text-[12px]">{r.role}</td>
                      <td className="px-3 py-2 font-mono text-[11.5px] text-muted">{r.model}</td>
                      <td className="tnum px-3 py-2 text-right">{num(r.calls)}</td>
                      <td className="tnum px-3 py-2 text-right">{num(r.tin)}</td>
                      <td className="tnum px-3 py-2 text-right">{num(r.tout)}</td>
                      <td className="tnum px-3 py-2 text-right">{r.avg_ms ? `${Math.round(r.avg_ms)} ms` : '—'}</td>
                      <td className="tnum px-4 py-2 text-right">{usd(r.cost)}</td>
                    </tr>
                  ))}
                  {!usage?.by_role.length && (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-muted">
                        No model calls yet. Send a message in Chat.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Your data">
            <div className="card divide-y divide-line px-5">
              <Panel title="Export everything" description="The whole memory ledger as a git repository in a zip: every memory, every commit, every source.">
                <button
                  className="btn"
                  disabled={busy === 'export'}
                  onClick={async () => {
                    setBusy('export')
                    try {
                      await api.exportZip()
                    } catch {
                      toast({ tone: 'error', title: 'Export failed' })
                    } finally {
                      setBusy(null)
                    }
                  }}
                >
                  {busy === 'export' ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />} Export memory ledger (.zip)
                </button>
              </Panel>
              <Panel title="Reset the demo" description="Restore Asha’s original inbox, calendar and memories. Useful after trying attacks.">
                <button className="btn" onClick={() => setConfirmReset(true)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reset demo
                </button>
              </Panel>
              <Panel title="Delete everything" description="Permanently delete every memory, email, event and ledger commit in this session.">
                <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete everything
                </button>
              </Panel>
            </div>
          </Section>
        </>
      )}

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset the demo?"
        footer={
          <>
            <button className="btn" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => wipe('reset')} disabled={!!busy}>
              {busy === 'reset' && <Spinner className="h-3.5 w-3.5" />} Reset demo
            </button>
          </>
        }
      >
        Your chats, approvals and anything Vouch learned this session are cleared, and Asha’s starting data comes back.
      </Dialog>

      <Dialog
        open={confirmDelete}
        onClose={() => {
          setConfirmDelete(false)
          setTyped('')
        }}
        tone="danger"
        title="Delete everything?"
        footer={
          <>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button
              className="btn border-transparent bg-red text-white hover:bg-red hover:brightness-110"
              disabled={typed.trim().toLowerCase() !== 'delete everything' || !!busy}
              onClick={() => wipe('delete')}
            >
              {busy === 'delete' && <Spinner className="h-3.5 w-3.5" />} Delete everything
            </button>
          </>
        }
      >
        <p>This permanently deletes every memory, email, event and ledger commit for this session. It can’t be undone.</p>
        <label className="mt-4 block">
          <span className="text-[12.5px] text-fg">
            Type <span className="font-mono">delete everything</span> to confirm
          </span>
          <input className="input mt-1.5" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus aria-label="Confirmation" />
        </label>
      </Dialog>
    </PageShell>
  )
}
