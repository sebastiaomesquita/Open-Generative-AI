#!/usr/bin/env node
// Generates src/lib/higgsfieldModels.js from electron/lib/higgsfieldCatalog.js.
// The renderer needs the catalogue synchronously at mount (the studios build
// their model lists before any IPC round-trip can finish), so we mirror the
// serialisable half. Run after editing the catalogue; tests assert parity.

const fs = require('fs');
const path = require('path');
const { toPublic } = require('../electron/lib/higgsfieldCatalog');

const OUT = path.join(__dirname, '..', 'src', 'lib', 'higgsfieldModels.js');

const banner = `// GENERATED FILE — do not edit by hand.
// Source: electron/lib/higgsfieldCatalog.js
// Regenerate with: node scripts/gen-higgsfield-mirror.js
`;

const body = `${banner}
export const HIGGSFIELD_MODELS = ${JSON.stringify(toPublic(), null, 4)};

export const HIGGSFIELD_IMAGE_MODELS = HIGGSFIELD_MODELS.filter((m) => m.kind === 'image');
export const HIGGSFIELD_VIDEO_MODELS = HIGGSFIELD_MODELS.filter((m) => m.kind === 'video');

export const isHiggsfieldModelId = (id) => HIGGSFIELD_MODELS.some((m) => m.id === id);
export const getHiggsfieldModelById = (id) => HIGGSFIELD_MODELS.find((m) => m.id === id) || null;
`;

if (require.main === module) {
    fs.writeFileSync(OUT, body);
    console.log(`wrote ${path.relative(process.cwd(), OUT)} (${toPublic().length} models)`);
}

module.exports = { render: () => body, OUT };
