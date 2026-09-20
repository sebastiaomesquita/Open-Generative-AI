// Title cards rendered by the browser this app already embeds.
//
// Diffusion models deform letters frame by frame; the usual advice is to put
// "text, watermark" in the negative prompt so they stop trying. Meanwhile the
// app ships Chromium. So titles are HTML: real fonts, real kerning, real
// accents, rendered in milliseconds instead of minutes.

const { BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const THEMES = {
    // Kept deliberately few. Each one is a complete look, not a knob.
    dark: { bg: '#0b0e13', fg: '#ffffff', accent: '#22d3ee', sub: 'rgba(255,255,255,0.62)' },
    light: { bg: '#f5f3ee', fg: '#14161a', accent: '#c2410c', sub: 'rgba(20,22,26,0.6)' },
    warm: { bg: '#1a1008', fg: '#ffeedd', accent: '#f59e0b', sub: 'rgba(255,238,221,0.6)' },
};

function cardHtml({ title, subtitle, theme = 'dark', width, height }) {
    const c = THEMES[theme] || THEMES.dark;
    // Sizes scale with the frame so the same card works at 512 or 1920 wide.
    const titleSize = Math.round(width * 0.075);
    const subSize = Math.round(width * 0.026);
    return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:${width}px; height:${height}px; overflow:hidden; }
  body {
    background:${c.bg};
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    font-family: -apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  /* A faint vignette keeps the card from looking like a flat slide. */
  body::after {
    content:''; position:fixed; inset:0;
    background: radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.45) 100%);
  }
  .wrap { text-align:center; padding:0 ${Math.round(width * 0.08)}px; position:relative; z-index:1; }
  h1 {
    color:${c.fg}; font-size:${titleSize}px; font-weight:800;
    letter-spacing:-0.02em; line-height:1.05;
    text-wrap:balance;
  }
  .rule { width:${Math.round(width * 0.09)}px; height:${Math.max(2, Math.round(height * 0.006))}px;
          background:${c.accent}; margin:${Math.round(height * 0.045)}px auto; border-radius:99px; }
  p { color:${c.sub}; font-size:${subSize}px; font-weight:500; letter-spacing:0.04em; }
</style></head><body><div class="wrap">
  <h1>${esc(title)}</h1>
  ${subtitle ? `<div class="rule"></div><p>${esc(subtitle)}</p>` : ''}
</div></body></html>`;
}

/**
 * Renders one card to a PNG and returns its path.
 * The window is offscreen and destroyed afterwards; nothing appears on screen.
 */
async function renderCard({ title, subtitle = '', theme = 'dark', width = 1280, height = 720, outPath }) {
    if (!String(title || '').trim()) throw new Error('O cartão precisa de um título.');

    const win = new BrowserWindow({
        width, height, show: false,
        webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false },
    });
    try {
        const html = cardHtml({ title, subtitle, theme, width, height });
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        // One frame of slack so webfonts and the gradient settle before capture.
        await new Promise((r) => setTimeout(r, 120));
        const image = await win.webContents.capturePage();
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, image.toPNG());
        return outPath;
    } finally {
        if (!win.isDestroyed()) win.destroy();
    }
}

module.exports = { renderCard, cardHtml, THEMES };
