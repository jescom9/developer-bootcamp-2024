// tests/comprehensive-test.ts - Comprehensive Solana Development Test Suite
import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import BN from "bn.js"
import { assert } from "chai";
import type { Favorites } from "../target/types/favorites";

// ========== TEST CONFIGURATION ==========
const TEST_CONFIG = {
  // Risk Parameter Operations
  INIT_RISK_PARAMS: true,
  UPDATE_RISK_PARAMS: true,
  REMOVE_RISK_PARAMS: true,
  
  // Obligation Operations  
  INIT_OBLIGATIONS: true,
  UPDATE_OBLIGATIONS: true,
  REMOVE_OBLIGATIONS: true,
  
  // Advanced Testing
  HEALTH_CHECKS: true,
  COMPLEX_SCENARIOS: true,
  ERROR_TESTING: true,
  
  // Cleanup Operations
  CLEANUP_ALL: true,
  
  // Development Features
  DETAILED_LOGS: true,
  PERFORMANCE_TESTING: false,
};

describe("favorites - comprehensive solana development test suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Favorites as anchor.Program<Favorites>;
  const payer = provider.wallet.publicKey;

  // Test feeds (mock oracle addresses)
  const FEEDS = {
    BTC: new web3.PublicKey("6PxBx93S8x3tno1TsFZwT5VqP8drrRCbCXygEXYNkFJe"),
    ETH: new web3.PublicKey("669U43LNHx7LsVj95uYksnhXUfWKDsdzVqev3V4Jpw3P"), 
    USDC: new web3.PublicKey("2EmfL3MqL3YHABudGNmajjCpR13NNEn9Y4LWxbDm6SwR"),
    USDT: new web3.PublicKey("8QQSUPtdRTboa4bKyMftVNRfGFsB4Vp9d7r39hGKi53e"),
    SOL: new web3.PublicKey("5w3itB5PVAPUk4GravSGn2sDr7xVhDs5w5vgBshqhHH5"),
  };

  // Test users
  const user0Wallet = web3.Keypair.generate();
  const user1Wallet = web3.Keypair.generate();
  const user2Wallet = web3.Keypair.generate();

  // PDAs
  let user0ObligationPda: web3.PublicKey;
  let user1ObligationPda: web3.PublicKey; 
  let user2ObligationPda: web3.PublicKey;

  // Helper function to get risk parameter PDA
  const getPairPda = async (feedA: web3.PublicKey, feedB: web3.PublicKey) => {
    return web3.PublicKey.findProgramAddressSync(
      [Buffer.from("risk_pair"), feedA.toBuffer(), feedB.toBuffer()],
      program.programId
    );
  };

  // Helper function to print detailed logs
  const printTransactionLogs = async (txSig: string, testName: string) => {
    if (!TEST_CONFIG.DETAILED_LOGS) return;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`=== ${testName} ===`);
    console.log(`${'='.repeat(60)}`);
    console.log("Transaction signature:", txSig);

    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      const tx = await provider.connection.getTransaction(txSig, {
        commitment: "confirmed",
      });

      if (tx?.meta?.logMessages) {
        const programLogs = tx.meta.logMessages.filter((log: string) => 
          log.includes("Program log:")
        );
        console.log("\n--- Program Logs ---");
        programLogs.forEach((log: string) => {
          console.log(log.replace("Program log: ", ""));
        });
      }
    } catch (error) {
      console.error("Error fetching logs:", error);
    }
  };

  before(async () => {
    console.log('\n=== SETUP PHASE ===');
    console.log('Test Configuration:', TEST_CONFIG);
    
    // Fund test users
    for (const wallet of [user0Wallet, user1Wallet, user2Wallet]) {
      const airdrop = await provider.connection.requestAirdrop(
        wallet.publicKey,
        2 * web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdrop);
    }

    // Calculate obligation PDAs
    [user0ObligationPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('obligation'), user0Wallet.publicKey.toBuffer()],
      program.programId
    );
    [user1ObligationPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('obligation'), user1Wallet.publicKey.toBuffer()],
      program.programId
    );
    [user2ObligationPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('obligation'), user2Wallet.publicKey.toBuffer()],
      program.programId
    );

    console.log('User wallets and PDAs calculated ✓');
  });

  // ========== RISK PARAMETER MANAGEMENT ==========
  if (TEST_CONFIG.INIT_RISK_PARAMS) {
    describe("Risk Parameter Initialization", () => {
      it("initialize BTC-ETH risk pair", async () => {
        const [pda] = await getPairPda(FEEDS.BTC, FEEDS.ETH);
        const txSig = await program.methods
          .initializePairRiskParam(77)
          .accounts({
            riskParam: pda,
            payer,
            feedA: FEEDS.BTC,
            feedB: FEEDS.ETH,
            systemProgram: web3.SystemProgram.programId,
          })
          .rpc();

        await printTransactionLogs(txSig, "Initialize BTC-ETH Risk Pair");
        
        const riskParam = await program.account.riskParam.fetch(pda);
        assert.equal(riskParam.riskLevel, 77);
        console.log("✓ BTC-ETH risk pair initialized with level 77");
      });

      it("initialize USDC-USDT risk pair", async () => {
        const [pda] = await getPairPda(FEEDS.USDC, FEEDS.USDT);
        const txSig = await program.methods
          .initializePairRiskParam(99)
          .accounts({
            riskParam: pda,
            payer,
            feedA: FEEDS.USDC,
            feedB: FEEDS.USDT,
            systemProgram: web3.SystemProgram.programId,
          })
          .rpc();

        await printTransactionLogs(txSig, "Initialize USDC-USDT Risk Pair");
        console.log("✓ USDC-USDT risk pair initialized with level 99");
      });

      it("initialize SOL-ETH risk pair", async () => {
        const [pda] = await getPairPda(FEEDS.SOL, FEEDS.ETH);
        await program.methods
          .initializePairRiskParam(65)
          .accounts({
            riskParam: pda,
            payer,
            feedA: FEEDS.SOL,
            feedB: FEEDS.ETH,
            systemProgram: web3.SystemProgram.programId,
          })
          .rpc();
        console.log("✓ SOL-ETH risk pair initialized with level 65");
      });
    });
  }

  if (TEST_CONFIG.UPDATE_RISK_PARAMS) {
    describe("Risk Parameter Updates", () => {
      it("update BTC-ETH risk level", async () => {
        const [pda] = await getPairPda(FEEDS.BTC, FEEDS.ETH);
        const txSig = await program.methods
          .updatePairRiskParam(85)
          .accounts({
            riskParam: pda,
            feedA: FEEDS.BTC,
            feedB: FEEDS.ETH,
          })
          .rpc();

        await printTransactionLogs(txSig, "Update BTC-ETH Risk Level");
        
        const riskParam = await program.account.riskParam.fetch(pda);
        assert.equal(riskParam.riskLevel, 85);
        console.log("✓ BTC-ETH risk level updated to 85");
      });

      it("update USDC-USDT risk level", async () => {
        const [pda] = await getPairPda(FEEDS.USDC, FEEDS.USDT);
        await program.methods
          .updatePairRiskParam(95)
          .accounts({
            riskParam: pda,
            feedA: FEEDS.USDC,
            feedB: FEEDS.USDT,
          })
          .rpc();
        console.log("✓ USDC-USDT risk level updated to 95");
      });
    });
  }

  // ========== OBLIGATION MANAGEMENT ==========
  if (TEST_CONFIG.INIT_OBLIGATIONS) {
    describe("Obligation Initialization", () => {
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
        console.log("✓ User0 obligation initialized");
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
        console.log("✓ User1 obligation initialized");
      });

      it("initialize user2 obligation", async () => {
        await program.methods
          .initObligation()
          .accounts({
            obligation: user2ObligationPda,
            owner: user2Wallet.publicKey,
            systemProgram: web3.SystemProgram.programId,
          })
          .signers([user2Wallet])
          .rpc();
        console.log("✓ User2 obligation initialized");
      });
    });
  }

  if (TEST_CONFIG.UPDATE_OBLIGATIONS) {
    describe("Obligation Updates", () => {
      it("user0: add BTC deposit", async () => {
        const txSig = await program.methods
          .addDeposit(FEEDS.BTC, new BN(100000000)) // 1 BTC
          .accounts({
            obligation: user0ObligationPda,
            owner: user0Wallet.publicKey,
          })
          .signers([user0Wallet])
          .rpc();

        await printTransactionLogs(txSig, "User0 Add BTC Deposit");
        console.log("✓ User0 deposited 1 BTC");
      });

      it("user0: add USDC deposit", async () => {
        await program.methods
          .addDeposit(FEEDS.USDC, new BN(50000000)) // 50 USDC
          .accounts({
            obligation: user0ObligationPda,
            owner: user0Wallet.publicKey,
          })
          .signers([user0Wallet])
          .rpc();
        console.log("✓ User0 deposited 50 USDC");
      });

      it("user0: add ETH borrow", async () => {
        const txSig = await program.methods
          .addBorrow(FEEDS.ETH, new BN(5000000)) // 0.05 ETH
          .accounts({
            obligation: user0ObligationPda,
            owner: user0Wallet.publicKey,
          })
          .signers([user0Wallet])
          .rpc();

        await printTransactionLogs(txSig, "User0 Add ETH Borrow");
        console.log("✓ User0 borrowed 0.05 ETH");
      });

      it("user1: complex position setup", async () => {
        // Multiple deposits
        await program.methods
          .addDeposit(FEEDS.ETH, new BN(200000000)) // 2 ETH
          .accounts({
            obligation: user1ObligationPda,
            owner: user1Wallet.publicKey,
          })
          .signers([user1Wallet])
          .rpc();

        await program.methods
          .addDeposit(FEEDS.SOL, new BN(1000000000)) // 1000 SOL
          .accounts({
            obligation: user1ObligationPda,
            owner: user1Wallet.publicKey,
          })
          .signers([user1Wallet])
          .rpc();

        // Multiple borrows
        await program.methods
          .addBorrow(FEEDS.USDC, new BN(1000000)) // 1 USDC
          .accounts({
            obligation: user1ObligationPda,
            owner: user1Wallet.publicKey,
          })
          .signers([user1Wallet])
          .rpc();

        console.log("✓ User1 complex position established");
      });
    });
  }

  // ========== HEALTH CHECK TESTING ==========
  if (TEST_CONFIG.HEALTH_CHECKS) {
    describe("Health Check Validation", () => {
      it("calculate risk between deposits and borrows", async () => {
        const [btcEthPda] = await getPairPda(FEEDS.BTC, FEEDS.ETH);
        const txSig = await program.methods
          .calculateRisk(
            new BN(100000000), // 1 BTC deposit
            new BN(5000000),   // 0.05 ETH borrow
            new BN(30000),     // BTC price
            8,                 // BTC decimals
            new BN(2000),      // ETH price
            8                  // ETH decimals
          )
          .accounts({
            riskParam: btcEthPda,
            depositFeed: FEEDS.BTC,
            borrowFeed: FEEDS.ETH,
          })
          .rpc();

        await printTransactionLogs(txSig, "Calculate BTC-ETH Risk");
        console.log("✓ Risk calculation completed");
      });

      it("test aggregate health factor calculation", async () => {
        const txSig = await program.methods
          .calculateAggregateHealthFactor()
          .accounts({
            obligation: user0ObligationPda,
            owner: user0Wallet.publicKey,
          })
          .remainingAccounts([
            { pubkey: FEEDS.BTC, isWritable: false, isSigner: false },
            { pubkey: FEEDS.ETH, isWritable: false, isSigner: false },
            { pubkey: FEEDS.USDC, isWritable: false, isSigner: false },
          ])
          .signers([user0Wallet])
          .rpc();

        await printTransactionLogs(txSig, "Aggregate Health Factor Calculation");
        console.log("✓ Aggregate health factor calculated");
      });
    });
  }

  // ========== ERROR TESTING ==========
  if (TEST_CONFIG.ERROR_TESTING) {
    describe("Error Handling", () => {
      it("test insufficient deposit removal", async () => {
        try {
          await program.methods
            .removeDeposit(FEEDS.BTC, new BN(200000000)) // Try to remove 2 BTC (only have 1)
            .accounts({
              obligation: user0ObligationPda,
              owner: user0Wallet.publicKey,
            })
            .signers([user0Wallet])
            .rpc();
          assert.fail("Should have thrown error");
        } catch (error) {
          assert.include(error.message, "Insufficient deposit");
          console.log("✓ Correctly rejected insufficient deposit removal");
        }
      });

      it("test non-existent asset removal", async () => {
        try {
          await program.methods
            .removeDeposit(FEEDS.USDT, new BN(1000000))
            .accounts({
              obligation: user0ObligationPda,
              owner: user0Wallet.publicKey,
            })
            .signers([user0Wallet])
            .rpc();
          assert.fail("Should have thrown error");
        } catch (error) {
          assert.include(error.message, "Deposit not found");
          console.log("✓ Correctly rejected non-existent asset removal");
        }
      });
    });
  } 

  // ========== REMOVAL OPERATIONS ==========
  if (TEST_CONFIG.REMOVE_OBLIGATIONS) {
    describe("Position Cleanup", () => {
      it("user0: remove partial positions", async () => {
        await program.methods
          .removeDeposit(FEEDS.USDC, new BN(25000000)) // Remove 25 USDC
          .accounts({
            obligation: user0ObligationPda,
            owner: user0Wallet.publicKey,
          })
          .signers([user0Wallet])
          .rpc();

        await program.methods
          .removeBorrow(FEEDS.ETH, new BN(2500000)) // Remove 0.025 ETH
          .accounts({
            obligation: user0ObligationPda,
            owner: user0Wallet.publicKey,
          })
          .signers([user0Wallet])
          .rpc();

        console.log("✓ User0 partial position cleanup completed");
      });

      it("user1: complete position reset", async () => {
        const obligation = await program.account.obligation.fetch(user1ObligationPda);
        
        // Remove all borrows first
        for (const borrow of obligation.borrows) {
          await program.methods
            .removeBorrow(borrow.asset, borrow.amount)
            .accounts({
              obligation: user1ObligationPda,
              owner: user1Wallet.publicKey,
            })
            .signers([user1Wallet])
            .rpc();
        }

        // Remove all deposits
        for (const deposit of obligation.deposits) {
          await program.methods
            .removeDeposit(deposit.asset, deposit.amount)
            .accounts({
              obligation: user1ObligationPda,
              owner: user1Wallet.publicKey,
            })
            .signers([user1Wallet])
            .rpc();
        }

        const cleanObligation = await program.account.obligation.fetch(user1ObligationPda);
        assert.equal(cleanObligation.deposits.length, 0);
        assert.equal(cleanObligation.borrows.length, 0);
        console.log("✓ User1 complete position reset");
      });
    });
  }

  // ========== CLEANUP OPERATIONS ==========
  if (TEST_CONFIG.CLEANUP_ALL) {
    describe("Cleanup", () => {
      it("delete USDC-USDT risk pair", async () => {
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
          console.log("✓ USDC-USDT risk pair deleted");
        }
      });

      it("delete BTC-ETH risk pair", async () => {
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
          console.log("✓ BTC-ETH risk pair deleted");
        }
      });

      it("delete SOL-ETH risk pair", async () => {
        const [pda] = await getPairPda(FEEDS.SOL, FEEDS.ETH);
        await program.methods
          .deletePairRiskParam()
          .accounts({
            riskParam: pda,
            payer,
            feedA: FEEDS.SOL,
            feedB: FEEDS.ETH,
          })
          .rpc();
        console.log("✓ SOL-ETH risk pair deleted");
      });

      it("summary report", async () => {
        console.log("\n" + "=".repeat(60));
        console.log("=== COMPREHENSIVE TEST SUITE COMPLETED ===");
        console.log("=".repeat(60));
        console.log("Configuration used:", TEST_CONFIG);
        
        // Check remaining obligations
        for (const [idx, pda] of [user0ObligationPda, user1ObligationPda, user2ObligationPda].entries()) {
          try {
            const obligation = await program.account.obligation.fetch(pda);
            console.log(`User${idx} final state: ${obligation.deposits.length} deposits, ${obligation.borrows.length} borrows`);
          } catch (e) {
            console.log(`User${idx}: Obligation account deleted or not found`);
          }
        }
        console.log("✓ Test suite completed successfully");
      });
    });
  }
}); 