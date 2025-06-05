// tests/favorites.ts
import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import BN from "bn.js"
import { assert } from "chai";
import type { Favorites } from "../target/types/favorites";

describe("favorites - asset registry and obligations", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Favorites as anchor.Program<Favorites>;
  const authority = provider.wallet.publicKey;

  // Test user wallets
  const user0Wallet = web3.Keypair.generate();
  const user1Wallet = web3.Keypair.generate();

  // Asset IDs
  const ASSET_IDS = {
    BTC: 0,
    ETH: 1,
    USDC: 2,
    USDT: 3,
  };

  // PDAs
  let assetRegistryPda: web3.PublicKey;
  let user0ObligationPda: web3.PublicKey;
  let user1ObligationPda: web3.PublicKey;

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
          log.includes("Asset Registry initialized") ||
          log.includes("Added asset") ||
          log.includes("Updated asset") ||
          log.includes("Added risk param") ||
          log.includes("Obligation initialized") ||
          log.includes("Health") ||
          log.includes("WARNING") ||
          log.includes("Adding") ||
          log.includes("Removing") ||
          log.includes("Current deposits") ||
          log.includes("Deposit:") ||
          log.includes("Borrow:") ||
          log.includes("=== ")
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

  // Setup phase
  before(async () => {
    console.log('\n=== Setting up test environment ===');
    
    // Calculate PDAs
    [assetRegistryPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("asset_registry")],
      program.programId
    );
    console.log("Asset Registry PDA:", assetRegistryPda.toBase58());

    [user0ObligationPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('obligation'), user0Wallet.publicKey.toBuffer()],
      program.programId
    );
    console.log('User0 Obligation PDA:', user0ObligationPda.toBase58());

    [user1ObligationPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('obligation'), user1Wallet.publicKey.toBuffer()],
      program.programId
    );
    console.log('User1 Obligation PDA:', user1ObligationPda.toBase58());
    
    // Fund user wallets
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

  describe("Asset Registry", () => {
    it("initialize asset registry", async () => {
      const txSig = await program.methods
        .initializeAssetRegistry()
        .accounts({
          assetRegistry: assetRegistryPda,
          authority,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();

      await printTransactionLogs(txSig, "Initialize Asset Registry");

      const registry = await program.account.assetRegistry.fetch(assetRegistryPda);
      assert.strictEqual(registry.authority.toBase58(), authority.toBase58());
      assert.strictEqual(registry.assets.length, 0);
      assert.strictEqual(registry.riskParams.length, 0);
    });

    it("add BTC asset", async () => {
      const txSig = await program.methods
        .addAsset(
          ASSET_IDS.BTC,  // id
          new BN(30000),  // price: $30,000
          8               // decimals
        )
        .accounts({
          assetRegistry: assetRegistryPda,
          authority,
        })
        .rpc();

      await printTransactionLogs(txSig, "Add BTC Asset");

      const registry = await program.account.assetRegistry.fetch(assetRegistryPda);
      assert.strictEqual(registry.assets.length, 1);
      assert.strictEqual(registry.assets[0].id, ASSET_IDS.BTC);
      assert.strictEqual(registry.assets[0].price.toString(), "30000");
      assert.strictEqual(registry.assets[0].decimals, 8);
    });

    it("add ETH, USDC, and USDT assets", async () => {
      // Add ETH
      await program.methods
        .addAsset(
          ASSET_IDS.ETH,
          new BN(2000),   // $2,000
          8
        )
        .accounts({
          assetRegistry: assetRegistryPda,
          authority,
        })
        .rpc();

      // Add USDC
      await program.methods
        .addAsset(
          ASSET_IDS.USDC,
          new BN(1),      // $1
          6
        )
        .accounts({
          assetRegistry: assetRegistryPda,
          authority,
        })
        .rpc();

      // Add USDT
      const txSig = await program.methods
        .addAsset(
          ASSET_IDS.USDT,
          new BN(1),      // $1
          6
        )
        .accounts({
          assetRegistry: assetRegistryPda,
          authority,
        })
        .rpc();

      await printTransactionLogs(txSig, "Add USDT Asset");

      const registry = await program.account.assetRegistry.fetch(assetRegistryPda);
      assert.strictEqual(registry.assets.length, 4);
      
      // Verify all assets
      console.log("\n--- All Assets in Registry ---");
      registry.assets.forEach(asset => {
        console.log(`Asset ID ${asset.id}: price=${asset.price}, decimals=${asset.decimals}`);
      });
    });

    it("update BTC price", async () => {
      const txSig = await program.methods
        .updateAssetPrice(
          ASSET_IDS.BTC,
          new BN(35000)   // New price: $35,000
        )
        .accounts({
          assetRegistry: assetRegistryPda,
          authority,
        })
        .rpc();

      await printTransactionLogs(txSig, "Update BTC Price");

      const registry = await program.account.assetRegistry.fetch(assetRegistryPda);
      const btcAsset = registry.assets.find(a => a.id === ASSET_IDS.BTC);
      assert.strictEqual(btcAsset.price.toString(), "35000");
    });

    it("add risk parameters", async () => {
      // BTC-ETH risk param
      await program.methods
        .addRiskParam(
          ASSET_IDS.BTC,
          ASSET_IDS.ETH,
          77              // risk level
        )
        .accounts({
          assetRegistry: assetRegistryPda,
          authority,
        })
        .rpc();

      // USDC-USDT risk param
      const txSig = await program.methods
        .addRiskParam(
          ASSET_IDS.USDC,
          ASSET_IDS.USDT,
          99              // risk level
        )
        .accounts({
          assetRegistry: assetRegistryPda,
          authority,
        })
        .rpc();

      await printTransactionLogs(txSig, "Add USDC-USDT Risk Param");

      const registry = await program.account.assetRegistry.fetch(assetRegistryPda);
      assert.strictEqual(registry.riskParams.length, 2);
      
      console.log("\n--- All Risk Parameters ---");
      registry.riskParams.forEach(param => {
        console.log(`Risk Param: ${param.assetIdA}-${param.assetIdB}, level=${param.riskLevel}`);
      });
    });

    it("test error: add duplicate asset", async () => {
      try {
        await program.methods
          .addAsset(
            ASSET_IDS.BTC,  // Already exists
            new BN(40000),
            8
          )
          .accounts({
            assetRegistry: assetRegistryPda,
            authority,
          })
          .rpc();
        
        assert.fail("Should have thrown AssetAlreadyExists error");
      } catch (error) {
        assert.include(error.message, "Asset already exists");
      }
    });
  });

  describe("Obligations with Asset Registry", () => {
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

    it("add USDC deposit", async () => {
      const depositAmount = new BN(1000000); // 1 USDC (6 decimals)
      
      const txSig = await program.methods
        .addDeposit(ASSET_IDS.USDC, depositAmount)
        .accounts({
          obligation: user0ObligationPda,
          assetRegistry: assetRegistryPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      await printTransactionLogs(txSig, "Add USDC Deposit");

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(obligation.deposits.length, 1);
      assert.strictEqual(obligation.deposits[0].assetId, ASSET_IDS.USDC);
      assert.strictEqual(obligation.deposits[0].amount.toString(), depositAmount.toString());
    });

    it("add BTC deposit and ETH borrow", async () => {
      // Add BTC deposit
      const btcAmount = new BN(50000000); // 0.5 BTC (8 decimals)
      
      const txSig1 = await program.methods
        .addDeposit(ASSET_IDS.BTC, btcAmount)
        .accounts({
          obligation: user0ObligationPda,
          assetRegistry: assetRegistryPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      await printTransactionLogs(txSig1, "Add BTC Deposit");

      // Add ETH borrow
      const borrowAmount = new BN(10000000); // 0.1 ETH (8 decimals)
      
      const txSig2 = await program.methods
        .addBorrow(ASSET_IDS.ETH, borrowAmount)
        .accounts({
          obligation: user0ObligationPda,
          assetRegistry: assetRegistryPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      await printTransactionLogs(txSig2, "Add ETH Borrow");

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(obligation.deposits.length, 2);
      assert.strictEqual(obligation.borrows.length, 1);
    });

    it("debug read all data", async () => {
      const txSig = await program.methods
        .debugReadAllData()
        .accounts({
          assetRegistry: assetRegistryPda,
          obligation: user0ObligationPda,
        })
        .rpc();

      await printTransactionLogs(txSig, "Debug Read All Data");
    });

    it("remove partial deposit", async () => {
      const removeAmount = new BN(25000000); // Remove 0.25 BTC
      
      const txSig = await program.methods
        .removeDeposit(ASSET_IDS.BTC, removeAmount)
        .accounts({
          obligation: user0ObligationPda,
          assetRegistry: assetRegistryPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      await printTransactionLogs(txSig, "Remove Partial BTC Deposit");

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      const btcDeposit = obligation.deposits.find(d => d.assetId === ASSET_IDS.BTC);
      assert.isNotNull(btcDeposit);
      assert.strictEqual(btcDeposit!.amount.toString(), "25000000"); // 0.5 - 0.25 = 0.25 BTC
    });

    it("test error: remove deposit for non-existent asset", async () => {
      try {
        await program.methods
          .removeDeposit(99, new BN(1000000)) // Asset ID 99 doesn't exist
          .accounts({
            obligation: user0ObligationPda,
            assetRegistry: assetRegistryPda,
            owner: user0Wallet.publicKey,
          })
          .signers([user0Wallet])
          .rpc();
        
        assert.fail("Should have thrown DepositNotFound error");
      } catch (error) {
        assert.include(error.message, "Deposit not found");
      }
    });

    it("test error: insufficient deposit", async () => {
      const tooMuchAmount = new BN(30000000); // Try to remove 0.3 BTC (only have 0.25)
      
      try {
        await program.methods
          .removeDeposit(ASSET_IDS.BTC, tooMuchAmount)
          .accounts({
            obligation: user0ObligationPda,
            assetRegistry: assetRegistryPda,
            owner: user0Wallet.publicKey,
          })
          .signers([user0Wallet])
          .rpc();
        
        assert.fail("Should have thrown InsufficientDeposit error");
      } catch (error) {
        assert.include(error.message, "Insufficient deposit amount");
      }
    });

    it("remove all ETH borrow", async () => {
      const removeAmount = new BN(10000000); // Remove all 0.1 ETH
      
      const txSig = await program.methods
        .removeBorrow(ASSET_IDS.ETH, removeAmount)
        .accounts({
          obligation: user0ObligationPda,
          assetRegistry: assetRegistryPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      await printTransactionLogs(txSig, "Remove All ETH Borrow");

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      assert.strictEqual(obligation.borrows.length, 0);
    });

    it("complex scenario - user1 operations", async () => {
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
        .addDeposit(ASSET_IDS.BTC, new BN(100000000)) // 1 BTC
        .accounts({
          obligation: user1ObligationPda,
          assetRegistry: assetRegistryPda,
          owner: user1Wallet.publicKey,
        })
        .signers([user1Wallet])
        .rpc();

      await printTransactionLogs(btcTx, "User1: Add 1 BTC Deposit");

      const ethTx = await program.methods
        .addDeposit(ASSET_IDS.ETH, new BN(500000000)) // 5 ETH
        .accounts({
          obligation: user1ObligationPda,
          assetRegistry: assetRegistryPda,
          owner: user1Wallet.publicKey,
        })
        .signers([user1Wallet])
        .rpc();

      await printTransactionLogs(ethTx, "User1: Add 5 ETH Deposit");

      // Add borrows
      const borrowTx = await program.methods
        .addBorrow(ASSET_IDS.USDT, new BN(5000000)) // 5 USDT
        .accounts({
          obligation: user1ObligationPda,
          assetRegistry: assetRegistryPda,
          owner: user1Wallet.publicKey,
        })
        .signers([user1Wallet])
        .rpc();

      await printTransactionLogs(borrowTx, "User1: Add 5 USDT Borrow");

      // Debug read user1's final state
      const debugTx = await program.methods
        .debugReadAllData()
        .accounts({
          assetRegistry: assetRegistryPda,
          obligation: user1ObligationPda,
        })
        .rpc();

      await printTransactionLogs(debugTx, "User1: Debug Final State");

      // Verify final state
      const obligation = await program.account.obligation.fetch(user1ObligationPda);
      assert.strictEqual(obligation.deposits.length, 2);
      assert.strictEqual(obligation.borrows.length, 1);
      
      console.log("\n=== User1 Final Obligation State ===");
      console.log("Deposits:", obligation.deposits.map(d => ({
        assetId: d.assetId,
        amount: d.amount.toString()
      })));
      console.log("Borrows:", obligation.borrows.map(b => ({
        assetId: b.assetId,
        amount: b.amount.toString()
      })));
    });

    it("add more deposits to same asset (test accumulation)", async () => {
      // Add more USDC to user0
      const additionalAmount = new BN(500000); // 0.5 USDC
      
      const txSig = await program.methods
        .addDeposit(ASSET_IDS.USDC, additionalAmount)
        .accounts({
          obligation: user0ObligationPda,
          assetRegistry: assetRegistryPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      await printTransactionLogs(txSig, "Add Additional USDC Deposit");

      const obligation = await program.account.obligation.fetch(user0ObligationPda);
      const usdcDeposit = obligation.deposits.find(d => d.assetId === ASSET_IDS.USDC);
      assert.isNotNull(usdcDeposit);
      assert.strictEqual(usdcDeposit!.amount.toString(), "1500000"); // 1 + 0.5 = 1.5 USDC
    });

    it("test zero amount operations (should be no-op)", async () => {
      const obligationBefore = await program.account.obligation.fetch(user0ObligationPda);
      
      // Try adding zero deposit
      await program.methods
        .addDeposit(ASSET_IDS.BTC, new BN(0))
        .accounts({
          obligation: user0ObligationPda,
          assetRegistry: assetRegistryPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      // Try removing zero deposit
      await program.methods
        .removeDeposit(ASSET_IDS.USDC, new BN(0))
        .accounts({
          obligation: user0ObligationPda,
          assetRegistry: assetRegistryPda,
          owner: user0Wallet.publicKey,
        })
        .signers([user0Wallet])
        .rpc();

      const obligationAfter = await program.account.obligation.fetch(user0ObligationPda);
      
      // State should be unchanged
      assert.deepEqual(
        obligationBefore.deposits.map(d => ({ id: d.assetId, amount: d.amount.toString() })),
        obligationAfter.deposits.map(d => ({ id: d.assetId, amount: d.amount.toString() }))
      );
    });

    it("verify asset registry has all data", async () => {
      const registry = await program.account.assetRegistry.fetch(assetRegistryPda);
      
      console.log("\n=== Final Asset Registry State ===");
      console.log("Authority:", registry.authority.toBase58());
      console.log("\nAssets:");
      registry.assets.forEach(asset => {
        const name = Object.keys(ASSET_IDS).find(key => ASSET_IDS[key] === asset.id) || "Unknown";
        console.log(`  ${name} (ID ${asset.id}): price=${asset.price}, decimals=${asset.decimals}`);
      });
      
      console.log("\nRisk Parameters:");
      registry.riskParams.forEach(param => {
        const nameA = Object.keys(ASSET_IDS).find(key => ASSET_IDS[key] === param.assetIdA) || "Unknown";
        const nameB = Object.keys(ASSET_IDS).find(key => ASSET_IDS[key] === param.assetIdB) || "Unknown";
        console.log(`  ${nameA}-${nameB}: risk_level=${param.riskLevel}`);
      });
      
      // Verify we have all expected data
      assert.strictEqual(registry.assets.length, 4);
      assert.strictEqual(registry.riskParams.length, 2);
    });
   

    it("test error: duplicate risk param", async () => {
      try {
        await program.methods
          .addRiskParam(
            ASSET_IDS.BTC,
            ASSET_IDS.ETH,
            80  // Different level, but pair already exists
          )
          .accounts({
            assetRegistry: assetRegistryPda,
            authority,
          })
          .rpc();
        
        assert.fail("Should have thrown RiskParamAlreadyExists error");
      } catch (error) {
        assert.include(error.message, "Risk parameter already exists");
      }
    });
  });
});