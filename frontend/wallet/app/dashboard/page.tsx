'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Server } from 'stellar-sdk/lib/horizon'
import { TxDetailSheet, type TxRecord } from '@/components/TxDetailSheet'

// ── Inactivity lock ───────────────────────────────────────────────────────────
const LOCK_TIMEOUT_MS = 5 * 60 * 1000
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'touchstart', 'click', 'scroll'] as const

function useInactivityLock() {
  const router          = useRouter()
  const timerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastActivityRef = useRef<number>(Date.now())

  const lock = useCallback(() => {
    sessionStorage.clear()
    router.replace('/lock')
  }, [router])

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now()
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(lock, LOCK_TIMEOUT_MS)
  }, [lock])

  useEffect(() => {
    resetTimer()
    ACTIVITY_EVENTS.forEach(event =>
      window.addEventListener(event, resetTimer, { passive: true }),
    )
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      ACTIVITY_EVENTS.forEach(event =>
        window.removeEventListener(event, resetTimer),
      )
    }
  }, [resetTimer])
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WalletAsset {
  code: string
  issuer: string | null
  balance: string
}

// ── Dashboard page ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter()
  useInactivityLock()

  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [assets, setAssets]               = useState<WalletAsset[]>([])
  const [transactions, setTransactions]   = useState<TxRecord[]>([])
  const [selectedTx, setSelectedTx]       = useState<TxRecord | null>(null)
  const [loading, setLoading]             = useState(true)
  const [isFunding, setIsFunding]         = useState(false)
  const [fundingError, setFundingError]   = useState<string | null>(null)

  const isTestnet = process.env.NEXT_PUBLIC_NETWORK === 'testnet'

  useEffect(() => {
    const stored = sessionStorage.getItem('invisible_wallet_address')
    setWalletAddress(stored)
  }, [])

  const fetchData = useCallback(async () => {
    if (!walletAddress) { setLoading(false); return }

    const horizonUrl = isTestnet
      ? 'https://horizon-testnet.stellar.org'
      : 'https://horizon.stellar.org'

    const server = new Server(horizonUrl)

    try {
      // ── Balances ────────────────────────────────────────────────────────────
      const account = await server.loadAccount(walletAddress)
      const walletAssets: WalletAsset[] = account.balances.map(b => {
        if (b.asset_type === 'native') return { code: 'XLM', issuer: null, balance: b.balance }
        const issued = b as { asset_code: string; asset_issuer: string; balance: string }
        return { code: issued.asset_code, issuer: issued.asset_issuer, balance: issued.balance }
      })
      setAssets(walletAssets)

      // ── Recent payments ──────────────────────────────────────────────────────
      const payments = await server
        .payments()
        .forAccount(walletAddress)
        .limit(20)
        .order('desc')
        .call()

      type HorizonPayment = {
        id: string; type: string; from: string; to: string
        amount: string; asset_type: string; asset_code?: string
        created_at: string; transaction_hash: string
        transaction?: { memo?: string }
      }

      const txRecords: TxRecord[] = (payments.records as HorizonPayment[])
        .filter(p => p.type === 'payment')
        .map(p => ({
          id:           p.id,
          type:         p.from === walletAddress ? 'sent' : 'received',
          amount:       p.amount,
          asset:        p.asset_type === 'native' ? 'XLM' : (p.asset_code ?? ''),
          counterparty: p.from === walletAddress ? p.to : p.from,
          timestamp:    Math.floor(new Date(p.created_at).getTime() / 1000),
          hash:         p.transaction_hash,
          memo:         p.transaction?.memo,
        }))

      setTransactions(txRecords)
    } catch {
      // Account may not yet be funded on testnet
    } finally {
      setLoading(false)
    }
  }, [walletAddress, isTestnet])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const xlmBalance = assets.find(a => a.code === 'XLM')?.balance ?? null

  const handleFund = async () => {
    if (!walletAddress) return
    setIsFunding(true)
    setFundingError(null)
    try {
      const res = await fetch(`https://friendbot.stellar.org/?addr=${walletAddress}`)
      if (!res.ok) throw new Error('Friendbot failed')
      await new Promise(r => setTimeout(r, 2000))
      await fetchData()
    } catch {
      setFundingError('Funding failed. Please try again.')
    } finally {
      setIsFunding(false)
    }
  }

  return (
    <div className="wallet-shell">

      {/* Header */}
      <header className="wallet-nav">
        <span style={{
          fontFamily: 'Anton, Impact, sans-serif',
          fontSize: '1.25rem', letterSpacing: '0.08em',
          color: 'var(--gold)', userSelect: 'none',
        }}>
          VEIL
        </span>
        {walletAddress && (
          <span className="address-chip">
            {walletAddress.slice(0, 6)}…{walletAddress.slice(-6)}
          </span>
        )}
      </header>

      <main className="wallet-main" style={{ paddingTop: '3rem', paddingBottom: '3rem' }}>

        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{
            fontFamily: 'Lora, Georgia, serif', fontWeight: 600, fontStyle: 'italic',
            fontSize: '1.75rem', color: 'var(--off-white)', marginBottom: '0.25rem',
          }}>
            Dashboard
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'rgba(246,247,248,0.5)' }}>
            Your wallet locks automatically after 5 minutes of inactivity.
          </p>
        </div>

        {/* ── Balance Display ── */}
        <div style={{ marginBottom: '2rem' }}>
          <p style={{ fontSize: '0.75rem', fontFamily: 'Anton, Impact, sans-serif', color: 'var(--warm-grey)', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
            AVAILABLE BALANCE
          </p>
          <div style={{ fontFamily: 'Lora, Georgia, serif', fontWeight: 600, fontStyle: 'italic', fontSize: '2.5rem', color: 'var(--off-white)' }}>
            {xlmBalance !== null
              ? `${parseFloat(xlmBalance).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 7 })} XLM`
              : '—'
            }
          </div>

          {/* Faucet button for zero-balance testnet wallets */}
          {isTestnet && xlmBalance === '0' && (
            <div style={{ marginTop: '1.25rem' }}>
              <button
                className="btn-ghost"
                onClick={handleFund}
                disabled={isFunding}
                style={{ width: 'auto', paddingLeft: '1.5rem', paddingRight: '1.5rem', minHeight: '3rem' }}
              >
                {isFunding ? (
                  <div className="spinner spinner-light" style={{ width: '1.25rem', height: '1.25rem' }} />
                ) : (
                  'Fund with testnet XLM'
                )}
              </button>
              {fundingError && (
                <p style={{ color: 'var(--teal)', fontSize: '0.75rem', marginTop: '0.75rem' }}>
                  {fundingError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Action Row ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '2.5rem' }}>
          <ActionButton
            label="Send"
            onClick={() => router.push('/send')}
            icon={<path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>}
          />
          <ActionButton
            label="Receive"
            onClick={() => {}}
            icon={<path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>}
          />
          <ActionButton
            label="Swap"
            onClick={() => router.push('/swap')}
            icon={<path d="M7 10l5-5 5 5M17 14l-5 5-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>}
          />
        </div>

        {/* ── Assets section ── */}
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '0.75rem', fontFamily: 'Anton, Impact, sans-serif', color: 'var(--warm-grey)', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
            ASSETS
          </h2>
          {loading ? (
            <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
              <div className="spinner spinner-light" />
            </div>
          ) : assets.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <p style={{ fontSize: '0.875rem', color: 'rgba(246,247,248,0.4)' }}>
                No assets found. Fund this address on Stellar Testnet to get started.
              </p>
            </div>
          ) : (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {assets.map(asset => (
                <div
                  key={`${asset.code}-${asset.issuer ?? 'native'}`}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div>
                    <p style={{ fontWeight: 500 }}>{asset.code}</p>
                    {asset.issuer && (
                      <p style={{ fontSize: '0.6875rem', color: 'rgba(246,247,248,0.35)', fontFamily: 'Inconsolata, monospace', marginTop: '0.125rem' }}>
                        {asset.issuer.slice(0, 6)}…{asset.issuer.slice(-6)}
                      </p>
                    )}
                  </div>
                  <span style={{ fontFamily: 'Inconsolata, monospace', fontSize: '1rem' }}>
                    {parseFloat(asset.balance).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Activity section ── */}
        <section>
          <h2 style={{ fontSize: '0.75rem', fontFamily: 'Anton, Impact, sans-serif', color: 'var(--warm-grey)', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
            ACTIVITY
          </h2>
          {!loading && transactions.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <p style={{ fontSize: '0.875rem', color: 'rgba(246,247,248,0.4)' }}>
                No transactions yet.
              </p>
            </div>
          )}
          {transactions.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {transactions.map((tx, i) => (
                <button
                  key={tx.id}
                  onClick={() => setSelectedTx(tx)}
                  aria-label={`${tx.type === 'sent' ? 'Sent' : 'Received'} ${tx.amount} ${tx.asset}`}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', padding: '0.875rem 1rem',
                    background: 'none', border: 'none', cursor: 'pointer',
                    borderBottom: i < transactions.length - 1 ? '1px solid var(--border-dim)' : 'none',
                    color: 'var(--off-white)', textAlign: 'left',
                    transition: 'background 100ms',
                  }}
                >
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                      {tx.type === 'sent' ? '↑ Sent' : '↓ Received'}
                    </p>
                    <p style={{ fontSize: '0.75rem', color: 'rgba(246,247,248,0.4)', marginTop: '0.125rem', fontFamily: 'Inconsolata, monospace' }}>
                      {tx.counterparty.slice(0, 6)}…{tx.counterparty.slice(-6)}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontFamily: 'Inconsolata, monospace', fontSize: '0.9375rem' }}>
                      {tx.amount} {tx.asset}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

      </main>

      {selectedTx && (
        <TxDetailSheet tx={selectedTx} onClose={() => setSelectedTx(null)} />
      )}
    </div>
  )
}

function ActionButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.625rem',
        padding: '1.25rem 0.5rem',
        cursor: 'pointer',
        background: 'var(--surface)',
        transition: 'all 0.2s ease',
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--gold)' }}>
        {icon}
      </svg>
      <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{label}</span>
    </button>
  )
}
