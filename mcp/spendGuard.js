// Spend guard.
//
// This server is driven by an agent, so a typo in a duration can turn a cheap
// job into an expensive one with nobody watching. Every generation is priced
// first and refused above a ceiling, unless the caller passes the exact amount
// it is willing to spend.

const DEFAULT_MAX_USD = 0.50;

function ceiling(env = process.env) {
    const raw = Number(env.HF_MAX_USD);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MAX_USD;
}

/**
 * @param {number|null} usd     price returned by /estimate
 * @param {number|undefined} approvedUsd  caller's explicit budget for this call
 * @returns {{allowed: boolean, reason?: string, max: number}}
 */
function check(usd, approvedUsd, env = process.env) {
    const max = ceiling(env);

    if (usd == null) {
        return {
            allowed: false,
            max,
            reason: 'Higgsfield did not return a price for this job, so the spend guard cannot clear it. '
                + 'Pass approve_usd with the amount you accept to run it anyway.',
        };
    }
    if (typeof approvedUsd === 'number' && Number.isFinite(approvedUsd)) {
        if (usd <= approvedUsd) return { allowed: true, max };
        return {
            allowed: false,
            max,
            reason: `This job costs US$ ${usd.toFixed(4)}, above the US$ ${approvedUsd.toFixed(4)} you approved.`,
        };
    }
    if (usd <= max) return { allowed: true, max };
    return {
        allowed: false,
        max,
        reason: `This job costs US$ ${usd.toFixed(4)}, above the US$ ${max.toFixed(2)} ceiling. `
            + `Pass approve_usd: ${usd.toFixed(4)} to run it, or raise HF_MAX_USD.`,
    };
}

module.exports = { check, ceiling, DEFAULT_MAX_USD };
