// programs/favorites/src/lib.rs
use anchor_lang::prelude::*;

declare_id!("8tqMBrKPc1p3XTo27d3ytxPyUyZ31mF3LpfG26WvYahf");

#[program]
pub mod favorites {
    use super::*;

    pub fn initialize_pair_risk_param(
        ctx: Context<InitializePairRiskParam>,
        risk_level: u8,
    ) -> Result<()> {
        let param = &mut ctx.accounts.risk_param;
        param.feed_a = ctx.accounts.feed_a.key();
        param.feed_b = ctx.accounts.feed_b.key();
        param.risk_level = risk_level;
        Ok(())
    }

    pub fn update_pair_risk_param(
        ctx: Context<UpdatePairRiskParam>,
        new_risk_level: u8,
    ) -> Result<()> {
        let param = &mut ctx.accounts.risk_param;
        param.risk_level = new_risk_level;
        Ok(())
    }

    pub fn delete_pair_risk_param(_ctx: Context<DeletePairRiskParam>) -> Result<()> {
        Ok(())
    }

    pub fn calculate_risk(
        ctx: Context<CalculateRisk>,
        deposit_amount: u64,
        borrow_amount: u64,
        deposit_price: u64,
        deposit_decimals: u8,
        borrow_price: u64,
        borrow_decimals: u8,
    ) -> Result<()> {
        let risk_param = &ctx.accounts.risk_param;
        let risk_level = risk_param.risk_level;

        // Normalize deposit and borrow to the same decimals (use 18 as common, or pick max)
        let common_decimals = std::cmp::max(deposit_decimals, borrow_decimals);
        let deposit_norm = normalize(deposit_amount, deposit_decimals, common_decimals)?;
        let borrow_norm = normalize(borrow_amount, borrow_decimals, common_decimals)?;

        // Calculate value in USD (or whatever price units)
        let deposit_value = deposit_norm
            .checked_mul(deposit_price)
            .ok_or(ErrorCode::InvalidRiskCalculation)?;
        let borrow_value = borrow_norm
            .checked_mul(borrow_price)
            .ok_or(ErrorCode::InvalidRiskCalculation)?;

        // Risk score calculation (example: (deposit_value * 100) / risk_level / borrow_value)
        let score = RiskParam::calculate_risk_score(deposit_value, risk_level, borrow_value)
            .ok_or_else(|| {
                msg!("Error: Risk calculation failed - likely due to arithmetic overflow or division by zero");
                ErrorCode::InvalidRiskCalculation
            })?;

        msg!(
            "Final risk calculation: deposit_value={} borrow_value={} risk_level={} => score={}",
            deposit_value,
            borrow_value,
            risk_level,
            score
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

    pub fn add_deposit(
        ctx: Context<AddDeposit>,
        asset_pubkey: Pubkey,
        amount: u64,
        price: u64,
    ) -> Result<()> {
        let obligation = &mut ctx.accounts.obligation;
        obligation.add_deposit(asset_pubkey, amount, price)?;
        
        msg!("Added deposit: asset={}, amount={}, price={}", asset_pubkey, amount, price);
        Ok(())
    }

    pub fn add_borrow(
        ctx: Context<AddBorrow>,
        asset_pubkey: Pubkey,
        amount: u64,
        price: u64,
    ) -> Result<()> {
        let obligation = &mut ctx.accounts.obligation;
        obligation.add_borrows(asset_pubkey, amount, price)?;
        
        msg!("Added borrow: asset={}, amount={}, price={}", asset_pubkey, amount, price);
        Ok(())
    }

    pub fn remove_deposit(
        ctx: Context<RemoveDeposit>,
        asset_pubkey: Pubkey,
        amount: u64,
    ) -> Result<()> {
        let obligation = &mut ctx.accounts.obligation;
        obligation.remove_deposit(asset_pubkey, amount)?;
        
        msg!("Removed deposit: asset={}, amount={}", asset_pubkey, amount);
        Ok(())
    }

    pub fn remove_borrow(
        ctx: Context<RemoveBorrow>,
        asset_pubkey: Pubkey,
        amount: u64,
    ) -> Result<()> {
        let obligation = &mut ctx.accounts.obligation;
        obligation.remove_borrows(asset_pubkey, amount)?;
        
        msg!("Removed borrow: asset={}, amount={}", asset_pubkey, amount);
        Ok(())
    }

    pub fn calculate_aggregate_health_factor(
        ctx: Context<CalculateAggregateHealthFactor>,
    ) -> Result<()> {
        let obligation = &ctx.accounts.obligation;
        let risk_params = &ctx.remaining_accounts;

        // Convert obligation positions to the required format
        let deposit_assets: Vec<(Pubkey, u64, u64)> = obligation
            .deposits
            .iter()
            .map(|pos| (pos.asset, pos.amount, pos.price))
            .collect();

        let borrow_assets: Vec<(Pubkey, u64, u64)> = obligation
            .borrows
            .iter()
            .map(|pos| (pos.asset, pos.amount, pos.price))
            .collect();

        // Load risk params from remaining accounts
        let mut loaded_risk_params: Vec<RiskParam> = Vec::new();
        for account_info in risk_params {
            match Account::<RiskParam>::try_from(account_info) {
                Ok(risk_param_account) => {
                    loaded_risk_params.push(*risk_param_account);
                }
                Err(_) => {
                    // Skip invalid accounts
                    continue;
                }
            }
        }

        // Calculate the health factor
        let health_factor = Obligation::calculate_aggregate_health_factor(
            deposit_assets,
            borrow_assets,
            &loaded_risk_params,
        );

        match health_factor {
            Some(hf) => {
                msg!("Aggregate Health Factor calculated: {}", hf);
            }
            None => {
                msg!("Health Factor calculation failed - no deposits or invalid data");
            }
        }

        Ok(())
    }
}

// ========== RISK PARAM CONTEXTS ==========

#[derive(Accounts)]
#[instruction(risk_level: u8)]
pub struct InitializePairRiskParam<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 1,
        seeds = [b"risk_pair", feed_a.key().as_ref(), feed_b.key().as_ref()],
        bump
    )]
    pub risk_param: Account<'info, RiskParam>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: feed identifiers only
    pub feed_a: UncheckedAccount<'info>,
    /// CHECK: feed identifiers only
    pub feed_b: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePairRiskParam<'info> {
    #[account(
        mut,
        seeds = [b"risk_pair", feed_a.key().as_ref(), feed_b.key().as_ref()],
        bump
    )]
    pub risk_param: Account<'info, RiskParam>,
    /// CHECK: feed identifiers only
    pub feed_a: UncheckedAccount<'info>,
    /// CHECK: feed identifiers only
    pub feed_b: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct DeletePairRiskParam<'info> {
    #[account(
        mut,
        close = payer,
        seeds = [b"risk_pair", feed_a.key().as_ref(), feed_b.key().as_ref()],
        bump
    )]
    pub risk_param: Account<'info, RiskParam>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: feed identifiers only
    pub feed_a: UncheckedAccount<'info>,
    /// CHECK: feed identifiers only
    pub feed_b: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CalculateRisk<'info> {
    #[account(
        seeds = [b"risk_pair", deposit_feed.key().as_ref(), borrow_feed.key().as_ref()],
        bump
    )]
    pub risk_param: Account<'info, RiskParam>,
    /// CHECK: feed identifiers only
    pub deposit_feed: UncheckedAccount<'info>,
    /// CHECK: feed identifiers only
    pub borrow_feed: UncheckedAccount<'info>,
}

// ========== OBLIGATION CONTEXTS ==========

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
pub struct AddDeposit<'info> {
    #[account(
        mut,
        seeds = [b"obligation", owner.key().as_ref()],
        bump,
        has_one = owner
    )]
    pub obligation: Account<'info, Obligation>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct AddBorrow<'info> {
    #[account(
        mut,
        seeds = [b"obligation", owner.key().as_ref()],
        bump,
        has_one = owner
    )]
    pub obligation: Account<'info, Obligation>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct RemoveDeposit<'info> {
    #[account(
        mut,
        seeds = [b"obligation", owner.key().as_ref()],
        bump,
        has_one = owner
    )]
    pub obligation: Account<'info, Obligation>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct RemoveBorrow<'info> {
    #[account(
        mut,
        seeds = [b"obligation", owner.key().as_ref()],
        bump,
        has_one = owner
    )]
    pub obligation: Account<'info, Obligation>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct CalculateAggregateHealthFactor<'info> {
    #[account(
        seeds = [b"obligation", owner.key().as_ref()],
        bump,
        has_one = owner
    )]
    pub obligation: Account<'info, Obligation>,
    pub owner: Signer<'info>,
    // remaining_accounts will contain RiskParam accounts
}

// ========== ERROR CODES ==========

#[error_code]
pub enum ErrorCode {
    #[msg("Risk calculation failed: division by zero, risk_level zero, or arithmetic overflow")]
    InvalidRiskCalculation,
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

#[derive(Debug, Clone, AnchorSerialize, AnchorDeserialize, PartialEq, Eq, InitSpace)]
pub struct ObligationPosition {
    pub asset: Pubkey, // Asset's oracle's public key
    pub amount: u64,
    pub price: u64,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Obligation {
    pub owner: Pubkey,
    #[max_len(11)]
    pub deposits: Vec<ObligationPosition>,
    #[max_len(10)]
    pub borrows: Vec<ObligationPosition>,
}

impl Obligation {
    // Remove (i.e. subtract and delete when zero) a deposit entry.
    pub fn remove_deposit(&mut self, asset_pubkey: Pubkey, amount_to_remove: u64) -> Result<()> {
        if amount_to_remove == 0 {
            return Ok(());
        }
        if let Some(index) = self.find_deposit_index(&asset_pubkey) {
            let position = &mut self.deposits[index];
            if position.amount < amount_to_remove {
                return Err(ErrorCode::InsufficientDeposit.into());
            }
            position.amount = position.amount.checked_sub(amount_to_remove).unwrap();
            // Remove the entry if the balance is now zero.
            if position.amount == 0 {
                self.deposits.remove(index);
            }
            Ok(())
        } else {
            Err(ErrorCode::DepositNotFound.into())
        }
    }

    // Remove (subtract and delete) a borrow entry.
    pub fn remove_borrows(&mut self, asset_pubkey: Pubkey, amount_to_remove: u64) -> Result<()> {
        if amount_to_remove == 0 {
            return Ok(());
        }
        if let Some(index) = self.find_borrows_index(&asset_pubkey) {
            let position = &mut self.borrows[index];
            if position.amount < amount_to_remove {
                return Err(ErrorCode::InsufficientBorrow.into());
            }
            position.amount = position.amount.checked_sub(amount_to_remove).unwrap();
            // Remove the entry if the remaining borrow is zero.
            if position.amount == 0 {
                self.borrows.remove(index);
            }
            Ok(())
        } else {
            Err(ErrorCode::BorrowNotFound.into())
        }
    }

    fn find_deposit_index(&self, asset_pubkey: &Pubkey) -> Option<usize> {
        self.deposits.iter().position(|p| p.asset == *asset_pubkey)
    }

    pub fn add_deposit(&mut self, asset_pubkey: Pubkey, amount_to_add: u64, price: u64) -> Result<()> {
        if amount_to_add == 0 {
            return Ok(());
        }

        if let Some(index) = self.find_deposit_index(&asset_pubkey) {
            let position = &mut self.deposits[index];
            position.amount = position
                .amount
                .checked_add(amount_to_add)
                .ok_or(ErrorCode::MathOverflow)?;
            position.price = price; // Update price
        } else {
            self.deposits.push(ObligationPosition {
                asset: asset_pubkey,
                amount: amount_to_add,
                price,
            });
        }
        Ok(())
    }

    fn find_borrows_index(&self, asset_pubkey: &Pubkey) -> Option<usize> {
        self.borrows.iter().position(|p| p.asset == *asset_pubkey)
    }

    pub fn add_borrows(&mut self, asset_pubkey: Pubkey, amount_to_add: u64, price: u64) -> Result<()> {
        if amount_to_add == 0 {
            return Ok(());
        }

        if let Some(index) = self.find_borrows_index(&asset_pubkey) {
            let position = &mut self.borrows[index];
            position.amount = position
                .amount
                .checked_add(amount_to_add)
                .ok_or(ErrorCode::MathOverflow)?;
            position.price = price; // Update price
        } else {
            self.borrows.push(ObligationPosition {
                asset: asset_pubkey,
                amount: amount_to_add,
                price,
            });
        }
        Ok(())
    }

    pub fn calculate_aggregate_health_factor(
        deposit_assets: Vec<(Pubkey, u64, u64)>, // (feed, amount, price)
        borrow_assets: Vec<(Pubkey, u64, u64)>,  // (feed, amount, price)
        risk_params: &Vec<RiskParam>,            // all loaded R_{n,o} values
    ) -> Option<u64> {
        let mut total_deposit_value: u128 = 0;
        let mut deposit_values: Vec<(Pubkey, u128)> = vec![];
        
        for (feed, amount, price) in deposit_assets.iter() {
            let value = (*amount as u128) * (*price as u128) / 10u128.pow(8);
            total_deposit_value += value;
            deposit_values.push((*feed, value));
        }
        
        if total_deposit_value == 0 {
            return None;
        }
        
        let mut score_accumulator: u128 = 0;
        
        for (borrow_feed, borrow_amount, borrow_price) in borrow_assets.iter() {
            let borrow_value = (*borrow_amount as u128) * (*borrow_price as u128) / 10u128.pow(8);
            if borrow_value == 0 {
                continue;
            }
            
            for (deposit_feed, dep_value) in deposit_values.iter() {
                let dep_weight = *dep_value * 1_000_000 / total_deposit_value;
                let alloc_borrow_value = borrow_value * dep_weight / 1_000_000;
                if alloc_borrow_value == 0 {
                    continue;
                }
                
                let risk = risk_params
                    .iter()
                    .find(|r| r.feed_a == *deposit_feed && r.feed_b == *borrow_feed);
                
                if let Some(r) = risk {
                    let risk_level = r.risk_level as u128;
                    if risk_level == 0 {
                        continue;
                    }
                    let hf_part = *dep_value * 100 / (alloc_borrow_value * risk_level);
                    score_accumulator += hf_part;
                }
            }
        }
        
        Some(score_accumulator as u64)
    }
}

#[account]
pub struct RiskParam {
    pub feed_a: Pubkey,
    pub feed_b: Pubkey,
    pub risk_level: u8,
}

impl RiskParam {
    pub fn calculate_risk_score(
        deposit_amount: u64,
        risk_level: u8,
        borrow_amount: u64,
    ) -> Option<u64> {
        if risk_level == 0 || borrow_amount == 0 {
            return None;
        }
        Some((deposit_amount * 100) / (risk_level as u64) / borrow_amount)
    }
}

// Helper to normalize amounts to a common decimal
fn normalize(amount: u64, from_decimals: u8, to_decimals: u8) -> Result<u64> {
    if from_decimals == to_decimals {
        Ok(amount)
    } else if from_decimals < to_decimals {
        amount
            .checked_mul(10u64.pow((to_decimals - from_decimals) as u32))
            .ok_or(ErrorCode::InvalidRiskCalculation.into())
    } else {
        amount
            .checked_div(10u64.pow((from_decimals - to_decimals) as u32))
            .ok_or(ErrorCode::InvalidRiskCalculation.into())
    }
}