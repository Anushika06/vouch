import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { Layout, PageShell } from './components/Layout'
import { EmptyState, SkeletonList } from './components/ui'
import { AppProvider } from './lib/app'

const Chat = lazy(() => import('./pages/Chat'))
const Memory = lazy(() => import('./pages/Memory'))
const Approvals = lazy(() => import('./pages/Approvals'))
const Briefing = lazy(() => import('./pages/Briefing'))
const Inbox = lazy(() => import('./pages/Inbox'))
const Skills = lazy(() => import('./pages/Skills'))
const Lab = lazy(() => import('./pages/Lab'))
const Evals = lazy(() => import('./pages/Evals'))
const Settings = lazy(() => import('./pages/Settings'))

function Fallback() {
  return (
    <PageShell>
      <div className="mb-6 space-y-2">
        <div className="skeleton h-7 w-48" />
        <div className="skeleton h-4 w-96 max-w-full" />
      </div>
      <SkeletonList rows={5} />
    </PageShell>
  )
}

function NotFound() {
  return (
    <PageShell>
      <EmptyState title="There’s no page here" action={<Link className="btn" to="/">Back to chat</Link>}>
        The link may be out of date.
      </EmptyState>
    </PageShell>
  )
}

export function App() {
  return (
    <AppProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<Layout />}>
            {(
              [
                ['/', Chat],
                ['/memory', Memory],
                ['/approvals', Approvals],
                ['/briefing', Briefing],
                ['/inbox', Inbox],
                ['/skills', Skills],
                ['/lab', Lab],
                ['/evals', Evals],
                ['/settings', Settings],
              ] as const
            ).map(([path, C]) => (
              <Route
                key={path}
                path={path}
                element={
                  <Suspense fallback={<Fallback />}>
                    <C />
                  </Suspense>
                }
              />
            ))}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}
