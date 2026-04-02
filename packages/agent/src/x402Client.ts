import type { Keypair } from '@stellar/stellar-sdk'

export interface FetchWithPaymentOptions {
  maxAutoPayUsdc?: number
}

/**
 * Creates an x402-aware fetch wrapper for the agent.
 * Attempts plain fetch first. If a 402 is returned AND @x402/stellar
 * is properly configured, handles the payment challenge and retries.
 * Falls back to plain fetch result if x402 setup is unavailable.
 */
export function createX402Fetch(_agentKeypair: Keypair, _options: FetchWithPaymentOptions = {}) {
  async function fetchWithPayment(url: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(url, init)

    // No payment required — return directly
    if (response.status !== 402) {
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`Request failed ${response.status}: ${text}`)
      }
      return response.json()
    }

    // 402 received — attempt x402 payment if available
    try {
      const { createEd25519Signer } = await import('@x402/stellar')
      const { ExactStellarScheme } = await import('@x402/stellar/exact/client')
      const { x402Client: CoreX402Client } = await import('@x402/core/client')

      const network = process.env.STELLAR_NETWORK === 'mainnet'
        ? 'stellar:pubnet'
        : 'stellar:testnet'

      const signer = createEd25519Signer(_agentKeypair.secret(), network as any)
      const scheme = new ExactStellarScheme(signer)
      const client = new CoreX402Client().register('stellar:*', scheme)

      const retryResponse = await client.fetch(url, init)
      if (!retryResponse.ok) {
        const text = await retryResponse.text()
        throw new Error(`x402 request failed ${retryResponse.status}: ${text}`)
      }
      return retryResponse.json()
    } catch (err) {
      // x402 payment failed — surface the error
      throw new Error(`Payment required and x402 failed: ${(err as Error).message}`)
    }
  }

  return { fetchWithPayment }
}
