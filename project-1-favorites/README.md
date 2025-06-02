# 📊 Favorites — Risk Parameters for Asset Pairs

This Solana Anchor program allows you to store, update, delete, and read **risk parameters** for pairs of asset feeds (e.g., Chainlink oracles). Each risk parameter is saved using a **Program Derived Address (PDA)** based on the combination of two feed public keys. The order of feeds is **irrelevant** — `(A, B)` is treated the same as `(B, A)`.

---

## 🧠 Features

- ✅ Store risk level (`u8`) per asset pair (e.g., BTC-ETH, USDC-USDT)
- ✅ Use deterministic, order-insensitive PDA
- ✅ Initialize, update, and delete risk parameters
- ✅ No user-specific state or permissions

---

## 📁 Program Structure

### PDA Seeds
 
["risk_pair", sorted_feed_a, sorted_feed_b]
 RUSTUP_TOOLCHAIN=nightly-2025-04-01 anchor build /deploy /test --skip-local-validator
 
