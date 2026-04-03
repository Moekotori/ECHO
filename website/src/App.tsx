import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Toaster } from 'react-hot-toast'
import { SiteLayout } from './components/SiteLayout'

const HomePage = lazy(() => import('./pages/HomePage').then(m => ({ default: m.HomePage })))
const DownloadPage = lazy(() => import('./pages/DownloadPage').then(m => ({ default: m.DownloadPage })))
const ChangelogPage = lazy(() => import('./pages/ChangelogPage').then(m => ({ default: m.ChangelogPage })))
const FaqPage = lazy(() => import('./pages/FaqPage').then(m => ({ default: m.FaqPage })))

export default function App() {
  const location = useLocation()

  return (
    <SiteLayout>
      <Toaster 
        position="bottom-center"
        toastOptions={{
          style: {
            background: 'var(--echo-surface)',
            color: 'var(--echo-text)',
            borderRadius: '16px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
            fontSize: '14px',
            fontWeight: 600,
          },
        }}
      />
      <AnimatePresence mode="wait">
        <Suspense fallback={<div className="p-8 text-center text-black/60">鍔犺浇涓?..</div>}>
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<HomePage />} />
            <Route path="/download" element={<DownloadPage />} />
            <Route path="/changelog" element={<ChangelogPage />} />
            <Route path="/faq" element={<FaqPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AnimatePresence>
    </SiteLayout>
  )
}
