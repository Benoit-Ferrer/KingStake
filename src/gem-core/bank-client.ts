import { GemBankClient } from "./gem-bank/gem-bank.client";
import { Connection, PublicKey } from "@solana/web3.js";
import { Idl, Wallet } from "@project-serum/anchor";
import { stakingDefaults } from "./../configs";
import BN from "bn.js";
import { programs } from "@metaplex/js";

export class GemBank extends GemBankClient {
  constructor(conn: Connection, wallet: Wallet, idl: Idl) {
    const programId = stakingDefaults.gemBankProgramId;
    super(conn, wallet, idl, programId);
  }

  async withdrawGemWallet(
    bank: PublicKey,
    vault: PublicKey,
    gemAmount: BN,
    gemMint: PublicKey
  ) {
    const { tx } = await this.withdrawGem(
      bank,
      vault,
      this.wallet.publicKey,
      gemAmount,
      gemMint,
      this.wallet.publicKey
    );

    return tx;
  }

  async depositGemWallet(
    bank: PublicKey,
    vault: PublicKey,
    gemAmount: BN,
    gemMint: PublicKey,
    gemSource: PublicKey,
    creator: PublicKey
  ) {
    const [mintProof] = await this.findWhitelistProofPDA(bank, gemMint);
    const [creatorProof] = await this.findWhitelistProofPDA(bank, creator);
    const metadata = await programs.metadata.Metadata.getPDA(gemMint);

    return this.depositGem(
      bank,
      vault,
      this.wallet.publicKey,
      gemAmount,
      gemMint,
      gemSource,
      mintProof,
      metadata,
      creatorProof
    );
  }
}
