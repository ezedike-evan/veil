'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useInactivityLock } from '@/hooks/useInactivityLock'
import { requirePasskey } from '@/lib/passkeyAuth'

interface Message {
  role: 'user' | 'agent'
  content: string
  pendingTxXdr?: string
  pendingTxSummary?: string
}

const SUGGESTIONS = [
  "What's my balance?",
  'Swap 100 XLM to USDC',
  'Show recent transfers',
  'Best XLM/USDC rate?',
]

export default function AgentPage() {
  const router = useRouter()
  useInactivityLock()

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'agent',
      content:
        "Hey! I'm your Veil agent. I can check prices, view transfer history, and execute swaps — all with your approval. What would you like to do?",
    },
  ])
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [pendingTxXdr, setPendingTxXdr] = useState<string | null>(null)
  const [pendingTxSummary, setPendingTxSummary] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const walletAddress =
    typeof window !== 'undefined'
      ? (sessionStorage.getItem('invisible_wallet_address') ?? '')
      : ''

  // Derive fee-payer G... address from stored signer secret for balance queries
  const feePayerAddress = (() => {
    if (typeof window === 'undefined') return ''
    try {
      const secret = sessionStorage.getItem('veil_signer_secret')
        ?? localStorage.getItem('veil_signer_secret')
      if (!secret) return ''
      // Dynamically import would be async — use cached public key instead
      return localStorage.getItem('veil_signer_public_key') ?? ''
    } catch { return '' }
  })()

  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    const wsUrl = process.env.NEXT_PUBLIC_AGENT_WS_URL ?? 'ws://localhost:3001'
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onclose = () => {
      reconnectTimer.current = setTimeout(connect, 2000)
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.type === 'thinking') {
        setIsThinking(true)
        return
      }

      if (data.type === 'response') {
        setIsThinking(false)
        const msg: Message = { role: 'agent', content: data.message }
        if (data.pendingTxXdr) {
          msg.pendingTxXdr = data.pendingTxXdr
          msg.pendingTxSummary = data.pendingTxSummary
          setPendingTxXdr(data.pendingTxXdr)
          setPendingTxSummary(data.pendingTxSummary ?? null)
        }
        setMessages((prev) => [...prev, msg])
        return
      }

      if (data.type === 'error') {
        setIsThinking(false)
        setMessages((prev) => [
          ...prev,
          { role: 'agent', content: `Something went wrong: ${data.message}` },
        ])
      }
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  const sendMessage = useCallback(() => {
    const text = input.trim()
    if (!text || isThinking || !wsRef.current) return

    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')

    // If fee-payer key was cleared (cache clear), warn the user before sending
    if (!feePayerAddress) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'agent',
          content:
            'Your signing key is missing — this usually happens after clearing browser storage.\n\nGo to the **Dashboard** and tap **Set up fee-payer** to restore it, then come back and try again.',
        },
      ])
      return
    }

    wsRef.current.send(
      JSON.stringify({ type: 'chat', walletAddress, feePayerAddress, message: text }),
    )
  }, [input, isThinking, walletAddress, feePayerAddress])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const approveTransaction = async () => {
    if (!pendingTxXdr) return
    const xdrToSubmit = pendingTxXdr
    setApproving(true)
    // Remove the approval card immediately so it can't be double-submitted
    setMessages((prev) =>
      prev.map((m) =>
        m.pendingTxXdr === xdrToSubmit
          ? { ...m, pendingTxXdr: undefined, pendingTxSummary: undefined }
          : m,
      ),
    )
    setPendingTxXdr(null)
    setPendingTxSummary(null)
    try {
      // Require biometric / passkey approval before signing
      await requirePasskey()

      const signerSecret =
        sessionStorage.getItem('veil_signer_secret') ??
        localStorage.getItem('veil_signer_secret')

      if (!signerSecret) {
        setMessages((prev) => [
          ...prev,
          { role: 'agent', content: 'Signing key not found. Please return to the dashboard first.' },
        ])
        return
      }

      const { Keypair, TransactionBuilder, Horizon } = await import('@stellar/stellar-sdk')
      const horizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL ?? 'https://horizon-testnet.stellar.org'
      const networkPassphrase =
        process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015'

      const feePayer = Keypair.fromSecret(signerSecret)
      const horizonServer = new Horizon.Server(horizonUrl)

      const tx = TransactionBuilder.fromXDR(xdrToSubmit, networkPassphrase)
      tx.sign(feePayer)

      const result = await horizonServer.submitTransaction(tx)

      setMessages((prev) => [
        ...prev,
        {
          role: 'agent',
          content: `Transaction submitted.\n\nHash: \`${result.hash}\`\n\nSettles in ~5 seconds.`,
        },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'agent', content: `Transaction failed: ${(err as Error).message}` },
      ])
    } finally {
      setApproving(false)
    }
  }

  const clearHistory = () => {
    if (!walletAddress || !wsRef.current) return
    wsRef.current.send(JSON.stringify({ type: 'clear_history', walletAddress }))
    setMessages([{ role: 'agent', content: 'History cleared. How can I help you?' }])
  }

  return (
    <div className="wallet-shell">
      {/* Header */}
      <header className="wallet-nav">
        <button
          onClick={() => router.back()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', color: 'var(--warm-grey)', display: 'flex' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <div style={{
            width: '2rem', height: '2rem', borderRadius: '50%',
            background: 'rgba(253,218,36,0.12)',
            border: '1px solid rgba(253,218,36,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4zm0 10c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--off-white)' }}>Veil Agent</div>
            <div style={{ fontSize: '0.6875rem', color: 'var(--warm-grey)' }}>Powered by Claude · x402 enabled</div>
          </div>
        </div>

        <button
          onClick={clearHistory}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', color: 'var(--warm-grey)', display: 'flex' }}
          title="Clear history"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M3 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </header>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '82%',
              minWidth: 0,
              padding: '0.75rem 1rem',
              borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: msg.role === 'user'
                ? 'rgba(253,218,36,0.12)'
                : 'var(--surface-md)',
              border: `1px solid ${msg.role === 'user' ? 'rgba(253,218,36,0.22)' : 'var(--border-dim)'}`,
              fontSize: '0.875rem',
              lineHeight: 1.6,
              color: 'var(--off-white)',
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
            }}>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}
                dangerouslySetInnerHTML={{ __html: msg.content
                  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                  .replace(/`(.+?)`/g, '<code style="font-family:Inconsolata,monospace;background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:4px;font-size:0.8125rem">$1</code>')
                }}
              />

              {/* Transaction approval card */}
              {msg.pendingTxXdr && (
                <div style={{
                  marginTop: '0.875rem',
                  padding: '0.875rem',
                  background: 'rgba(253,218,36,0.06)',
                  border: '1px solid rgba(253,218,36,0.2)',
                  borderRadius: '12px',
                }}>
                  <div style={{ fontSize: '0.6875rem', fontFamily: 'Anton, Impact, sans-serif', letterSpacing: '0.08em', color: 'var(--warm-grey)', marginBottom: '0.5rem' }}>
                    TRANSACTION READY
                  </div>
                  {msg.pendingTxSummary && (
                    <div style={{ fontSize: '0.8125rem', color: 'var(--off-white)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                      {msg.pendingTxSummary}
                    </div>
                  )}
                  <button
                    onClick={approveTransaction}
                    disabled={approving}
                    className="btn-gold"
                    style={{ fontSize: '0.875rem', padding: '0.625rem 1.25rem' }}
                  >
                    {approving ? (
                      <>
                        <span className="spinner" style={{ width: '14px', height: '14px' }} />
                        Verifying…
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke="currentColor" strokeWidth="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        Approve &amp; Submit
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Thinking dots */}
        {isThinking && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '18px 18px 18px 4px',
              background: 'var(--surface-md)',
              border: '1px solid var(--border-dim)',
              display: 'flex', alignItems: 'center', gap: '5px',
            }}>
              {[0, 150, 300].map((delay) => (
                <span key={delay} style={{
                  width: '6px', height: '6px',
                  borderRadius: '50%',
                  background: 'var(--gold)',
                  display: 'inline-block',
                  animation: `bounce 1.2s ${delay}ms ease-in-out infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={{
        borderTop: '1px solid var(--border-dim)',
        padding: '0.875rem 1.25rem 1.5rem',
        background: 'rgba(15,15,15,0.9)',
        backdropFilter: 'blur(12px)',
      }}>
        {/* Suggestion chips */}
        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.75rem', scrollbarWidth: 'none' }}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => { setInput(s); inputRef.current?.focus() }}
              style={{
                flexShrink: 0,
                fontSize: '0.75rem',
                padding: '0.375rem 0.875rem',
                background: 'var(--surface)',
                border: '1px solid var(--border-dim)',
                borderRadius: '100px',
                color: 'var(--warm-grey)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'border-color 120ms, color 120ms',
              }}
              onMouseEnter={e => { (e.target as HTMLElement).style.color = 'var(--off-white)'; (e.target as HTMLElement).style.borderColor = 'rgba(253,218,36,0.3)' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.color = 'var(--warm-grey)'; (e.target as HTMLElement).style.borderColor = 'var(--border-dim)' }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Input row */}
        <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything…"
            disabled={isThinking}
            className="input-field"
            style={{ flex: 1 }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isThinking}
            style={{
              flexShrink: 0,
              width: '44px', height: '44px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: !input.trim() || isThinking ? 'rgba(253,218,36,0.3)' : 'var(--gold)',
              color: 'var(--near-black)',
              border: 'none', borderRadius: '12px',
              cursor: !input.trim() || isThinking ? 'not-allowed' : 'pointer',
              transition: 'background 120ms',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
