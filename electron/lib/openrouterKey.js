// Lets the desktop app reuse the OpenRouter key already stored in the macOS
// keychain by the MCP server, instead of asking the user to paste it a second
// time into localStorage. Read-only on purpose: saving stays a deliberate
// command-line act (`mcp/server.js --save-openrouter-key`).

const { ipcMain } = require('electron');
const { execFileSync } = require('node:child_process');

const SERVICE = 'openrouter-mcp';
const ACCOUNT = 'api-key';

function readKey() {
    if (process.platform !== 'darwin') return '';
    try {
        return execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return ''; // absent, or the user declined the keychain prompt
    }
}

function register() {
    ipcMain.handle('openrouter:get-key', () => readKey());
    ipcMain.handle('openrouter:has-key', () => Boolean(readKey()));
}

module.exports = { register, readKey, SERVICE, ACCOUNT };
