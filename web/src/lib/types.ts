// Shapes mirrored from the FastAPI backend (vouch/api/main.py, vouch/models.py and friends).

export type Trust = 'GREEN' | 'YELLOW' | 'RED'
export type MemType = 'PREFERENCE' | 'FACT' | 'EVENT' | 'CONTACT' | 'INSTRUCTION' | 'PAYMENT' | 'SKILL_NOTE'
export type Status =
  | 'active'
  | 'claim'
  | 'corroborated_claim'
  | 'pending_approval'
  | 'rejected'
  | 'disputed'
  | 'expired'
  | 'superseded'
export type GateAction = 'auto_save' | 'save_as_claim' | 'queue_approval' | 'block'
export type Shield = 'on' | 'off'

export interface Provenance {
  kind: string
  ref: string
  principal: string
  trust: Trust
  excerpt: string
  excerpt_hash: string
  captured_at: string
  hidden_technique: string | null
}

export interface GateDecision {
  action: GateAction
  reason: string
  detector_flags: string[]
  high_risk: boolean
  suggestion: 'approve' | 'reject' | null
  classified_type: MemType | null
  classifier: Record<string, unknown>
  conflict_with: string | null
}

export interface CorroborationSource {
  domain?: string
  url?: string
  excerpt?: string
  reason?: string
  [k: string]: unknown
}

export interface Corroboration {
  checked_at: string
  supporting: CorroborationSource[]
  disputing: CorroborationSource[]
  filtered: CorroborationSource[]
  independent_domains: number
  upgraded: boolean
  note: string
}

export interface Memory {
  id: string
  type: MemType
  content: string
  subject: string | null
  status: Status
  trust: Trust
  effective_trust?: Trust
  provenance: Provenance[]
  created_by_model: string
  gate_decision: GateDecision | null
  supersedes: string | null
  superseded_by: string | null
  expires_at: string | null
  approved_by_user: boolean
  vaulted: boolean
  corroboration: Corroboration | null
  created_at: string
  updated_at: string
  used_in: string[]
}

export interface Commit {
  sha: string
  time: string
  ts: number
  title: string
  message: string
  snapshot?: Memory | null
}

export interface Segment {
  text: string
  trust: Trust | null
  source?: string
  ref?: string
  handle?: string
}

export interface MemoryEvent {
  memory: Memory
  action: GateAction | 'duplicate' | string
  notes: string[]
}

export interface TaintItem {
  arg: string
  value: string
  trust: Trust
  source: string
  reason: string
}

export interface PendingAction {
  id: string
  turn_id: string
  tool: string
  args: Record<string, unknown>
  taint: TaintItem[]
  status: 'pending' | 'rejected' | 'executed' | string
  result: unknown
  created_at: string
  resolved_at: string | null
}

export interface ExecutedAction {
  tool: string
  args: Record<string, unknown>
  result: unknown
}

export type TraceEvent = { kind: string; [k: string]: unknown }

export interface TurnResult {
  turn_id: string
  mode: 'vouch' | 'naive'
  config?: string
  user?: string
  answer: string
  segments: Segment[]
  trace: TraceEvent[]
  memory_events: MemoryEvent[]
  pending_actions: PendingAction[]
  executed_actions: ExecutedAction[]
  used_memories: string[]
  created_at?: string
}

export type HistoryItem =
  | { role: 'user'; content: string; turn_id: string; created_at: string }
  | ({ role: 'assistant' } & TurnResult)

export interface UsageRow {
  role: string
  model: string
  calls: number
  tin: number | null
  tout: number | null
  cost: number | null
  avg_ms: number | null
}

export interface Usage {
  by_role: UsageRow[]
  total_cost: number
  total_tokens: number
  tavily_calls: number
  tavily_cache_hits: number
  token_cap: number
  tavily_cap: number
}

export interface Persona {
  name: string
  email: string
  about?: string
  note?: string
}

export interface SessionInfo {
  session: string
  persona: Persona | null
  provider: string
  mock: boolean
  hosted: boolean
  models: Record<string, string | null>
  tavily: boolean
  usage: Usage
  pending: number
}

export interface Instruction {
  text: string
  flags: string[]
  hidden: string | null
  write_attempt: boolean
  source: string
}

export interface HiddenText {
  technique: string
  text: string
}

export interface ReaderOutput {
  doc_id: string
  kind: string
  ref: string
  principal: string
  trust: Trust
  domain: string | null
  title: string | null
  summary: string
  price: number | null
  currency: string | null
  date: string | null
  sender: string | null
  amounts: number[]
  entities: string[]
  claims: { text: string; type_hint?: string }[]
  instructions: Instruction[]
  flags: string[]
  hidden: HiddenText[]
  model: string
}

export interface WhyDoc {
  id: string
  kind: string
  ref: string
  principal: string
  trust: Trust
  reader: ReaderOutput
}

export interface WhyResult {
  turn: TurnResult | null
  memories: { memory: Memory; history: Commit[] }[]
  docs: WhyDoc[]
}

export interface ApprovalSource {
  kind: string
  principal: string
  trust: Trust
  hidden: HiddenText[]
  instructions: Instruction[]
  title: string | null
  text: string
}

export interface Approvals {
  memories: Memory[]
  disputed: Memory[]
  actions: PendingAction[]
  sources: Record<string, ApprovalSource>
  conflicts: Record<string, Memory>
}

export interface Email {
  id: string
  from_addr: string
  from_name: string
  to_addrs: string[]
  cc: string[]
  subject: string
  body: string
  html: string | null
  date: string
  unread: number
  labels: string[]
  trust: Trust
}

export interface OutboxItem {
  id: string
  to_addrs: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  attachments: string[]
  sent_at: string
  turn_id: string
  origin: string
}

export interface CalEvent {
  id: string
  title: string
  start: string
  end: string
  attendees: string[]
  location: string
  notes: string
  source: string
  trust: Trust
  created_at: string
}

export interface Task {
  id: string
  title: string
  due: string
  done: number
  source: string
  trust: Trust
}

export interface Briefing {
  id: string
  created_at: string
  headline: string
  headline_trust: Trust
  events: { title: string; start: string; end: string; trust: Trust; source: string }[]
  emails: {
    email_id: string
    from: string
    from_name: string
    trust: Trust
    subject: string
    summary: string
    flags: string[]
    warning: string | null
  }[]
  news: { topic: string; title: string; url: string; domain: string; snippet: string; trust: Trust; via: string }[]
  tasks: Task[]
  pending_approvals: number
  model: string
}

export interface SkillManifest {
  name: string
  description: string
  version: string
  entrypoint: string
  permissions: { network: string[]; files: string[]; tools: string[] }
  source?: string
}

export interface ScanFinding {
  severity: 'high' | 'medium' | 'low'
  kind: string
  detail: string
  file: string
  line: number
}

export interface SkillReview {
  verdict?: 'benign' | 'suspicious' | 'malicious'
  risk?: 'low' | 'medium' | 'high'
  explanation?: string
  undeclared_capabilities?: string[]
  model?: string
  deep?: boolean
  note?: string
}

export interface SkillRow {
  name: string
  version: string
  hash: string
  manifest: SkillManifest
  scan: ScanFinding[]
  review: SkillReview
  status: 'pending_approval' | 'installed' | string
  installed_at: string
  error?: string
}

export interface SkillRun {
  id: string
  name: string
  input: string
  output: string
  log: { blocked: { kind: string; detail: string }[]; unblocked: { kind: string; detail: string }[] }
  sandbox: string
  created_at: string
}

export interface SkillsPayload {
  catalog: SkillManifest[]
  installed: SkillRow[]
  runs: SkillRun[]
}

export interface ScenarioStep {
  user?: string
  advance_days?: number
  install_skill?: string
  audit?: boolean
}

export interface Scenario {
  id: string
  name: string
  description: string
  variants: { id: string; label: string; steps: ScenarioStep[] }[]
}

export interface LabStep {
  mode?: 'naive' | 'vouch'
  kind: 'turn' | 'advance' | 'install' | 'audit' | string
  user?: string
  latency_ms?: number
  answer?: string
  segments?: Segment[]
  trace?: TraceEvent[]
  memory_events?: MemoryEvent[]
  pending_actions?: PendingAction[]
  executed_actions?: ExecutedAction[]
  days?: number
  skill?: string
  decision?: string
  scan?: ScanFinding[]
  review?: SkillReview
  summary?: string
  findings?: { kind: string; memory_ids: string[]; explanation: string; suggested_action?: string }[]
}

export interface LabSide {
  error?: string
  evaluation?: {
    attack_succeeded: boolean
    evidence: string[]
    caught_pending: string[]
    blocked: string[]
    would_succeed_if_user_follows_suggestions?: boolean
  }
  state?: {
    outbox: { to_addrs: string[]; cc: string[]; bcc: string[]; subject: string; attachments: string[] }[]
    memories: {
      id: string
      type: MemType
      trust: Trust
      status: Status
      content: string
      source: string
      flags: string[]
      reason: string
    }[]
    pending_actions: { id: string; tool: string; args: Record<string, unknown>; taint: TaintItem[]; status: string }[]
    usage: Usage
  }
  steps?: LabStep[]
}

export interface LabJob {
  id: string
  status: 'running' | 'done' | 'error'
  error?: string
  variant: { id: string; label: string; steps: ScenarioStep[] }
  events: LabStep[]
  result: { naive?: LabSide; vouch?: LabSide } | null
}

export interface MeanStd {
  mean: number | null
  std: number | null
  n: number
}

export interface EvalConfig {
  attack_success_rate: MeanStd
  by_scenario: Record<string, { asr: MeanStd; variants: number; asr_if_user_follows_suggestions: number }>
  attack_runs: number
  attack_errors: number
  benign: {
    false_positive_rate: MeanStd
    ok: number
    over_restricted: number
    missed: number
    checks: number
    cases: number
    errors: number
  }
  approval_prompts_per_100_interactions: number | null
  latency_ms: { p50: number | null; p95: number | null; turns: number }
  cost_usd: number
}

export interface EvalsPayload {
  available: boolean
  message?: string
  generated_at?: string
  provider?: string
  models?: Record<string, string | null>
  runs?: number
  python?: string
  configs?: string[]
  aggregate?: { configs: Record<string, EvalConfig> }
  day?: { config: string; turns: number; cost_usd: number; tokens: number; wall_s: number; tavily_calls: number }[]
  longmemeval?: Record<string, { accuracy: number; n: number }>
  failures?: { scenario: string; variant: string; label?: string; evidence: string[] }[]
}

export interface Settings {
  trusted_contacts: string[]
  trusted_domains: string[]
  followed_topics: string[]
  models: Record<string, string | null>
  provider: string
  usage: Usage
}
