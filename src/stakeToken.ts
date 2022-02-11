import { SignerWalletAdapter } from "@solana/wallet-adapter-base";
import { PublicKey, Transaction, Connection } from "@solana/web3.js";
import BN from "bn.js";

import { fetchFarm, fetchFarmer, initGemBank, initGemFarm } from "./staking";

interface stakeTokenI {
  mint: string;
  tokenPubkey: PublicKey;
  connection: Connection;
  wallet: any;
  configs: {
    CMPDAToBase: string;
    farmIdToBase: string;
  };
}

const stakeToken = async ({
  mint,
  tokenPubkey,
  wallet,
  connection,
  configs: { farmIdToBase, CMPDAToBase },
}: stakeTokenI) => {
  try {
    const creator = new PublicKey(CMPDAToBase);
    const farmId = new PublicKey(farmIdToBase);

    const { publicKey } = wallet;

    const gf = initGemFarm(connection, wallet!.adapter as SignerWalletAdapter);

    const gb = initGemBank(connection, wallet!.adapter as SignerWalletAdapter);

    const txs = new Transaction();
    const farmer = await fetchFarmer(
      connection,
      wallet!.adapter as SignerWalletAdapter,
      publicKey!
    );

    const farm = await fetchFarm(
      connection,
      wallet!.adapter as SignerWalletAdapter
    );

    let farmerVault: PublicKey;
    if (farmer === null) {
      // Initializes the farmer if it doesn't exist
      const { tx: txCreateFarmer, vault } = await gf!.initFarmerWallet(farmId);
      txs.add(txCreateFarmer);

      farmerVault = vault;
    } else {
      farmerVault = farmer.farmerAcc.vault;
    }

    if (publicKey) {
      if (farmer !== null && farmer.farmerState === "staked") {
        const txDepositAndStake = await gf!.flashDepositWallet(
          farmId,
          "1",
          new PublicKey(mint),
          tokenPubkey,
          creator
        );

        txs.add(txDepositAndStake);
      } else {
        const { tx: txDeposit } = await gb.depositGemWallet(
          farm.bank,
          farmerVault,
          new BN(1),
          new PublicKey(mint),
          tokenPubkey,
          creator
        );

        txs.add(txDeposit);

        const txStake = await gf!.stakeWallet(farmId);
        txs.add(txStake);
      }
    }

    let blockhashObj = await connection.getRecentBlockhash();
    txs.recentBlockhash = blockhashObj.blockhash;
    txs.feePayer = publicKey!;

    const txid = await wallet.sendTransaction(txs, connection);

    await connection.confirmTransaction(txid);
    return { error: null };
  } catch (e) {
    console.error(e);
    return { error: e };
  }
};

export default stakeToken;
