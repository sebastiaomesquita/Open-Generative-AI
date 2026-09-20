// Running spend ledger for OpenRouter.
//
// Higgsfield can be priced before a job runs, so that engine uses a per-call
// ceiling. OpenRouter cannot: it reports the real cost only in the response.
// So the control here is a rolling daily budget — every call is recorded, and
// once the day's total is spent the next call is refused before it is sent.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_DAILY_USD = 2.00;

function ledgerPath(env = process.env) {
    return env.HF_SPEND_LEDGER || path.join(os.homedir(), '.higgsfield-mcp', 'spend.json');
}

function dailyBudget(env = process.env) {
    const raw = Number(env.OPENROUTER_DAILY_USD);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DAILY_USD;
}

const today = () => new Date().toISOString().slice(0, 10);

function read(env = process.env) {
    const file = ledgerPath(env);
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {}; // missing or corrupt: start clean rather than block work
    }
}

function write(data, env = process.env) {
    const file = ledgerPath(env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function spentToday(env = process.env) {
    const day = read(env)[today()];
    return Number(day?.usd) || 0;
}

/** Called before a request. Returns { allowed, spent, budget, remaining, reason? }. */
function check(env = process.env) {
    const budget = dailyBudget(env);
    const spent = spentToday(env);
    const remaining = Math.max(0, budget - spent);
    if (spent >= budget) {
        return {
            allowed: false,
            spent,
            budget,
            remaining: 0,
            reason: `The OpenRouter daily budget is spent: US$ ${spent.toFixed(4)} of US$ ${budget.toFixed(2)} today. `
                + 'Raise OPENROUTER_DAILY_USD, or wait until tomorrow.',
        };
    }
    return { allowed: true, spent, budget, remaining };
}

/** Called after a request, with the cost OpenRouter reported. */
function record(usd, { model, kind } = {}, env = process.env) {
    const cost = Number(usd) || 0;
    const data = read(env);
    const day = today();
    const entry = data[day] || { usd: 0, calls: 0, by_model: {} };
    entry.usd = Number((entry.usd + cost).toFixed(6));
    entry.calls += 1;
    if (model) entry.by_model[model] = Number(((entry.by_model[model] || 0) + cost).toFixed(6));
    if (kind) entry.last_kind = kind;
    data[day] = entry;

    // Keep a month of history, no more.
    const keep = Object.keys(data).sort().slice(-31);
    write(Object.fromEntries(keep.map((k) => [k, data[k]])), env);

    const budget = dailyBudget(env);
    return { charged_usd: cost, spent_today_usd: entry.usd, budget_usd: budget, remaining_usd: Math.max(0, Number((budget - entry.usd).toFixed(6))) };
}

function summary(env = process.env) {
    const data = read(env);
    const day = today();
    return {
        today: data[day] || { usd: 0, calls: 0, by_model: {} },
        budget_usd: dailyBudget(env),
        remaining_usd: Math.max(0, dailyBudget(env) - (Number(data[day]?.usd) || 0)),
        ledger: ledgerPath(env),
        history: Object.fromEntries(Object.entries(data).slice(-7)),
    };
}

module.exports = { check, record, summary, spentToday, dailyBudget, ledgerPath, DEFAULT_DAILY_USD };
