'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Keypair, Networks, TransactionBuilder, BASE_FEE, Operation, Asset, Memo } from 'stellar-sdk'
import { Server } from 'stellar-sdk/lib/horizon'
import { VeilLogo } from '@/components/VeilLogo'

type Step = 'form' | 'confirm' | 'signing' | 'done' | 'error'

export default function SendPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('form')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    const addr = sessionStorage.getItem('veil_address')
    if (!addr) router.replace('/')
  }, [router])

  function validateForm(): boolean {
    if (!recipient.startsWith('G') || recipient.length !== 56) return false
    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return false
    return true
  }

  async function handleSend() {
    setStep('signing')
    setErrorMsg(null)
    try {
      const sourceAddress = sessionStorage.getItem('veil_address')!
      const signerSecret = sessionStorage.getItem('veil_signer_secret')!
      const signerKeypair = Keypair.fromSecret(signerSecret)

      const server = new Server('https://horizon-testnet.stellar.org')
      const account = await server.loadAccount(sourceAddress)

      const txBuilder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: recipient,
            asset: Asset.native(),
            amount: amount,
          })
        )
        .setTimeout(30)

      if (memo) txBuilder.addMemo(Memo.text(memo))

      const tx = txBuilder.build()
      tx.sign(signerKeypair)

      const result = await server.submitTransaction(tx)
      setTxHash(result.hash)
      setStep('done')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(msg)
      setStep('error')
    }
  }

  return (
    <div className="wallet-shell">
      {/* Nav */}
      <nav className="wallet-nav">
        <button
          onClick={() => router.back()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--off-white)', display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.875rem' }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>
        <VeilLogo size={22} />
        <div style={{ width: 40 }} />
      </nav>

      <main className="wallet-main">
        <h2 style={{ fontFamily: 'Lora, Georgia, serif', fontWeight: 600, fontStyle: 'italic', fontSize: '1.75rem', marginBottom: '1.75rem' }}>
          Send XLM
        </h2>

        {step === 'form' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'rgba(246,247,248,0.4)', display: 'block', marginBottom: '0.5rem', fontFamily: 'Anton, Impact, sans-serif', letterSpacing: '0.06em' }}>
                RECIPIENT ADDRESS
              </label>
              <input
                className="input-field mono"
                type="text"
                placeholder="G..."
                value={recipient}
                onChange={e => setRecipient(e.target.value.trim())}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: 'rgba(246,247,248,0.4)', display: 'block', marginBottom: '0.5rem', fontFamily: 'Anton, Impact, sans-serif', letterSpacing: '0.06em' }}>
                AMOUNT (XLM)
              </label>
              <input
                className="input-field"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                min="0"
                step="0.0000001"
                style={{ fontFamily: 'Inconsolata, monospace', fontSize: '1.25rem' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: 'rgba(246,247,248,0.4)', display: 'block', marginBottom: '0.5rem', fontFamily: 'Anton, Impact, sans-serif', letterSpacing: '0.06em' }}>
                MEMO (OPTIONAL)
              </label>
              <input
                className="input-field"
                type="text"
                placeholder="Add a note..."
                value={memo}
                onChange={e => setMemo(e.target.value)}
                maxLength={28}
              />
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <button
                className="btn-gold"
                onClick={() => setStep('confirm')}
                disabled={!validateForm()}
              >
                Review
              </button>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="card">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Row label="To" value={`${recipient.slice(0, 8)}...${recipient.slice(-8)}`} mono />
                <Row label="Amount" value={`${amount} XLM`} />
                {memo && <Row label="Memo" value={memo} />}
                <Row label="Network" value="Stellar Testnet" />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button className="btn-gold" onClick={handleSend}>
                Confirm send
              </button>
              <button className="btn-ghost" onClick={() => setStep('form')}>
                Edit
              </button>
            </div>
          </div>
        )}

        {step === 'signing' && (
          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <div className="spinner spinner-light" />
            </div>
            <p style={{ fontWeight: 500 }}>Broadcasting transaction...</p>
            <p style={{ fontSize: '0.8125rem', color: 'rgba(246,247,248,0.4)', marginTop: '0.5rem' }}>
              Submitting to Stellar Testnet
            </p>
          </div>
        )}

        {step === 'done' && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center' }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: '0 auto' }}>
              <circle cx="20" cy="20" r="19" stroke="var(--teal)" strokeWidth="1.5" />
              <path d="M13 20.5l5 5 9-9" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <p style={{ fontFamily: 'Lora, Georgia, serif', fontWeight: 600, fontStyle: 'italic', fontSize: '1.25rem' }}>
                Sent successfully
              </p>
              {txHash && (
                <p style={{ fontSize: '0.75rem', color: 'rgba(246,247,248,0.35)', fontFamily: 'Inconsolata, monospace', marginTop: '0.5rem', wordBreak: 'break-all' }}>
                  {txHash.slice(0, 20)}...
                </p>
              )}
            </div>
            <button className="btn-gold" onClick={() => router.push('/dashboard')}>
              Done
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center' }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: '0 auto' }}>
              <circle cx="20" cy="20" r="19" stroke="var(--teal)" strokeWidth="1.5" opacity="0.5" />
              <path d="M14 14l12 12M26 14l-12 12" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <div>
              <p style={{ fontWeight: 500 }}>Transaction failed</p>
              <p style={{ fontSize: '0.8125rem', color: 'rgba(246,247,248,0.4)', marginTop: '0.5rem' }}>
                {errorMsg}
              </p>
            </div>
            <button className="btn-ghost" onClick={() => setStep('form')}>
              Try again
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
      <span style={{ fontSize: '0.8125rem', color: 'rgba(246,247,248,0.4)', flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: '0.875rem',
        fontFamily: mono ? 'Inconsolata, monospace' : 'Inter, sans-serif',
        textAlign: 'right',
        wordBreak: 'break-all',
      }}>
        {value}
      </span>
    </div>
  )
}
