import { SignerWalletAdapter } from "@solana/wallet-adapter-base";
import { PublicKey, Transaction, Connection } from "@solana/web3.js";
import BN from "bn.js";

import { fetchFarm, fetchFarmer, initGemBank, initGemFarm } from "./staking";

interface stakeTokenI {
  mint: string;
  connection: Connection;
  wallet: any;
  currentVaultTokens: [];
  configs: {
    farmIdToBase: string;
  };
}

const unStakeToken = async ({
  mint,
  wallet,
  connection,
  currentVaultTokens,
  configs: { farmIdToBase },
}: stakeTokenI) => {
  try {
    const { publicKey } = wallet;
    const farmId = new PublicKey(farmIdToBase);

    const gf = initGemFarm(connection, wallet!.adapter as SignerWalletAdapter);
    const gb = initGemBank(connection, wallet!.adapter as SignerWalletAdapter);

    const farmAcc = await fetchFarm(
      connection,
      wallet!.adapter as SignerWalletAdapter
    );
    const { farmerAcc } = await fetchFarmer(
      connection,
      wallet!.adapter as SignerWalletAdapter,
      publicKey!
    );

    // There's two calls to unstake, the first "unstakes" it
    const txUnstake = await gf!.unstakeWallet(farmId);
    // Then, the second ends the cooldown period
    const txCooldown = await gf!.unstakeWallet(farmId);
    // Then and only then we can withdraw the gem
    const txWithdraw = await gb!.withdrawGemWallet(
      farmAcc.bank,
      farmerAcc.vault,
      new BN(1),
      new PublicKey(mint)
    );

    const txs = new Transaction()
      .add(txUnstake)
      .add(txCooldown)
      .add(txWithdraw);

    // Then, if there was more than this NFT staking, we need to restart
    // staking for the other ones
    if (currentVaultTokens.length > 1) {
      txs.add(await gf!.stakeWallet(farmId));
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

export default unStakeToken;
