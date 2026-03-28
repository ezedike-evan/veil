'use client'

import { useEffect, useRef, useState } from 'react'

interface QrScannerProps {
  onScan: (address: string) => void
  onClose: () => void
}

// BarcodeDetector is not yet in the standard TS lib — declare minimally.
interface BarcodeDetectorResult {
  rawValue: string
}
interface BarcodeDetectorApi {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>
}
declare const BarcodeDetector: {
  new(options: { formats: string[] }): BarcodeDetectorApi
}

export function QrScanner({ onScan, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let animFrame = 0
    let stopped = false

    function stop() {
      stopped = true
      cancelAnimationFrame(animFrame)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream

        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()

        if (!('BarcodeDetector' in window)) {
          setError('QR scanning requires a Chromium-based browser (Chrome 88+, Edge 88+).')
          return
        }

        const detector = new BarcodeDetector({ formats: ['qr_code'] })

        async function scan() {
          if (stopped || !video) return
          try {
            const codes = await detector.detect(video)
            for (const code of codes) {
              const addr = code.rawValue.trim()
              if (addr.startsWith('G') && addr.length === 56) {
                stop()
                onScan(addr)
                return
              }
            }
          } catch { /* transient detection errors are expected */ }
          animFrame = requestAnimationFrame(scan)
        }

        animFrame = requestAnimationFrame(scan)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg.includes('Permission') || msg.includes('NotAllowed')
          ? 'Camera access denied. Allow camera in browser settings.'
          : msg)
      }
    }

    start()
    return stop
  }, [onScan])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(15,15,15,0.95)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div style={{ width: '100%', maxWidth: 360 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <span style={{
            fontFamily: 'Lora, Georgia, serif', fontWeight: 600, fontStyle: 'italic',
            fontSize: '1.125rem', color: 'var(--off-white)',
          }}>
            Scan Recipient QR
          </span>
          <button
            onClick={onClose}
            aria-label="Close scanner"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--off-white)', fontSize: '1.5rem', lineHeight: 1, padding: '0.25rem',
            }}
          >
            ×
          </button>
        </div>

        {/* Video viewfinder */}
        <div style={{
          position: 'relative', borderRadius: '0.75rem', overflow: 'hidden',
          background: '#000', aspectRatio: '1',
        }}>
          <video
            ref={videoRef}
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          {/* Corner-bracket viewfinder overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{ position: 'relative', width: 200, height: 200 }}>
              {(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const).map(corner => (
                <CornerBracket key={corner} corner={corner} />
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <p style={{
            marginTop: '0.875rem', fontSize: '0.8125rem',
            color: 'rgba(246,247,248,0.6)', textAlign: 'center',
          }}>
            {error}
          </p>
        ) : (
          <p style={{
            marginTop: '0.875rem', fontSize: '0.75rem',
            color: 'rgba(246,247,248,0.35)', textAlign: 'center',
          }}>
            Point camera at a Stellar address QR code
          </p>
        )}

        <button
          className="btn-ghost"
          onClick={onClose}
          style={{ marginTop: '1.25rem', width: '100%' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'

function CornerBracket({ corner }: { corner: Corner }) {
  const size = 20
  const thickness = 2
  const color = 'var(--gold)'

  const styles: Record<Corner, React.CSSProperties> = {
    topLeft:     { top: 0, left: 0, borderTop: `${thickness}px solid ${color}`, borderLeft: `${thickness}px solid ${color}` },
    topRight:    { top: 0, right: 0, borderTop: `${thickness}px solid ${color}`, borderRight: `${thickness}px solid ${color}` },
    bottomLeft:  { bottom: 0, left: 0, borderBottom: `${thickness}px solid ${color}`, borderLeft: `${thickness}px solid ${color}` },
    bottomRight: { bottom: 0, right: 0, borderBottom: `${thickness}px solid ${color}`, borderRight: `${thickness}px solid ${color}` },
  }

  return (
    <div style={{
      position: 'absolute',
      width: size, height: size,
      borderRadius: 2,
      ...styles[corner],
    }} />
  )
}
