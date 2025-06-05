// tests/favorites.ts
import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import BN from "bn.js"
import { assert } from "chai";
import type { Favorites } from "../target/types/favorites";

describe("favorites - global feed pairs + obligations with health checks", () => {
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

  // Helper function to extract and print logs
  const printTransactionLogs = async (txSig: string, testName: string) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`=== ${testName} ===`);
    console.log(`${'='.repeat(60)}`);
    console.log("Transaction signature:", txSig);

    // Add delay to ensure transaction is confirmed
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const tx = await provider.connection.getTransaction(txSig, {
        commitment: "confirmed",
      });

      if (!tx || !tx.meta || !tx.meta.logMessages) {
        console.error("❌ Transaction data is incomplete");
        return;
      }

      // Filter and format program logs
      const programLogs = tx.meta.logMessages.filter((log: string) => 
        log.includes("Program log:") && (
          log.includes("Health") ||
          log.includes("WARNING") ||
          log.includes("Adding") ||
          log.includes("Removing") ||
          log.includes("Required oracles") ||
          log.includes("oracles provided") ||
          log.includes("oracles missing") ||
          log.includes("Current deposits") ||
          log.includes("Obligation initialized")
        )
      );

      console.log("\n--- Program Logs ---");
      programLogs.forEach((log: string) => {
        const cleanLog = log.replace("Program log: ", "");
        console.log(cleanLog);
      });

    } catch (error) {
      console.error("Error fetching transaction logs:", error);
    }
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
  });

  describe("Obligation System with Health Checks", () => {
    // Obligation PDAs Setup
    let user0ObligationPda: web3.PublicKey;
    [user0ObligationPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('obligation'), user0Wallet.publicKey.toBuffer()],
      program.programId
    );

    let user1ObligationPda: web3.PublicKey;
    [user1ObligationPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('obligation'), user1Wallet.publicKey.toBuffer()],
      program.programId
    );

    it("initialize user0 obligation", async () => {
      const txSig = await program.methods
        .initObligation()
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([user0Wallet])
        .rpc();

      await printTransactionLogs(txSig, "Initialize User0 Obligation");

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(obligation.owner.toBase58(), user0Wallet.publicKey.toBase58());
      assert.strictEqual(obligation.deposits.length, 0);
      assert.strictEqual(obligation.borrows.length, 0);
    });

    it("add deposit to user0 obligation (with health check)", async () => {
      const depositAmount = new BN(1000000); // 1 USDC (6 decimals)
      
      // Since this is the first deposit and no borrows, we don't need oracle accounts yet
      const txSig = await program.methods
        .addDeposit(FEEDS.USDC, depositAmount)
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      await printTransactionLogs(txSig, "Add First Deposit to User0 (No Oracle Accounts Needed)");

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(obligation.deposits.length, 1);
      assert.strictEqual(obligation.deposits[0].asset.toBase58(), FEEDS.USDC.toBase58());
      assert.strictEqual(obligation.deposits[0].amount.toString(), depositAmount.toString());
    });

    it("add multiple deposits and then add borrow (with oracle accounts)", async () => {
      // First add BTC deposit
      const btcAmount = new BN(50000000); // 0.5 BTC (8 decimals)
      
      const txSig1 = await program.methods
        .addDeposit(FEEDS.BTC, btcAmount)
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .remainingAccounts([
          { pubkey: FEEDS.USDC, isSigner: false, isWritable: false }, // Existing deposit oracle
        ])
        .signers([user0Wallet])
        .rpc();

      await printTransactionLogs(txSig1, "Add BTC Deposit with USDC Oracle");

      // Now add a borrow - this requires all oracle accounts
      const borrowAmount = new BN(10000000); // 0.1 ETH (8 decimals)
      
      const txSig2 = await program.methods
        .addBorrow(FEEDS.ETH, borrowAmount)
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .remainingAccounts([
          { pubkey: FEEDS.USDC, isSigner: false, isWritable: false }, // Deposit oracle
          { pubkey: FEEDS.BTC, isSigner: false, isWritable: false },  // Deposit oracle
          { pubkey: FEEDS.ETH, isSigner: false, isWritable: false },  // Borrow oracle (will be added)
        ])
        .signers([user0Wallet])
        .rpc();

      await printTransactionLogs(txSig2, "Add ETH Borrow with All Oracle Accounts");

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(obligation.deposits.length, 2);
      assert.strictEqual(obligation.borrows.length, 1);
    });

    it("remove deposit with health check (all oracles required)", async () => {
      const removeAmount = new BN(25000000); // Remove 0.25 BTC
      
      // Fetch current obligation to know what oracles we need
      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      
      // Collect all unique oracle pubkeys
      const oracleSet = new Set<string>();
      obligation.deposits.forEach(d => oracleSet.add(d.asset.toBase58()));
      obligation.borrows.forEach(b => oracleSet.add(b.asset.toBase58()));
      
      const oracleAccounts = Array.from(oracleSet).map(pubkey => ({
        pubkey: new web3.PublicKey(pubkey),
        isSigner: false,
        isWritable: false
      }));

      console.log("\nOracle accounts being passed:", oracleAccounts.map(o => o.pubkey.toBase58()));

      const txSig = await program.methods
        .removeDeposit(FEEDS.BTC, removeAmount)
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .remainingAccounts(oracleAccounts)
        .signers([user0Wallet])
        .rpc();

      await printTransactionLogs(txSig, "Remove BTC Deposit with Health Check");

      const updatedObligation = await program.account.obligation.fetch(user0ObligationPda);
      const btcDeposit = updatedObligation.deposits.find(d => d.asset.toBase58() === FEEDS.BTC.toBase58());
      assert.isNotNull(btcDeposit);
      assert.strictEqual(btcDeposit!.amount.toString(), "25000000"); // 0.5 - 0.25 = 0.25 BTC
    });
 
    it("complex scenario - user1 with multiple operations and health checks", async () => {
      // Initialize user1 obligation
      const initTx = await program.methods
        .initObligation()
        .accounts({
          obligation: user1ObligationPda,
          owner: user1Wallet.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([user1Wallet])
        .rpc();

      await printTransactionLogs(initTx, "Initialize User1 Obligation");

      // Add multiple deposits
      const btcTx = await program.methods
        .addDeposit(FEEDS.BTC, new BN(100000000)) // 1 BTC
        .accounts({
          obligation: user1ObligationPda,
          owner: user1Wallet.publicKey,
        })
        .signers([user1Wallet])
        .rpc();

      await printTransactionLogs(btcTx, "User1: Add 1 BTC Deposit");

      const ethTx = await program.methods
        .addDeposit(FEEDS.ETH, new BN(500000000)) // 5 ETH
        .accounts({
          obligation: user1ObligationPda,
          owner: user1Wallet.publicKey,
        })
        .remainingAccounts([
          { pubkey: FEEDS.BTC, isSigner: false, isWritable: false },
        ])
        .signers([user1Wallet])
        .rpc();

      await printTransactionLogs(ethTx, "User1: Add 5 ETH Deposit");

      // Add borrows with all necessary oracles
      const borrowTx = await program.methods
        .addBorrow(FEEDS.USDT, new BN(5000000)) // 5 USDT
        .accounts({
          obligation: user1ObligationPda,
          owner: user1Wallet.publicKey,
        })
        .remainingAccounts([
          { pubkey: FEEDS.BTC, isSigner: false, isWritable: false },
          { pubkey: FEEDS.ETH, isSigner: false, isWritable: false },
          { pubkey: FEEDS.USDT, isSigner: false, isWritable: false },
        ])
        .signers([user1Wallet])
        .rpc();

      await printTransactionLogs(borrowTx, "User1: Add 5 USDT Borrow with Full Health Check");

      // Final state check
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
    });

    it("remove deposit that would make position unhealthy (demonstration)", async () => {
      // Try to remove most of the USDC deposit while having borrows
      const removeAmount = new BN(900000); // Remove 0.9 USDC (leaving only 0.1)
      
      // Get all oracles
      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      const oracleSet = new Set<string>();
      obligation.deposits.forEach(d => oracleSet.add(d.asset.toBase58()));
      obligation.borrows.forEach(b => oracleSet.add(b.asset.toBase58()));
      
      const oracleAccounts = Array.from(oracleSet).map(pubkey => ({
        pubkey: new web3.PublicKey(pubkey),
        isSigner: false,
        isWritable: false
      }));

      const txSig = await program.methods
        .removeDeposit(FEEDS.USDC, removeAmount)
        .accounts({
          obligation: user0ObligationPda,
          owner: user0Wallet.publicKey,
        })
        .remainingAccounts(oracleAccounts)
        .signers([user0Wallet])
        .rpc();

      await printTransactionLogs(txSig, "Remove Deposit That May Cause Unhealthy Position");
    });

    it("remove all borrows to make position healthy again", async () => {
      // First remove ETH borrow
      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      const ethBorrow = obligation.borrows.find(b => b.asset.toBase58() === FEEDS.ETH.toBase58());
      
      if (ethBorrow) {
        const oracleSet = new Set<string>();
        obligation.deposits.forEach(d => oracleSet.add(d.asset.toBase58()));
        obligation.borrows.forEach(b => oracleSet.add(b.asset.toBase58()));
        
        const oracleAccounts = Array.from(oracleSet).map(pubkey => ({
          pubkey: new web3.PublicKey(pubkey),
          isSigner: false,
          isWritable: false
        }));

        const txSig = await program.methods
          .removeBorrow(FEEDS.ETH, ethBorrow.amount)
          .accounts({
            obligation: user0ObligationPda,
            owner: user0Wallet.publicKey,
          })
          .remainingAccounts(oracleAccounts)
          .signers([user0Wallet])
          .rpc();

        await printTransactionLogs(txSig, "Remove All ETH Borrows");
      }

      // Then remove USDT borrow
      const updatedObligation = await program.account.obligation.fetch(user0ObligationPda);
      const usdtBorrow = updatedObligation.borrows.find(b => b.asset.toBase58() === FEEDS.USDT.toBase58());
      
      if (usdtBorrow) {
        const oracleSet = new Set<string>();
        updatedObligation.deposits.forEach(d => oracleSet.add(d.asset.toBase58()));
        updatedObligation.borrows.forEach(b => oracleSet.add(b.asset.toBase58()));
        
        const oracleAccounts = Array.from(oracleSet).map(pubkey => ({
          pubkey: new web3.PublicKey(pubkey),
          isSigner: false,
          isWritable: false
        }));

        const txSig = await program.methods
          .removeBorrow(FEEDS.USDT, usdtBorrow.amount)
          .accounts({
            obligation: user0ObligationPda,
            owner: user0Wallet.publicKey,
          })
          .remainingAccounts(oracleAccounts)
          .signers([user0Wallet])
          .rpc();

        await printTransactionLogs(txSig, "Remove All USDT Borrows - Position Now Healthy");
      }

      // Verify final state
      const finalObligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(finalObligation.borrows.length, 0);
      console.log("\n✅ All borrows removed - position is now healthy with no debt!");
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