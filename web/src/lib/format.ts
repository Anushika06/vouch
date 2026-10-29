import type { GateAction, MemType, Status, Trust } from './types'

export const TRUST_HEX: Record<Trust, string> = { GREEN: '#22c55e', YELLOW: '#eab308', RED: '#ef4444' }

export const TRUST_LABEL: Record<Trust, string> = {
  GREEN: 'You said it',
  YELLOW: 'Trusted contact',
  RED: 'Untrusted',
}

export const TRUST_LONG: Record<Trust, string> = {
  GREEN: 'Came from you directly',
  YELLOW: 'From a trusted contact or one of your own accounts',
  RED: 'From an untrusted source: the web, an unknown sender, or a skill',
}

export const STATUS_LABEL: Record<Status, string> = {
  active: 'Active',
  claim: 'Claim',
  corroborated_claim: 'Corroborated',
  pending_approval: 'Needs approval',
  rejected: 'Rejected',
  disputed: 'Disputed',
  expired: 'Expired',
  superseded: 'Superseded',
}

export const STATUS_HELP: Record<Status, string> = {
  active: 'Vouch treats this as true and can act on it.',
  claim: 'Remembered as something a source said, not as fact. Expires unless corroborated.',
  corroborated_claim: 'Independent sources agree with this claim.',
  pending_approval: 'Waiting for you before Vouch will use it.',
  rejected: 'You or the Trust Gate turned this down. It is never recalled.',
  disputed: 'Contradicts something you told Vouch. Your version wins.',
  expired: 'An unverified claim that aged out.',
  superseded: 'Replaced by a newer version.',
}

export const ACTION_LABEL: Record<string, string> = {
  auto_save: 'Saved',
  save_as_claim: 'Kept as claim',
  queue_approval: 'Queued for approval',
  block: 'Blocked',
  duplicate: 'Already known',
}

export const GATE_ACTION_HELP: Record<GateAction, string> = {
  auto_save: 'Saved automatically',
  save_as_claim: 'Saved as an attributed claim',
  queue_approval: 'Held for your approval',
  block: 'Blocked by the Trust Gate',
}

export const TYPE_LABEL: Record<MemType, string> = {
  PREFERENCE: 'Preference',
  FACT: 'Fact',
  EVENT: 'Event',
  CONTACT: 'Contact',
  INSTRUCTION: 'Instruction',
  PAYMENT: 'Payment',
  SKILL_NOTE: 'Skill note',
}

const FLAG_LABEL: Record<string, string> = {
  exfiltration: 'Exfiltration',
  hidden_instruction: 'Hidden instruction',
  hidden_text: 'Hidden text',
  imperative_to_ai: 'Talks to the AI',
  memory_write: 'Tries to write memory',
  secrecy: 'Asks for secrecy',
  standing_rule: 'Standing rule',
  payment_change: 'Payment change',
  override: 'Override attempt',
  new_recipient: 'New recipient',
}

export function flagLabel(f: string) {
  return FLAG_LABEL[f] ?? f.replace(/[_:-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** "css:display-none" → "CSS display:none" */
export function techniqueLabel(t: string | null | undefined) {
  if (!t) return ''
  const [scope, rest] = t.includes(':') ? t.split(':', 2) : ['', t]
  const pretty = rest.replace(/-/g, ' ')
  if (scope === 'css') return `CSS ${rest.replace('-', ':')}`
  if (scope === 'html') return `HTML ${pretty}`
  if (scope === 'attr') return `${pretty} attribute`
  return scope ? `${scope.toUpperCase()} ${pretty}` : pretty
}

export interface Principal {
  kind: string
  value: string
  raw: string
}

export function parsePrincipal(p: string | null | undefined): Principal {
  if (!p) return { kind: 'unknown', value: 'unknown', raw: '' }
  if (p === 'user') return { kind: 'user', value: 'You', raw: p }
  if (p === 'assistant') return { kind: 'assistant', value: 'Assistant', raw: p }
  const i = p.indexOf(':')
  if (i < 0) return { kind: 'other', value: p, raw: p }
  return { kind: p.slice(0, i), value: p.slice(i + 1), raw: p }
}

export function shortPrincipal(p: string | null | undefined) {
  return parsePrincipal(p).value
}

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null

export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.round((t - now) / 1000)
  const a = Math.abs(s)
  if (!rtf) return new Date(iso).toLocaleString()
  if (a < 45) return 'just now'
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day')
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = {}) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', ...opts })
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function dayKey(iso: string) {
  return iso.slice(0, 10)
}

export function pct(x: number | null | undefined, digits = 0) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  return `${(x * 100).toFixed(digits)}%`
}

export function num(x: number | null | undefined) {
  if (x === null || x === undefined) return '—'
  return x.toLocaleString()
}

export function usd(x: number | null | undefined) {
  if (x === null || x === undefined) return '—'
  if (x === 0) return '$0.00'
  if (x < 0.01) return `$${x.toFixed(4)}`
  return `$${x.toFixed(2)}`
}

export function isHttp(ref: string | null | undefined) {
  return !!ref && /^https?:\/\//i.test(ref)
}

/** Seeded demo sites are served locally at /demo-sites/<domain>/<path>. */
export function demoSiteHref(url: string) {
  try {
    const u = new URL(url)
    if (u.hostname.endsWith('.example')) return `/demo-sites/${u.hostname}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    /* not a url */
  }
  return url
}

export function shortSha(sha: string) {
  return sha.slice(0, 7)
}

export function cx(...xs: (string | number | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ')
}

export function asList(v: unknown): string[] {
  if (v === null || v === undefined || v === '') return []
  if (Array.isArray(v)) return v.map(String)
  return String(v)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** Ledger commit titles look like "gate:queue_approval: mem_01… [INSTRUCTION/RED/pending_approval]". */
export function commitParts(title: string): { action: string; tag: string | null; memId: string | null } {
  const tag = title.match(/\[([^\]]+)\]\s*$/)?.[1] ?? null
  const memId = title.match(/\bmem_[0-9A-Z]+/)?.[0] ?? null
  let action = title.replace(/\[[^\]]+\]\s*$/, '').replace(/\bmem_[0-9A-Z]+/, '').replace(/[:\s]+$/, '').trim()
  action = action.replace(/^gate:/, 'gate ').replace(/_/g, ' ')
  return { action, tag, memId }
}

/** Calendar times are wall-clock values (the backend reads start[11:16]); show them as stored. */
export function wallTime(iso: string | null | undefined) {
  return iso && iso.length >= 16 ? iso.slice(11, 16) : ''
}
