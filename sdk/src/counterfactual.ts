import { computeWalletAddress } from './utils';

export type CounterfactualConfig = {
    factoryAddress: string;
    wasmHash: string;
    networkPassphrase: string;
};

export type CounterfactualAddress = {
    address: string;
    publicKeyHex: string;
    derivedAt: number;
};

export function deriveCounterfactualAddress(
    publicKeyBytes: Uint8Array,
    config: CounterfactualConfig
): CounterfactualAddress {
    const address = computeWalletAddress(
        config.factoryAddress,
        publicKeyBytes,
        config.networkPassphrase
    );

    const hex = Array.from(publicKeyBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    return {
        address,
        publicKeyHex: hex,
        derivedAt: Date.now(),
    };
}
