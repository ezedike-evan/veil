'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LockKeyhole, Fingerprint, AlertCircle } from 'lucide-react'
import { useInvisibleWallet } from 'invisible-wallet-sdk'

// ── Config ────────────────────────────────────────────────────────────────────
// TODO: move these to env vars / config module once the wallet app is wired up
const FACTORY_ADDRESS    = process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? ''
const RPC_URL            = process.env.NEXT_PUBLIC_RPC_URL         ?? 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015'

// ── Lock screen ───────────────────────────────────────────────────────────────
export default function LockPage() {
  const router = useRouter()

  const wallet = useInvisibleWallet({
    factoryAddress:   FACTORY_ADDRESS,
    rpcUrl:           RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
  })

  const [error, setError] = useState<string | null>(null)
  const [isUnlocking, setIsUnlocking] = useState(false)

  const handleUnlock = useCallback(async () => {
    setError(null)
    setIsUnlocking(true)

    try {
      // login() reads the stored credential and triggers a WebAuthn assertion,
      // returning the wallet address from sessionStorage.
      //
      // Security note: we compare the address returned by login() against the
      // value stored in sessionStorage BEFORE the lock was triggered. This
      // prevents an attacker from switching to a different account by presenting
      // a different passkey on the unlock screen.
      const storedAddress = sessionStorage.getItem('invisible_wallet_address')

      await wallet.login()

      // wallet.address is set synchronously by login() via setState, but we
      // read sessionStorage directly here to avoid depending on the render cycle.
      const restoredAddress = sessionStorage.getItem('invisible_wallet_address')

      if (!restoredAddress) {
        setError('No wallet found. Please register again.')
        return
      }

      if (storedAddress && restoredAddress !== storedAddress) {
        // Account-switching attack detected — clear session and send to register
        sessionStorage.clear()
        setError('Account mismatch detected. Please register again.')
        return
      }

      // Session restored — return to dashboard
      router.replace('/dashboard')

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unlock failed. Please try again.'
      setError(message)
    } finally {
      setIsUnlocking(false)
    }
  }, [wallet, router])

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center px-6">

      {/* Veil wordmark */}
      <span className="font-serif font-semibold italic text-[#FDDA24] text-3xl tracking-tight select-none mb-12">
        Veil
      </span>

      {/* Lock card */}
      <div className="w-full max-w-sm rounded-3xl border border-white/[0.08] bg-white/[0.03] p-10 flex flex-col items-center gap-6">

        {/* Lock icon */}
        <div className="w-16 h-16 rounded-full bg-white/[0.06] flex items-center justify-center">
          <LockKeyhole className="w-7 h-7 text-white/60" strokeWidth={1.5} />
        </div>

        {/* Copy */}
        <div className="text-center space-y-1.5">
          <h1 className="text-white font-semibold text-xl tracking-tight">
            Wallet locked
          </h1>
          <p className="text-white/45 text-sm leading-relaxed">
            Your session ended after 5 minutes of inactivity.
            <br />
            Verify your identity to continue.
          </p>
        </div>

        {/* Error state */}
        {error && (
          <div className="w-full flex items-start gap-2.5 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" strokeWidth={1.5} />
            <p className="text-red-300 text-sm leading-snug">{error}</p>
          </div>
        )}

        {/* Unlock button */}
        <button
          type="button"
          onClick={handleUnlock}
          disabled={isUnlocking || wallet.isPending}
          className="
            w-full flex items-center justify-center gap-2.5
            rounded-2xl px-6 py-4
            bg-[#FDDA24] hover:bg-[#f5d100]
            text-[#0A0A0A] font-semibold text-sm
            transition-all active:scale-[0.98]
            disabled:opacity-50 disabled:cursor-not-allowed
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FDDA24]/60
          "
          aria-label="Unlock wallet with passkey"
        >
          <Fingerprint className="w-5 h-5" strokeWidth={1.5} />
          {isUnlocking || wallet.isPending ? 'Verifying…' : 'Unlock with passkey'}
        </button>

        {/* Subtle hint */}
        <p className="text-white/25 text-xs text-center">
          Your biometric is your key — no password needed.
        </p>
      </div>
    </div>
  )
}