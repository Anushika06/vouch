import type {
  Approvals,
  Briefing,
  CalEvent,
  Commit,
  Corroboration,
  Email,
  EvalsPayload,
  HistoryItem,
  LabJob,
  Memory,
  MemoryEvent,
  OutboxItem,
  PendingAction,
  ReaderOutput,
  Scenario,
  SessionInfo,
  Settings,
  Shield,
  SkillRow,
  SkillsPayload,
  Task,
  TurnResult,
  WhyResult,
} from './types'

const SID_KEY = 'vouch-session'

function readSid(): string | null {
  try {
    return localStorage.getItem(SID_KEY)
  } catch {
    return null
  }
}

function writeSid(sid: string) {
  try {
    localStorage.setItem(SID_KEY, sid)
  } catch {
    /* storage blocked (private window / iframe): the in-memory copy still works */
  }
}

let sid: string | null = readSid()
// Until the server has handed us a session id, hold every other request so that parallel
// first-load calls don't each mint a different session.
let sessionReady: Promise<void> | null = null

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type Listener = (e: ApiError) => void
const listeners = new Set<Listener>()
export function onApiError(fn: Listener) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (sid) headers.set('X-Vouch-Session', sid)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const res = await fetch(path, { ...init, headers, credentials: 'include' })
  const got = res.headers.get('x-vouch-session')
  if (got && got !== sid) {
    sid = got
    writeSid(got)
  }
  return res
}

async function request<T>(path: string, init: RequestInit = {}, opts: { skipWait?: boolean } = {}): Promise<T> {
  if (!opts.skipWait && !sid) {
    if (!sessionReady) sessionReady = getSession().then(() => undefined)
    await sessionReady.catch(() => undefined)
  }
  let res: Response
  try {
    res = await raw(path, init)
  } catch {
    const e = new ApiError(0, 'Could not reach the Vouch server. Is it running?', 'network')
    listeners.forEach((l) => l(e))
    throw e
  }
  if (!res.ok) {
    let body: { error?: string; message?: string; detail?: unknown } = {}
    try {
      body = await res.json()
    } catch {
      /* not json */
    }
    const msg =
      body.message ||
      (typeof body.detail === 'string' ? body.detail : '') ||
      `${res.status} ${res.statusText}`.trim()
    const e = new ApiError(res.status, msg, body.error)
    listeners.forEach((l) => l(e))
    throw e
  }
  return (await res.json()) as T
}

const q = (shield: Shield) => `?shield=${shield}`
const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) })

export function getSession(): Promise<SessionInfo> {
  return request<SessionInfo>('/api/session', {}, { skipWait: true })
}

export const api = {
  session: getSession,
  resetSession: () => request<{ ok: boolean }>('/api/session/reset', json({})),

  // chat
  chat: (message: string, shield: Shield) => request<TurnResult>(`/api/chat${q(shield)}`, json({ message })),
  history: (shield: Shield) => request<HistoryItem[]>(`/api/chat/history${q(shield)}`),
  why: (turnId: string, shield: Shield) => request<WhyResult>(`/api/turns/${turnId}/why${q(shield)}`),

  // memory ledger
  memories: (f: { type?: string; trust?: string; status?: string; q?: string } = {}) => {
    const p = new URLSearchParams()
    Object.entries(f).forEach(([k, v]) => v && p.set(k, v))
    const s = p.toString()
    return request<Memory[]>(`/api/memories${s ? `?${s}` : ''}`)
  },
  memory: (id: string) =>
    request<{ memory: Memory; history: Commit[]; vaulted: boolean; used_in: ({ id: string; content: string; created_at: string } | null)[] }>(
      `/api/memories/${id}`,
    ),
  revert: (id: string, sha: string, shield: Shield = 'on') => request<Memory>(`/api/memories/${id}/revert${q(shield)}`, json({ sha })),
  forget: (id: string, shield: Shield = 'on') => request<Memory | Record<string, never>>(`/api/memories/${id}/forget${q(shield)}`, json({})),
  corroborate: (id: string) =>
    request<{ memory: Memory; corroboration: Corroboration }>(`/api/memories/${id}/corroborate`, json({})),
  addMemory: (content: string) => request<MemoryEvent[]>('/api/memories', json({ content })),
  ledgerLog: (limit = 300) => request<Commit[]>(`/api/ledger/log?limit=${limit}`),
  snapshot: (at: string) => request<{ sha: string | null; memories: Memory[] }>(`/api/ledger/snapshot?at=${encodeURIComponent(at)}`),
  rollback: (sha: string) => request<{ changed: number }>('/api/ledger/rollback', json({ sha })),

  // approvals
  approvals: () => request<Approvals>('/api/approvals'),
  decideMemory: (id: string, decision: 'approve' | 'approve_trust_source' | 'reject') =>
    request<Memory>(`/api/approvals/memory/${id}`, json({ decision })),
  decideAction: (id: string, decision: 'approve' | 'approve_clean' | 'reject', shield: Shield = 'on') =>
    request<{ status?: string; result?: unknown; args?: Record<string, unknown>; error?: string }>(
      `/api/approvals/action/${id}${q(shield)}`,
      json({ decision }),
    ),

  // inbox / outbox / calendar
  inbox: () => request<Email[]>('/api/inbox'),
  readEmail: (id: string) => request<TurnResult>(`/api/inbox/${id}/read`, json({})),
  summarize: (id: string) => request<Omit<ReaderOutput, 'visible_text'>>(`/api/inbox/${id}/summarize`, json({})),
  draft: (id: string) =>
    request<{ to: string[]; subject: string; body: string; note: string; flags: string[] }>(`/api/inbox/${id}/draft`, json({})),
  send: (b: { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; attachments: string[] }) =>
    request<{ sent: boolean; outbox_id: string; note: string }>('/api/outbox/send', json(b)),
  outbox: () => request<OutboxItem[]>('/api/outbox'),
  calendar: () => request<{ events: CalEvent[]; tasks: Task[] }>('/api/calendar'),
  addEvent: (b: { title: string; start: string; end?: string; attendees?: string[]; location?: string }) =>
    request<{ id: string }>('/api/calendar', json(b)),
  taskDone: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}/done`, json({})),
  files: () => request<{ id: string; name: string; mime: string; description: string }[]>('/api/files'),

  // briefing
  briefing: () => request<Briefing | Record<string, never>>('/api/briefing/latest'),
  runBriefing: () => request<Briefing>('/api/briefing/run', json({})),

  // skills
  skills: () => request<SkillsPayload>('/api/skills'),
  installSkill: (name: string, deep: boolean) => request<SkillRow>(`/api/skills/${name}/install`, json({ deep })),
  approveSkill: (name: string, override = false) => request<SkillRow>(`/api/skills/${name}/approve`, json({ override })),
  rejectSkill: (name: string) => request<{ status: string }>(`/api/skills/${name}/reject`, json({})),
  runSkill: (name: string) => request<TurnResult>(`/api/skills/${name}/run`, json({})),

  // attack lab
  scenarios: () => request<Scenario[]>('/api/attacklab/scenarios'),
  runLab: (b: { scenario?: string; variant?: string; custom?: string; technique?: string; trigger?: string }) =>
    request<{ job_id: string }>('/api/attacklab/run', json(b)),
  labJob: (id: string) => request<LabJob>(`/api/attacklab/jobs/${id}`),

  // evals
  evals: async (): Promise<EvalsPayload> => {
    if (import.meta.env.DEV) {
      try {
        if (new URLSearchParams(window.location.search).get('fixture') === 'mock') {
          const r = await fetch('/__dev/evals-mock.json')
          if (r.ok) return (await r.json()) as EvalsPayload
        }
      } catch {
        /* fall through to the real endpoint */
      }
    }
    return request<EvalsPayload>('/api/evals/latest')
  },

  // settings & privacy
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (b: Partial<Pick<Settings, 'trusted_contacts' | 'trusted_domains' | 'followed_topics'>>) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(b) }),
  deleteAll: () => request<{ ok: boolean; message: string }>('/api/delete-all', json({})),
  exportZip: async () => {
    const res = await raw('/api/export')
    if (!res.ok) throw new ApiError(res.status, 'Export failed')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'vouch-memory-ledger.zip'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  },
}

export type { PendingAction }
