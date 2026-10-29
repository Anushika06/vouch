import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, FlaskConical, Table2, Terminal, TriangleAlert } from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useLoad } from '../lib/app'
import { cx, fmtDateTime, num, pct, usd } from '../lib/format'
import type { EvalConfig, EvalsPayload } from '../lib/types'
import { PageShell } from '../components/Layout'
import { ErrorNote, PageHeader, Section, SkeletonList, Tabs } from '../components/ui'

// Validated categorical slots 1 and 2 (dataviz reference palette), stepped per theme.
const SERIES = {
  dark: { vouch: '#3987e5', naive: '#d95926', context: '#4a5571', grid: '#242c40', axis: '#8e97ad', cursor: 'rgba(143,168,255,0.08)' },
  light: { vouch: '#2a78d6', naive: '#eb6834', context: '#c4cad8', grid: '#e3e7ef', axis: '#5d6679', cursor: 'rgba(50,82,226,0.06)' },
}

const CONFIG_LABEL: Record<string, string> = {
  naive: 'Naive memory',
  'vouch-full': 'Vouch (full)',
  'no-gate': 'Without the Trust Gate',
  'no-reader-split': 'Without the quarantined reader',
  'no-taint': 'Without taint checks',
  'no-corroboration-rules': 'Without corroboration rules',
}

function MockBadge() {
  return <span className="rounded-md border border-[#f59e0b]/40 bg-[#f59e0b]/10 px-1.5 py-px text-[11px] font-semibold text-yellow-ink">MOCK</span>
}

function Stat({ label, value, sub, mock }: { label: string; value: string; sub?: React.ReactNode; mock?: boolean }) {
  return (
    <div className="card px-4 py-4">
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        {label}
        {mock && <MockBadge />}
      </div>
      <div className="tnum mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.02em]">{value}</div>
      {sub && <div className="mt-2 text-[12px] text-muted">{sub}</div>}
    </div>
  )
}

function ChartTooltip({ active, payload, label, names }: { active?: boolean; payload?: { name: string; value: number; color: string; payload: Record<string, unknown> }[]; label?: string; names: Record<string, string> }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-pop">
      <div className="mb-1 font-medium">
        {label} <span className="font-normal text-muted">{names[label ?? ''] ?? ''}</span>
      </div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-muted">{p.name}</span>
          <span className="tnum ml-auto pl-4 font-medium">{pct(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function ScenarioChart({ cfgs, names }: { cfgs: Record<string, EvalConfig>; names: Record<string, string> }) {
  const { theme } = useApp()
  const c = SERIES[theme]
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const ids = Array.from(new Set(Object.values(cfgs).flatMap((x) => Object.keys(x.by_scenario)))).sort()
  const data = ids.map((id) => ({
    id,
    naive: cfgs.naive?.by_scenario[id]?.asr.mean ?? null,
    vouch: cfgs['vouch-full']?.by_scenario[id]?.asr.mean ?? null,
    follow: cfgs['vouch-full']?.by_scenario[id]?.asr_if_user_follows_suggestions ?? null,
    variants: cfgs['vouch-full']?.by_scenario[id]?.variants ?? cfgs.naive?.by_scenario[id]?.variants ?? 0,
  }))
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-[12.5px]">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.naive }} /> Naive memory
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.vouch }} /> Vouch
          </span>
        </div>
        <Tabs
          value={view}
          onChange={setView}
          items={[
            { value: 'chart', label: <><BarChart3 className="h-3.5 w-3.5" /> Chart</> },
            { value: 'table', label: <><Table2 className="h-3.5 w-3.5" /> Table</> },
          ]}
        />
      </div>
      {view === 'chart' ? (
        <div className="h-[300px]" role="img" aria-label="Attack success rate per scenario, naive memory versus Vouch">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 18, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={c.grid} />
              <XAxis dataKey="id" tickLine={false} axisLine={{ stroke: c.grid }} tick={{ fill: c.axis, fontSize: 12, fontFamily: 'JetBrains Mono' }} />
              <YAxis
                domain={[0, 1]}
                ticks={[0, 0.25, 0.5, 0.75, 1]}
                tickFormatter={(v) => `${Math.round(v * 100)}%`}
                tickLine={false}
                axisLine={false}
                tick={{ fill: c.axis, fontSize: 11 }}
              />
              <Tooltip cursor={{ fill: c.cursor }} content={<ChartTooltip names={names} />} />
              <Bar dataKey="naive" name="Naive memory" fill={c.naive} radius={[4, 4, 0, 0]} minPointSize={2} isAnimationActive={false} />
              <Bar dataKey="vouch" name="Vouch" fill={c.vouch} radius={[4, 4, 0, 0]} minPointSize={2} isAnimationActive={false}>
                <LabelList dataKey="vouch" position="top" formatter={(v: number) => pct(v)} style={{ fill: c.axis, fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th className="py-2 pr-3 font-medium">Scenario</th>
                <th className="py-2 pr-3 text-right font-medium">Variants</th>
                <th className="py-2 pr-3 text-right font-medium">Naive</th>
                <th className="py-2 pr-3 text-right font-medium">Vouch</th>
                <th className="py-2 text-right font-medium" title="If Asha approved everything Vouch suggested approving">If suggestions followed</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} className="border-b border-line/60">
                  <td className="py-2 pr-3">
                    <span className="font-mono">{d.id}</span> <span className="text-muted">{names[d.id]}</span>
                  </td>
                  <td className="tnum py-2 pr-3 text-right text-muted">{d.variants}</td>
                  <td className="tnum py-2 pr-3 text-right">{pct(d.naive)}</td>
                  <td className="tnum py-2 pr-3 text-right font-medium">{pct(d.vouch)}</td>
                  <td className="tnum py-2 text-right text-muted">{pct(d.follow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11.5px] text-faint">Attack success rate: share of attack variants where the attacker got what they wanted. Lower is better.</p>
    </div>
  )
}

function AblationChart({ cfgs }: { cfgs: Record<string, EvalConfig> }) {
  const { theme } = useApp()
  const c = SERIES[theme]
  const data = Object.entries(cfgs).map(([k, v]) => ({ k, label: CONFIG_LABEL[k] ?? k, asr: v.attack_success_rate.mean ?? 0 }))
  const color = (k: string) => (k === 'vouch-full' ? c.vouch : k === 'naive' ? c.naive : c.context)
  return (
    <div className="card p-4">
      <div className="h-[220px]" style={{ height: Math.max(120, data.length * 40 + 20) }} role="img" aria-label="Overall attack success rate by configuration">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }} barCategoryGap="30%">
            <XAxis type="number" domain={[0, 1]} hide />
            <YAxis type="category" dataKey="label" width={210} tickLine={false} axisLine={false} tick={{ fill: c.axis, fontSize: 12 }} />
            <Tooltip cursor={{ fill: c.cursor }} content={<ChartTooltip names={{}} />} />
            <Bar dataKey="asr" name="Attack success" radius={[0, 4, 4, 0]} minPointSize={2} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.k} fill={color(d.k)} />
              ))}
              <LabelList dataKey="asr" position="right" formatter={(v: number) => pct(v)} style={{ fill: c.axis, fontSize: 11.5 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11.5px] text-faint">Each ablation turns off one layer of Vouch. Grey bars are the ablations; the gap to Vouch (full) is what that layer buys.</p>
    </div>
  )
}

function ConfigTable({ cfgs }: { cfgs: Record<string, EvalConfig> }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th className="px-4 py-2.5 font-medium">Config</th>
            <th className="px-3 py-2.5 text-right font-medium">Attack success</th>
            <th className="px-3 py-2.5 text-right font-medium">Benign false positives</th>
            <th className="px-3 py-2.5 text-right font-medium">Missed by writer</th>
            <th className="px-3 py-2.5 text-right font-medium">Approval prompts / 100</th>
            <th className="px-3 py-2.5 text-right font-medium">Latency p50 / p95</th>
            <th className="px-4 py-2.5 text-right font-medium">Eval cost</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(cfgs).map(([k, v]) => {
            const a = v.attack_success_rate
            const b = v.benign
            return (
              <tr key={k} className={cx('border-b border-line/60 last:border-0', k === 'vouch-full' && 'bg-accent/[0.05]')}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{CONFIG_LABEL[k] ?? k}</div>
                  <div className="font-mono text-[11px] text-faint">{k}</div>
                </td>
                <td className="tnum px-3 py-2.5 text-right">
                  {pct(a.mean)}
                  {a.std ? <span className="text-faint"> ±{Math.round(a.std * 100)}</span> : null}
                  <div className="text-[11px] text-faint">{v.attack_runs} runs{v.attack_errors ? `, ${v.attack_errors} errors` : ''}</div>
                </td>
                <td className="tnum px-3 py-2.5 text-right">
                  {pct(b.false_positive_rate.mean, 1)}
                  <div className="text-[11px] text-faint">
                    {b.over_restricted}/{b.ok + b.over_restricted} checks
                  </div>
                </td>
                <td className="tnum px-3 py-2.5 text-right">{b.missed}</td>
                <td className="tnum px-3 py-2.5 text-right">{v.approval_prompts_per_100_interactions ?? '—'}</td>
                <td className="tnum px-3 py-2.5 text-right">
                  {num(v.latency_ms.p50)} / {num(v.latency_ms.p95)} ms
                </td>
                <td className="tnum px-4 py-2.5 text-right">{usd(v.cost_usd)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Unavailable({ scenarios, variants }: { scenarios: number; variants: number }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="hairline-grid absolute inset-0 opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden />
      <div className="relative grid gap-8 px-6 py-10 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.02em]">No published run yet</h2>
          <p className="mt-2 max-w-[56ch] text-[13.5px] leading-relaxed text-muted">
            The numbers on this page come only from <span className="font-mono text-fg/90">evals/run.py</span> running against real Nemotron models on
            Nebius Token Factory. The script writes <span className="font-mono text-fg/90">evals/results/latest.json</span>, and this page shows it
            exactly as written. Results are never edited by hand, and mock runs are never published here.
          </p>
          <ul className="mt-5 space-y-2 text-[13px]">
            <li className="flex gap-2.5">
              <span className="tnum flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] text-muted">1</span>
              {scenarios ? `${scenarios} attack scenarios with ${variants} variants` : 'Every attack scenario and variant'}, each run against naive memory, Vouch and
              ablations that switch off one defence at a time
            </li>
            <li className="flex gap-2.5">
              <span className="tnum flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] text-muted">2</span>A benign suite to measure false positives and approval friction
            </li>
            <li className="flex gap-2.5">
              <span className="tnum flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] text-muted">3</span>A simulated day of always-on use for cost, plus optional LongMemEval utility
            </li>
          </ul>
          {import.meta.env.DEV && (
            <a href="/evals?fixture=mock" className="btn mt-6">
              <FlaskConical className="h-3.5 w-3.5" /> Preview with the mock fixture (dev only)
            </a>
          )}
        </div>
        <div className="self-start rounded-xl border border-line bg-sunken p-4 font-mono text-[12px] leading-relaxed">
          <div className="mb-2 flex items-center gap-1.5 font-sans text-[12px] text-muted">
            <Terminal className="h-3.5 w-3.5" /> Produce a run
          </div>
          <div className="text-faint"># needs a Token Factory key in .env</div>
          <div>
            <span className="text-faint">$ </span>make eval
          </div>
          <div className="mt-3 text-faint"># or directly</div>
          <div>
            <span className="text-faint">$ </span>python -m evals.run --config all --runs 3
          </div>
        </div>
      </div>
    </div>
  )
}

export default function EvalsPage() {
  const { data, error, loading, reload } = useLoad<EvalsPayload>(() => api.evals(), [])
  const scen = useLoad(() => api.scenarios(), [])
  const names = useMemo(() => Object.fromEntries((scen.data ?? []).map((s) => [s.id, s.name])), [scen.data])
  const mock = data?.provider === 'mock'
  const cfgs = data?.aggregate?.configs ?? {}
  const naive = cfgs.naive
  const full = cfgs['vouch-full']
  const day = data?.day ?? []
  const dayFull = day.find((d) => d.config === 'vouch-full')
  const dayNaive = day.find((d) => d.config === 'naive')
  const lme = data?.longmemeval ?? {}

  return (
    <PageShell wide>
      <PageHeader
        title="Evals"
        description="How often attacks succeed against naive memory and against Vouch, what Vouch costs in false positives, friction, latency and money, and where it still fails."
      >
        {data?.available && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
            <span>
              Provider <span className="font-mono text-fg/85">{data.provider}</span>
            </span>
            {mock && <MockBadge />}
            <span className="text-faint">·</span>
            <span>generated {fmtDateTime(data.generated_at)}</span>
            <span className="text-faint">·</span>
            <span>
              {data.runs} run{data.runs === 1 ? '' : 's'} per variant
            </span>
          </div>
        )}
      </PageHeader>

      {error && <ErrorNote message={error} onRetry={() => reload()} />}
      {loading && !data && <SkeletonList rows={3} className="h-40" />}
      {data && !data.available && <Unavailable scenarios={scen.data?.length ?? 0} variants={(scen.data ?? []).reduce((n, s) => n + s.variants.length, 0)} />}

      {data?.available && (
        <>
          {mock && (
            <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-[#f59e0b]/35 bg-[#f59e0b]/10 px-4 py-3 text-[13px] text-yellow-ink">
              <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="font-semibold">MOCK RUN.</span> Deterministic stand-in models produced these numbers. They test the pipeline, not Nemotron, and
                must not be quoted as results.
              </span>
            </div>
          )}

          <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              mock={mock}
              label="Attack success, naive → Vouch"
              value={`${pct(naive?.attack_success_rate.mean)} → ${pct(full?.attack_success_rate.mean)}`}
              sub={`${full?.attack_runs ?? 0} attack runs per config`}
            />
            <Stat
              mock={mock}
              label="Benign false-positive rate"
              value={pct(full?.benign.false_positive_rate.mean, 1)}
              sub={full ? `${full.benign.over_restricted} of ${full.benign.ok + full.benign.over_restricted} legitimate checks over-restricted` : undefined}
            />
            <Stat
              mock={mock}
              label="Approval prompts per 100 turns"
              value={String(full?.approval_prompts_per_100_interactions ?? '—')}
              sub={naive ? `naive: ${naive.approval_prompts_per_100_interactions ?? 0} (it never asks)` : undefined}
            />
            <Stat
              mock={mock}
              label="Latency p50 / p95"
              value={`${num(full?.latency_ms.p50)} / ${num(full?.latency_ms.p95)} ms`}
              sub={naive ? `naive: ${num(naive.latency_ms.p50)} / ${num(naive.latency_ms.p95)} ms` : undefined}
            />
            {dayFull && (
              <Stat
                mock={mock}
                label="Cost of one simulated day"
                value={usd(dayFull.cost_usd)}
                sub={`${dayFull.turns} turns, ${num(dayFull.tokens)} tokens${dayNaive ? ` · naive ${usd(dayNaive.cost_usd)}` : ''}`}
              />
            )}
            {Object.entries(lme).map(([k, v]) => (
              <Stat key={k} mock={mock} label={`LongMemEval accuracy · ${CONFIG_LABEL[k] ?? k}`} value={pct(v.accuracy, 1)} sub={`${v.n} questions`} />
            ))}
          </div>

          <Section title="Attack success by scenario" description="Naive memory against Vouch on every attack family. Hover a bar for the exact rate.">
            <ScenarioChart cfgs={cfgs} names={names} />
          </Section>

          {Object.keys(cfgs).length > 2 && (
            <Section title="What each layer buys" description="Overall attack success with one defence switched off at a time.">
              <AblationChart cfgs={cfgs} />
            </Section>
          )}

          <Section title="Every configuration" description="Security, utility and cost side by side.">
            <ConfigTable cfgs={cfgs} />
          </Section>

          <Section title="Where Vouch failed" count={data.failures?.length ?? 0} description="Every attack variant that succeeded against the full Vouch configuration, listed as the harness recorded it.">
            {data.failures && data.failures.length > 0 ? (
              <ul className="space-y-2">
                {data.failures.map((f, i) => (
                  <li key={i} className="card flex gap-3 px-4 py-3">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-ink" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium">
                        <span className="font-mono">{f.variant}</span> <span className="text-muted">{f.label}</span>
                      </div>
                      <ul className="mt-1 space-y-0.5 text-[12.5px] text-muted">
                        {f.evidence.map((e, j) => (
                          <li key={j} className="break-words">
                            {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="card px-4 py-4 text-[13px] text-muted">
                No attack variant succeeded against vouch-full in this run{mock ? ' (mock models)' : ''}. False positives above are the cost side of that.
              </p>
            )}
          </Section>
        </>
      )}
    </PageShell>
  )
}
