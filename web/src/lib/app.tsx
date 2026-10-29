import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, onApiError } from './api'
import type { SessionInfo } from './types'

type Theme = 'dark' | 'light'
export type ToastTone = 'info' | 'success' | 'error'
export interface Toast {
  id: number
  tone: ToastTone
  title: string
  body?: string
}

interface AppCtx {
  session: SessionInfo | null
  sessionError: string | null
  refreshSession: () => Promise<void>
  theme: Theme
  setTheme: (t: Theme) => void
  demoLimit: string | null
  dismissDemoLimit: () => void
  toasts: Toast[]
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
}

const Ctx = createContext<AppCtx | null>(null)

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem('vouch-theme')
    if (t === 'light' || t === 'dark') return t
  } catch {
    /* ignore */
  }
  return 'dark'
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [theme, setThemeState] = useState<Theme>(initialTheme)
  const [demoLimit, setDemoLimit] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current
    setToasts((xs) => [...xs.slice(-3), { ...t, id }])
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.tone === 'error' ? 7000 : 4000)
  }, [])
  const dismissToast = useCallback((id: number) => setToasts((xs) => xs.filter((x) => x.id !== id)), [])

  const refreshSession = useCallback(async () => {
    try {
      const s = await api.session()
      setSession(s)
      setSessionError(null)
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : 'Could not reach the server')
    }
  }, [])

  useEffect(() => {
    refreshSession()
    const t = setInterval(refreshSession, 20000)
    return () => clearInterval(t)
  }, [refreshSession])

  useEffect(
    () =>
      onApiError((e) => {
        if (e.status === 429 || e.code === 'demo_limit') setDemoLimit(e.message || 'Demo limit reached')
        else if (e.code === 'model_error') toast({ tone: 'error', title: 'The model call failed', body: e.message })
        else if (e.status >= 500) toast({ tone: 'error', title: 'Server error', body: e.message })
      }),
    [toast],
  )

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    document.documentElement.setAttribute('data-theme', t)
    try {
      localStorage.setItem('vouch-theme', t)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const value = useMemo<AppCtx>(
    () => ({
      session,
      sessionError,
      refreshSession,
      theme,
      setTheme,
      demoLimit,
      dismissDemoLimit: () => setDemoLimit(null),
      toasts,
      toast,
      dismissToast,
    }),
    [session, sessionError, refreshSession, theme, setTheme, demoLimit, toasts, toast, dismissToast],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp outside AppProvider')
  return c
}

/** Small data hook: load on mount (and when deps change), with reload + optimistic set. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const reload = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const d = await fnRef.current()
      if (alive.current) {
        setData(d)
        setError(null)
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    reload()
    return () => {
      alive.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, setData, error, loading, reload }
}
