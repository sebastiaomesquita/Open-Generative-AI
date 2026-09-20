import { enhancePrompt, isLlmConfigured } from '../lib/promptLlm.js';
import { SettingsModal } from './SettingsModal.js';
import { t } from '../lib/i18n.js';

// Writes through execCommand so the native undo stack (Cmd/Ctrl+Z) keeps the original prompt.
function replaceTextareaValue(textarea, text) {
    textarea.focus();
    textarea.select();
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok || textarea.value !== text) textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

export function EnhanceButton(textarea, { kind = 'image' } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `${kind}-enhance-btn`;
    btn.className = 'shrink-0 self-end mb-1.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white/5 hover:bg-white/10 text-secondary hover:text-primary border border-white/5 hover:border-primary/30 transition-all whitespace-nowrap disabled:opacity-50 disabled:cursor-wait';
    btn.setAttribute('data-tooltip', t('llm.tooltip'));

    const render = (busy) => {
        btn.disabled = busy;
        btn.innerHTML = `<span aria-hidden="true">✨</span><span>${busy ? t('common.enhancing') : t('common.enhance')}</span>`;
    };
    render(false);

    btn.onclick = async () => {
        const prompt = textarea.value.trim();
        if (!prompt) { textarea.focus(); return; }
        if (!isLlmConfigured()) {
            document.body.appendChild(SettingsModal(null, 'llm'));
            return;
        }
        render(true);
        try {
            const enhanced = await enhancePrompt(prompt, { kind });
            replaceTextareaValue(textarea, enhanced);
        } catch (err) {
            alert(`${t('llm.error')}${err?.message || err}`);
        } finally {
            render(false);
        }
    };

    return btn;
}
