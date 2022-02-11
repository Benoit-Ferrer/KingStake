import { Keypair, PublicKey } from '@solana/web3.js';

export function isKp(toCheck: PublicKey | Keypair) {
  return toCheck instanceof Keypair;
}
