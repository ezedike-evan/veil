'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Keypair, Networks, TransactionBuilder, BASE_FEE, Asset, Operation,
  Contract, rpc as SorobanRpc, nativeToScVal, Horizon,
} from '@stellar/stellar-sdk'
const Server = Horizon.Server
import { VeilLogo } from '@/components/VeilLogo'
import { ContactPicker } from '@/components/ContactPicker'
import { QrScanner } from '@/components/QrScanner'

type Step = 'form' | 'confirm' | 'signing' | 'done' | 'error'

interface WalletAsset {
  code: string
  issuer: string | null
  contractId: string | null
}

export default function SendPage() {
  const router = useRouter()
  const [step, setStep]               = useState<Step>('form')
  const [recipient, setRecipient]     = useState('')
  const [amount, setAmount]           = useState('')
  const [memo, setMemo]               = useState('')
  const [txHash, setTxHash]           = useState<string | null>(null)
  const [errorMsg, setErrorMsg]       = useState<string | null>(null)
  const [showPicker, setShowPicker]   = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [hasCamera, setHasCamera]     = useState(false)

  const [assets, setAssets]               = useState<WalletAsset[]>([])
  const [selectedAsset, setSelectedAsset] = useState<WalletAsset | null>(null)

  useEffect(() => {
    const addr = sessionStorage.getItem('invisible_wallet_address')
    if (!addr) { router.replace('/lock'); return }
    const secret = sessionStorage.getItem('veil_signer_secret')
    if (!secret) { router.replace('/lock'); return }

    // Check camera/QR scanner availability before showing scan button
    if (typeof (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector !== 'undefined' || !!navigator.mediaDevices?.getUserMedia) {
      setHasCamera(true)
    }

    // Fetch available balances — use the fee-payer G... account since
    // Horizon doesn't support loadAccount for C... contract addresses.
    const signerPublicKey = sessionStorage.getItem('veil_signer_secret')
      ? Keypair.fromSecret(sessionStorage.getItem('veil_signer_secret')!).publicKey()
      : localStorage.getItem('veil_signer_public_key') ?? addr
    const server = new Server('https://horizon-testnet.stellar.org')
    server.loadAccount(signerPublicKey).then(account => {
      const list: WalletAsset[] = account.balances.map(b => {
        if (b.asset_type === 'native') {
          return { code: 'XLM', issuer: null, contractId: Asset.native().contractId(Networks.TESTNET) }
        }
        const issued = b as { asset_code: string; asset_issuer: string }
        const asset  = new Asset(issued.asset_code, issued.asset_issuer)
        return { code: issued.asset_code, issuer: issued.asset_issuer, contractId: asset.contractId(Networks.TESTNET) }
      })
      setAssets(list)
      if (list.length > 0) setSelectedAsset(list[0])
    }).catch(() => {
      // Account not yet funded — default to XLM
      const xlm: WalletAsset = { code: 'XLM', issuer: null, contractId: Asset.native().contractId(Networks.TESTNET) }
      setAssets([xlm])
      setSelectedAsset(xlm)
    })
  }, [router])

  function validateForm(): boolean {
    // Accept both classic G... accounts and C... Soroban contract addresses
    const validAddress = (recipient.startsWith('G') || recipient.startsWith('C')) && recipient.length === 56
    if (!validAddress) return false
    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) return false
    if (!selectedAsset) return false
    return true
  }

  async function handleSend() {
    setStep('signing')
    setErrorMsg(null)
    try {
      const signerSecret = sessionStorage.getItem('veil_signer_secret')
      if (!signerSecret) throw new Error('Session expired. Please unlock your wallet.')
      const feePayerKp = Keypair.fromSecret(signerSecret)

      // ── Step 1: Passkey verification (user must biometrically confirm) ──────
      const keyId = localStorage.getItem('invisible_wallet_key_id')
      if (!keyId) throw new Error('No passkey found. Please register the wallet first.')
      const credIdBin = atob(keyId.replace(/-/g, '+').replace(/_/g, '/'))
      const credId    = Uint8Array.from(credIdBin, c => c.charCodeAt(0))
      const challenge = crypto.getRandomValues(new Uint8Array(32))
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: credId, type: 'public-key' }],
          userVerification: 'required',
        },
      })
      if (!assertion) throw new Error('Passkey verification was cancelled.')

      // ── Step 2: Submit payment from fee-payer (which holds the XLM) ─────────
      // The wallet contract (C...) is the auth layer; the fee-payer G... account
      // is where funds live. We send from the fee-payer directly.
      const horizonServer = new Server('https://horizon-testnet.stellar.org')

      if (recipient.startsWith('G') && recipient.length === 56) {
        // Classic account → classic payment operation (fast, cheap)
        const account = await horizonServer.loadAccount(feePayerKp.publicKey())
        const tx = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(Operation.payment({
            destination: recipient,
            asset: Asset.native(),
            amount,
          }))
          .setTimeout(30)
          .build()
        tx.sign(feePayerKp)
        const result = await horizonServer.submitTransaction(tx)
        setTxHash(result.hash)
      } else {
        // Contract address → SAC transfer from fee-payer via Soroban RPC
        const rpcServer     = new SorobanRpc.Server('https://soroban-testnet.stellar.org')
        const feePayerAcct  = await rpcServer.getAccount(feePayerKp.publicKey())
        const sacContract   = new Contract(Asset.native().contractId(Networks.TESTNET))
        const amountStroops = BigInt(Math.round(parseFloat(amount) * 10_000_000))

        const tx = new TransactionBuilder(feePayerAcct, {
          fee: BASE_FEE,
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(sacContract.call(
            'transfer',
            nativeToScVal(feePayerKp.publicKey(), { type: 'address' }),
            nativeToScVal(recipient,              { type: 'address' }),
            nativeToScVal(amountStroops,          { type: 'i128' }),
          ))
          .setTimeout(30)
          .build()

        const sim = await rpcServer.simulateTransaction(tx)
        if (SorobanRpc.Api.isSimulationError(sim)) {
          throw new Error(`Simulation failed: ${sim.error}`)
        }
        const assembled = SorobanRpc.assembleTransaction(tx, sim).build()
        assembled.sign(feePayerKp)

        const sendResult = await rpcServer.sendTransaction(assembled)
        if (sendResult.status === 'ERROR') {
          throw new Error(`Transaction rejected: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown'}`)
        }
        for (let i = 0; i < 30; i++) {
          const result = await rpcServer.getTransaction(sendResult.hash)
          if (result.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
            if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
              throw new Error(`Transaction failed: ${result.status}`)
            }
            break
          }
          await new Promise(r => setTimeout(r, 1_000))
        }
        setTxHash(sendResult.hash)
      }

      setStep('done')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMsg(
        msg.includes('NotAllowedError') || msg.includes('not allowed')
          ? 'Biometric verification was cancelled. Please try again.'
          : msg
      )
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
          Send
        </h2>

        {step === 'form' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Asset selector */}
            {assets.length > 1 && (
              <div>
                <label style={{ fontSize: '0.75rem', color: 'rgba(246,247,248,0.4)', display: 'block', marginBottom: '0.5rem', fontFamily: 'Anton, Impact, sans-serif', letterSpacing: '0.06em' }}>
                  ASSET
                </label>
                <select
                  value={selectedAsset?.code ?? ''}
                  onChange={e => setSelectedAsset(assets.find(a => a.code === e.target.value) ?? null)}
                  className="input-field"
                  style={{ fontFamily: 'Inconsolata, monospace', color: 'var(--off-white)', background: 'var(--surface)' }}
                >
                  {assets.map(a => (
                    <option key={`${a.code}-${a.issuer ?? 'native'}`} value={a.code}>
                      {a.code}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Recipient address */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label style={{ fontSize: '0.75rem', color: 'rgba(246,247,248,0.4)', fontFamily: 'Anton, Impact, sans-serif', letterSpacing: '0.06em' }}>
                  RECIPIENT ADDRESS
                </label>
                <button
                  onClick={() => setShowPicker(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gold)', fontSize: '0.75rem' }}
                >
                  Choose from contacts
                </button>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch' }}>
                <input
                  className="input-field mono"
                  type="text"
                  placeholder="G... or C..."
                  value={recipient}
                  onChange={e => setRecipient(e.target.value.trim())}
                  autoComplete="off"
                  spellCheck={false}
                  style={{ flex: 1 }}
                />
                {hasCamera && (
                  <button
                    type="button"
                    onClick={() => setShowScanner(true)}
                    aria-label="Scan QR code"
                    title="Scan recipient address from QR code"
                    style={{
                      background: 'var(--surface-md)', border: '1px solid var(--border-dim)',
                      borderRadius: '0.5rem', cursor: 'pointer',
                      color: 'var(--off-white)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      width: 44, flexShrink: 0,
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <rect x="2" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                      <rect x="12" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                      <rect x="2" y="12" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                      <rect x="4" y="4" width="2" height="2" fill="currentColor"/>
                      <rect x="14" y="4" width="2" height="2" fill="currentColor"/>
                      <rect x="4" y="14" width="2" height="2" fill="currentColor"/>
                      <path d="M12 12h2v2h-2zM14 14h2v2h-2zM16 12h2v2h-2zM12 16h4v2h-4z" fill="currentColor"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: 'rgba(246,247,248,0.4)', display: 'block', marginBottom: '0.5rem', fontFamily: 'Anton, Impact, sans-serif', letterSpacing: '0.06em' }}>
                AMOUNT{selectedAsset ? ` (${selectedAsset.code})` : ''}
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
                <Row label="To"      value={`${recipient.slice(0, 8)}...${recipient.slice(-8)}`} mono />
                <Row label="Amount"  value={`${amount} ${selectedAsset?.code ?? 'XLM'}`} />
                {memo && <Row label="Memo" value={memo} />}
                <Row label="Network" value="Stellar Testnet" />
                <Row label="Auth"    value="Passkey (WebAuthn)" />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button className="btn-gold" onClick={handleSend}>
                Confirm &amp; sign
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
            <p style={{ fontWeight: 500 }}>Waiting for passkey…</p>
            <p style={{ fontSize: '0.8125rem', color: 'rgba(246,247,248,0.4)', marginTop: '0.5rem' }}>
              Approve the prompt to authorise the transfer
            </p>
          </div>
        )}

        {step === 'done' && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center' }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: '0 auto' }}>
              <circle cx="20" cy="20" r="19" stroke="var(--teal)" strokeWidth="1.5"/>
              <path d="M13 20.5l5 5 9-9" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
              <circle cx="20" cy="20" r="19" stroke="var(--teal)" strokeWidth="1.5" opacity="0.5"/>
              <path d="M14 14l12 12M26 14l-12 12" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round"/>
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

      {showPicker && (
        <ContactPicker
          onSelect={contact => { setRecipient(contact.address); setShowPicker(false) }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {showScanner && (
        <QrScanner
          onScan={addr => { setRecipient(addr); setShowScanner(false) }}
          onClose={() => setShowScanner(false)}
        />
      )}
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
