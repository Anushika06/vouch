import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  BarChart3,
  CheckCircle2,
  FlaskConical,
  Info,
  Mail,
  Menu,
  MessageSquare,
  Moon,
  Puzzle,
  ScrollText,
  Settings2,
  Stamp,
  Sun,
  Sunrise,
  TriangleAlert,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useApp } from '../lib/app'
import { cx } from '../lib/format'

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="9" className="fill-raised" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" className="fill-none stroke-line-strong" />
      <path d="M8.5 10.5 16 23l7.5-12.5" fill="none" className="stroke-fg" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8.5" cy="10.5" r="2.3" fill="#22c55e" />
      <circle cx="16" cy="23" r="2.3" fill="#eab308" />
      <circle cx="23.5" cy="10.5" r="2.3" fill="#ef4444" />
    </svg>
  )
}

type Item = { to: string; label: string; icon: LucideIcon; badge?: 'pending' }
const GROUPS: Item[][] = [
  [
    { to: '/', label: 'Chat', icon: MessageSquare },
    { to: '/briefing', label: 'Briefing', icon: Sunrise },
    { to: '/inbox', label: 'Inbox & calendar', icon: Mail },
  ],
  [
    { to: '/memory', label: 'Memory ledger', icon: ScrollText },
    { to: '/approvals', label: 'Approvals', icon: Stamp, badge: 'pending' },
  ],
  [
    { to: '/skills', label: 'Skills', icon: Puzzle },
    { to: '/lab', label: 'Attack Lab', icon: FlaskConical },
    { to: '/evals', label: 'Evals', icon: BarChart3 },
  ],
  [{ to: '/settings', label: 'Settings & privacy', icon: Settings2 }],
]

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const { session } = useApp()
  const pending = session?.pending ?? 0
  return (
    <nav className="flex flex-col gap-3 px-3" aria-label="Main">
      {GROUPS.map((g, gi) => (
        <div key={gi} className={cx('flex flex-col gap-0.5', gi > 0 && 'border-t border-line/70 pt-3')}>
          {g.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cx(
                  'group relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors',
                  isActive ? 'bg-raised font-medium text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <it.icon className={cx('h-4 w-4 shrink-0', isActive ? 'text-accent' : 'text-faint group-hover:text-muted')} aria-hidden />
                  <span className="truncate">{it.label}</span>
                  {it.badge === 'pending' && pending > 0 && (
                    <span
                      className="tnum ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red px-1 text-[11px] font-semibold text-white"
                      aria-label={`${pending} waiting for approval`}
                    >
                      {pending}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

function UserCard() {
  const { session, theme, setTheme } = useApp()
  const name = session?.persona?.name ?? 'Asha Menon'
  const email = session?.persona?.email ?? 'asha@ashamenon.example'
  const initials = name
    .split(' ')
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8fa8ff] to-[#5b6fd6] text-[12px] font-semibold text-white">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-tight">{name}</div>
        <div className="truncate font-mono text-[10.5px] text-faint">{email}</div>
      </div>
      <button
        className="btn btn-ghost h-7 w-7 shrink-0 px-0"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </div>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5">
      <Logo />
      <div className="leading-tight">
        <div className="text-[16px] font-semibold tracking-[-0.02em]">Vouch</div>
        <div className="text-[11.5px] text-faint">Memory you can trust.</div>
      </div>
    </div>
  )
}

export function Footer() {
  return (
    <p className="px-1 text-[11px] leading-relaxed text-faint">
      Runs on Nebius Token Factory · NVIDIA Nemotron · Tavily
    </p>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 pb-4 pt-5">
      <Brand />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Nav onNavigate={onNavigate} />
      </div>
      <div className="space-y-3 px-3">
        <UserCard />
        <Footer />
      </div>
    </div>
  )
}

function Banner({ tone, icon, children, onClose }: { tone: 'amber' | 'red' | 'info'; icon: ReactNode; children: ReactNode; onClose?: () => void }) {
  return (
    <div
      className={cx(
        'flex items-center gap-2.5 border-b px-4 py-2 text-[12.5px] lg:px-8',
        tone === 'amber' && 'border-[#f59e0b]/30 bg-[#f59e0b]/10 text-[rgb(var(--yellow-ink))]',
        tone === 'red' && 'border-red/30 bg-red/10 text-red-ink',
        tone === 'info' && 'border-accent/30 bg-accent/10 text-accent',
      )}
      role="status"
    >
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100" onClick={onClose} aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function Toasts() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-surface px-3.5 py-3 shadow-pop animate-rise',
            t.tone === 'error' ? 'border-red/40' : 'border-line',
          )}
        >
          {t.tone === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          ) : t.tone === 'error' ? (
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-ink" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{t.title}</div>
            {t.body && <div className="mt-0.5 break-words text-[12.5px] text-muted">{t.body}</div>}
          </div>
          <button className="text-faint hover:text-fg" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function Layout() {
  const { session, sessionError, demoLimit, dismissDemoLimit } = useApp()
  const [mobileOpen, setMobileOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => setMobileOpen(false), [loc.pathname])
  const full = loc.pathname === '/'

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <aside className="hidden w-[244px] shrink-0 border-r border-line bg-sunken/60 lg:block">
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-[272px] border-r border-line bg-bg animate-slide-in-right">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4 lg:hidden">
          <button className="btn btn-ghost h-8 w-8 px-0" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-4 w-4" />
          </button>
          <Logo size={24} />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">Vouch</span>
          {(session?.pending ?? 0) > 0 && (
            <NavLink to="/approvals" className="tnum ml-auto inline-flex h-6 items-center gap-1 rounded-full bg-red px-2 text-[11.5px] font-semibold text-white">
              <Stamp className="h-3 w-3" /> {session?.pending}
            </NavLink>
          )}
        </div>

        {session?.mock && (
          <Banner tone="amber" icon={<FlaskConical className="h-3.5 w-3.5" />}>
            <span className="font-semibold">MOCK MODE</span> — deterministic stand-in models, not Nemotron output
          </Banner>
        )}
        {sessionError && !session && (
          <Banner tone="red" icon={<WifiOff className="h-3.5 w-3.5" />}>
            Can’t reach the Vouch server. Start it with <span className="font-mono">make dev</span> or check the API on port 7860.
          </Banner>
        )}
        {demoLimit && (
          <Banner tone="info" icon={<Info className="h-3.5 w-3.5" />} onClose={dismissDemoLimit}>
            <span className="font-semibold">Demo limit reached — clone the repo to run your own.</span>{' '}
            <span className="opacity-80">{demoLimit}</span>
          </Banner>
        )}

        <main className={cx('min-h-0 flex-1', full ? 'flex flex-col overflow-hidden' : 'overflow-y-auto')}>
          <Outlet />
        </main>
      </div>
      <Toasts />
    </div>
  )
}

export function PageShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={cx('mx-auto w-full px-4 pb-16 pt-7 sm:px-6 lg:px-10', wide ? 'max-w-[1320px]' : 'max-w-[1080px]')}>{children}</div>
}
