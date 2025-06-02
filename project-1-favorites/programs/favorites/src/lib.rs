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

#[account]
pub struct RiskParam {
    pub feed_a: Pubkey,
    pub feed_b: Pubkey,
    pub risk_level: u8,
}
