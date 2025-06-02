// tests/favorites.ts
import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import { assert } from "chai";
import type { Favorites } from "../target/types/favorites";

describe("favorites - global feed pairs", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Favorites as anchor.Program<Favorites>;
  const payer = provider.wallet.publicKey;

  const FEEDS = {
    BTC: new web3.PublicKey("6PxBx93S8x3tno1TsFZwT5VqP8drrRCbCXygEXYNkFJe"),
    ETH: new web3.PublicKey("669U43LNHx7LsVj95uYksnhXUfWKDsdzVqev3V4Jpw3P"),
    USDC: new web3.PublicKey("2EmfL3MqL3YHABudGNmajjCpR13NNEn9Y4LWxbDm6SwR"),
    USDT: new web3.PublicKey("8QQSUPtdRTboa4bKyMftVNRfGFsB4Vp9d7r39hGKi53e"),
  };

  const getPairPda = async (feedA: web3.PublicKey, feedB: web3.PublicKey) => {
    return await web3.PublicKey.findProgramAddress(
      [Buffer.from("risk_pair"), feedA.toBuffer(), feedB.toBuffer()],
      program.programId
    );
  };

  it("initialize BTC-ETH with 77", async () => {
    const [pda] = await getPairPda(FEEDS.BTC, FEEDS.ETH);

    await program.methods
      .initializePairRiskParam(77)
      .accounts({
        riskParam: pda,
        payer,
        feedA: FEEDS.BTC,
        feedB: FEEDS.ETH,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    const acc = await program.account.riskParam.fetch(pda);
    assert.strictEqual(acc.riskLevel, 77);
  });

  it("initialize USDC-USDT with 99", async () => {
    const [pda] = await getPairPda(FEEDS.USDC, FEEDS.USDT);

    await program.methods
      .initializePairRiskParam(99)
      .accounts({
        riskParam: pda,
        payer,
        feedA: FEEDS.USDC,
        feedB: FEEDS.USDT,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    const acc = await program.account.riskParam.fetch(pda);
    assert.strictEqual(acc.riskLevel, 99);
  });

  it("update BTC-ETH to 88", async () => {
    const [pda] = await getPairPda(FEEDS.BTC, FEEDS.ETH);

    await program.methods
      .updatePairRiskParam(88)
      .accounts({
        riskParam: pda,
        feedA: FEEDS.BTC,
        feedB: FEEDS.ETH,
      })
      .rpc();

    const acc = await program.account.riskParam.fetch(pda);
    assert.strictEqual(acc.riskLevel, 88);
  });

  it("delete USDC-USDT", async () => {
    const [pda] = await getPairPda(FEEDS.USDC, FEEDS.USDT);

    await program.methods
      .deletePairRiskParam()
      .accounts({
        riskParam: pda,
        payer,
        feedA: FEEDS.USDC,
        feedB: FEEDS.USDT,
      })
      .rpc();

    try {
      await program.account.riskParam.fetch(pda);
      assert.fail("Account should be deleted");
    } catch (e) {
      assert.include(e.message, "Account does not exist");
    }
  });

  it("delete BTC-ETH", async () => {
    const [pda] = await getPairPda(FEEDS.BTC, FEEDS.ETH);

    await program.methods
      .deletePairRiskParam()
      .accounts({
        riskParam: pda,
        payer,
        feedA: FEEDS.BTC,
        feedB: FEEDS.ETH,
      })
      .rpc();

    try {
      await program.account.riskParam.fetch(pda);
      assert.fail("Account should be deleted");
    } catch (e) {
      assert.include(e.message, "Account does not exist");
    }
  });
})