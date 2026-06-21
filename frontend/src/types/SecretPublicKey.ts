export interface SecretPublicKey {
  keyId: string;
  publicKey: string;
  algorithm: "libsodium-sealed-box";
}
