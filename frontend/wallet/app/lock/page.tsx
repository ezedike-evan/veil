'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LockKeyhole, Fingerprint, AlertCircle } from 'lucide-react'
import { useInvisibleWallet } from '@veil/sdk'

// ── Config ────────────────────────────────────────────────────────────────────
const FACTORY_ADDRESS    = process.env.NEXT_PUBLIC_FACTORY_ADDRESS    ?? ''
const RPC_URL            = process.env.NEXT_PUBLIC_RPC_URL            ?? 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015'

// ── Lock screen ───────────────────────────────────────────────────────────────
export default function LockPage() {
  const router = useRouter()

  const wallet = useInvisibleWallet({
    factoryAddress:    FACTORY_ADDRESS,
    rpcUrl:            RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
  })

  const [error, setError]           = useState<string | null>(null)
  const [isUnlocking, setIsUnlocking] = useState(false)

  const handleUnlock = useCallback(async () => {
    setError(null)
    setIsUnlocking(true)

    try {
      // Security note: compare stored address before and after login() to prevent
      // account-switching attacks via a different passkey on the unlock screen.
      const storedAddress = sessionStorage.getItem('invisible_wallet_address')

      await wallet.login()

      const restoredAddress = sessionStorage.getItem('invisible_wallet_address')

      if (!restoredAddress) {
        setError('No wallet found. Please register again.')
        return
      }

      if (storedAddress && restoredAddress !== storedAddress) {
        sessionStorage.clear()
        setError('Account mismatch detected. Please register again.')
        return
      }

      router.replace('/dashboard')

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unlock failed. Please try again.'
      setError(message)
    } finally {
      setIsUnlocking(false)
    }
  }, [wallet, router])

  return (
    <div
      className="wallet-shell"
      style={{ justifyContent: 'center', alignItems: 'center', padding: '2rem 1.25rem' }}
    >
      <div style={{ maxWidth: 400, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2.5rem' }}>

        {/* Veil wordmark — Anton ALL CAPS per Stellar brand manual */}
        <span style={{ fontFamily: 'Anton, Impact, sans-serif', fontSize: '2rem', letterSpacing: '0.08em', color: 'var(--gold)', userSelect: 'none' }}>
          VEIL
        </span>

        {/* Lock card */}
        <div
          className="card"
          style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', padding: '2.5rem 2rem' }}
        >
          {/* Lock icon */}
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'var(--surface-md)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <LockKeyhole size={28} color="rgba(246,247,248,0.6)" strokeWidth={1.5} />
          </div>

          {/* Copy — heading uses Lora SemiBold Italic per brand */}
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <h1 style={{ fontFamily: 'Lora, Georgia, serif', fontWeight: 600, fontStyle: 'italic', fontSize: '1.25rem', color: 'var(--off-white)' }}>
              Wallet locked
            </h1>
            <p style={{ fontSize: '0.875rem', color: 'rgba(246,247,248,0.45)', lineHeight: 1.6 }}>
              Your session ended after 5 minutes of inactivity.
              <br />
              Verify your identity to continue.
            </p>
          </div>

          {/* Error state */}
          {error && (
            <div style={{
              width: '100%', display: 'flex', alignItems: 'flex-start', gap: '0.625rem',
              borderRadius: 12, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.20)',
              padding: '0.75rem 1rem',
            }}>
              <AlertCircle size={16} color="rgba(252,165,165,1)" strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 2 }} />
              <p style={{ fontSize: '0.875rem', color: 'rgba(252,165,165,1)', lineHeight: 1.4 }}>{error}</p>
            </div>
          )}

          {/* Unlock button — .btn-gold from globals.css */}
          <button
            type="button"
            onClick={handleUnlock}
            disabled={isUnlocking || wallet.isPending}
            className="btn-gold"
          >
            <Fingerprint size={20} strokeWidth={1.5} />
            {isUnlocking || wallet.isPending ? 'Verifying…' : 'Unlock with passkey'}
          </button>

          {/* Subtle hint */}
          <p style={{ fontSize: '0.75rem', color: 'rgba(246,247,248,0.25)', textAlign: 'center' }}>
            Your biometric is your key — no password needed.
          </p>
        </div>
      </div>
    </div>
  )
}
