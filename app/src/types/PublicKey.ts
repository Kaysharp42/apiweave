/**
 * Public key response from the key endpoint.
 *
 * Clients use this to encrypt secret values before POSTing.
 */
export interface PublicKey {
  keyId: string;
  publicKey: string;
  algorithm: string;
}
