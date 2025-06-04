// tests/favorites.ts
import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import BN from "bn.js"
import { assert } from "chai";
import type { Favorites } from "../target/types/favorites";

describe("favorites - global feed pairs + obligations", () => {
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

  // Test user wallets
  const user0Wallet = web3.Keypair.generate();
  const user1Wallet = web3.Keypair.generate();

  const getPairPda = async (feedA: web3.PublicKey, feedB: web3.PublicKey) => {
    return await web3.PublicKey.findProgramAddress(
      [Buffer.from("risk_pair"), feedA.toBuffer(), feedB.toBuffer()],
      program.programId
    );
  };

  // Setup phase - Fund test accounts
  before(async () => {
    console.log('\n=== Setting up test wallets ===');
    
    // Fund user0 and user1 wallets
    const airdropUser0 = await provider.connection.requestAirdrop(
      user0Wallet.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    const airdropUser1 = await provider.connection.requestAirdrop(
      user1Wallet.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    
    await provider.connection.confirmTransaction(airdropUser0);
    await provider.connection.confirmTransaction(airdropUser1);
    
    console.log('User0 wallet:', user0Wallet.publicKey.toBase58());
    console.log('User1 wallet:', user1Wallet.publicKey.toBase58());
  });

  describe("Risk Parameters", () => {
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

    it("calculate risk for BTC-ETH with prices and decimals", async () => {
      const [btcEthPda] = await getPairPda(FEEDS.BTC, FEEDS.ETH);

      // Example: 3 BTC (8 decimals, price $30,000), 2 ETH (8 decimals, price $2,000)
      const depositAmount = new BN(3 * 10 ** 8); // 3 BTC, 8 decimals
      const borrowAmount = new BN(2 * 10 ** 8);  // 2 ETH, 8 decimals
      const depositPrice = new BN(30_000);       // $30,000
      const depositDecimals = 8;
      const borrowPrice = new BN(2_000);         // $2,000
      const borrowDecimals = 8;

      const txSig = await program.methods
        .calculateRisk(
          depositAmount,
          borrowAmount,
          depositPrice,
          depositDecimals,
          borrowPrice,
          borrowDecimals
        )
        .accounts({
          riskParam: btcEthPda,
          depositFeed: FEEDS.BTC,
          borrowFeed: FEEDS.ETH,
        })
        .rpc();

      console.log("\n=== Transaction Info ===");
      console.log("Transaction signature:", txSig);

      // Add delay to ensure transaction is confirmed
      await new Promise(resolve => setTimeout(resolve, 3000));

      const tx = await provider.connection.getTransaction(txSig, {
          commitment: "confirmed",
      });

      console.log("\n=== Program Logs ===");
      if (!tx || !tx.meta || !tx.meta.logMessages) {
          console.error("❌ Transaction data is incomplete:");
          console.error("Transaction:", !!tx);
          console.error("Meta:", !!tx?.meta);
          console.error("LogMessages:", !!tx?.meta?.logMessages);
          throw new Error("Failed to fetch transaction logs - transaction data incomplete");
      }

      // Find our specific log
      const riskLog = tx.meta.logMessages.find((l: string) => l.includes("Final risk calculation"));
      console.log("\nRisk Calculation Log:", riskLog);

      // Print account state after transaction
      console.log("\n=== Account State After Transaction ===");
      const riskParamAccount = await program.account.riskParam.fetch(btcEthPda);
      console.log("Risk Param Account:", {
          feedA: riskParamAccount.feedA.toBase58(),
          feedB: riskParamAccount.feedB.toBase58(),
          riskLevel: riskParamAccount.riskLevel
      });
    });
  });

  describe("Obligation System", () => {
    // 3. Obligation PDAs Setup
    console.log('\n=== Calculating Obligation PDAs ===');
    
    // 3.1 User0 Obligation PDA
    let user0ObligationPda: web3.PublicKey;
    [user0ObligationPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('obligation'), user0Wallet.publicKey.toBuffer()],
      program.programId
    );
    console.log('User0 Obligation PDA:', user0ObligationPda.toBase58());

    // 3.2 User1 Obligation PDA  
    let user1ObligationPda: web3.PublicKey;
    [user1ObligationPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('obligation'), user1Wallet.publicKey.toBuffer()],
      program.programId
    );
    console.log('User1 Obligation PDA:', user1ObligationPda.toBase58());

    it("initialize user0 obligation", async () => {
      await program.methods
        .initObligation()
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([user0Wallet])
        .rpc();

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(obligation.owner.toBase58(), user0Wallet.publicKey.toBase58());
      assert.strictEqual(obligation.deposits.length, 0);
      assert.strictEqual(obligation.borrows.length, 0);
    });

    it("initialize user1 obligation", async () => {
      await program.methods
        .initObligation()
        .accounts({
          obligation: user1ObligationPda,
          owner: user1Wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([user1Wallet])
        .rpc();

      const obligation = await program.account.obligation.fetch(user1ObligationPda);
      assert.strictEqual(obligation.owner.toBase58(), user1Wallet.publicKey.toBase58());
      assert.strictEqual(obligation.deposits.length, 0);
      assert.strictEqual(obligation.borrows.length, 0);
    });

    it("add deposit to user0 obligation", async () => {
      const depositAmount = new BN(1000000); // 1 USDC (6 decimals)
      
      await program.methods
        .addDeposit(FEEDS.USDC, depositAmount)
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(obligation.deposits.length, 1);
      assert.strictEqual(obligation.deposits[0].asset.toBase58(), FEEDS.USDC.toBase58());
      assert.strictEqual(obligation.deposits[0].amount.toString(), depositAmount.toString());
    });

    it("add another deposit (same asset) to user0 obligation", async () => {
      const additionalAmount = new BN(500000); // 0.5 USDC
      
      await program.methods
        .addDeposit(FEEDS.USDC, additionalAmount)
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(obligation.deposits.length, 1); // Still only 1 position
      assert.strictEqual(obligation.deposits[0].amount.toString(), "1500000"); // Combined amount
    });

    it("add different asset deposit to user0 obligation", async () => {
      const btcAmount = new BN(50000000); // 0.5 BTC (8 decimals)
      
      await program.methods
        .addDeposit(FEEDS.BTC, btcAmount)
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(obligation.deposits.length, 2); // Now 2 positions
      
      // Find BTC deposit
      const btcDeposit = obligation.deposits.find(d => d.asset.toBase58() === FEEDS.BTC.toBase58());
      assert.isNotNull(btcDeposit);
      assert.strictEqual(btcDeposit!.amount.toString(), btcAmount.toString());
    });

    it("add borrow to user0 obligation", async () => {
      const borrowAmount = new BN(10000000); // 0.1 ETH (8 decimals)
      
      await program.methods
        .addBorrow(FEEDS.ETH, borrowAmount)
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(obligation.borrows.length, 1);
      assert.strictEqual(obligation.borrows[0].asset.toBase58(), FEEDS.ETH.toBase58());
      assert.strictEqual(obligation.borrows[0].amount.toString(), borrowAmount.toString());
    });

    it("remove partial deposit from user0 obligation", async () => {
      const removeAmount = new BN(500000); // Remove 0.5 USDC
      
      await program.methods
        .removeDeposit(FEEDS.USDC, removeAmount)
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      const usdcDeposit = obligation.deposits.find(d => d.asset.toBase58() === FEEDS.USDC.toBase58());
      assert.isNotNull(usdcDeposit);
      assert.strictEqual(usdcDeposit!.amount.toString(), "1000000"); // 1.5 - 0.5 = 1.0 USDC
    });

    it("remove entire deposit from user0 obligation", async () => {
      const removeAmount = new BN(50000000); // Remove all 0.5 BTC
      
      await program.methods
        .removeDeposit(FEEDS.BTC, removeAmount)
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(obligation.deposits.length, 1); // BTC position should be removed
      
      // Only USDC should remain
      const btcDeposit = obligation.deposits.find(d => d.asset.toBase58() === FEEDS.BTC.toBase58());
      assert.isUndefined(btcDeposit);
    });

    it("remove borrow from user0 obligation", async () => {
      const removeAmount = new BN(5000000); // Remove 0.05 ETH
      
      await program.methods
        .removeBorrow(FEEDS.ETH, removeAmount)
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(obligation.borrows.length, 1);
      assert.strictEqual(obligation.borrows[0].amount.toString(), "5000000"); // 0.1 - 0.05 = 0.05 ETH
    });

    it("test error cases - insufficient deposit", async () => {
      const tooMuchAmount = new BN(2000000); // Try to remove 2 USDC (only have 1)
      
      try {
        await program.methods
          .removeDeposit(FEEDS.USDC, tooMuchAmount)
          .accounts({
            obligation: user0ObligationPda,
            owner: user0Wallet.publicKey,
          })
          .signers([user0Wallet])
          .rpc();
        
        assert.fail("Should have thrown InsufficientDeposit error");
      } catch (error) {
        assert.include(error.message, "Insufficient deposit amount");
      }
    });

    it("test error cases - deposit not found", async () => {
      const removeAmount = new BN(1000000);
      
      try {
        await program.methods
          .removeDeposit(FEEDS.USDT, removeAmount) // USDT not deposited
          .accounts({
            obligation: user0ObligationPda,
            owner: user0Wallet.publicKey,
          })
          .signers([user0Wallet])
          .rpc();
        
        assert.fail("Should have thrown DepositNotFound error");
      } catch (error) {
        assert.include(error.message, "Deposit not found in obligation");
      }
    });

    it("test error cases - insufficient borrow", async () => {
      const tooMuchAmount = new BN(10000000); // Try to remove 0.1 ETH (only have 0.05)
      
      try {
        await program.methods
          .removeBorrow(FEEDS.ETH, tooMuchAmount)
          .accounts({
            obligation: user0ObligationPda,
            owner: user0Wallet.publicKey,
          })
          .signers([user0Wallet])
          .rpc();
        
        assert.fail("Should have thrown InsufficientBorrow error");
      } catch (error) {
        assert.include(error.message, "Insufficient borrow amount");
      }
    });

    it("test error cases - borrow not found", async () => {
      const removeAmount = new BN(1000000);
      
      try {
        await program.methods
          .removeBorrow(FEEDS.USDT, removeAmount) // USDT not borrowed
          .accounts({
            obligation: user0ObligationPda,
            owner: user0Wallet.publicKey,
          })
          .signers([user0Wallet])
          .rpc();
        
        assert.fail("Should have thrown BorrowNotFound error");
      } catch (error) {
        assert.include(error.message, "Borrow not found in obligation");
      }
    });

    it("complex scenario - user1 multiple operations", async () => {
      // Add multiple deposits
      await program.methods
        .addDeposit(FEEDS.BTC, new BN(100000000)) // 1 BTC
        .accounts({
          obligation: user1ObligationPda,
          owner: user1Wallet.publicKey,
        })
        .signers([user1Wallet])
        .rpc();

      await program.methods
        .addDeposit(FEEDS.ETH, new BN(500000000)) // 5 ETH
        .accounts({
          obligation: user1ObligationPda,
          owner: user1Wallet.publicKey,
        })
        .signers([user1Wallet])
        .rpc();

      await program.methods
        .addDeposit(FEEDS.USDC, new BN(10000000)) // 10 USDC
        .accounts({
          obligation: user1ObligationPda,
          owner: user1Wallet.publicKey,
        })
        .signers([user1Wallet])
        .rpc();

      // Add multiple borrows
      await program.methods
        .addBorrow(FEEDS.USDT, new BN(5000000)) // 5 USDT
        .accounts({
          obligation: user1ObligationPda,
          owner: user1Wallet.publicKey,
        })
        .signers([user1Wallet])
        .rpc();

      await program.methods
        .addBorrow(FEEDS.ETH, new BN(50000000)) // 0.5 ETH
        .accounts({
          obligation: user1ObligationPda,
          owner: user1Wallet.publicKey,
        })
        .signers([user1Wallet])
        .rpc();

      // Check final state
      const obligation = await program.account.obligation.fetch(user1ObligationPda);
      
      console.log("\n=== User1 Final Obligation State ===");
      console.log("Deposits:", obligation.deposits.map(d => ({
        asset: d.asset.toBase58(),
        amount: d.amount.toString()
      })));
      console.log("Borrows:", obligation.borrows.map(b => ({
        asset: b.asset.toBase58(),
        amount: b.amount.toString()
      })));

      assert.strictEqual(obligation.deposits.length, 3);
      assert.strictEqual(obligation.borrows.length, 2);
      
      // Verify specific amounts
      const btcDeposit = obligation.deposits.find(d => d.asset.toBase58() === FEEDS.BTC.toBase58());
      assert.strictEqual(btcDeposit!.amount.toString(), "100000000");
      
      const ethBorrow = obligation.borrows.find(b => b.asset.toBase58() === FEEDS.ETH.toBase58());
      assert.strictEqual(ethBorrow!.amount.toString(), "50000000");
    });

    it("test zero amount operations (should be no-op)", async () => {
      const obligationBefore = await program.account.obligation.fetch(user0ObligationPda);
      
      // Try adding zero amounts
      await program.methods
        .addDeposit(FEEDS.BTC, new BN(0))
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      await program.methods
        .removeDeposit(FEEDS.USDC, new BN(0))
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      const obligationAfter = await program.account.obligation.fetch(user0ObligationPda);
      
      // State should be unchanged
      assert.deepEqual(obligationBefore.deposits, obligationAfter.deposits);
      assert.deepEqual(obligationBefore.borrows, obligationAfter.borrows);
    });
  });

  describe("Cleanup", () => {
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
  });
});