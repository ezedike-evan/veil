import { signMessage, verifyMessage, SignedMessage } from '../signMessage';
import { WebAuthnSignature } from '../useInvisibleWallet';

// Helper: generate a real P-256 keypair, sign a hash, and return everything needed
async function generateSignedWebAuthnSig(hash: Uint8Array): Promise<{
    sig: WebAuthnSignature;
    credentialId: string;
    privateKey: CryptoKey;
    publicKey: CryptoKey;
    publicKeyBytes: Uint8Array;
    signatureBytes: Uint8Array;
}> {
    const kp = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
    );

    const rawPub = await crypto.subtle.exportKey('raw', kp.publicKey);
    const publicKeyBytes = new Uint8Array(rawPub);

    const sigBuf = await crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        kp.privateKey,
        hash.buffer as ArrayBuffer
    );
    const signatureBytes = new Uint8Array(sigBuf);

    const sig: WebAuthnSignature = {
        publicKey: publicKeyBytes,
        authData: new Uint8Array(37).fill(1),
        clientDataJSON: new Uint8Array(64).fill(2),
        signature: signatureBytes,
    };

    return {
        sig,
        credentialId: 'test-credential-id',
        privateKey: kp.privateKey,
        publicKey: kp.publicKey,
        publicKeyBytes,
        signatureBytes,
    };
}

describe('signMessage()', () => {
    it('sign → verify success (full round-trip)', async () => {
        const message = new TextEncoder().encode('hello veil');

        // We need to know the hash before signing, so compute it first
        const domainBytes = new TextEncoder().encode('VEIL_SIGNED_MESSAGE_V1\n');
        const payload = new Uint8Array(domainBytes.length + message.length);
        payload.set(domainBytes, 0);
        payload.set(message, domainBytes.length);
        const hashBuf = await crypto.subtle.digest('SHA-256', payload);
        const hash = new Uint8Array(hashBuf);

        const { sig, credentialId } = await generateSignedWebAuthnSig(hash);

        const mockSignAuthEntry = jest.fn().mockResolvedValue(sig);
        const signed = await signMessage(message, mockSignAuthEntry, credentialId);

        expect(signed.version).toBe(1);
        expect(signed.domain).toBe('VEIL_SIGNED_MESSAGE_V1');
        expect(signed.credentialId).toBe(credentialId);
        expect(signed.messageHash).toHaveLength(64); // 32 bytes hex

        const valid = await verifyMessage(message, signed);
        expect(valid).toBe(true);
    });

    it('modified message → verify returns false', async () => {
        const message = new TextEncoder().encode('hello veil');

        const domainBytes = new TextEncoder().encode('VEIL_SIGNED_MESSAGE_V1\n');
        const payload = new Uint8Array(domainBytes.length + message.length);
        payload.set(domainBytes, 0);
        payload.set(message, domainBytes.length);
        const hashBuf = await crypto.subtle.digest('SHA-256', payload);
        const hash = new Uint8Array(hashBuf);

        const { sig, credentialId } = await generateSignedWebAuthnSig(hash);
        const mockSignAuthEntry = jest.fn().mockResolvedValue(sig);
        const signed = await signMessage(message, mockSignAuthEntry, credentialId);

        const modified = new TextEncoder().encode('hello veil tampered');
        const valid = await verifyMessage(modified, signed);
        expect(valid).toBe(false);
    });

    it('modified signature → verify returns false', async () => {
        const message = new TextEncoder().encode('hello veil');

        const domainBytes = new TextEncoder().encode('VEIL_SIGNED_MESSAGE_V1\n');
        const payload = new Uint8Array(domainBytes.length + message.length);
        payload.set(domainBytes, 0);
        payload.set(message, domainBytes.length);
        const hashBuf = await crypto.subtle.digest('SHA-256', payload);
        const hash = new Uint8Array(hashBuf);

        const { sig, credentialId } = await generateSignedWebAuthnSig(hash);
        const mockSignAuthEntry = jest.fn().mockResolvedValue(sig);
        const signed = await signMessage(message, mockSignAuthEntry, credentialId);

        // Mutate one byte of the signature hex
        const sigHex = signed.signature;
        const mutated = sigHex.slice(0, -2) + (sigHex.slice(-2) === 'ff' ? '00' : 'ff');
        const tampered: SignedMessage = { ...signed, signature: mutated };

        const valid = await verifyMessage(message, tampered);
        expect(valid).toBe(false);
    });

    it('wrong credentialId → verify returns false (wrong cred in payload)', async () => {
        const message = new TextEncoder().encode('hello veil');

        const domainBytes = new TextEncoder().encode('VEIL_SIGNED_MESSAGE_V1\n');
        const payload = new Uint8Array(domainBytes.length + message.length);
        payload.set(domainBytes, 0);
        payload.set(message, domainBytes.length);
        const hashBuf = await crypto.subtle.digest('SHA-256', payload);
        const hash = new Uint8Array(hashBuf);

        const { sig, credentialId } = await generateSignedWebAuthnSig(hash);
        const mockSignAuthEntry = jest.fn().mockResolvedValue(sig);
        const signed = await signMessage(message, mockSignAuthEntry, credentialId);

        // Generate a second keypair and put its public key in the signed message
        const kp2 = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
        const rawPub2 = await crypto.subtle.exportKey('raw', kp2.publicKey);
        const pub2Hex = Array.from(new Uint8Array(rawPub2)).map(b => b.toString(16).padStart(2, '0')).join('');

        const wrongCred: SignedMessage = {
            ...signed,
            credentialId: 'different-credential-id',
            publicKey: pub2Hex, // different public key → verify will fail
        };

        const valid = await verifyMessage(message, wrongCred);
        expect(valid).toBe(false);
    });

    it('domain separation — "hello" and "VEIL_SIGNED_MESSAGE_V1\\nhello" produce different domain-separated hashes', async () => {
        // Compute domain-separated hash for two inputs independently
        const domainBytes = new TextEncoder().encode('VEIL_SIGNED_MESSAGE_V1\n');

        const computeHash = async (msg: Uint8Array) => {
            const payload = new Uint8Array(domainBytes.length + msg.length);
            payload.set(domainBytes, 0);
            payload.set(msg, domainBytes.length);
            const buf = await crypto.subtle.digest('SHA-256', payload);
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        };

        const msg1 = new TextEncoder().encode('hello');
        const msg2 = new TextEncoder().encode('VEIL_SIGNED_MESSAGE_V1\nhello');

        const hash1 = await computeHash(msg1);
        const hash2 = await computeHash(msg2);

        // Domain prefix shifts msg2's hash, so they must differ
        expect(hash1).not.toBe(hash2);
    });

    it('returns null from signAuthEntry → throws', async () => {
        // signAuthEntry returns null after hash is computed → error thrown
        const message = new TextEncoder().encode('hi');
        const domainBytes = new TextEncoder().encode('VEIL_SIGNED_MESSAGE_V1\n');
        const payload = new Uint8Array(domainBytes.length + message.length);
        payload.set(domainBytes, 0);
        payload.set(message, domainBytes.length);
        const hashBuf = await crypto.subtle.digest('SHA-256', payload);
        const hash = new Uint8Array(hashBuf);

        const { sig, credentialId } = await generateSignedWebAuthnSig(hash);
        // Replace with null-returning mock
        const nullMock = jest.fn().mockResolvedValue(null);

        await expect(signMessage(message, nullMock, credentialId)).rejects.toThrow('signAuthEntry returned null');
    });
});
