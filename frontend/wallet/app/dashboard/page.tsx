'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Horizon, Keypair, rpc as SorobanRpc, Contract, Account,
  TransactionBuilder, BASE_FEE, Networks, Asset, nativeToScVal, scValToNative,
} from '@stellar/stellar-sdk'
const Server = Horizon.Server
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
  const [copied, setCopied]               = useState(false)

  const isTestnet = process.env.NEXT_PUBLIC_NETWORK === 'testnet'

  useEffect(() => {
    const stored = sessionStorage.getItem('invisible_wallet_address')
    if (!stored) { router.replace('/lock'); return }
    setWalletAddress(stored)
  }, [router])

  const fetchData = useCallback(async () => {
    if (!walletAddress) { setLoading(false); return }

    const horizonUrl = isTestnet
      ? 'https://horizon-testnet.stellar.org'
      : 'https://horizon.stellar.org'
    const rpcUrl = isTestnet
      ? 'https://soroban-testnet.stellar.org'
      : 'https://soroban.stellar.org'

    const horizonServer = new Server(horizonUrl)
    const rpcServer     = new SorobanRpc.Server(rpcUrl)

    // ── 1. Wallet contract (C...) XLM balance via native SAC ────────────────
    // This is the canonical on-chain balance — survives cache clears and
    // cross-device recovery because it reads directly from the ledger.
    let contractXlm = 0
    try {
      const sacAddress  = Asset.native().contractId(Networks.TESTNET)
      const sacContract = new Contract(sacAddress)
      const dummyKp     = Keypair.random()
      const dummyAcct   = new Account(dummyKp.publicKey(), '0')
      const balanceTx   = new TransactionBuilder(dummyAcct, {
        fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
      })
        .addOperation(sacContract.call('balance', nativeToScVal(walletAddress, { type: 'address' })))
        .setTimeout(30)
        .build()

      const sim = await rpcServer.simulateTransaction(balanceTx)
      if (!SorobanRpc.Api.isSimulationError(sim)) {
        const result = (sim as SorobanRpc.Api.SimulateTransactionSuccessResponse).result
        if (result) {
          const stroops = scValToNative(result.retval) as bigint
          contractXlm  = Number(stroops) / 10_000_000
        }
      }
    } catch { /* contract has no balance entry yet */ }

    // ── 2. Fee-payer G... balance (holds the testnet faucet XLM) ────────────
    const signerSecret    = sessionStorage.getItem('veil_signer_secret')
    const signerPublicKey = signerSecret
      ? Keypair.fromSecret(signerSecret).publicKey()
      : (localStorage.getItem('veil_signer_public_key') || null)

    let feePayerXlm = 0
    let txRecords: TxRecord[] = []

    if (signerPublicKey) {
      try {
        const account = await horizonServer.loadAccount(signerPublicKey)
        const native  = account.balances.find(b => b.asset_type === 'native')
        feePayerXlm   = native ? parseFloat(native.balance) : 0

        // Transaction history (fee-payer + wallet address)
        type HorizonPayment = {
          id: string; type: string; from: string; to: string
          amount: string; asset_type: string; asset_code?: string
          created_at: string; transaction_hash: string
          transaction?: { memo?: string }
        }

        const payments = await horizonServer
          .payments()
          .forAccount(signerPublicKey)
          .limit(20)
          .order('desc')
          .call()

        txRecords = (payments.records as HorizonPayment[])
          .filter(p => p.type === 'payment')
          .map(p => ({
            id:           p.id,
            type:         p.from === signerPublicKey ? 'sent' : 'received',
            amount:       p.amount,
            asset:        p.asset_type === 'native' ? 'XLM' : (p.asset_code ?? ''),
            counterparty: p.from === signerPublicKey ? p.to : p.from,
            timestamp:    Math.floor(new Date(p.created_at).getTime() / 1000),
            hash:         p.transaction_hash,
            memo:         p.transaction?.memo,
          }))
      } catch { /* not yet funded */ }
    }

    // ── 3. Wraith: incoming SAC transfers to the wallet contract ────────────
    const wraithUrl = process.env.NEXT_PUBLIC_WRAITH_URL
    if (wraithUrl) {
      try {
        type WraithTransfer = {
          id: number; eventType: string; fromAddress: string | null
          toAddress: string | null; amount: string; ledger: number
          ledgerClosedAt: string; txHash: string; contractId: string
        }
        const [inRes, outRes] = await Promise.all([
          fetch(`${wraithUrl}/transfers/incoming/${walletAddress}?limit=20`),
          fetch(`${wraithUrl}/transfers/outgoing/${walletAddress}?limit=20`),
        ])
        const inData  = inRes.ok  ? await inRes.json()  as { transfers: WraithTransfer[] } : { transfers: [] }
        const outData = outRes.ok ? await outRes.json() as { transfers: WraithTransfer[] } : { transfers: [] }

        const wraithRecords: TxRecord[] = [
          ...inData.transfers.map(t => ({
            id:           `w-${t.id}`,
            type:         'received' as const,
            amount:       (Math.abs(Number(t.amount)) / 10_000_000).toFixed(7),
            asset:        'XLM',
            counterparty: t.fromAddress ?? 'unknown',
            timestamp:    Math.floor(new Date(t.ledgerClosedAt).getTime() / 1000),
            hash:         t.txHash,
          })),
          ...outData.transfers.map(t => ({
            id:           `w-${t.id}`,
            type:         'sent' as const,
            amount:       (Math.abs(Number(t.amount)) / 10_000_000).toFixed(7),
            asset:        'XLM',
            counterparty: t.toAddress ?? 'unknown',
            timestamp:    Math.floor(new Date(t.ledgerClosedAt).getTime() / 1000),
            hash:         t.txHash,
          })),
        ]

        // Merge Wraith records with Horizon records, deduplicate by hash, sort newest first
        const merged = [...wraithRecords, ...txRecords]
          .filter((tx, i, arr) => arr.findIndex(t => t.hash === tx.hash) === i)
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 30)
        txRecords = merged
      } catch { /* Wraith offline — fall back to Horizon only */ }
    }

    // ── 4. Combine and display ───────────────────────────────────────────────
    const totalXlm = (contractXlm + feePayerXlm).toFixed(7)
    setAssets([{ code: 'XLM', issuer: null, balance: totalXlm }])
    setTransactions(txRecords)
    setLoading(false)
  }, [walletAddress, isTestnet])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const xlmBalance = assets.find(a => a.code === 'XLM')?.balance ?? null

  const handleFund = async () => {
    setIsFunding(true)
    setFundingError(null)
    try {
      // Friendbot only funds classic G... accounts, not C... contract addresses.
      // Derive the G... public key from session secret or fall back to localStorage.
      const signerSecret = sessionStorage.getItem('veil_signer_secret')
      let signerPublicKey = signerSecret
        ? Keypair.fromSecret(signerSecret).publicKey()
        : (localStorage.getItem('veil_signer_public_key') || null)

      // After cross-device recovery there is no fee-payer yet — auto-create one.
      if (!signerPublicKey) {
        const newKp = Keypair.random()
        localStorage.setItem('veil_signer_public_key', newKp.publicKey())
        sessionStorage.setItem('veil_signer_secret', newKp.secret())
        signerPublicKey = newKp.publicKey()
      }
      const res = await fetch(`https://friendbot.stellar.org/?addr=${signerPublicKey}`)
      if (!res.ok) {
        // 400 means the account is already funded — just refresh balances
        if (res.status === 400) {
          await fetchData()
          return
        }
        throw new Error('Friendbot failed')
      }
      await new Promise(r => setTimeout(r, 2000))
      await fetchData()
    } catch (err: unknown) {
      setFundingError(err instanceof Error ? err.message : 'Funding failed. Please try again.')
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
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(walletAddress)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            title="Copy wallet address"
          >
            <span className="address-chip">
              {walletAddress.slice(0, 6)}…{walletAddress.slice(-6)}
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: copied ? 'var(--teal)' : 'rgba(246,247,248,0.35)', flexShrink: 0 }}>
              {copied
                ? <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                : <><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.75"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="1.75"/></>
              }
            </svg>
          </button>
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

          {/* Faucet button for unfunded or zero-balance testnet wallets */}
          {isTestnet && !loading && (xlmBalance === null || xlmBalance === '0') && (
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
            onClick={() => router.push('/receive')}
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
