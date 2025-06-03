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
}

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

#[error_code]
pub enum ErrorCode {
    #[msg("Risk calculation failed: division by zero, risk_level zero, or arithmetic overflow")]
    InvalidRiskCalculation,
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
