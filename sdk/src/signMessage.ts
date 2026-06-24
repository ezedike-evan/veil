import { bufferToHex, hexToUint8Array } from './utils';
import type { WebAuthnSignature } from './useInvisibleWallet';

export type SignedMessage = {
    version: 1;
    domain: 'VEIL_SIGNED_MESSAGE_V1';
    messageHash: string;
    credentialId: string;
    signature: string;
    publicKey: string;
    authData: string;
    clientDataJSON: string;
};

const DOMAIN_BYTES = new TextEncoder().encode('VEIL_SIGNED_MESSAGE_V1\n');

async function domainSeparatedHash(message: Uint8Array): Promise<Uint8Array> {
    const payload = new Uint8Array(DOMAIN_BYTES.length + message.length);
    payload.set(DOMAIN_BYTES, 0);
    payload.set(message, DOMAIN_BYTES.length);
    const buf = await crypto.subtle.digest('SHA-256', payload);
    return new Uint8Array(buf);
}

export async function signMessage(
    message: Uint8Array,
    signAuthEntry: (payload: Uint8Array) => Promise<WebAuthnSignature | null>,
    credentialId: string
): Promise<SignedMessage> {
    const hash = await domainSeparatedHash(message);
    const sig = await signAuthEntry(hash);
    if (!sig) throw new Error('signAuthEntry returned null');
    return {
        version: 1,
        domain: 'VEIL_SIGNED_MESSAGE_V1',
        messageHash: bufferToHex(hash),
        credentialId,
        signature: bufferToHex(sig.signature),
        publicKey: bufferToHex(sig.publicKey),
        authData: bufferToHex(sig.authData),
        clientDataJSON: bufferToHex(sig.clientDataJSON),
    };
}

export async function verifyMessage(
    message: Uint8Array,
    signed: SignedMessage
): Promise<boolean> {
    try {
        const hash = await domainSeparatedHash(message);
        const expectedHash = bufferToHex(hash);
        if (expectedHash !== signed.messageHash) return false;

        const publicKeyBytes = hexToUint8Array(signed.publicKey);
        const signatureBytes = hexToUint8Array(signed.signature);

        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            publicKeyBytes.buffer.slice(publicKeyBytes.byteOffset, publicKeyBytes.byteOffset + publicKeyBytes.byteLength) as ArrayBuffer,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false,
            ['verify']
        );

        return await crypto.subtle.verify(
            { name: 'ECDSA', hash: { name: 'SHA-256' } },
            cryptoKey,
            signatureBytes.buffer.slice(signatureBytes.byteOffset, signatureBytes.byteOffset + signatureBytes.byteLength) as ArrayBuffer,
            hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer
        );
    } catch {
        return false;
    }
}
