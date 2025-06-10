// tests/favorites.ts
import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import BN from "bn.js"
import { assert } from "chai";
import type { Favorites } from "../target/types/favorites";

describe("favorites - health score calculation scenarios", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Favorites as anchor.Program<Favorites>;
  const authority = provider.wallet.publicKey;

  // Test user wallet
  const testUser = web3.Keypair.generate();

  // Asset IDs for our test scenario
  const ASSET_A = 0;
  const ASSET_B = 1;
  const ASSET_C = 2;
  const ASSET_D = 3;

  // PDAs
  let assetRegistryPda: web3.PublicKey;
  let testObligationPda: web3.PublicKey;

  // Helper function to extract and print logs
  const printTransactionLogs = async (txSig: string, testName: string) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`=== ${testName} ===`);
    console.log(`${'='.repeat(60)}`);
    console.log("Transaction signature:", txSig);

    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const tx = await provider.connection.getTransaction(txSig, {
        commitment: "confirmed",
      });

      if (!tx || !tx.meta || !tx.meta.logMessages) {
        console.error("❌ Transaction data is incomplete");
        return;
      }

      const programLogs = tx.meta.logMessages.filter((log: string) => 
        log.includes("Program log:") && (
          log.includes("===") ||
          log.includes("Health") ||
          log.includes("Deposit:") ||
          log.includes("Borrow:") ||
          log.includes("WARNING") ||
          log.includes("✓") ||
          log.includes("Pair") ||
          log.includes("contribution")
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

  before(async () => {
    console.log('\n=== SETUP PHASE ===');
    
    // Calculate PDAs
    [assetRegistryPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("asset_registry")],
      program.programId
    );

    [testObligationPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from('obligation'), testUser.publicKey.toBuffer()],
      program.programId
    );
    
    // Fund test user
    const airdrop = await provider.connection.requestAirdrop(
      testUser.publicKey,
      2 * web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdrop);
    
    console.log('Test user wallet:', testUser.publicKey.toBase58());
    console.log('Asset Registry PDA:', assetRegistryPda.toBase58());
    console.log('Test Obligation PDA:', testObligationPda.toBase58());
  });

  describe("Setup", () => {
    it("initialize asset registry", async () => {
      await program.methods
        .initializeAssetRegistry()
        .accounts({
          assetRegistry: assetRegistryPda,
          authority,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();

      console.log("✓ Asset registry initialized");
    });

    it("add all assets with updated prices", async () => {
      // Assets with their respective prices and decimals
      const assets = [
        { id: ASSET_A, name: "USDC", price: 1, decimals: 6 },      // $1.00
        { id: ASSET_B, name: "SOL", price: 157, decimals: 9 },     // $157.00
        { id: ASSET_C, name: "ETH", price: 2749, decimals: 9 },    // $2,749.00
        { id: ASSET_D, name: "BTC", price: 109000, decimals: 8 },  // $109,000.00
      ];

      for (const asset of assets) {
        await program.methods
          .addAsset(
            asset.id,
            new BN(asset.price),    // price in dollars
            asset.decimals          // decimals for the asset
          )
          .accounts({
            assetRegistry: assetRegistryPda,
            authority,
          })
          .rpc();
        console.log(`✓ Added Asset ${asset.name} (ID ${asset.id}) at $${asset.price}`);
      }
    });

    it("add risk parameters", async () => {
      const riskParams = [
        { a: ASSET_A, b: ASSET_B, risk: 80 }, // RiskAB = 0.8
        { a: ASSET_B, b: ASSET_C, risk: 80 }, // RiskBC = 0.8
        { a: ASSET_C, b: ASSET_D, risk: 60 }, // RiskCD = 0.6
        { a: ASSET_A, b: ASSET_C, risk: 90 }, // RiskAC = 0.9
        { a: ASSET_B, b: ASSET_D, risk: 40 }, // RiskBD = 0.4
        { a: ASSET_A, b: ASSET_D, risk: 60 }, // RiskAD = 0.6
      ];

      for (const param of riskParams) {
        await program.methods
          .addRiskParam(param.a, param.b, param.risk)
          .accounts({
            assetRegistry: assetRegistryPda,
            authority,
          })
          .rpc();
        console.log(`✓ Added risk param ${param.a}-${param.b}: ${param.risk/100}`);
      }
    });

    it("initialize test obligation", async () => {
      await program.methods
        .initObligation()
        .accounts({
          obligation: testObligationPda,
          owner: testUser.publicKey,
          systemProgram: web3.SystemProgram.programId,
        })
        .signers([testUser])
        .rpc();

      console.log("✓ Test obligation initialized");
    });
  });

  describe("Test Scenario 1: Health Score = 1.175", () => {
    it("setup position with deposits USDC=$1M, SOL=$1M and borrows ETH=$250K, BTC=$750K", async () => {
      console.log("\n--- Setting up Scenario 1 ---");
      
      // Add deposits
      // USDC: $1,000,000 = 1,000,000 * 10^6 (6 decimals)
      await program.methods
        .addDeposit(ASSET_A, new BN(1000000000000))
        .accounts({
          obligation: testObligationPda,
          assetRegistry: assetRegistryPda,
          owner: testUser.publicKey,
        })
        .signers([testUser])
        .rpc();
      console.log("✓ Deposited $1,000,000 of USDC");

      // SOL: $1,000,000 = ~6,369.43 * 10^9 (9 decimals)
      await program.methods
        .addDeposit(ASSET_B, new BN(6369426757000))
        .accounts({
          obligation: testObligationPda,
          assetRegistry: assetRegistryPda,
          owner: testUser.publicKey,
        })
        .signers([testUser])
        .rpc();
      console.log("✓ Deposited $1,000,000 worth of SOL");

      // Add borrows
      // ETH: $250,000 = ~90.94 * 10^9 (9 decimals)
      const tx1 = await program.methods
        .addBorrow(ASSET_C, new BN(90940000000))
        .accounts({
          obligation: testObligationPda,
          assetRegistry: assetRegistryPda,
          owner: testUser.publicKey,
        })
        .signers([testUser])
        .rpc();
      
      await printTransactionLogs(tx1, "Add Borrow ETH=$250,000");
      console.log("✓ Borrowed $250,000 worth of ETH");

      // BTC: $750,000 = ~6.88 * 10^8 (8 decimals)
      const txSig = await program.methods
        .addBorrow(ASSET_D, new BN(688000000))
        .accounts({
          obligation: testObligationPda,
          assetRegistry: assetRegistryPda,
          owner: testUser.publicKey,
        })
        .signers([testUser])
        .rpc();
      console.log("✓ Borrowed $750,000 worth of BTC");

      await printTransactionLogs(txSig, "Scenario 1 Complete - Expected Health Score: 1.175");

      // Verify position
      const obligation = await program.account.obligation.fetch(testObligationPda);
      console.log("\n--- Position Summary ---");
      console.log("Deposits:");
      obligation.deposits.forEach(d => {
        const value = d.amount.toNumber() / 1000000;
        console.log(`  Asset ${d.assetId}: ${value}`);
      });
      console.log("Borrows:");
      obligation.borrows.forEach(b => {
        const value = b.amount.toNumber() / 1000000;
        console.log(`  Asset ${b.assetId}: ${value}`);
      });
    });
  });

  describe("Test Scenario 2: Health Score = 0.9", () => {
    it(" $750,000 worth of BTC C", async () => {
      console.log("\ $750,000 worth of BTC---");
      
      try {
        const txSig = await program.methods
        .addBorrow(ASSET_C, new BN(688000000))
        .accounts({
          obligation: testObligationPda,
          assetRegistry: assetRegistryPda,
          owner: testUser.publicKey,
        })
        .signers([testUser])
        .rpc();
        console.log("✓ Borrowed $750,000 worth of BTC");

        await printTransactionLogs(txSig, "Scenario 1 Complete - Expected Health Score: 1.175");

        // Verify position
        const obligation = await program.account.obligation.fetch(testObligationPda);
        console.log("\n--- Position Summary ---");
        console.log("Deposits:");
        obligation.deposits.forEach(d => {
          const value = d.amount.toNumber() / 1000000;
          console.log(`  Asset ${d.assetId}: ${value}`);
        });
        console.log("Borrows:");
        obligation.borrows.forEach(b => {
          const value = b.amount.toNumber() / 1000000;
          console.log(`  Asset ${b.assetId}: ${value}`);
        });
      } catch (error) {
        console.log("✓ Correctly rejected unhealthy borrow");
        assert.include(error.message, "Obligation health score is below minimum threshold");
      }  
    });
  });
});
 