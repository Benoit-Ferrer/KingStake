import * as anchor from '@project-serum/anchor';
import {BN, Idl, Provider, Wallet} from '@project-serum/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  AccountInfo,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { AccountUtils } from '../gem-common/account-utils';
import { isKp } from '../gem-common/types';
import {GemBank} from "../types/gem_bank";

export enum BankFlags {
  FreezeVaults = 1 << 0,
}

export enum WhitelistType {
  Creator = 1 << 0,
  Mint = 1 << 1,
}

export class GemBankClient extends AccountUtils {
  wallet: Wallet;
  provider!: anchor.Provider;
  bankProgram!: anchor.Program<GemBank>;

  constructor(
    conn: Connection,
    wallet: Wallet,
    idl?: Idl,
    programId?: PublicKey
  ) {
    super(conn);
    this.wallet = wallet;
    this.setProvider();
    this.setBankProgram(idl, programId);
  }

  setProvider() {
    this.provider = new Provider(
      this.conn,
      this.wallet,
      Provider.defaultOptions()
    );
    anchor.setProvider(this.provider);
  }

  setBankProgram(idl?: Idl, programId?: PublicKey) {
    //instantiating program depends on the environment
    if (idl && programId) {
      //means running in prod
      this.bankProgram = new anchor.Program<GemBank>(
        idl as any,
        programId,
        this.provider
      );
    } else {
      //means running inside test suite
      //this.bankProgram = anchor.workspace.GemBank as Program<GemBank>;
    }
  }

  // --------------------------------------- fetch deserialized accounts

  async fetchBankAcc(bank: PublicKey) {
    return this.bankProgram.account.bank.fetch(bank);
  }

  async fetchVaultAcc(vault: PublicKey) {
    return this.bankProgram.account.vault.fetch(vault);
  }

  async fetchGDRAcc(GDR: PublicKey) {
    return this.bankProgram.account.gemDepositReceipt.fetch(GDR);
  }

  async fetchGemAcc(mint: PublicKey, gemAcc: PublicKey): Promise<AccountInfo> {
    return this.deserializeTokenAccount(mint, gemAcc);
  }

  async fetchWhitelistProofAcc(proof: PublicKey) {
    return this.bankProgram.account.whitelistProof.fetch(proof);
  }

  async fetchRarity(rarity: PublicKey) {
    return this.bankProgram.account.rarity.fetch(rarity);
  }

  // --------------------------------------- find PDA addresses

  async findVaultPDA(bank: PublicKey, creator: PublicKey) {
    return this.findProgramAddress(this.bankProgram.programId, [
      'vault',
      bank,
      creator,
    ]);
  }

  async findGemBoxPDA(vault: PublicKey, mint: PublicKey) {
    return this.findProgramAddress(this.bankProgram.programId, [
      'gem_box',
      vault,
      mint,
    ]);
  }

  async findGdrPDA(vault: PublicKey, mint: PublicKey) {
    return this.findProgramAddress(this.bankProgram.programId, [
      'gem_deposit_receipt',
      vault,
      mint,
    ]);
  }

  async findVaultAuthorityPDA(vault: PublicKey) {
    return this.findProgramAddress(this.bankProgram.programId, [vault]);
  }

  async findWhitelistProofPDA(bank: PublicKey, whitelistedAddress: PublicKey) {
    return this.findProgramAddress(this.bankProgram.programId, [
      'whitelist',
      bank,
      whitelistedAddress,
    ]);
  }

  async findRarityPDA(bank: PublicKey, mint: PublicKey) {
    return this.findProgramAddress(this.bankProgram.programId, [
      'gem_rarity',
      bank,
      mint,
    ]);
  }

  // --------------------------------------- get all PDAs by type
  //https://project-serum.github.io/anchor/ts/classes/accountclient.html#all

  async fetchAllBankPDAs(manager?: PublicKey) {
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
    const pdas = await this.bankProgram.account.bank.all(filter);
    return pdas;
  }

  async fetchAllVaultPDAs(bank?: PublicKey) {
    const filter = bank
      ? [
          {
            memcmp: {
              offset: 8, //need to prepend 8 bytes for anchor's disc
              bytes: bank.toBase58(),
            },
          },
        ]
      : [];
    const pdas = await this.bankProgram.account.vault.all(filter);
    return pdas;
  }

  async fetchAllGdrPDAs(vault?: PublicKey) {
    const filter = vault
      ? [
          {
            memcmp: {
              offset: 8, //need to prepend 8 bytes for anchor's disc
              bytes: vault.toBase58(),
            },
          },
        ]
      : [];
    const pdas = await this.bankProgram.account.gemDepositReceipt.all(filter);
    return pdas;
  }

  async fetchAllWhitelistProofPDAs(bank?: PublicKey) {
    const filter = bank
      ? [
          {
            memcmp: {
              offset: 41, //need to prepend 8 bytes for anchor's disc
              bytes: bank.toBase58(),
            },
          },
        ]
      : [];
    const pdas = await this.bankProgram.account.whitelistProof.all(filter);
    return pdas;
  }

  async fetchAllRarityPDAs() {
    //todo need to add client-side (not stored in PDA) filtering based on finding PDAs for given farm and mint
    const pdas = await this.bankProgram.account.rarity.all();
    return pdas;
  }

  // --------------------------------------- execute ixs

  async initBank(
    bank: Keypair,
    bankManager: PublicKey | Keypair,
    payer: PublicKey | Keypair
  ) {
    const signers = [bank];
    if (isKp(bankManager)) signers.push(bankManager as Keypair);

    const txSig = await this.bankProgram.rpc.initBank({
      accounts: {
        bank: bank.publicKey,
        bankManager: isKp(bankManager)
          ? (bankManager as Keypair).publicKey
          : bankManager,
        payer: isKp(payer) ? (payer as Keypair).publicKey : payer,
        systemProgram: SystemProgram.programId,
      },
      signers,
    });

    return { txSig };
  }

  async updateBankManager(
    bank: PublicKey,
    bankManager: PublicKey | Keypair,
    newManager: PublicKey
  ) {
    const signers = [];
    if (isKp(bankManager)) signers.push(bankManager as Keypair);

    const txSig = await this.bankProgram.rpc.updateBankManager(newManager, {
      accounts: {
        bank,
        bankManager: isKp(bankManager)
          ? (bankManager as Keypair).publicKey
          : bankManager,
      },
      signers,
    });

    return { txSig };
  }

  async initVault(
    bank: PublicKey,
    creator: PublicKey | Keypair,
    payer: PublicKey | Keypair,
    owner: PublicKey,
    name: string
  ) {
    const creatorPk = isKp(creator)
      ? (creator as Keypair).publicKey
      : creator as PublicKey;

    const [vault, vaultBump] = await this.findVaultPDA(bank, creatorPk);
    const [vaultAuth, vaultAuthBump] = await this.findVaultAuthorityPDA(vault); //nice-to-have

    const signers = [];
    if (isKp(creator)) signers.push(creator as Keypair);
    if (isKp(payer)) signers.push(payer as Keypair);

    const txSig = await this.bankProgram.rpc.initVault(vaultBump, owner, name, {
      accounts: {
        bank,
        vault,
        creator: creatorPk,
        payer: isKp(payer) ? (payer as Keypair).publicKey : payer as PublicKey,
        systemProgram: SystemProgram.programId,
      },
      signers,
    });

    return { vault, vaultBump, vaultAuth, vaultAuthBump, txSig };
  }

  async updateVaultOwner(
    bank: PublicKey,
    vault: PublicKey,
    existingOwner: Keypair | PublicKey,
    newOwner: PublicKey
  ) {
    const signers = [];
    if (isKp(existingOwner)) signers.push(existingOwner as Keypair);

    const txSig = await this.bankProgram.rpc.updateVaultOwner(newOwner, {
      accounts: {
        bank,
        vault,
        owner: isKp(existingOwner)
          ? (existingOwner as Keypair).publicKey
          : existingOwner,
      },
      signers,
    });

    return { txSig };
  }

  async setVaultLock(
    bank: PublicKey,
    vault: PublicKey,
    bankManager: PublicKey | Keypair,
    vaultLocked: boolean
  ) {
    const signers = [];
    if (isKp(bankManager)) signers.push(bankManager as Keypair);

    const txSig = await this.bankProgram.rpc.setVaultLock(vaultLocked, {
      accounts: {
        bank,
        vault,
        bankManager: isKp(bankManager)
          ? (bankManager as Keypair).publicKey
          : bankManager,
      },
      signers,
    });

    return { txSig };
  }

  async setBankFlags(
    bank: PublicKey,
    bankManager: PublicKey | Keypair,
    flags: BankFlags
  ) {
    const signers = [];
    if (isKp(bankManager)) signers.push(bankManager as Keypair);

    const txSig = await this.bankProgram.rpc.setBankFlags(flags, {
      accounts: {
        bank,
        bankManager: bankManager
          ? (bankManager as Keypair).publicKey
          : bankManager,
      },
      signers,
    });

    return { txSig };
  }

  async depositGem(
    bank: PublicKey,
    vault: PublicKey,
    vaultOwner: PublicKey | Keypair,
    gemAmount: BN,
    gemMint: PublicKey,
    gemSource: PublicKey,
    mintProof?: PublicKey,
    metadata?: PublicKey,
    creatorProof?: PublicKey
  ) {
    const [gemBox, gemBoxBump] = await this.findGemBoxPDA(vault, gemMint);
    const [GDR, GDRBump] = await this.findGdrPDA(vault, gemMint);
    const [vaultAuth, vaultAuthBump] = await this.findVaultAuthorityPDA(vault);
    const [gemRarity, gemRarityBump] = await this.findRarityPDA(bank, gemMint);

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
    if (isKp(vaultOwner)) signers.push(vaultOwner as Keypair);

    const tx = await this.bankProgram.transaction.depositGem(
      vaultAuthBump,
      gemBoxBump,
      GDRBump,
      gemRarityBump,
      gemAmount,
      {
        accounts: {
          bank,
          vault,
          owner: isKp(vaultOwner)
            ? (vaultOwner as Keypair).publicKey
            : vaultOwner,
          authority: vaultAuth,
          gemBox,
          gemDepositReceipt: GDR,
          gemSource,
          gemMint,
          gemRarity,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        remainingAccounts,
        signers,
      }
    );

    return {
      vaultAuth,
      vaultAuthBump,
      gemBox,
      gemBoxBump,
      GDR,
      GDRBump,
      gemRarity,
      gemRarityBump,
      tx,
    };
  }

  async withdrawGem(
    bank: PublicKey,
    vault: PublicKey,
    vaultOwner: PublicKey | Keypair,
    gemAmount: BN,
    gemMint: PublicKey,
    receiver: PublicKey
  ) {
    const [gemBox, gemBoxBump] = await this.findGemBoxPDA(vault, gemMint);
    const [GDR, GDRBump] = await this.findGdrPDA(vault, gemMint);
    const [vaultAuth, vaultAuthBump] = await this.findVaultAuthorityPDA(vault);
    const [gemRarity, gemRarityBump] = await this.findRarityPDA(bank, gemMint);

    const gemDestination = await this.findATA(gemMint, receiver);

    const signers = [];
    if (isKp(vaultOwner)) signers.push(vaultOwner as Keypair);

    const tx = await this.bankProgram.transaction.withdrawGem(
      vaultAuthBump,
      gemBoxBump,
      GDRBump,
      gemRarityBump,
      gemAmount,
      {
        accounts: {
          bank,
          vault,
          owner: isKp(vaultOwner)
            ? (vaultOwner as Keypair).publicKey
            : vaultOwner,
          authority: vaultAuth,
          gemBox,
          gemDepositReceipt: GDR,
          gemDestination,
          gemMint,
          gemRarity,
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
      gemBox,
      gemBoxBump,
      GDR,
      GDRBump,
      gemRarity,
      gemRarityBump,
      vaultAuth,
      vaultAuthBump,
      gemDestination,
      tx,
    };
  }

  async addToWhitelist(
    bank: PublicKey,
    bankManager: PublicKey | Keypair,
    addressToWhitelist: PublicKey,
    whitelistType: WhitelistType,
    payer?: PublicKey
  ) {
    const managerPk = isKp(bankManager)
      ? (bankManager as Keypair).publicKey
      : bankManager as PublicKey;

    const [whitelistProof, whitelistBump] = await this.findWhitelistProofPDA(
      bank,
      addressToWhitelist
    );

    const signers = [];
    if (isKp(bankManager)) signers.push(bankManager as Keypair);

    const txSig = await this.bankProgram.rpc.addToWhitelist(
      whitelistBump,
      whitelistType,
      {
        accounts: {
          bank,
          bankManager: managerPk,
          addressToWhitelist,
          whitelistProof,
          systemProgram: SystemProgram.programId,
          payer: payer ?? managerPk,
        },
        signers,
      }
    );

    return { whitelistProof, whitelistBump, txSig };
  }

  async removeFromWhitelist(
    bank: PublicKey,
    bankManager: PublicKey | Keypair,
    addressToRemove: PublicKey
  ) {
    const [whitelistProof, whitelistBump] = await this.findWhitelistProofPDA(
      bank,
      addressToRemove
    );

    const signers = [];
    if (isKp(bankManager)) signers.push(bankManager as Keypair);

    const txSig = await this.bankProgram.rpc.removeFromWhitelist(
      whitelistBump,
      {
        accounts: {
          bank,
          bankManager: isKp(bankManager)
            ? (bankManager as Keypair).publicKey
            : bankManager,
          addressToRemove,
          whitelistProof,
        },
        signers,
      }
    );

    return { whitelistProof, whitelistBump, txSig };
  }
}
