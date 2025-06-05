// programs/favorites/src/lib.rs
use anchor_lang::prelude::*;

declare_id!("8tqMBrKPc1p3XTo27d3ytxPyUyZ31mF3LpfG26WvYahf");

#[program]
pub mod favorites {
    use super::*;

    // ========== ASSET REGISTRY INSTRUCTIONS ==========

    pub fn initialize_asset_registry(ctx: Context<InitializeAssetRegistry>) -> Result<()> {
        let registry = &mut ctx.accounts.asset_registry;
        registry.authority = ctx.accounts.authority.key();
        registry.assets = Vec::new();
        registry.risk_params = Vec::new();

        msg!(
            "Asset Registry initialized with authority: {}",
            registry.authority
        );
        Ok(())
    }

    pub fn add_asset(
        ctx: Context<ManageAssetRegistry>,
        id: u8,
        price: u64,
        decimals: u8,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.asset_registry;

        // Check if ID already exists
        if registry.assets.iter().any(|a| a.id == id) {
            return Err(ErrorCode::AssetAlreadyExists.into());
        }

        registry.assets.push(AssetInfo {
            id,
            price,
            decimals,
        });

        msg!(
            "Added asset: id={}, price={}, decimals={}",
            id,
            price,
            decimals
        );
        Ok(())
    }

    pub fn update_asset_price(
        ctx: Context<ManageAssetRegistry>,
        id: u8,
        new_price: u64,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.asset_registry;

        let asset = registry
            .assets
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or(ErrorCode::AssetNotFound)?;

        asset.price = new_price;

        msg!("Updated asset {} price to {}", id, new_price);
        Ok(())
    }

    pub fn add_risk_param(
        ctx: Context<ManageAssetRegistry>,
        asset_id_a: u8,
        asset_id_b: u8,
        risk_level: u8,
    ) -> Result<()> {
        let registry = &mut ctx.accounts.asset_registry;

        // Verify both assets exist
        if !registry.assets.iter().any(|a| a.id == asset_id_a) {
            return Err(ErrorCode::AssetNotFound.into());
        }
        if !registry.assets.iter().any(|a| a.id == asset_id_b) {
            return Err(ErrorCode::AssetNotFound.into());
        }

        // Check if pair already exists
        if registry.risk_params.iter().any(|p| {
            (p.asset_id_a == asset_id_a && p.asset_id_b == asset_id_b)
                || (p.asset_id_a == asset_id_b && p.asset_id_b == asset_id_a)
        }) {
            return Err(ErrorCode::RiskParamAlreadyExists.into());
        }

        registry.risk_params.push(PairRiskParam {
            asset_id_a,
            asset_id_b,
            risk_level,
        });

        msg!(
            "Added risk param: assets {}-{}, level={}",
            asset_id_a,
            asset_id_b,
            risk_level
        );
        Ok(())
    }

    // ========== OBLIGATION INSTRUCTIONS ==========

    pub fn init_obligation(ctx: Context<InitObligation>) -> Result<()> {
        let obligation = &mut ctx.accounts.obligation;
        obligation.owner = ctx.accounts.owner.key();
        obligation.deposits = Vec::new();
        obligation.borrows = Vec::new();

        msg!("Obligation initialized for owner: {}", obligation.owner);
        Ok(())
    }

    pub fn add_deposit(ctx: Context<ModifyObligation>, asset_id: u8, amount: u64) -> Result<()> {
        let obligation = &mut ctx.accounts.obligation;
        let registry = &ctx.accounts.asset_registry;

        // Verify asset exists
        if !registry.assets.iter().any(|a| a.id == asset_id) {
            return Err(ErrorCode::AssetNotFound.into());
        }

        // Add or update deposit
        if let Some(position) = obligation
            .deposits
            .iter_mut()
            .find(|p| p.asset_id == asset_id)
        {
            position.amount = position
                .amount
                .checked_add(amount)
                .ok_or(ErrorCode::MathOverflow)?;
        } else {
            obligation.deposits.push(Position { asset_id, amount });
        }

        msg!("Added deposit: asset_id={}, amount={}", asset_id, amount);

        // Perform health check
        perform_health_check(&ctx.accounts.obligation, &ctx.accounts.asset_registry)?;

        Ok(())
    }

    pub fn add_borrow(ctx: Context<ModifyObligation>, asset_id: u8, amount: u64) -> Result<()> {
        let obligation = &mut ctx.accounts.obligation;
        let registry = &ctx.accounts.asset_registry;

        // Verify asset exists
        if !registry.assets.iter().any(|a| a.id == asset_id) {
            return Err(ErrorCode::AssetNotFound.into());
        }

        msg!("Adding borrow: asset_id={}, amount={}", asset_id, amount);
        msg!(
            "Current deposits: {}, borrows: {}",
            obligation.deposits.len(),
            obligation.borrows.len()
        );

        // Add or update borrow
        if let Some(position) = obligation
            .borrows
            .iter_mut()
            .find(|p| p.asset_id == asset_id)
        {
            position.amount = position
                .amount
                .checked_add(amount)
                .ok_or(ErrorCode::MathOverflow)?;
        } else {
            obligation.borrows.push(Position { asset_id, amount });
        }

        // Perform health check
        perform_health_check(&ctx.accounts.obligation, &ctx.accounts.asset_registry)?;

        Ok(())
    }

    pub fn remove_deposit(ctx: Context<ModifyObligation>, asset_id: u8, amount: u64) -> Result<()> {
        let obligation = &mut ctx.accounts.obligation;

        msg!("Removing deposit: asset_id={}, amount={}", asset_id, amount);
        msg!(
            "Current deposits: {}, borrows: {}",
            obligation.deposits.len(),
            obligation.borrows.len()
        );

        if amount == 0 {
            return Ok(());
        }

        let position = obligation
            .deposits
            .iter_mut()
            .find(|p| p.asset_id == asset_id)
            .ok_or(ErrorCode::DepositNotFound)?;

        if position.amount < amount {
            return Err(ErrorCode::InsufficientDeposit.into());
        }

        position.amount = position.amount.checked_sub(amount).unwrap();

        // Remove if zero
        if position.amount == 0 {
            obligation.deposits.retain(|p| p.asset_id != asset_id);
        }

        // Perform health check
        perform_health_check(&ctx.accounts.obligation, &ctx.accounts.asset_registry)?;

        Ok(())
    }

    pub fn remove_borrow(ctx: Context<ModifyObligation>, asset_id: u8, amount: u64) -> Result<()> {
        let obligation = &mut ctx.accounts.obligation;

        msg!("Removing borrow: asset_id={}, amount={}", asset_id, amount);

        if amount == 0 {
            return Ok(());
        }

        let position = obligation
            .borrows
            .iter_mut()
            .find(|p| p.asset_id == asset_id)
            .ok_or(ErrorCode::BorrowNotFound)?;

        if position.amount < amount {
            return Err(ErrorCode::InsufficientBorrow.into());
        }

        position.amount = position.amount.checked_sub(amount).unwrap();

        // Remove if zero
        if position.amount == 0 {
            obligation.borrows.retain(|p| p.asset_id != asset_id);
        }

        // Perform health check
        perform_health_check(&ctx.accounts.obligation, &ctx.accounts.asset_registry)?;

        Ok(())
    }

    // ========== DEBUG INSTRUCTION ==========

    pub fn debug_read_all_data(ctx: Context<DebugReadData>) -> Result<()> {
        let registry = &ctx.accounts.asset_registry;
        let obligation = &ctx.accounts.obligation;

        msg!("=== ASSET REGISTRY DATA ===");
        msg!("Authority: {}", registry.authority);
        msg!("Total assets: {}", registry.assets.len());

        for asset in &registry.assets {
            msg!(
                "Asset: id={}, price={}, decimals={}",
                asset.id,
                asset.price,
                asset.decimals
            );
        }

        msg!("Total risk params: {}", registry.risk_params.len());
        for param in &registry.risk_params {
            msg!(
                "Risk param: {}-{}, level={}",
                param.asset_id_a,
                param.asset_id_b,
                param.risk_level
            );
        }

        msg!("=== OBLIGATION DATA ===");
        msg!("Owner: {}", obligation.owner);
        msg!("Deposits: {}", obligation.deposits.len());
        for deposit in &obligation.deposits {
            msg!(
                "  Deposit: asset_id={}, amount={}",
                deposit.asset_id,
                deposit.amount
            );
        }

        msg!("Borrows: {}", obligation.borrows.len());
        for borrow in &obligation.borrows {
            msg!(
                "  Borrow: asset_id={}, amount={}",
                borrow.asset_id,
                borrow.amount
            );
        }

        Ok(())
    }
}

// ========== HEALTH CHECK FUNCTION ==========

fn perform_health_check(obligation: &Obligation, registry: &AssetRegistry) -> Result<()> {
    msg!(
        "Health check: {} deposits, {} borrows",
        obligation.deposits.len(),
        obligation.borrows.len()
    );

    let mut total_deposit_value = 0u64;
    let mut total_borrow_value = 0u64;

    // Calculate deposit values
    for deposit in &obligation.deposits {
        let asset = registry
            .assets
            .iter()
            .find(|a| a.id == deposit.asset_id)
            .ok_or(ErrorCode::AssetNotFound)?;

        let value = deposit.amount.saturating_mul(asset.price);
        total_deposit_value = total_deposit_value.saturating_add(value);

        msg!(
            "Deposit: id={}, amount={}, price={}, value={}",
            deposit.asset_id,
            deposit.amount,
            asset.price,
            value
        );
    }

    // Calculate borrow values
    for borrow in &obligation.borrows {
        let asset = registry
            .assets
            .iter()
            .find(|a| a.id == borrow.asset_id)
            .ok_or(ErrorCode::AssetNotFound)?;

        let value = borrow.amount.saturating_mul(asset.price);
        total_borrow_value = total_borrow_value.saturating_add(value);

        msg!(
            "Borrow: id={}, amount={}, price={}, value={}",
            borrow.asset_id,
            borrow.amount,
            asset.price,
            value
        );
    }

    // Health check
    if total_borrow_value > 0 {
        let health_factor = total_deposit_value
            .checked_div(total_borrow_value)
            .unwrap_or(0);
        msg!(
            "Health: deposits={} borrows={} factor={}",
            total_deposit_value,
            total_borrow_value,
            health_factor
        );

        if health_factor < 1 {
            msg!("WARNING: Undercollateralized!");
        }
    } else {
        msg!("Health: OK (no borrows)");
    }

    Ok(())
}

// ========== CONTEXTS ==========

#[derive(Accounts)]
pub struct InitializeAssetRegistry<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + AssetRegistry::INIT_SPACE,
        seeds = [b"asset_registry"],
        bump
    )]
    pub asset_registry: Account<'info, AssetRegistry>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ManageAssetRegistry<'info> {
    #[account(
        mut,
        seeds = [b"asset_registry"],
        bump,
        has_one = authority
    )]
    pub asset_registry: Account<'info, AssetRegistry>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitObligation<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Obligation::INIT_SPACE,
        seeds = [b"obligation", owner.key().as_ref()],
        bump
    )]
    pub obligation: Account<'info, Obligation>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ModifyObligation<'info> {
    #[account(
        mut,
        seeds = [b"obligation", owner.key().as_ref()],
        bump,
        has_one = owner
    )]
    pub obligation: Account<'info, Obligation>,
    #[account(
        seeds = [b"asset_registry"],
        bump
    )]
    pub asset_registry: Account<'info, AssetRegistry>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct DebugReadData<'info> {
    #[account(
        seeds = [b"asset_registry"],
        bump
    )]
    pub asset_registry: Account<'info, AssetRegistry>,
    #[account(
        seeds = [b"obligation", obligation.owner.as_ref()],
        bump
    )]
    pub obligation: Account<'info, Obligation>,
}

// ========== ERROR CODES ==========

#[error_code]
pub enum ErrorCode {
    #[msg("Asset already exists with this ID")]
    AssetAlreadyExists,
    #[msg("Asset not found in registry")]
    AssetNotFound,
    #[msg("Risk parameter already exists for this pair")]
    RiskParamAlreadyExists,
    #[msg("Deposit not found in obligation")]
    DepositNotFound,
    #[msg("Borrow not found in obligation")]
    BorrowNotFound,
    #[msg("Insufficient deposit amount")]
    InsufficientDeposit,
    #[msg("Insufficient borrow amount")]
    InsufficientBorrow,
    #[msg("Math overflow occurred")]
    MathOverflow,
}

// ========== DATA STRUCTURES ==========

#[account]
#[derive(InitSpace)]
pub struct AssetRegistry {
    pub authority: Pubkey,
    #[max_len(20)]
    pub assets: Vec<AssetInfo>,
    #[max_len(50)]
    pub risk_params: Vec<PairRiskParam>,
}

#[derive(Debug, Clone, AnchorSerialize, AnchorDeserialize, PartialEq, Eq, InitSpace)]
pub struct AssetInfo {
    pub id: u8,
    pub price: u64,
    pub decimals: u8,
}

#[derive(Debug, Clone, AnchorSerialize, AnchorDeserialize, PartialEq, Eq, InitSpace)]
pub struct PairRiskParam {
    pub asset_id_a: u8,
    pub asset_id_b: u8,
    pub risk_level: u8,
}

#[derive(Debug, Clone, AnchorSerialize, AnchorDeserialize, PartialEq, Eq, InitSpace)]
pub struct Position {
    pub asset_id: u8,
    pub amount: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Obligation {
    pub owner: Pubkey,
    #[max_len(11)]
    pub deposits: Vec<Position>,
    #[max_len(10)]
    pub borrows: Vec<Position>,
}
