'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ── Inactivity lock constant ──────────────────────────────────────────────────
// After this many milliseconds of no user interaction the wallet is locked and
// sessionStorage is cleared. Set to 5 minutes per the security spec.
const LOCK_TIMEOUT_MS = 5 * 60 * 1000

// Events that count as user activity and reset the inactivity timer
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'touchstart', 'click', 'scroll'] as const

// ── useInactivityLock ─────────────────────────────────────────────────────────
function useInactivityLock() {
  const router = useRouter()
  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastActivityRef = useRef<number>(Date.now())

  const lock = useCallback(() => {
    // Clear the session — user must re-authenticate via passkey
    sessionStorage.clear()
    router.replace('/lock')
  }, [router])

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now()

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(lock, LOCK_TIMEOUT_MS)
  }, [lock])

  useEffect(() => {
    // Start the timer immediately on mount
    resetTimer()

    // Attach activity listeners — each resets the countdown
    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, resetTimer, { passive: true }),
    )

    return () => {
      // Clean up on unmount (e.g. user navigates away from dashboard)
      if (timerRef.current) clearTimeout(timerRef.current)
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, resetTimer),
      )
    }
  }, [resetTimer])
}

// ── Dashboard page ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  // Activate inactivity lock for the entire dashboard session
  useInactivityLock()

  // Read the wallet address stored by register() / login()
  const walletAddress =
    typeof window !== 'undefined'
      ? sessionStorage.getItem('invisible_wallet_address')
      : null

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F6F7F8] flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-white/[0.06] px-6 py-4 flex items-center justify-between">
        <span className="font-serif font-semibold italic text-[#FDDA24] text-xl tracking-tight select-none">
          Veil
        </span>
        <span className="text-xs text-white/40 font-mono truncate max-w-[200px]">
          {walletAddress ?? '—'}
        </span>
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-12 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-white mb-1">Dashboard</h1>
          <p className="text-sm text-white/50">
            Your wallet locks automatically after 5 minutes of inactivity.
          </p>
        </div>

        {/* Placeholder — replace with real wallet UI */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-8 text-center">
          <p className="text-white/40 text-sm">
            Wallet content goes here.
          </p>
        </div>
      </main>
    </div>
  )
}