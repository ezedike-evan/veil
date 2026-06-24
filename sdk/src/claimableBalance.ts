import {
    Keypair,
    TransactionBuilder,
    BASE_FEE,
    Operation,
    Asset,
    Claimant,
    Horizon,
} from '@stellar/stellar-sdk';

export type EscrowConfig = {
    rpcUrl: string;
    networkPassphrase: string;
};

export type CreateEscrowOptions = {
    senderKeypair: Keypair;
    recipientAddress: string;
    amount: string;
    asset: Asset;
    claimDeadlineSeconds: number;
    config: EscrowConfig;
};

export type EscrowResult = {
    balanceId: string;
    claimLink: string;
    expiresAt: number;
};

export type ClaimOptions = {
    claimantKeypair: Keypair;
    balanceId: string;
    config: EscrowConfig;
};

export type ReclaimOptions = {
    senderKeypair: Keypair;
    balanceId: string;
    config: EscrowConfig;
};

export function buildClaimLink(balanceId: string): string {
    return `https://app.veil.xyz/claim/${balanceId}`;
}

export function buildEscrowClaimants(
    recipientAddress: string,
    senderAddress: string,
    deadlineUnix: number
): Claimant[] {
    const recipientClaimant = new Claimant(recipientAddress, Claimant.predicateUnconditional());
    const senderClaimant = new Claimant(
        senderAddress,
        Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime(deadlineUnix.toString()))
    );
    return [recipientClaimant, senderClaimant];
}

export async function createEscrow(options: CreateEscrowOptions): Promise<EscrowResult> {
    const { senderKeypair, recipientAddress, amount, asset, claimDeadlineSeconds, config } = options;
    const server = new Horizon.Server(config.rpcUrl);

    const account = await server.loadAccount(senderKeypair.publicKey());
    const expiresAt = Math.floor(Date.now() / 1000) + claimDeadlineSeconds;

    const claimants = buildEscrowClaimants(recipientAddress, senderKeypair.publicKey(), expiresAt);

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: config.networkPassphrase,
    })
        .addOperation(
            Operation.createClaimableBalance({
                asset,
                amount,
                claimants,
            })
        )
        .setTimeout(180)
        .build();

    tx.sign(senderKeypair);

    const result = await server.submitTransaction(tx);
    const balanceId = (result as unknown as { balance_id?: string }).balance_id;
    if (!balanceId) {
        throw new Error('create_claimable_balance: missing balance_id in Horizon response');
    }

    return {
        balanceId,
        claimLink: buildClaimLink(balanceId),
        expiresAt,
    };
}

export async function claimEscrow(options: ClaimOptions): Promise<{ txHash: string }> {
    const { claimantKeypair, balanceId, config } = options;
    const server = new Horizon.Server(config.rpcUrl);

    const account = await server.loadAccount(claimantKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: config.networkPassphrase,
    })
        .addOperation(Operation.claimClaimableBalance({ balanceId }))
        .setTimeout(180)
        .build();

    tx.sign(claimantKeypair);

    const result = await server.submitTransaction(tx);
    return { txHash: result.hash };
}

export async function reclaimEscrow(options: ReclaimOptions): Promise<{ txHash: string }> {
    const { senderKeypair, balanceId, config } = options;
    const server = new Horizon.Server(config.rpcUrl);

    const account = await server.loadAccount(senderKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: config.networkPassphrase,
    })
        .addOperation(Operation.claimClaimableBalance({ balanceId }))
        .setTimeout(180)
        .build();

    tx.sign(senderKeypair);

    const result = await server.submitTransaction(tx);
    return { txHash: result.hash };
}
