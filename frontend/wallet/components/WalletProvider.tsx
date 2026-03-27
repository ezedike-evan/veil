'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { useInvisibleWallet } from '@veil/sdk'
import { Keypair } from 'stellar-sdk'

const TESTNET_CONFIG = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  factoryContractId: process.env.NEXT_PUBLIC_FACTORY_CONTRACT_ID ?? '',
  rpId: typeof window !== 'undefined' ? window.location.hostname : 'localhost',
  origin: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
}

interface WalletSession {
  address: string
  signerKeypair: Keypair
}

interface WalletContextValue {
  session: WalletSession | null
  setSession: (s: WalletSession | null) => void
  wallet: ReturnType<typeof useInvisibleWallet>
  clearSession: () => void
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<WalletSession | null>(null)

  const wallet = useInvisibleWallet({
    ...TESTNET_CONFIG,
    contractId: session?.address ?? '',
  })

  const setSession = useCallback((s: WalletSession | null) => {
    setSessionState(s)
  }, [])

  const clearSession = useCallback(() => {
    setSessionState(null)
  }, [])

  return (
    <WalletContext.Provider value={{ session, setSession, wallet, clearSession }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider')
  return ctx
}
