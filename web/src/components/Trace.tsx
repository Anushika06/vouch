import {
  Brain,
  CirclePause,
  Compass,
  FileSearch,
  ListChecks,
  Puzzle,
  Scale,
  Search,
  Send,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { asList, cx, shortPrincipal } from '../lib/format'
import type { TraceEvent, Trust } from '../lib/types'
import { FlagRow, SourceChip, TrustDot } from './trust'

const ICON: Record<string, LucideIcon> = {
  recall: Brain,
  route: Compass,
  plan: ListChecks,
  tavily: Search,
  read: FileSearch,
  tool: Wrench,
  taint: CirclePause,
  action: Send,
  corroborate: Scale,
  skill: Puzzle,
}

const TOOL_WORD: Record<string, string> = {
  web_search: 'web search',
  web_extract: 'read page',
  deep_research: 'deep research',
  learn_site: 'crawl site',
  list_inbox: 'list inbox',
  read_email: 'read email',
  send_email: 'send email',
  list_events: 'list events',
  create_event: 'create event',
  list_tasks: 'list tasks',
  create_task: 'create reminder',
  find_files: 'find files',
  recall: 'recall',
  query_doc: 'ask a document',
  corroborate: 'check sources',
  run_skill: 'run skill',
  http_post: 'http post',
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[11.5px] text-fg/80">{children}</span>
}

function describe(e: TraceEvent, naive = false): { title: ReactNode; body?: ReactNode; tone?: 'red' | 'muted' } {
  const k = e.kind
  if (k === 'recall') {
    const mems = (e.memories as { trust: Trust }[] | undefined) ?? []
    const rules = (e.rules as string[] | undefined) ?? []
    return {
      title: (
        <>
          Recalled {mems.length} {mems.length === 1 ? 'memory' : 'memories'}, {String(e.contacts ?? 0)} trusted contacts
          {rules.length ? `, ${rules.length} standing rule${rules.length > 1 ? 's' : ''}` : ''}
        </>
      ),
      body:
        mems.length || rules.length ? (
          <div className="space-y-1">
            {mems.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {mems.map((m, i) => (
                  <TrustDot key={i} trust={m.trust} />
                ))}
              </div>
            )}
            {rules.map((r) => (
              <p key={r} className="text-muted">
                Rule: {r}
              </p>
            ))}
          </div>
        ) : undefined,
    }
  }
  if (k === 'route')
    return {
      title: e.needs_tools ? 'Routed: this needs tools' : 'Routed: answered directly from trusted memory',
      body: e.model ? <Mono>{String(e.model)}</Mono> : undefined,
      tone: 'muted',
    }
  if (k === 'plan') {
    const steps = (e.steps as { tool: string }[] | undefined) ?? []
    return {
      title: e.final && !steps.length ? 'Composed the answer over handles' : `Planned round ${Number(e.round ?? 0) + 1}: ${steps.map((s) => TOOL_WORD[s.tool] ?? s.tool).join(', ') || 'no tools'}`,
      body: (
        <span>
          {e.thought ? <span className="text-muted">“{String(e.thought)}” </span> : null}
          {e.model ? <Mono>{String(e.model)}</Mono> : null}
        </span>
      ),
      tone: 'muted',
    }
  }
  if (k === 'tavily') {
    const results = (e.results as unknown[] | undefined) ?? (e.pages as unknown[] | undefined) ?? (e.sources as unknown[] | undefined)
    return {
      title: (
        <>
          Tavily {String(e.endpoint)}
          {results ? `: ${results.length} result${results.length === 1 ? '' : 's'}` : ''}
          {e.source === 'demo' ? <span className="text-faint"> (demo index)</span> : null}
        </>
      ),
      body: <Mono>{String(e.query ?? e.url ?? '')}</Mono>,
      tone: 'muted',
    }
  }
  if (k === 'read') {
    const instr = (e.instructions as unknown[] | undefined) ?? []
    const hidden = (e.hidden as unknown[] | undefined) ?? []
    return {
      title: (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {naive ? 'Read raw' : 'Read in quarantine'} <SourceChip principal={String(e.principal)} trust={e.trust as Trust} size="sm" />
          <span className="text-faint">→</span> <Mono>{String(e.handle)}</Mono>
        </span>
      ),
      body:
        instr.length || hidden.length || asList(e.flags).length ? (
          <div className="space-y-1.5">
            {(instr.length > 0 || hidden.length > 0) && (
              <p className="text-red-ink">
                {instr.length} instruction{instr.length === 1 ? '' : 's'} aimed at the AI
                {hidden.length ? `, ${hidden.length} hidden passage${hidden.length === 1 ? '' : 's'}` : ''}.{' '}
                {naive
                  ? 'The naive assistant passes all of it, hidden text included, straight to the model.'
                  : 'Reader output stays a handle; the planner never sees the text.'}
              </p>
            )}
            <FlagRow flags={asList(e.flags)} />
          </div>
        ) : undefined,
      tone: instr.length ? 'red' : undefined,
    }
  }
  if (k === 'tool')
    return { title: <>Ran {TOOL_WORD[String(e.tool)] ?? String(e.tool)}</>, body: <Mono>{String(e.step ?? '')}</Mono>, tone: 'muted' }
  if (k === 'taint') {
    const items = (e.tainted as { value: string; source: string }[] | undefined) ?? []
    return {
      title: <>Paused {TOOL_WORD[String(e.tool)] ?? String(e.tool)}: {items.length} value{items.length === 1 ? '' : 's'} from untrusted sources</>,
      body: (
        <div className="flex flex-wrap gap-1.5">
          {items.map((t, i) => (
            <span key={i} className="font-mono text-[11.5px] text-red-ink">
              {t.value} <span className="text-faint">← {shortPrincipal(t.source)}</span>
            </span>
          ))}
        </div>
      ),
      tone: 'red',
    }
  }
  if (k === 'action') {
    const a = (e.args as Record<string, unknown>) ?? {}
    return {
      title: <>Executed {TOOL_WORD[String(e.tool)] ?? String(e.tool)}</>,
      body: e.tool === 'send_email' ? (
        <Mono>
          to {asList(a.to).join(', ') || '—'}
          {asList(a.cc).length ? ` · cc ${asList(a.cc).join(', ')}` : ''}
          {asList(a.bcc).length ? ` · bcc ${asList(a.bcc).join(', ')}` : ''}
        </Mono>
      ) : undefined,
    }
  }
  if (k === 'corroborate')
    return {
      title: (
        <>
          Checked sources: {String(e.independent ?? 0)} independent, {String(e.disputing ?? 0)} disputing, {String(e.filtered ?? 0)} filtered as duplicates
        </>
      ),
      body: <span className="text-muted">{e.upgraded ? 'Upgraded to corroborated claim.' : 'Not enough independent agreement to upgrade.'}</span>,
    }
  if (k === 'skill') {
    const blocked = (e.blocked as { kind: string; detail: string }[] | undefined) ?? []
    return {
      title: (
        <>
          Ran skill <Mono>{String(e.name)}</Mono> in <Mono>{String(e.sandbox ?? 'sandbox')}</Mono>
        </>
      ),
      body: blocked.length ? (
        <div className="space-y-0.5 text-red-ink">
          {blocked.map((b, i) => (
            <div key={i}>
              Blocked {b.kind.replace('_', ' ')}: <span className="font-mono text-[11.5px]">{b.detail}</span>
            </div>
          ))}
        </div>
      ) : undefined,
      tone: blocked.length ? 'red' : undefined,
    }
  }
  return { title: k, tone: 'muted' }
}

export function TraceTimeline({ trace, dense = false, naive = false }: { trace: TraceEvent[]; dense?: boolean; naive?: boolean }) {
  if (!trace?.length) return <p className="text-[12.5px] text-faint">No trace recorded for this turn.</p>
  return (
    <ol className="relative">
      {trace.map((e, i) => {
        const Icon = ICON[e.kind] ?? Wrench
        const d = describe(e, naive)
        return (
          <li key={i} className={cx('relative flex gap-3', dense ? 'pb-2.5' : 'pb-3.5', 'last:pb-0')}>
            {i < trace.length - 1 && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-line" aria-hidden />}
            <span
              className={cx(
                'relative z-[1] flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                d.tone === 'red' ? 'border-red/40 bg-red/10 text-red-ink' : 'border-line bg-surface text-muted',
              )}
            >
              <Icon className="h-3 w-3" aria-hidden />
            </span>
            <div className="min-w-0 pt-0.5 text-[12.5px]">
              <div className={cx('leading-snug', d.tone === 'muted' ? 'text-fg/80' : 'text-fg')}>{d.title}</div>
              {d.body && <div className="mt-1 text-[12px] leading-relaxed text-muted">{d.body}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Only the trace items that tell the story (for the Attack Lab's compact columns). */
export function keyTrace(trace: TraceEvent[] | undefined) {
  return (trace ?? []).filter(
    (e) =>
      (e.kind === 'read' && (((e.instructions as unknown[]) ?? []).length > 0 || ((e.hidden as unknown[]) ?? []).length > 0)) ||
      e.kind === 'taint' ||
      e.kind === 'skill' ||
      e.kind === 'corroborate',
  )
}
