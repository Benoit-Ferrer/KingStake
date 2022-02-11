import { SignerWalletAdapter } from "@solana/wallet-adapter-base";
import { PublicKey, Transaction, Connection } from "@solana/web3.js";

import { fetchFarm, initGemFarm } from "./staking";

const claimAllTokens = async ({
  connection,
  wallet,
  configs: { farmIdToBase },
}: {
  connection: Connection;
  wallet: any;
  configs: {
    farmIdToBase: string;
  };
}) => {
  try {
    const gf = initGemFarm(connection, wallet!.adapter as SignerWalletAdapter);

    const farmAcc = await fetchFarm(
      connection,
      wallet!.adapter as SignerWalletAdapter
    );
    if (farmAcc === null) return { error: "FarmAcc null" };

    const txClaim = await gf.claimWallet(
      new PublicKey(farmIdToBase),
      new PublicKey(farmAcc.rewardA.rewardMint!),
      new PublicKey(farmAcc.rewardB.rewardMint!)
    );

    const txs = new Transaction().add(txClaim);
    let blockhashObj = await connection.getRecentBlockhash();
    txs.recentBlockhash = blockhashObj.blockhash;
    txs.feePayer = wallet.PublicKey!;

    const txid = await wallet.sendTransaction(txs, connection);
    await connection.confirmTransaction(txid);
    return { error: null };
  } catch (e) {
    console.error(e);
    return { error: e };
  }
};

export default claimAllTokens;
