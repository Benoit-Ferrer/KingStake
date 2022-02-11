import { Connection, PublicKey } from "@solana/web3.js";
import { GemFarmClient } from "./gem-farm/gem-farm.client";
import { BN, Idl, Wallet } from "@project-serum/anchor";
import { programs } from "@metaplex/js";
import { stakingDefaults } from "../configs";

export class GemFarm extends GemFarmClient {
  constructor(conn: Connection, wallet: Wallet, farmIdl: Idl, bankIdl: Idl) {
    const farmProgId = stakingDefaults.gemFarmProgramId;
    const bankProgId = stakingDefaults.gemBankProgramId;
    super(conn, wallet, farmIdl, farmProgId, bankIdl, bankProgId);
  }

  async refreshFarmerWallet(farm: PublicKey, farmerIdentity: PublicKey) {
    const { tx } = await this.refreshFarmer(farm, farmerIdentity, undefined);
    return tx;
  }

  async initFarmerWallet(farm: PublicKey) {
    const { tx, vault } = await this.initFarmer(
      farm,
      this.wallet.publicKey,
      this.wallet.publicKey
    );

    return { tx, vault };
  }

  async stakeWallet(farm: PublicKey) {
    const { tx } = await this.stake(farm, this.wallet.publicKey);
    return tx;
  }

  async unstakeWallet(farm: PublicKey) {
    const { tx } = await this.unstake(farm, this.wallet.publicKey);
    return tx;
  }

  async claimWallet(
    farm: PublicKey,
    rewardAMint: PublicKey,
    rewardBMint: PublicKey
  ) {
    const { tx } = await this.claim(
      farm,
      this.wallet.publicKey,
      rewardAMint,
      rewardBMint
    );

    return tx;
  }

  async flashDepositWallet(
    farm: PublicKey,
    gemAmount: string,
    gemMint: PublicKey,
    gemSource: PublicKey,
    creator: PublicKey
  ) {
    const farmAcc = await this.fetchFarmAcc(farm);
    const bank = farmAcc.bank;

    const [mintProof] = await this.findWhitelistProofPDA(bank, gemMint);
    const [creatorProof] = await this.findWhitelistProofPDA(bank, creator);
    const metadata = await programs.metadata.Metadata.getPDA(gemMint);

    const { tx } = await this.flashDeposit(
      farm,
      this.wallet.publicKey,
      new BN(gemAmount),
      gemMint,
      gemSource,
      mintProof,
      metadata,
      creatorProof
    );

    return tx;
  }
}
