'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { VeilLogo } from '@/components/VeilLogo'

interface TxItem {
  id: string
  type: 'send' | 'receive'
  amount: string
  asset: string
  counterparty: string
  timestamp: number
}

export default function DashboardPage() {
  const router = useRouter()
  const [address, setAddress] = useState<string | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<TxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'assets' | 'activity'>('assets')

  useEffect(() => {
    const addr = sessionStorage.getItem('veil_address')
    if (!addr) { router.replace('/'); return }
    setAddress(addr)
    fetchBalance(addr)
  }, [router])

  async function fetchBalance(addr: string) {
    try {
      const res = await fetch(
        `https://horizon-testnet.stellar.org/accounts/${addr}`
      )
      if (!res.ok) { setBalance('0'); setLoading(false); return }
      const data = await res.json()
      const xlm = (data.balances as Array<{ asset_type: string; balance: string }>)
        .find(b => b.asset_type === 'native')
      setBalance(xlm?.balance ?? '0')

      // Fetch recent payments
      const paymentsRes = await fetch(
        `https://horizon-testnet.stellar.org/accounts/${addr}/payments?limit=10&order=desc`
      )
      if (paymentsRes.ok) {
        const pd = await paymentsRes.json()
        const items: TxItem[] = (pd._embedded?.records ?? []).map((r: {
          id: string; type?: string; to?: string; from?: string;
          amount?: string; asset_type?: string; created_at?: string;
        }) => ({
          id: r.id,
          type: r.to === addr ? 'receive' : 'send',
          amount: r.amount ?? '0',
          asset: r.asset_type === 'native' ? 'XLM' : 'TOKEN',
          counterparty: r.type === 'payment'
            ? (r.to === addr ? r.from ?? '' : r.to ?? '')
            : '',
          timestamp: new Date(r.created_at ?? '').getTime(),
        }))
        setTransactions(items)
      }
    } catch {
      setBalance('0')
    } finally {
      setLoading(false)
    }
  }

  function copyAddress() {
    if (!address) return
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  function handleLogout() {
    sessionStorage.clear()
    router.replace('/')
  }

  const shortAddr = address
    ? `${address.slice(0, 6)}...${address.slice(-6)}`
    : '—'

  return (
    <div className="wallet-shell">
      {/* Nav */}
      <nav className="wallet-nav">
        <VeilLogo size={24} />
        <button
          className="address-chip"
          onClick={copyAddress}
          title={address ?? ''}
        >
          {shortAddr}
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="var(--gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="4" y="1" width="7" height="7" rx="1" stroke="var(--gold)" strokeWidth="1.2"/>
              <path d="M1 4v7h7V9" stroke="var(--gold)" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          )}
        </button>
        <button
          onClick={handleLogout}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(246,247,248,0.4)', fontSize: '0.8125rem' }}
        >
          Lock
        </button>
      </nav>

      <main className="wallet-main">
        {/* Balance */}
        <div style={{ textAlign: 'center', padding: '2rem 0 2.5rem' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div className="spinner spinner-light" />
            </div>
          ) : (
            <>
              <div className="amount-display">
                {balance ? parseFloat(balance).toFixed(2) : '0.00'}
              </div>
              <p style={{ fontSize: '1rem', color: 'rgba(246,247,248,0.4)', marginTop: '0.375rem', fontFamily: 'Anton, Impact, sans-serif', letterSpacing: '0.06em' }}>
                XLM
              </p>
            </>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '2rem' }}>
          <Link href="/send" style={{ textDecoration: 'none' }}>
            <button className="btn-gold" style={{ fontSize: '0.875rem', padding: '0.75rem 1rem' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 8h12M10 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Send
            </button>
          </Link>
          <button
            className="btn-ghost"
            style={{ fontSize: '0.875rem', padding: '0.75rem 1rem' }}
            onClick={copyAddress}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M14 2L8 14M8 14l-4-4M8 14l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Receive
          </button>
        </div>

        {/* Tabs */}
        <div className="tab-bar" style={{ marginBottom: '1.25rem' }}>
          <button
            className={`tab-item ${activeTab === 'assets' ? 'active' : ''}`}
            onClick={() => setActiveTab('assets')}
          >
            Assets
          </button>
          <button
            className={`tab-item ${activeTab === 'activity' ? 'active' : ''}`}
            onClick={() => setActiveTab('activity')}
          >
            Activity
          </button>
        </div>

        {/* Assets tab */}
        {activeTab === 'assets' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                {/* XLM icon */}
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(253,218,36,0.12)', border: '1px solid rgba(253,218,36,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M9 2l7 13H2L9 2z" stroke="var(--gold)" strokeWidth="1.4" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div>
                  <p style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Stellar Lumens</p>
                  <p style={{ fontSize: '0.8125rem', color: 'rgba(246,247,248,0.4)' }}>XLM</p>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontWeight: 600, fontFamily: 'Inconsolata, monospace', fontSize: '1rem' }}>
                  {balance ? parseFloat(balance).toFixed(4) : '0.0000'}
                </p>
                <p style={{ fontSize: '0.75rem', color: 'rgba(246,247,248,0.4)' }}>XLM</p>
              </div>
            </div>
          </div>
        )}

        {/* Activity tab */}
        {activeTab === 'activity' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {transactions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 0', color: 'rgba(246,247,248,0.3)', fontSize: '0.875rem' }}>
                No transactions yet
              </div>
            ) : (
              transactions.map(tx => (
                <div key={tx.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: tx.type === 'receive' ? 'rgba(0,167,181,0.12)' : 'rgba(253,218,36,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        {tx.type === 'receive'
                          ? <path d="M7 2v10M3 8l4 4 4-4" stroke="var(--teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          : <path d="M7 12V2M3 6l4-4 4 4" stroke="var(--gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        }
                      </svg>
                    </div>
                    <div>
                      <p style={{ fontWeight: 500, fontSize: '0.875rem', textTransform: 'capitalize' }}>{tx.type}</p>
                      <p style={{ fontSize: '0.75rem', color: 'rgba(246,247,248,0.35)', fontFamily: 'Inconsolata, monospace' }}>
                        {tx.counterparty ? `${tx.counterparty.slice(0,4)}...${tx.counterparty.slice(-4)}` : '—'}
                      </p>
                    </div>
                  </div>
                  <p style={{
                    fontFamily: 'Inconsolata, monospace',
                    fontWeight: 500,
                    fontSize: '0.9375rem',
                    color: tx.type === 'receive' ? 'var(--teal)' : 'var(--off-white)',
                  }}>
                    {tx.type === 'receive' ? '+' : '-'}{parseFloat(tx.amount).toFixed(4)} {tx.asset}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {/* Settings link */}
        <div style={{ marginTop: '2.5rem', textAlign: 'center' }}>
          <Link
            href="/settings"
            style={{ fontSize: '0.8125rem', color: 'rgba(246,247,248,0.35)', textDecoration: 'none' }}
          >
            Signers & Recovery
          </Link>
        </div>
      </main>
    </div>
  )
}
