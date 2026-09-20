import { LocalModelManager } from './LocalModelManager.js';
import { isLocalAIAvailable } from '../lib/localInferenceClient.js';
import { t } from '../lib/i18n.js';
import { getLlmSettings, saveLlmSettings, enhancePrompt, normalizeBaseUrl, LLM_DEFAULTS } from '../lib/promptLlm.js';
import { higgsfield, isHiggsfieldAvailable } from '../lib/higgsfieldClient.js';

export function SettingsModal(onClose, initialTab = 'api') {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:100;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-card,#111);border-radius:1rem;border:1px solid rgba(255,255,255,0.08);width:min(90vw,36rem);max-height:85vh;display:flex;flex-direction:column;overflow:hidden;';

    // ── Header ────────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;';
    header.innerHTML = `
        <h2 style="font-size:1rem;font-weight:800;color:#fff;margin:0;">${t('settings.title')}</h2>
        <button id="settings-close-btn" style="color:rgba(255,255,255,0.4);background:none;border:none;cursor:pointer;padding:4px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
    `;
    modal.appendChild(header);

    // ── Tabs ──────────────────────────────────────────────────────────────────
    const TABS = [
        { id: 'api', label: t('settings.apiKey') },
        { id: 'llm', label: t('settings.llm') },
        ...(isHiggsfieldAvailable() ? [{ id: 'higgsfield', label: t('settings.higgsfield') }] : []),
        ...(isLocalAIAvailable() ? [{ id: 'local', label: t('settings.localModels') }] : []),
    ];

    let activeTab = 'api';

    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:0.25rem;padding:0.75rem 1.5rem 0;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;';

    const tabBtns = {};
    TABS.forEach(({ id, label }) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = 'padding:0.4rem 0.75rem;border-radius:0.5rem 0.5rem 0 0;font-size:0.75rem;font-weight:700;border:none;cursor:pointer;transition:all 0.15s;';
        btn.onclick = () => switchTab(id);
        tabBtns[id] = btn;
        tabBar.appendChild(btn);
    });
    modal.appendChild(tabBar);

    // ── Body ──────────────────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow-y:auto;padding:1.5rem;';
    modal.appendChild(body);

    // ── Tab: API Key ──────────────────────────────────────────────────────────
    const apiPanel = document.createElement('div');
    apiPanel.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
            <div>
                <label style="display:block;font-size:0.75rem;color:rgba(255,255,255,0.5);margin-bottom:0.4rem;font-weight:600;">${t('settings.muapiKeyLabel')}</label>
                <input id="settings-api-key" type="password"
                    style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:0.75rem;padding:0.6rem 0.9rem;color:#fff;font-size:0.875rem;outline:none;"
                    placeholder="${t('settings.keyPlaceholder')}"
                    value="${localStorage.getItem('muapi_key') || ''}">
            </div>
            <p style="font-size:0.7rem;color:rgba(255,255,255,0.3);margin:0;">
                ${t('settings.keyNote')}
            </p>
            <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem;">
                <button id="settings-cancel-btn" style="padding:0.5rem 1rem;border-radius:0.5rem;background:none;border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:0.75rem;font-weight:700;cursor:pointer;">${t('common.cancel')}</button>
                <button id="settings-save-btn" style="padding:0.5rem 1rem;border-radius:0.5rem;background:var(--color-primary,#22d3ee);color:#000;font-size:0.75rem;font-weight:700;cursor:pointer;border:none;">${t('common.save')}</button>
            </div>
        </div>
    `;

    // ── Tab: Prompt LLM (OpenRouter / Ollama / LM Studio) ─────────────────────
    const llm = getLlmSettings();
    const llmInput = 'width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:0.75rem;padding:0.6rem 0.9rem;color:#fff;font-size:0.875rem;outline:none;';
    const llmLabel = 'display:block;font-size:0.75rem;color:rgba(255,255,255,0.5);margin-bottom:0.4rem;font-weight:600;';
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const llmPanel = document.createElement('div');
    llmPanel.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
            <div>
                <label style="${llmLabel}">${t('settings.llmBaseUrl')}</label>
                <input id="llm-base-url" type="url" style="${llmInput}" value="${esc(llm.baseUrl)}" spellcheck="false">
            </div>
            <div>
                <label style="${llmLabel}">${t('settings.llmKey')}</label>
                <input id="llm-api-key" type="password" style="${llmInput}" value="${esc(llm.apiKey)}" placeholder="sk-or-v1-...">
            </div>
            <div>
                <label style="${llmLabel}">${t('settings.llmModel')}</label>
                <input id="llm-model" type="text" style="${llmInput}" value="${esc(llm.model)}" spellcheck="false">
            </div>
            <p style="font-size:0.7rem;color:rgba(255,255,255,0.3);margin:0;">${t('settings.llmNote')}</p>
            <p id="llm-test-status" style="font-size:0.75rem;color:rgba(255,255,255,0.6);margin:0;min-height:1.2em;white-space:pre-wrap;"></p>
            <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem;">
                <button id="llm-test-btn" style="padding:0.5rem 1rem;border-radius:0.5rem;background:none;border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:0.75rem;font-weight:700;cursor:pointer;">${t('common.test')}</button>
                <button id="llm-save-btn" style="padding:0.5rem 1rem;border-radius:0.5rem;background:var(--color-primary,#22d3ee);color:#000;font-size:0.75rem;font-weight:700;cursor:pointer;border:none;">${t('common.save')}</button>
            </div>
        </div>
    `;
    const readLlmForm = () => ({
        baseUrl: llmPanel.querySelector('#llm-base-url').value,
        apiKey: llmPanel.querySelector('#llm-api-key').value,
        model: llmPanel.querySelector('#llm-model').value,
    });

    // ── Tab: Higgsfield API ───────────────────────────────────────────────────
    const hfPanel = document.createElement('div');
    hfPanel.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
            <div>
                <label style="${llmLabel}">${t('settings.hfCredentialLabel')}</label>
                <input id="hf-credential" type="password" style="${llmInput}" placeholder="${t('settings.hfPlaceholder')}" spellcheck="false">
            </div>
            <p id="hf-saved-state" style="font-size:0.75rem;color:rgba(255,255,255,0.6);margin:0;"></p>
            <p style="font-size:0.7rem;color:rgba(255,255,255,0.3);margin:0;">${t('settings.hfNote')}</p>
            <p id="hf-test-status" style="font-size:0.75rem;color:rgba(255,255,255,0.6);margin:0;min-height:1.2em;white-space:pre-wrap;"></p>
            <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.5rem;">
                <button id="hf-clear-btn" style="padding:0.5rem 1rem;border-radius:0.5rem;background:none;border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.45);font-size:0.75rem;font-weight:700;cursor:pointer;">${t('settings.hfClear')}</button>
                <button id="hf-test-btn" style="padding:0.5rem 1rem;border-radius:0.5rem;background:none;border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);font-size:0.75rem;font-weight:700;cursor:pointer;">${t('common.test')}</button>
                <button id="hf-save-btn" style="padding:0.5rem 1rem;border-radius:0.5rem;background:var(--color-primary,#22d3ee);color:#000;font-size:0.75rem;font-weight:700;cursor:pointer;border:none;">${t('common.save')}</button>
            </div>
        </div>
    `;
    const refreshHfState = async () => {
        const el = hfPanel.querySelector('#hf-saved-state');
        if (!el) return;
        try {
            const st = await higgsfield.status();
            el.textContent = st.configured ? `${t('settings.hfSaved')}${st.keyId}` : t('settings.hfNone');
        } catch {
            el.textContent = t('settings.hfNone');
        }
    };
    if (isHiggsfieldAvailable()) refreshHfState();

    // ── Tab: Local Models ─────────────────────────────────────────────────────
    const localPanel = LocalModelManager();

    // ── Tab switching ─────────────────────────────────────────────────────────
    const switchTab = (id) => {
        activeTab = id;
        body.innerHTML = '';

        TABS.forEach(({ id: tid }) => {
            const btn = tabBtns[tid];
            if (tid === id) {
                btn.style.background = 'rgba(255,255,255,0.08)';
                btn.style.color = '#fff';
            } else {
                btn.style.background = 'transparent';
                btn.style.color = 'rgba(255,255,255,0.4)';
            }
        });

        if (id === 'api') body.appendChild(apiPanel);
        if (id === 'llm') body.appendChild(llmPanel);
        if (id === 'higgsfield') body.appendChild(hfPanel);
        if (id === 'local') body.appendChild(localPanel);
    };

    switchTab(TABS.some((tab) => tab.id === initialTab) ? initialTab : 'api');

    // ── API key save/cancel handlers ──────────────────────────────────────────
    const close = () => {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
        if (onClose) onClose();
    };

    apiPanel.querySelector('#settings-cancel-btn').onclick = close;
    apiPanel.querySelector('#settings-save-btn').onclick = () => {
        const key = apiPanel.querySelector('#settings-api-key').value.trim();
        if (key) {
            localStorage.setItem('muapi_key', key);
            close();
        } else {
            alert(t('settings.invalidKey'));
        }
    };

    // ── Prompt LLM save/test handlers ─────────────────────────────────────────
    llmPanel.querySelector('#llm-save-btn').onclick = () => {
        saveLlmSettings(readLlmForm());
        close();
    };
    llmPanel.querySelector('#llm-test-btn').onclick = async () => {
        const status = llmPanel.querySelector('#llm-test-status');
        const btn = llmPanel.querySelector('#llm-test-btn');
        btn.disabled = true;
        status.textContent = t('common.loading');
        try {
            const form = readLlmForm();
            const settings = {
                baseUrl: normalizeBaseUrl(form.baseUrl),
                apiKey: form.apiKey.trim(),
                model: form.model.trim() || LLM_DEFAULTS.model,
            };
            const out = await enhancePrompt('a cat sleeping on a windowsill', { settings, timeoutMs: 30_000 });
            status.textContent = t('settings.llmTestOk') + out;
        } catch (err) {
            status.textContent = t('settings.llmTestFail') + (err?.message || err);
        } finally {
            btn.disabled = false;
        }
    };

    // ── Higgsfield handlers ───────────────────────────────────────────────────
    if (isHiggsfieldAvailable()) {
        const hfStatus = hfPanel.querySelector('#hf-test-status');
        const hfInput = hfPanel.querySelector('#hf-credential');
        hfPanel.querySelector('#hf-save-btn').onclick = async () => {
            const raw = hfInput.value.trim();
            if (!raw) { hfStatus.textContent = t('settings.hfNone'); return; }
            try {
                await higgsfield.setCredentials(raw);
                hfInput.value = '';
                await refreshHfState();
                close();
            } catch (err) {
                hfStatus.textContent = err?.message || String(err);
            }
        };
        hfPanel.querySelector('#hf-test-btn').onclick = async () => {
            const btn = hfPanel.querySelector('#hf-test-btn');
            btn.disabled = true;
            hfStatus.textContent = t('common.loading');
            try {
                const res = await higgsfield.test(hfInput.value.trim() || undefined);
                hfStatus.textContent = (res.ok ? t('settings.llmTestOk') : t('settings.llmTestFail')) + res.message;
            } catch (err) {
                hfStatus.textContent = t('settings.llmTestFail') + (err?.message || err);
            } finally {
                btn.disabled = false;
            }
        };
        hfPanel.querySelector('#hf-clear-btn').onclick = async () => {
            await higgsfield.clearCredentials();
            hfInput.value = '';
            hfStatus.textContent = t('settings.hfCleared');
            await refreshHfState();
        };
    }

    header.querySelector('#settings-close-btn').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.appendChild(modal);
    return overlay;
}
