import {
  Horizon,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  BASE_FEE,
  rpc as SorobanRpc,
  Contract,
  Account,
  Keypair,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk'

const horizonUrl = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org'
const networkPassphrase = process.env.STELLAR_NETWORK === 'mainnet'
  ? Networks.PUBLIC
  : Networks.TESTNET

const horizon = new Horizon.Server(horizonUrl)

function parseAsset(assetStr: string): Asset {
  if (assetStr === 'XLM' || assetStr === 'native') return Asset.native()
  const [code, issuer] = assetStr.split(':')
  if (!issuer) throw new Error(`Asset "${assetStr}" must be "CODE:ISSUER" or "XLM"`)
  return new Asset(code, issuer)
}

export interface SwapInput {
  from_asset: string
  to_asset: string
  amount: number
  min_received?: number
  wallet_address: string
}

export interface PaymentInput {
  to_address: string
  asset: string
  amount: number
  wallet_address: string
  memo?: string
}

/**
 * Builds a path payment transaction (swap via SDEX best path).
 * Returns unsigned XDR — user must sign with passkey before submission.
 */
export async function buildSwap(input: SwapInput): Promise<string> {
  const account = await horizon.loadAccount(input.wallet_address)
  const sendAsset = parseAsset(input.from_asset)
  const destAsset = parseAsset(input.to_asset)
  const sendAmount = input.amount.toFixed(7)
  const destMin = (input.min_received ?? input.amount * 0.995).toFixed(7)

  const txBuilder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })

  // Auto-add trustline if the fee-payer account doesn't yet hold the destination asset
  const hasTrustline = destAsset.isNative() ||
    account.balances.some((b: any) =>
      b.asset_code === destAsset.getCode() && b.asset_issuer === destAsset.getIssuer(),
    )

  if (!hasTrustline) {
    txBuilder.addOperation(Operation.changeTrust({ asset: destAsset }))
  }

  txBuilder
    .addOperation(Operation.pathPaymentStrictSend({
      sendAsset,
      sendAmount,
      destination: input.wallet_address,
      destAsset,
      destMin,
      path: [],
    }))
    .setTimeout(180)

  return txBuilder.build().toXDR()
}

/**
 * Builds a simple payment transaction.
 * Returns unsigned XDR — user must sign with passkey before submission.
 */
export async function buildPayment(input: PaymentInput): Promise<string> {
  const account = await horizon.loadAccount(input.wallet_address)
  const asset = parseAsset(input.asset)
  const amount = input.amount.toFixed(7)

  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  }).addOperation(Operation.payment({
    destination: input.to_address,
    asset,
    amount,
  }))

  if (input.memo) {
    builder.addMemo({ type: 'text', value: input.memo } as any)
  }

  const tx = builder.setTimeout(180).build()
  return tx.toXDR()
}

/**
 * Fetch XLM + token balances.
 * @param feePayerAddress  G... classic account (Horizon)
 * @param contractAddress  C... Soroban wallet contract (Soroban RPC) — optional
 *
 * Returns balances with XLM split into:
 *   XLM_contract   — native XLM held in the smart wallet contract
 *   XLM_feepayer   — native XLM in the fee-payer classic account
 *   XLM            — combined total
 *   plus any token balances (e.g. USDC:ISSUER)
 */
export async function getBalances(
  feePayerAddress: string,
  contractAddress?: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}

  // ── 1. Fee-payer G... account via Horizon ────────────────────────────────
  const account = await horizon.loadAccount(feePayerAddress)
  let feePayerXlm = 0
  for (const balance of account.balances) {
    if (balance.asset_type === 'native') {
      feePayerXlm = parseFloat(balance.balance)
      result['XLM_feepayer'] = balance.balance
    } else {
      const key = `${(balance as any).asset_code}:${(balance as any).asset_issuer}`
      result[key] = balance.balance
    }
  }

  // ── 2. Smart wallet C... contract via Soroban RPC ────────────────────────
  let contractXlm = 0
  if (contractAddress) {
    try {
      const rpcUrl = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org'
      const rpc = new SorobanRpc.Server(rpcUrl)
      const sacAddress = Asset.native().contractId(networkPassphrase === Networks.PUBLIC ? 'Public Global Stellar Network ; September 2015' : networkPassphrase)
      const sacContract = new Contract(sacAddress)
      const dummyKp = Keypair.random()
      const dummyAcct = new Account(dummyKp.publicKey(), '0')
      const tx = new TransactionBuilder(dummyAcct, { fee: BASE_FEE, networkPassphrase })
        .addOperation(sacContract.call('balance', nativeToScVal(contractAddress, { type: 'address' })))
        .setTimeout(30)
        .build()
      const sim = await rpc.simulateTransaction(tx)
      if (!SorobanRpc.Api.isSimulationError(sim)) {
        const ret = (sim as SorobanRpc.Api.SimulateTransactionSuccessResponse).result
        if (ret) contractXlm = Number(scValToNative(ret.retval) as bigint) / 10_000_000
      }
      result['XLM_contract'] = contractXlm.toFixed(7)
    } catch { /* contract has no balance yet */ }
  }

  // ── 3. Combined XLM total ─────────────────────────────────────────────────
  result['XLM'] = (feePayerXlm + contractXlm).toFixed(7)

  return result
}
