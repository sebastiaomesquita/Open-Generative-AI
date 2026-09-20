// Shared helpers, in their own module so mcp/local.js and mcp/server.js can
// both use them without a require cycle.

const slug = (s) => String(s || 'output')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'output';

module.exports = { slug };
