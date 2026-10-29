import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ACTION_LABEL, cx, shortPrincipal } from '../lib/format'
import type { MemoryEvent, Segment } from '../lib/types'
import { ProvenanceCard, TrustDot, TrustSpan } from './trust'
import { Hover } from './ui'

type Inline = { kind: 'text'; text: string } | { kind: 'seg'; seg: Segment }

function bold(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={`${keyBase}-${i}`} className="font-semibold text-fg">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={`${keyBase}-${i}`}>{part}</Fragment>
    ),
  )
}

function renderInline(xs: Inline[], key: string) {
  return xs.map((x, i) =>
    x.kind === 'text' ? (
      <Fragment key={`${key}-${i}`}>{bold(x.text, `${key}-${i}`)}</Fragment>
    ) : x.seg.trust ? (
      <TrustSpan key={`${key}-${i}`} trust={x.seg.trust} source={x.seg.source} refUrl={x.seg.ref}>
        <span className="whitespace-pre-wrap">{x.seg.text}</span>
      </TrustSpan>
    ) : (
      <Fragment key={`${key}-${i}`}>{x.seg.text}</Fragment>
    ),
  )
}

/**
 * Renders an assistant answer from its segments. Plain segments get light markdown (paragraphs,
 * "- " bullets, **bold**); segments that carry a trust value are underlined in their trust colour
 * with a hover card showing source and reference.
 */
export function Segments({ segments, className }: { segments: Segment[]; className?: string }) {
  const lines: Inline[][] = [[]]
  for (const s of segments) {
    if (s.trust) {
      lines[lines.length - 1].push({ kind: 'seg', seg: s })
      continue
    }
    s.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ kind: 'text', text: part })
    })
  }

  type Block = { type: 'p'; lines: Inline[][] } | { type: 'ul'; items: Inline[][] } | { type: 'note'; line: Inline[] }
  const blocks: Block[] = []
  const bulletRe = /^\s*(?:[-•*])\s+/
  for (const line of lines) {
    const first = line[0]
    const isEmpty = line.length === 0 || line.every((x) => x.kind === 'text' && !x.text.trim())
    if (isEmpty) {
      blocks.push({ type: 'p', lines: [] })
      continue
    }
    if (first?.kind === 'text' && bulletRe.test(first.text)) {
      const item: Inline[] = [{ kind: 'text', text: first.text.replace(bulletRe, '') }, ...line.slice(1)]
      const last = blocks[blocks.length - 1]
      if (last?.type === 'ul') last.items.push(item)
      else blocks.push({ type: 'ul', items: [item] })
      continue
    }
    if (first?.kind === 'text' && /^\s*[⏸⚠]/.test(first.text)) {
      blocks.push({ type: 'note', line })
      continue
    }
    const last = blocks[blocks.length - 1]
    if (last?.type === 'p' && last.lines.length) last.lines.push(line)
    else blocks.push({ type: 'p', lines: [line] })
  }

  return (
    <div className={cx('space-y-2.5 text-[14px] leading-[1.65] text-fg/95', className)}>
      {blocks.map((b, bi) => {
        if (b.type === 'p')
          return b.lines.length ? (
            <p key={bi} className="text-pretty">
              {b.lines.map((l, li) => (
                <Fragment key={li}>
                  {li > 0 && <br />}
                  {renderInline(l, `${bi}-${li}`)}
                </Fragment>
              ))}
            </p>
          ) : null
        if (b.type === 'note')
          return (
            <p key={bi} className="rounded-lg border border-line bg-sunken px-3 py-2 text-[13px] text-muted">
              {renderInline(b.line, `${bi}`)}
            </p>
          )
        return (
          <ul key={bi} className="space-y-1.5 pl-1">
            {b.items.map((it, ii) => (
              <li key={ii} className="relative pl-4 before:absolute before:left-0 before:top-[0.7em] before:h-1 before:w-1 before:rounded-full before:bg-faint">
                {renderInline(it, `${bi}-${ii}`)}
              </li>
            ))}
          </ul>
        )
      })}
    </div>
  )
}

export function eventLabel(e: MemoryEvent) {
  const m = e.memory
  const parts = [ACTION_LABEL[e.action] ?? e.action, m.type, m.trust]
  const src = m.provenance?.[0]?.principal
  if (src && src !== 'user' && src !== 'assistant') parts.push(shortPrincipal(src))
  return parts
}

const ACTION_STYLE: Record<string, string> = {
  auto_save: 'border-line bg-surface',
  save_as_claim: 'border-dashed border-line-strong bg-surface',
  queue_approval: 'border-accent/40 bg-accent/[0.07]',
  block: 'border-red/30 bg-red/[0.06]',
  duplicate: 'border-line bg-sunken text-muted',
}

/** One chip per memory write the turn attempted, summarising what the Trust Gate did with it. */
export function MemoryEventChips({ events, linkable = true }: { events: MemoryEvent[]; linkable?: boolean }) {
  if (!events?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {events.map((e, i) => {
        const parts = eventLabel(e)
        const inner = (
          <span
            className={cx(
              'inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border px-2 text-[11.5px] text-fg/90',
              ACTION_STYLE[e.action] ?? 'border-line bg-surface',
            )}
          >
            <TrustDot trust={e.memory.trust} className="h-1.5 w-1.5" />
            <span className="truncate">
              <span className="font-medium">{parts[0]}</span>
              {parts.slice(1).map((p, j) => (
                <span key={j} className={cx(j === 2 && 'font-mono text-[11px]', 'text-muted')}>
                  <span className="px-1 text-faint">·</span>
                  {p}
                </span>
              ))}
            </span>
          </span>
        )
        const card = (
          <div className="space-y-2">
            <p className="text-[12.5px] leading-relaxed">{e.memory.content}</p>
            {e.memory.gate_decision?.reason && (
              <p className="border-t border-line pt-2 text-[11.5px] text-muted">{e.memory.gate_decision.reason}</p>
            )}
            {e.notes?.length > 0 && <p className="text-[11.5px] text-faint">{e.notes.join(' · ')}</p>}
            {e.memory.trust && (
              <ProvenanceCard trust={e.memory.trust} source={e.memory.provenance?.[0]?.principal} refUrl={undefined} />
            )}
          </div>
        )
        return (
          <Hover key={`${e.memory.id}-${i}`} card={card} className="max-w-full rounded-full">
            {linkable && e.action !== 'duplicate' ? (
              <Link to={`/memory?open=${e.memory.id}`} className="max-w-full" tabIndex={-1}>
                {inner}
              </Link>
            ) : (
              inner
            )}
          </Hover>
        )
      })}
    </div>
  )
}
