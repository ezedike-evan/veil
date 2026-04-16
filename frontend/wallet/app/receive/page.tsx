'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { QRCodeCanvas } from 'qrcode.react'

export default function ReceivePage() {
  const router = useRouter()
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const qrRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem('invisible_wallet_address')
    if (!stored) { router.replace('/lock'); return }
    setWalletAddress(stored)
  }, [router])

  // ── Copy address ────────────────────────────────────────────────────────────
  const handleCopy = async () => {
    if (!walletAddress) return
    await navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Download QR as PNG ──────────────────────────────────────────────────────
  // QRCodeCanvas renders a <canvas> element — we grab it directly and trigger
  // a download without any server round-trip.
  const handleDownload = () => {
    if (!walletAddress || !qrRef.current) return
    setDownloading(true)

    const canvas = qrRef.current.querySelector('canvas')
    if (!canvas) { setDownloading(false); return }

    // Paint a white-padded version so the PNG looks nice when shared
    const pad = 24
    const out = document.createElement('canvas')
    out.width  = canvas.width  + pad * 2
    out.height = canvas.height + pad * 2
    const ctx = out.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(canvas, pad, pad)

    const link = document.createElement('a')
    link.download = `veil-address-${walletAddress.slice(0, 8)}.png`
    link.href = out.toDataURL('image/png')
    link.click()

    setDownloading(false)
  }

  // ── Web Share API ───────────────────────────────────────────────────────────
  // On mobile browsers (Chrome Android, Safari iOS) this opens the native
  // share sheet. On desktop it falls back gracefully to copy.
  const handleShare = async () => {
    if (!walletAddress) return

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'My Veil Wallet Address',
          text: walletAddress,
        })
      } catch {
        // User dismissed the share sheet — ignore
      }
      return
    }

    // Desktop fallback: copy to clipboard
    await navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const canShare = typeof navigator !== 'undefined' && !!navigator.share

  return (
    <div className="wallet-shell">
      <header className="wallet-nav">
        <button
          onClick={() => router.back()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--off-white)', display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.875rem' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>
        <span style={{
          fontFamily: 'Anton, Impact, sans-serif',
          fontSize: '1.25rem', letterSpacing: '0.08em',
          color: 'var(--gold)', userSelect: 'none',
        }}>
          VEIL
        </span>
      </header>

      <main className="wallet-main" style={{ paddingTop: '3rem', paddingBottom: '3rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

        <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
          <h1 style={{
            fontFamily: 'Lora, Georgia, serif', fontWeight: 600, fontStyle: 'italic',
            fontSize: '1.75rem', color: 'var(--off-white)', marginBottom: '0.375rem',
          }}>
            Receive
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'rgba(246,247,248,0.5)' }}>
            Share your address to receive XLM or any Stellar asset.
          </p>
        </div>

        {walletAddress ? (
          <>
            {/* QR code — rendered as <canvas> so we can export to PNG */}
            <div
              ref={qrRef}
              style={{
                background: '#ffffff',
                borderRadius: '1rem',
                padding: '1.25rem',
                marginBottom: '2rem',
                boxShadow: '0 0 0 1px var(--border-dim)',
              }}
            >
              <QRCodeCanvas
                value={walletAddress}
                size={220}
                bgColor="#ffffff"
                fgColor="#0F0F0F"
                level="M"
              />
            </div>

            {/* Address display */}
            <div className="card" style={{ width: '100%', marginBottom: '1.5rem', textAlign: 'center', padding: '1rem 1.25rem' }}>
              <p style={{ fontSize: '0.6875rem', fontFamily: 'Anton, Impact, sans-serif', letterSpacing: '0.08em', color: 'var(--warm-grey)', marginBottom: '0.625rem' }}>
                WALLET ADDRESS
              </p>
              <p style={{
                fontFamily: 'Inconsolata, monospace',
                fontSize: '0.8125rem',
                color: 'var(--off-white)',
                wordBreak: 'break-all',
                lineHeight: 1.6,
              }}>
                {walletAddress}
              </p>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', maxWidth: '20rem' }}>
              {/* Copy address */}
              <button className="btn-gold" onClick={handleCopy}>
                {copied ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2"/>
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                    Copy Address
                  </>
                )}
              </button>

              {/* Download QR as PNG */}
              <button
                className="btn-secondary flex justify-center items-center rounded-full bg-transparent hover:bg-gold text-white hover:text-black"
                onClick={handleDownload}
                disabled={downloading}
                style={{
                  gap: '0.5rem',
                  padding: '0.75rem 1.25rem', fontSize: '0.9375rem',
                  fontWeight: 600, cursor: downloading ? 'not-allowed' : 'pointer',
                  border: '1.5px solid var(--border-dim)',
                  opacity: downloading ? 0.6 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {downloading ? 'Saving…' : 'Download QR as PNG'}
              </button>

              {/* Share — shows native sheet on mobile, copies on desktop */}
              <button
                className="btn-secondary"
                onClick={handleShare}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                  padding: '0.75rem 1.25rem', borderRadius: '0.75rem', fontSize: '0.9375rem',
                  fontWeight: 600, cursor: 'pointer',
                  background: 'transparent',
                  border: '1.5px solid var(--border-dim)',
                  color: 'var(--off-white)',
                  transition: 'opacity 0.15s',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {canShare ? 'Share Address' : 'Copy to Share'}
              </button>

            </div>
          </>
        ) : (
          <div className="spinner spinner-light" style={{ width: '2rem', height: '2rem', marginTop: '4rem' }} />
        )}

      </main>
    </div>
  )
}