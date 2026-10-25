import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { SignatureVerifier } from '../../domain/updates/feed.ts';

/**
 * Verifies detached Ed25519 signatures with Node's built-in crypto. The browser carries
 * the current key and its successor, so keys can rotate without breaking installations.
 */
export class Ed25519Verifier implements SignatureVerifier {
  private readonly keys: readonly KeyObject[];

  /** @param publicKeys - Public keys in PEM format. */
  constructor(publicKeys: readonly string[]) {
    this.keys = publicKeys.map((pem) => createPublicKey(pem));
  }

  /** Whether any key is configured. */
  get hasKeys(): boolean {
    return this.keys.length > 0;
  }

  verify(data: string, signature: string): boolean {
    const bytes = Buffer.from(data, 'utf8');
    const signatureBytes = Buffer.from(signature, 'base64');
    return this.keys.some((key) => {
      try {
        return verify(null, bytes, key, signatureBytes);
      } catch {
        return false;
      }
    });
  }
}
