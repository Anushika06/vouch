import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, CheckSquare, Mail, Newspaper, Play, Stamp, TriangleAlert } from 'lucide-react'
import { api } from '../lib/api'
import { useApp, useLoad } from '../lib/app'
import { cx, demoSiteHref, fmtDate, fmtDateTime, timeAgo, wallTime } from '../lib/format'
import type { Briefing } from '../lib/types'
import { PageShell } from '../components/Layout'
import { FlagRow, SourceChip, TrustBadge, TrustDot, TrustSpan, trustRail } from '../components/trust'
import { EmptyState, ErrorNote, PageHeader, SkeletonList, Spinner } from '../components/ui'

function Panel({ icon: Icon, title, count, children }: { icon: typeof Mail; title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Icon className="h-4 w-4 text-muted" />
        <h2 className="section-title">{title}</h2>
        {count !== undefined && <span className="tnum text-[12px] text-faint">{count}</span>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Events({ b }: { b: Briefing }) {
  const today = b.created_at.slice(0, 10)
  const groups: [string, Briefing['events']][] = []
  for (const e of b.events) {
    const k = e.start.slice(0, 10)
    const g = groups.find((x) => x[0] === k)
    if (g) g[1].push(e)
    else groups.push([k, [e]])
  }
  if (!groups.length) return <p className="text-[13px] text-muted">Nothing on your calendar today or tomorrow.</p>
  return (
    <div className="space-y-4">
      {groups.map(([day, es]) => (
        <div key={day}>
          <div className="mb-1.5 text-[12px] font-medium text-muted">{day === today ? 'Today' : fmtDate(`${day}T12:00:00`)}</div>
          <ul className="space-y-1.5">
            {es.map((e, i) => (
              <li key={i} className={cx('flex items-baseline gap-3 border-l-2 pl-3', trustRail(e.trust))}>
                <span className="tnum w-11 shrink-0 font-mono text-[12px] text-muted">{wallTime(e.start)}</span>
                <span className="min-w-0 text-[13.5px]">{e.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export default function BriefingPage() {
  const { refreshSession } = useApp()
  const { data, setData, error, loading, reload } = useLoad(() => api.briefing(), [])
  const [running, setRunning] = useState(false)
  const b = data && 'id' in data ? (data as Briefing) : null

  const run = async () => {
    setRunning(true)
    try {
      setData(await api.runBriefing())
      refreshSession()
    } finally {
      setRunning(false)
    }
  }

  return (
    <PageShell wide>
      <PageHeader
        title="Briefing"
        description="Your morning summary. The headline is written only from green facts; everything quoted from emails and the web keeps its trust colour."
        actions={
          <button className="btn btn-primary" onClick={run} disabled={running}>
            {running ? <Spinner className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {running ? 'Building briefing…' : 'Run now'}
          </button>
        }
      />
      {error && <ErrorNote message={error} onRetry={() => reload()} />}
      {loading && !data && <SkeletonList rows={3} className="h-40" />}
      {data && !b && (
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title="No briefing yet today"
          action={
            <button className="btn btn-primary" onClick={run} disabled={running}>
              {running ? <Spinner className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} Build my briefing
            </button>
          }
        >
          Vouch builds one every morning from your calendar, unread email, open tasks and the topics you follow.
        </EmptyState>
      )}
      {b && (
        <div className={cx('space-y-6', running && 'opacity-60 transition-opacity')}>
          <div className="relative overflow-hidden rounded-2xl border border-line bg-surface px-6 py-6 sm:px-8 sm:py-7">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
              <span>{fmtDate(b.created_at, { weekday: 'long', month: 'long' })}</span>
              <span className="text-faint">·</span>
              <span>generated {timeAgo(b.created_at)}</span>
              {b.model && <span className="font-mono text-[11px] text-faint">{b.model}</span>}
            </div>
            <p className="max-w-[60ch] text-[22px] font-medium leading-[1.45] tracking-[-0.015em] text-balance sm:text-[24px]">
              <TrustSpan trust={b.headline_trust ?? 'GREEN'} source="user" refUrl="your calendar, tasks and counts only">
                {b.headline}
              </TrustSpan>
            </p>
            <p className="mt-3 text-[12px] text-faint">Composed only from your own calendar, task list and counts. No email or web text reaches the headline.</p>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="space-y-5">
              <Panel icon={Mail} title="Unread email" count={b.emails.length}>
                {b.emails.length === 0 ? (
                  <p className="text-[13px] text-muted">Inbox zero.</p>
                ) : (
                  <ul className="-my-1 divide-y divide-line">
                    {b.emails.map((e) => (
                      <li key={e.email_id} className="py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <TrustBadge trust={e.trust} size="sm" />
                          <span className="text-[13.5px] font-medium">{e.from_name}</span>
                          <span className="truncate font-mono text-[11px] text-faint">{e.from}</span>
                        </div>
                        <p className="mt-1 text-[13px] text-fg/90">{e.subject}</p>
                        {e.summary && (
                          <p className="mt-1 text-[13px] leading-relaxed text-muted">
                            <TrustSpan trust={e.trust} source={`${e.trust === 'RED' ? 'sender' : 'contact'}:${e.from}`}>
                              {e.summary}
                            </TrustSpan>
                          </p>
                        )}
                        {e.warning && (
                          <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-red-ink">
                            <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> This email {e.warning}. Vouch did not act on it.
                          </p>
                        )}
                        {e.flags.length > 0 && (
                          <div className="mt-1.5">
                            <FlagRow flags={e.flags} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <Link to="/inbox" className="mt-2 inline-block text-[12.5px] text-accent hover:underline">
                  Open inbox
                </Link>
              </Panel>

              <Panel icon={Newspaper} title="Topics you follow" count={b.news.length}>
                {b.news.length === 0 ? (
                  <p className="text-[13px] text-muted">No news found for your followed topics. Add topics in Settings.</p>
                ) : (
                  <ul className="space-y-3">
                    {b.news.map((n, i) => (
                      <li key={i} className={cx('border-l-2 pl-3', trustRail(n.trust))}>
                        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
                          <span>{n.topic}</span>
                          <span>·</span>
                          <span>via {n.via === 'tavily' ? 'Tavily' : 'demo index'}</span>
                        </div>
                        <a href={demoSiteHref(n.url)} target="_blank" rel="noreferrer" className="mt-0.5 block text-[13.5px] font-medium hover:text-accent">
                          {n.title}
                        </a>
                        <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{n.snippet}</p>
                        <div className="mt-1.5">
                          <SourceChip principal={`domain:${n.domain}`} trust={n.trust} refUrl={n.url} size="sm" />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <div className="space-y-5">
              <Link
                to="/approvals"
                className={cx(
                  'flex items-center gap-3 rounded-xl border px-4 py-3.5 transition-colors',
                  b.pending_approvals ? 'border-accent/40 bg-accent/[0.07] hover:bg-accent/[0.11]' : 'border-line bg-surface hover:bg-raised',
                )}
              >
                <Stamp className={cx('h-5 w-5', b.pending_approvals ? 'text-accent' : 'text-faint')} />
                <div className="min-w-0 flex-1">
                  <div className="tnum text-[20px] font-semibold leading-none">{b.pending_approvals}</div>
                  <div className="mt-1 text-[12.5px] text-muted">memory write{b.pending_approvals === 1 ? '' : 's'} waiting for your approval</div>
                </div>
              </Link>
              <Panel icon={CalendarDays} title="Today and tomorrow" count={b.events.length}>
                <Events b={b} />
              </Panel>
              <Panel icon={CheckSquare} title="Due this week" count={b.tasks.length}>
                {b.tasks.length === 0 ? (
                  <p className="text-[13px] text-muted">Nothing due.</p>
                ) : (
                  <ul className="space-y-2">
                    {b.tasks.map((t) => (
                      <li key={t.id} className="flex items-baseline gap-2.5">
                        <TrustDot trust={t.trust} className="translate-y-[-1px]" />
                        <span className="min-w-0 flex-1 text-[13.5px]">{t.title}</span>
                        <span className="shrink-0 text-[11.5px] text-faint">{fmtDateTime(t.due).split(',')[0]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
