import { Connection, PublicKey } from "@solana/web3.js";
import { SignerWalletAdapter } from "@solana/wallet-adapter-base";
import { GemBank } from "./gem-core/bank-client";
import { GemFarm } from "./gem-core/farm-client";
import bankIdl from "./gem-core/idl/gem_bank.json";
import farmIdl from "./gem-core/idl/gem_farm.json";
import { stakingDefaults } from "./configs";
import { Wallet } from "@project-serum/anchor";
import { getNFTMetadataForMany, getNFTsByOwner, INFT } from "./gem-core/nft";

export const initGemBank = (conn: Connection, wallet: SignerWalletAdapter) => {
  return new GemBank(conn, (wallet as unknown) as Wallet, bankIdl as any);
};

export const initGemFarm = (conn: Connection, wallet: SignerWalletAdapter) => {
  return new GemFarm(
    conn,
    (wallet as unknown) as Wallet,
    farmIdl as any,
    bankIdl as any
  );
};

export const fetchFarm = async (
  connection: Connection,
  walletAdapter: SignerWalletAdapter
): Promise<any> => {
  const gf = await initGemFarm(connection, walletAdapter);

  return await gf!.fetchFarmAcc(stakingDefaults.farmId);
};

export const fetchFarmer = async (
  connection: Connection,
  walletAdapter: SignerWalletAdapter,
  farmer: PublicKey
): Promise<any> => {
  const gf = await initGemFarm(connection, walletAdapter);

  const [farmerPDA] = await gf!.findFarmerPDA(stakingDefaults.farmId, farmer);

  try {
    const farmerIdentity = farmer.toBase58();
    const farmerAcc = await gf!.fetchFarmerAcc(farmerPDA);
    const farmerState = gf!.parseFarmerState(farmerAcc);

    return { farmerIdentity, farmerAcc, farmerState };
  } catch (e) {
    return null;
  }
};

export const fetchWalletNFTs = async (
  connection: Connection,
  owner: PublicKey
) => {
  if (!owner) {
    return [];
  }

  return await getNFTsByOwner(owner, connection);
};

export const fetchVaultNFTs = async (
  connection: Connection,
  walletAdapter: SignerWalletAdapter,
  farmer_pubkey: PublicKey
): Promise<INFT[]> => {
  const gb = await initGemBank(connection, walletAdapter);
  const farmer = await fetchFarmer(connection, walletAdapter, farmer_pubkey);

  // If the farmer doesn't exist yet, the vault doesn't exist
  if (farmer === null) {
    return [];
  }

  const farmerAcc = farmer.farmerAcc;
  const foundGDRs = await gb!.fetchAllGdrPDAs(farmerAcc.vault);

  if (foundGDRs && foundGDRs.length) {
    const mints = foundGDRs.map((gdr: any) => {
      return { mint: gdr.account.gemMint };
    });

    return await getNFTMetadataForMany(mints, connection);
  }

  return [];
};

export const fetchAvailableRewards = async (
  connection: Connection,
  walletAdapter: SignerWalletAdapter,
  farmer_pubkey: PublicKey
): Promise<any> => {
  const farmer = await fetchFarmer(connection, walletAdapter, farmer_pubkey);

  if (farmer === null) return "N/A";

  return farmer.farmerAcc.rewardA.accruedReward
    .sub(farmer.farmerAcc.rewardA.paidOutReward)
    .toString();
};
