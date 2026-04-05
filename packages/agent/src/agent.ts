import Anthropic from '@anthropic-ai/sdk'
import { Keypair } from '@stellar/stellar-sdk'
import { createX402Fetch } from './x402Client.js'
import { buildSwap, buildPayment, getBalances } from './txBuilder.js'

const client = new Anthropic()

const tools: Anthropic.Tool[] = [
  {
    name: 'get_price',
    description:
      'Get the current best price and swap route for an asset pair on Stellar. ' +
      'Returns VWAP, SDEX price, AMM price, 24h volume, and best execution route. ' +
      'Costs a small USDC fee via x402 micropayment (auto-paid).',
    input_schema: {
      type: 'object' as const,
      properties: {
        asset_a: { type: 'string', description: 'First asset: "XLM" or "CODE:ISSUER"' },
        asset_b: { type: 'string', description: 'Second asset: "XLM" or "CODE:ISSUER"' },
      },
      required: ['asset_a', 'asset_b'],
    },
  },
  {
    name: 'get_transfer_history',
    description:
      'Get recent transfer history for a wallet — includes both classic Stellar payments (XLM sends/receives) ' +
      'and Soroban token transfers. Returns classicPayments from Horizon and sorobanTransfers from Wraith.',
    input_schema: {
      type: 'object' as const,
      properties: {
        address: { type: 'string', description: 'Stellar wallet address (G...)' },
        direction: { type: 'string', enum: ['incoming', 'outgoing', 'both'] },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['address', 'direction'],
    },
  },
  {
    name: 'get_wallet_balance',
    description: 'Get current XLM and token balances for a wallet address. Free.',
    input_schema: {
      type: 'object' as const,
      properties: {
        address: { type: 'string', description: 'Stellar wallet address (G...)' },
      },
      required: ['address'],
    },
  },
  {
    name: 'build_swap',
    description:
      'Build a Stellar path payment transaction to swap one asset for another at the best available rate. ' +
      'ALWAYS call get_price first, and ALWAYS call request_user_approval after building — never execute without approval.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from_asset: { type: 'string', description: '"XLM" or "CODE:ISSUER"' },
        to_asset: { type: 'string', description: '"XLM" or "CODE:ISSUER"' },
        amount: { type: 'number', description: 'Amount of from_asset to swap' },
        min_received: {
          type: 'number',
          description: 'Minimum to_asset to accept for slippage protection. Default: amount * estimated_price * 0.995',
        },
        wallet_address: { type: 'string' },
      },
      required: ['from_asset', 'to_asset', 'amount', 'wallet_address'],
    },
  },
  {
    name: 'build_payment',
    description:
      'Build a Stellar payment transaction to send XLM or tokens. ' +
      'ALWAYS call request_user_approval after building.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to_address: { type: 'string', description: 'Recipient Stellar address (G...)' },
        asset: { type: 'string', description: '"XLM" or "CODE:ISSUER"' },
        amount: { type: 'number' },
        wallet_address: { type: 'string' },
        memo: { type: 'string', description: 'Optional text memo' },
      },
      required: ['to_address', 'asset', 'amount', 'wallet_address'],
    },
  },
  {
    name: 'request_user_approval',
    description:
      'ALWAYS call this before any transaction executes. ' +
      'Sends the transaction to the wallet UI for passkey (biometric) approval. ' +
      'The user must approve with Face ID / fingerprint before the tx is submitted.',
    input_schema: {
      type: 'object' as const,
      properties: {
        transaction_xdr: { type: 'string', description: 'Unsigned transaction XDR (base64)' },
        summary: {
          type: 'string',
          description: 'Plain English: what this transaction does, amounts, assets, recipient',
        },
        estimated_fee_xlm: { type: 'number', description: 'Estimated network fee in XLM' },
      },
      required: ['transaction_xdr', 'summary'],
    },
  },
]

const SYSTEM_PROMPT = (walletAddress: string, feePayerAddress: string) => `\
You are a helpful AI agent embedded in the Veil passkey smart wallet on Stellar.

The user's wallet contract address is: ${walletAddress}
The user's fee-payer address (use this as wallet_address in ALL build_swap and build_payment calls): ${feePayerAddress}

You help users:
- Check their balance and recent transfers
- Get live prices and swap routes (SDEX vs AMM)
- Execute swaps and payments — always with biometric approval

RULES:
1. Before recommending any swap, call get_price to get the live rate.
2. Before executing any transaction, ALWAYS call request_user_approval — never skip this.
3. For swaps, set min_received = estimated_output * 0.995 (0.5% slippage) unless user specifies otherwise.
4. Inform the user when a small x402 micropayment is being auto-paid to fetch data.
5. Format amounts clearly: "500 XLM", "47.3 USDC".
6. If you need a recipient address and the user hasn't provided one, ask before building.
7. Keep responses concise. Use bullet points for multi-step flows.
8. Always use the fee-payer address (not the contract address) as wallet_address when calling build_swap or build_payment.`

export interface AgentResult {
  response: string
  pendingTxXdr?: string
  pendingTxSummary?: string
}

export async function runAgent(
  userMessage: string,
  walletAddress: string,
  agentKeypair: Keypair,
  conversationHistory: Anthropic.MessageParam[] = [],
  feePayerAddress?: string,
): Promise<AgentResult> {
  const { fetchWithPayment } = createX402Fetch(agentKeypair)
  let pendingTxXdr: string | undefined
  let pendingTxSummary: string | undefined

  async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'get_price': {
        const url = `${process.env.ORACLE_URL}/price/${input.asset_a}/${input.asset_b}`
        const data = await fetchWithPayment(url)
        return JSON.stringify(data)
      }

      case 'get_transfer_history': {
        const limit = (input.limit as number | undefined) ?? 10
        const horizonUrl = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org'

        // Use fee-payer G... address for Horizon (can't query C... contract on Horizon)
        const horizonAddr = feePayerAddress ?? (input.address as string)

        // Fetch Soroban token transfers from Wraith + classic payments from Horizon in parallel
        const [wraithResult, horizonResult] = await Promise.allSettled([
          fetchWithPayment(
            `${process.env.WRAITH_URL}/transfers/address/${input.address}?direction=${input.direction}&limit=${limit}`,
          ),
          fetch(`${horizonUrl}/accounts/${horizonAddr}/payments?limit=${limit}&order=desc`)
            .then(r => r.json()),
        ])

        const sorobanTransfers = wraithResult.status === 'fulfilled' ? wraithResult.value : []
        const classicPayments = horizonResult.status === 'fulfilled'
          ? (horizonResult.value as any)?._embedded?.records ?? []
          : []

        return JSON.stringify({ sorobanTransfers, classicPayments })
      }

      case 'get_wallet_balance': {
        // Fee-payer G... for Horizon; walletAddress C... for Soroban RPC contract XLM
        const fpAddress = feePayerAddress ?? (input.address as string)
        const contractAddr = walletAddress?.startsWith('C') ? walletAddress : undefined
        const balances = await getBalances(fpAddress, contractAddr)
        return JSON.stringify(balances)
      }

      case 'build_swap': {
        const swapInput = {
          ...(input as unknown as Parameters<typeof buildSwap>[0]),
          wallet_address: feePayerAddress ?? (input as any).wallet_address,
        }
        const xdr = await buildSwap(swapInput)
        return JSON.stringify({ transaction_xdr: xdr, status: 'built' })
      }

      case 'build_payment': {
        const payInput = {
          ...(input as unknown as Parameters<typeof buildPayment>[0]),
          wallet_address: feePayerAddress ?? (input as any).wallet_address,
        }
        const xdr = await buildPayment(payInput)
        return JSON.stringify({ transaction_xdr: xdr, status: 'built' })
      }

      case 'request_user_approval': {
        pendingTxXdr = input.transaction_xdr as string
        pendingTxSummary = input.summary as string
        return JSON.stringify({ status: 'awaiting_approval' })
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  }

  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ]

  let response = await client.messages.create({
    model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT(walletAddress, feePayerAddress ?? walletAddress),
    tools,
    messages,
  })

  // Agentic loop — keep going until no more tool calls
  while (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const toolUse of toolUseBlocks) {
      let content: string
      try {
        content = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>)
      } catch (err) {
        content = JSON.stringify({ error: (err as Error).message })
      }
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content })
    }

    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })

    response = await client.messages.create({
      model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT(walletAddress, feePayerAddress ?? walletAddress),
      tools,
      messages,
    })
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')

  return { response: text, pendingTxXdr, pendingTxSummary }
}
