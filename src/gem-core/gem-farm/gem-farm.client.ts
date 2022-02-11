import * as anchor from '@project-serum/anchor';
import {BN, Idl, Wallet} from '@project-serum/anchor';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {Connection} from '@metaplex/js';
import { isKp } from '../gem-common/types';
import { GemBankClient, WhitelistType } from '../gem-bank/gem-bank.client';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {GemFarm} from "../types/gem_farm";

//acts as an enum
export const RewardType = {
  Variable: { variable: {} },
  Fixed: { fixed: {} },
};

export interface FarmConfig {
  minStakingPeriodSec: BN;
  cooldownPeriodSec: BN;
  unstakingFeeLamp: BN;
}

export interface TierConfig {
  rewardRate: BN;
  requiredTenure: BN;
}

export interface FixedRateSchedule {
  baseRate: BN;
  tier1: TierConfig | null;
  tier2: TierConfig | null;
  tier3: TierConfig | null;
  denominator: BN;
}

export interface FixedRateConfig {
  schedule: FixedRateSchedule;
  amount: BN;
  durationSec: BN;
}

export interface VariableRateConfig {
  amount: BN;
  durationSec: BN;
}

export interface RarityConfig {
  mint: PublicKey;
  rarityPoints: number;
}

export class GemFarmClient extends GemBankClient {
  farmProgram!: anchor.Program<GemFarm>;

  constructor(
    conn: Connection,
    wallet: Wallet,
    farmIdl?: Idl,
    farmProgramId?: PublicKey,
    bankIdl?: Idl,
    bankProgramId?: PublicKey
  ) {
    super(conn, wallet, bankIdl, bankProgramId);
    this.setFarmProgram(farmIdl, farmProgramId);
  }

  setFarmProgram(idl?: Idl, programId?: PublicKey) {
    //instantiating program depends on the environment
    if (idl && programId) {
      //means running in prod
      this.farmProgram = new anchor.Program<GemFarm>(
        idl as any,
        programId,
        this.provider
      );
    } else {
      //means running inside test suite
      //this.farmProgram = anchor.workspace.GemFarm as Program<GemFarm>;
    }
  }

  // --------------------------------------- fetch deserialized accounts

  async fetchFarmAcc(farm: PublicKey) {
    return this.farmProgram.account.farm.fetch(farm);
  }

  async fetchFarmerAcc(farmer: PublicKey) {
    return this.farmProgram.account.farmer.fetch(farmer);
  }

  async fetchAuthorizationProofAcc(authorizationProof: PublicKey) {
    return this.farmProgram.account.authorizationProof.fetch(
      authorizationProof
    );
  }

  async fetchTokenAcc(rewardMint: PublicKey, rewardAcc: PublicKey) {
    return this.deserializeTokenAccount(rewardMint, rewardAcc);
  }

  async fetchTreasuryBalance(farm: PublicKey) {
    const [treasury] = await this.findFarmTreasuryPDA(farm);
    return this.getBalance(treasury);
  }

  // --------------------------------------- find PDA addresses

  async findFarmerPDA(farm: PublicKey, identity: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [
      'farmer',
      farm,
      identity,
    ]);
  }

  async findFarmAuthorityPDA(farm: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [farm]);
  }

  async findFarmTreasuryPDA(farm: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [
      'treasury',
      farm,
    ]);
  }

  async findAuthorizationProofPDA(farm: PublicKey, funder: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [
      'authorization',
      farm,
      funder,
    ]);
  }

  async findRewardsPotPDA(farm: PublicKey, rewardMint: PublicKey) {
    return this.findProgramAddress(this.farmProgram.programId, [
      'reward_pot',
      farm,
      rewardMint,
    ]);
  }

  // --------------------------------------- get all PDAs by type
  //https://project-serum.github.io/anchor/ts/classes/accountclient.html#all

  async fetchAllFarmPDAs(manager?: PublicKey) {
    const filter = manager
      ? [
          {
            memcmp: {
              offset: 10, //need to prepend 8 bytes for anchor's disc
              bytes: manager.toBase58(),
            },
          },
        ]
      : [];
    const pdas = await this.farmProgram.account.farm.all(filter);
    return pdas;
  }

  async fetchAllFarmerPDAs(farm?: PublicKey, identity?: PublicKey) {
    const filter: any = [];
    if (farm) {
      filter.push({
        memcmp: {
          offset: 8, //need to prepend 8 bytes for anchor's disc
          bytes: farm.toBase58(),
        },
      });
    }
    if (identity) {
      filter.push({
        memcmp: {
          offset: 40, //need to prepend 8 bytes for anchor's disc
          bytes: identity.toBase58(),
        },
      });
    }
    const pdas = await this.farmProgram.account.farmer.all(filter);
    return pdas;
  }

  async fetchAllAuthProofPDAs(farm?: PublicKey, funder?: PublicKey) {
    const filter: any = [];
    if (farm) {
      filter.push({
        memcmp: {
          offset: 40, //need to prepend 8 bytes for anchor's disc
          bytes: farm.toBase58(),
        },
      });
    }
    if (funder) {
      filter.push({
        memcmp: {
          offset: 8, //need to prepend 8 bytes for anchor's disc
          bytes: funder.toBase58(),
        },
      });
    }
    const pdas = await this.farmProgram.account.authorizationProof.all(filter);
    return pdas;
  }

  // --------------------------------------- core ixs

  async initFarm(
    farm: Keypair,
    farmManager: PublicKey | Keypair,
    payer: PublicKey | Keypair,
    bank: Keypair,
    rewardAMint: PublicKey,
    rewardAType: any, //RewardType instance
    rewardBMint: PublicKey,
    rewardBType: any, //RewardType instance
    farmConfig: FarmConfig
  ) {
    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(
      farm.publicKey
    );
    const [farmTreasury, farmTreasuryBump] = await this.findFarmTreasuryPDA(
      farm.publicKey
    );
    const [rewardAPot, rewardAPotBump] = await this.findRewardsPotPDA(
      farm.publicKey,
      rewardAMint
    );
    const [rewardBPot, rewardBPotBump] = await this.findRewardsPotPDA(
      farm.publicKey,
      rewardBMint
    );

    const signers = [farm, bank];
    if (isKp(farmManager)) signers.push(farmManager as Keypair);

    const txSig = await this.farmProgram.rpc.initFarm(
      farmAuthBump,
      farmTreasuryBump,
      rewardAPotBump,
      rewardBPotBump,
      rewardAType,
      rewardBType,
      farmConfig,
      {
        accounts: {
          farm: farm.publicKey,
          farmManager: isKp(farmManager)
            ? (farmManager as Keypair).publicKey
            : farmManager,
          farmAuthority: farmAuth,
          farmTreasury,
          payer: isKp(payer) ? (payer as Keypair).publicKey : farmManager,
          rewardAPot,
          rewardAMint,
          rewardBPot,
          rewardBMint,
          bank: bank.publicKey,
          gemBank: this.bankProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers,
      }
    );

    return {
      farmAuth,
      farmAuthBump,
      farmTreasury,
      farmTreasuryBump,
      rewardAPot,
      rewardAPotBump,
      rewardBPot,
      rewardBPotBump,
      txSig,
    };
  }

  async updateFarm(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    config: FarmConfig | null = null,
    newManager: PublicKey | null = null
  ) {
    const signers = [];
    if (isKp(farmManager)) signers.push(farmManager as Keypair);

    const txSig = await this.farmProgram.rpc.updateFarm(config, newManager, {
      accounts: {
        farm,
        farmManager: isKp(farmManager)
          ? (farmManager as Keypair).publicKey
          : farmManager,
      },
      signers,
    });

    return { txSig };
  }

  async payoutFromTreasury(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    destination: PublicKey,
    lamports: BN
  ) {
    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(farm);
    const [farmTreasury, farmTreasuryBump] = await this.findFarmTreasuryPDA(
      farm
    );

    const signers = [];
    if (isKp(farmManager)) signers.push(farmManager as Keypair);

    const txSig = await this.farmProgram.rpc.payoutFromTreasury(
      farmAuthBump,
      farmTreasuryBump,
      lamports,
      {
        accounts: {
          farm,
          farmManager: isKp(farmManager)
            ? (farmManager as Keypair).publicKey
            : farmManager,
          farmAuthority: farmAuth,
          farmTreasury,
          destination,
          systemProgram: SystemProgram.programId,
        },
        signers,
      }
    );

    return {
      farmAuth,
      farmAuthBump,
      farmTreasury,
      farmTreasuryBump,
      txSig,
    };
  }

  async addToBankWhitelist(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    addressToWhitelist: PublicKey,
    whitelistType: WhitelistType
  ) {
    const farmAcc = await this.fetchFarmAcc(farm);

    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(farm);
    const [whitelistProof, whitelistProofBump] =
      await this.findWhitelistProofPDA(farmAcc.bank, addressToWhitelist);

    const signers = [];
    if (isKp(farmManager)) signers.push(farmManager as Keypair);

    const txSig = await this.farmProgram.rpc.addToBankWhitelist(
      farmAuthBump,
      whitelistProofBump,
      whitelistType,
      {
        accounts: {
          farm,
          farmManager: isKp(farmManager)
            ? (farmManager as Keypair).publicKey
            : farmManager,
          farmAuthority: farmAuth,
          bank: farmAcc.bank,
          addressToWhitelist,
          whitelistProof,
          systemProgram: SystemProgram.programId,
          gemBank: this.bankProgram.programId,
        },
        signers,
      }
    );

    return {
      farmAuth,
      farmAuthBump,
      whitelistProof,
      whitelistProofBump,
      txSig,
    };
  }

  async removeFromBankWhitelist(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    addressToRemove: PublicKey
  ) {
    const farmAcc = await this.fetchFarmAcc(farm);

    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(farm);
    const [whitelistProof, whitelistProofBump] =
      await this.findWhitelistProofPDA(farmAcc.bank, addressToRemove);

    const signers = [];
    if (isKp(farmManager)) signers.push(farmManager as Keypair);

    const txSig = await this.farmProgram.rpc.removeFromBankWhitelist(
      farmAuthBump,
      whitelistProofBump,
      {
        accounts: {
          farm,
          farmManager: isKp(farmManager)
            ? (farmManager as Keypair).publicKey
            : farmManager,
          farmAuthority: farmAuth,
          bank: farmAcc.bank,
          addressToRemove,
          whitelistProof,
          gemBank: this.bankProgram.programId,
        },
        signers,
      }
    );

    return {
      farmAuth,
      farmAuthBump,
      whitelistProof,
      whitelistProofBump,
      txSig,
    };
  }

  // --------------------------------------- farmer ops ixs

  async initFarmer(
    farm: PublicKey,
    farmerIdentity: PublicKey | Keypair,
    payer: PublicKey | Keypair
  ) {
    const identityPk = isKp(farmerIdentity)
      ? (farmerIdentity as Keypair).publicKey
      : farmerIdentity as PublicKey;

    const farmAcc = await this.fetchFarmAcc(farm);

    const [farmer, farmerBump] = await this.findFarmerPDA(farm, identityPk);
    const [vault, vaultBump] = await this.findVaultPDA(
      farmAcc.bank,
      identityPk
    );
    const [vaultAuth, vaultAuthBump] = await this.findVaultAuthorityPDA(vault); //nice-to-have

    const signers = [];
    if (isKp(farmerIdentity)) signers.push(farmerIdentity as Keypair);
    if (isKp(payer)) signers.push(payer as Keypair);

    const tx = await this.farmProgram.instruction.initFarmer(farmerBump, vaultBump, {
      accounts: {
        farm,
        farmer,
        identity: identityPk,
        payer: isKp(payer) ? (payer as Keypair).publicKey : payer,
        bank: farmAcc.bank,
        vault,
        gemBank: this.bankProgram.programId,
        systemProgram: SystemProgram.programId,
      },
      signers,
    });

    return {
      farmer,
      farmerBump,
      vault,
      vaultBump,
      vaultAuth,
      vaultAuthBump,
      tx,
    };
  }

  async stakeCommon(
    farm: PublicKey,
    farmerIdentity: PublicKey | Keypair,
    unstake = false
  ) {
    const identityPk = isKp(farmerIdentity)
      ? (farmerIdentity as Keypair).publicKey
      : farmerIdentity as PublicKey;

    const farmAcc = await this.fetchFarmAcc(farm);

    const [farmer, farmerBump] = await this.findFarmerPDA(farm, identityPk);
    const [vault, vaultBump] = await this.findVaultPDA(
      farmAcc.bank,
      identityPk
    );
    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(farm);
    const [farmTreasury, farmTreasuryBump] = await this.findFarmTreasuryPDA(
      farm
    );

    const signers = [];
    if (isKp(farmerIdentity)) signers.push(farmerIdentity as Keypair);

    let tx;
    if (unstake) {
      tx = await this.farmProgram.transaction.unstake(
        farmAuthBump,
        farmTreasuryBump,
        farmerBump,
        {
          accounts: {
            farm,
            farmer,
            farmTreasury,
            identity: identityPk,
            bank: farmAcc.bank,
            vault,
            farmAuthority: farmAuth,
            gemBank: this.bankProgram.programId,
            systemProgram: SystemProgram.programId,
          },
          signers,
        }
      );
    } else {
      tx = await this.farmProgram.transaction.stake(farmAuthBump, farmerBump, {
        accounts: {
          farm,
          farmer,
          identity: identityPk,
          bank: farmAcc.bank,
          vault,
          farmAuthority: farmAuth,
          gemBank: this.bankProgram.programId,
        },
        signers,
      });
    }

    return {
      farmer,
      farmerBump,
      vault,
      vaultBump,
      farmAuth,
      farmAuthBump,
      farmTreasury,
      farmTreasuryBump,
      tx,
    };
  }

  async stake(farm: PublicKey, farmerIdentity: PublicKey | Keypair) {
    return this.stakeCommon(farm, farmerIdentity, false);
  }

  async unstake(farm: PublicKey, farmerIdentity: PublicKey | Keypair) {
    return this.stakeCommon(farm, farmerIdentity, true);
  }

  async claim(
    farm: PublicKey,
    farmerIdentity: PublicKey | Keypair,
    rewardAMint: PublicKey,
    rewardBMint: PublicKey
  ) {
    const identityPk = isKp(farmerIdentity)
      ? (farmerIdentity as Keypair).publicKey
      : farmerIdentity as PublicKey;

    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(farm);
    const [farmer, farmerBump] = await this.findFarmerPDA(farm, identityPk);

    const [potA, potABump] = await this.findRewardsPotPDA(farm, rewardAMint);
    const [potB, potBBump] = await this.findRewardsPotPDA(farm, rewardBMint);

    const rewardADestination = await this.findATA(rewardAMint, identityPk);
    const rewardBDestination = await this.findATA(rewardBMint, identityPk);

    const signers = [];
    if (isKp(farmerIdentity)) signers.push(farmerIdentity as Keypair);

    const tx = await this.farmProgram.instruction.claim(
      farmAuthBump,
      farmerBump,
      potABump,
      potBBump,
      {
        accounts: {
          farm,
          farmAuthority: farmAuth,
          farmer,
          identity: identityPk,
          rewardAPot: potA,
          rewardAMint,
          rewardADestination,
          rewardBPot: potB,
          rewardBMint,
          rewardBDestination,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers,
      }
    );

    return {
      farmAuth,
      farmAuthBump,
      farmer,
      farmerBump,
      potA,
      potABump,
      potB,
      potBBump,
      rewardADestination,
      rewardBDestination,
      tx
    };
  }

  async flashDeposit(
    farm: PublicKey,
    farmerIdentity: PublicKey | Keypair,
    gemAmount: BN,
    gemMint: PublicKey,
    gemSource: PublicKey,
    mintProof?: PublicKey,
    metadata?: PublicKey,
    creatorProof?: PublicKey
  ) {
    const identityPk = isKp(farmerIdentity)
      ? (farmerIdentity as Keypair).publicKey
      : farmerIdentity as PublicKey;

    const farmAcc = await this.fetchFarmAcc(farm);

    const [farmer, farmerBump] = await this.findFarmerPDA(farm, identityPk);
    const [vault, vaultBump] = await this.findVaultPDA(
      farmAcc.bank,
      identityPk
    );
    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(farm);

    const [gemBox, gemBoxBump] = await this.findGemBoxPDA(vault, gemMint);
    const [GDR, GDRBump] = await this.findGdrPDA(vault, gemMint);
    const [vaultAuth, vaultAuthBump] = await this.findVaultAuthorityPDA(vault);
    const [gemRarity, gemRarityBump] = await this.findRarityPDA(
      farmAcc.bank,
      gemMint
    );

    const remainingAccounts = [];
    if (mintProof)
      remainingAccounts.push({
        pubkey: mintProof,
        isWritable: false,
        isSigner: false,
      });
    if (metadata)
      remainingAccounts.push({
        pubkey: metadata,
        isWritable: false,
        isSigner: false,
      });
    if (creatorProof)
      remainingAccounts.push({
        pubkey: creatorProof,
        isWritable: false,
        isSigner: false,
      });

    const signers = [];
    if (isKp(farmerIdentity)) signers.push(farmerIdentity as Keypair);

    const tx = await this.farmProgram.transaction.flashDeposit(
      farmerBump,
      vaultAuthBump,
      gemBoxBump,
      GDRBump,
      gemRarityBump,
      gemAmount,
      {
        accounts: {
          farm,
          farmAuthority: farmAuth,
          farmer,
          identity: identityPk,
          bank: farmAcc.bank,
          vault,
          vaultAuthority: vaultAuth,
          gemBox,
          gemDepositReceipt: GDR,
          gemSource,
          gemMint,
          gemRarity,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          gemBank: this.bankProgram.programId,
        },
        remainingAccounts,
        signers,
      }
    );

    return {
      farmer,
      farmerBump,
      vault,
      vaultBump,
      farmAuth,
      farmAuthBump,
      gemBox,
      gemBoxBump,
      GDR,
      GDRBump,
      vaultAuth,
      vaultAuthBump,
      tx,
    };
  }

  async refreshFarmer(
    farm: PublicKey,
    farmerIdentity: PublicKey | Keypair,
    reenroll?: boolean
  ) {
    const identityPk = isKp(farmerIdentity)
      ? (farmerIdentity as Keypair).publicKey
      : farmerIdentity as PublicKey;

    const [farmer, farmerBump] = await this.findFarmerPDA(farm, identityPk);

    let tx;
    tx = await this.farmProgram.transaction.refreshFarmer(farmerBump, {
      accounts: {
        farm,
        farmer,
        identity: identityPk,
      },
      signers: [],
    });

    return {
      farmer,
      farmerBump,
      tx,
    };
  }

  // --------------------------------------- funder ops ixs

  async authorizeCommon(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    funder: PublicKey,
    deauthorize = false
  ) {
    const [authorizationProof, authorizationProofBump] =
      await this.findAuthorizationProofPDA(farm, funder);

    const signers = [];
    if (isKp(farmManager)) signers.push(farmManager as Keypair);

    let txSig;
    if (deauthorize) {
      txSig = await this.farmProgram.rpc.deauthorizeFunder(
        authorizationProofBump,
        {
          accounts: {
            farm,
            farmManager: isKp(farmManager)
              ? (farmManager as Keypair).publicKey
              : farmManager,
            funderToDeauthorize: funder,
            authorizationProof,
            systemProgram: SystemProgram.programId,
          },
          signers,
        }
      );
    } else {
      txSig = await this.farmProgram.rpc.authorizeFunder(
        authorizationProofBump,
        {
          accounts: {
            farm,
            farmManager: isKp(farmManager)
              ? (farmManager as Keypair).publicKey
              : farmManager,
            funderToAuthorize: funder,
            authorizationProof,
            systemProgram: SystemProgram.programId,
          },
          signers,
        }
      );
    }

    return { authorizationProof, authorizationProofBump, txSig };
  }

  async authorizeFunder(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    funderToAuthorize: PublicKey
  ) {
    return this.authorizeCommon(farm, farmManager, funderToAuthorize, false);
  }

  async deauthorizeFunder(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    funderToDeauthorize: PublicKey
  ) {
    return this.authorizeCommon(farm, farmManager, funderToDeauthorize, true);
  }

  // --------------------------------------- reward ops ixs

  async fundReward(
    farm: PublicKey,
    rewardMint: PublicKey,
    funder: PublicKey | Keypair,
    rewardSource: PublicKey,
    variableRateConfig: VariableRateConfig | null = null,
    fixedRateConfig: FixedRateConfig | null = null
  ) {
    const funderPk = isKp(funder)
      ? (funder as Keypair).publicKey
      : funder as PublicKey;

    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(farm);
    const [authorizationProof, authorizationProofBump] =
      await this.findAuthorizationProofPDA(farm, funderPk);
    const [pot, potBump] = await this.findRewardsPotPDA(farm, rewardMint);

    const signers = [];
    if (isKp(funder)) signers.push(funder as Keypair);

    const txSig = await this.farmProgram.rpc.fundReward(
      authorizationProofBump,
      potBump,
      variableRateConfig as any,
      fixedRateConfig as any,
      {
        accounts: {
          farm,
          authorizationProof,
          authorizedFunder: funderPk,
          rewardPot: pot,
          rewardSource,
          rewardMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        },
        signers,
      }
    );

    return {
      farmAuth,
      farmAuthBump,
      authorizationProof,
      authorizationProofBump,
      pot,
      potBump,
      txSig,
    };
  }

  async cancelReward(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    rewardMint: PublicKey,
    receiver: PublicKey
  ) {
    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(farm);
    const [pot, potBump] = await this.findRewardsPotPDA(farm, rewardMint);
    const rewardDestination = await this.findATA(rewardMint, receiver);

    const signers = [];
    if (isKp(farmManager)) signers.push(farmManager as Keypair);

    const txSig = await this.farmProgram.rpc.cancelReward(
      farmAuthBump,
      potBump,
      {
        accounts: {
          farm,
          farmManager: isKp(farmManager)
            ? (farmManager as Keypair).publicKey
            : farmManager,
          farmAuthority: farmAuth,
          rewardPot: pot,
          rewardDestination,
          rewardMint,
          receiver,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers,
      }
    );

    return {
      farmAuth,
      farmAuthBump,
      pot,
      potBump,
      rewardDestination,
      txSig,
    };
  }

  async lockReward(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    rewardMint: PublicKey
  ) {
    const signers = [];
    if (isKp(farmManager)) signers.push(farmManager as Keypair);

    const txSig = await this.farmProgram.rpc.lockReward({
      accounts: {
        farm,
        farmManager: isKp(farmManager)
          ? (farmManager as Keypair).publicKey
          : farmManager,
        rewardMint,
      },
      signers,
    });

    return { txSig };
  }

  // --------------------------------------- rarity

  async addRaritiesToBank(
    farm: PublicKey,
    farmManager: PublicKey | Keypair,
    ratityConfigs: RarityConfig[]
  ) {
    const farmAcc = await this.fetchFarmAcc(farm);
    const bank = farmAcc.bank;

    const [farmAuth, farmAuthBump] = await this.findFarmAuthorityPDA(farm);

    //prepare rarity configs
    const completeRarityConfigs = [...ratityConfigs];
    const remainingAccounts = [];

    for (const config of completeRarityConfigs) {
      const [gemRarity] = await this.findRarityPDA(bank, config.mint);
      //add mint
      remainingAccounts.push({
        pubkey: config.mint,
        isWritable: false,
        isSigner: false,
      });
      //add rarity pda
      remainingAccounts.push({
        pubkey: gemRarity,
        isWritable: true,
        isSigner: false,
      });
    }

    const signers = [];
    if (isKp(farmManager)) signers.push(farmManager as Keypair);

    const txSig = await this.farmProgram.rpc.addRaritiesToBank(
      farmAuthBump,
      completeRarityConfigs,
      {
        accounts: {
          farm,
          farmManager: isKp(farmManager)
            ? (farmManager as Keypair).publicKey
            : farmManager,
          farmAuthority: farmAuth,
          bank,
          gemBank: this.bankProgram.programId,
          systemProgram: SystemProgram.programId,
        },
        remainingAccounts,
        signers,
      }
    );

    return {
      bank,
      farmAuth,
      farmAuthBump,
      completeRarityConfigs,
      txSig,
    };
  }

  // --------------------------------------- helpers

  //returns "variable" or "fixed"
  parseRewardType(reward: any): string {
    return Object.keys(reward.rewardType)[0];
  }

  //returns "staked" / "unstaked" / "pendingCooldown"
  parseFarmerState(farmer: any): string {
    return Object.keys(farmer.state)[0];
  }
}
