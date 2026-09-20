import { t } from '../lib/i18n.js';
import { composer, isComposeAvailable } from '../lib/composeClient.js';

// This tab used to be a placeholder pointing at the web app. It is now the
// composition studio: a brief goes in, a finished piece comes out, and the
// choices in between — how many shots, which camera move, which transition,
// whether there is a title — are made from the brief rather than by the user.
export function WorkflowStudio() {
    const container = document.createElement('div');
    container.className = 'w-full h-full flex flex-col items-center bg-app-bg text-white overflow-y-auto custom-scrollbar p-6';

    if (!isComposeAvailable()) {
        container.className = 'w-full h-full flex flex-col items-center justify-center bg-app-bg text-white gap-3';
        container.innerHTML = `<p class="text-lg font-bold opacity-60">${t('compose.title')}</p>
            <p class="text-sm opacity-40">${t('compose.desktopOnly')}</p>`;
        return container;
    }

    container.innerHTML = `
      <div class="w-full max-w-3xl flex flex-col gap-5 pt-6">
        <div class="text-center">
          <h1 class="text-3xl md:text-5xl font-black tracking-widest uppercase">${t('compose.title')}</h1>
          <p class="text-secondary text-sm mt-2 opacity-70">${t('compose.subtitle')}</p>
        </div>

        <div class="bg-[#111]/90 border border-white/10 rounded-3xl p-5 flex flex-col gap-4">
          <textarea id="cmp-brief" rows="3"
            class="w-full bg-transparent border-none text-white text-base md:text-lg placeholder:text-muted focus:outline-none resize-none"
            placeholder="${t('compose.placeholder')}"></textarea>

          <div class="flex flex-wrap items-center gap-2 pt-3 border-t border-white/5">
            <select id="cmp-ar" class="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold">
              <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option>
            </select>
            <select id="cmp-shots" class="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold">
              <option value="1">1 ${t('compose.shot')}</option>
              <option value="2">2 ${t('compose.shots')}</option>
              <option value="3" selected>3 ${t('compose.shots')}</option>
            </select>
            <select id="cmp-theme" class="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold">
              <option value="dark">${t('compose.themeDark')}</option>
              <option value="light">${t('compose.themeLight')}</option>
              <option value="warm">${t('compose.themeWarm')}</option>
            </select>
            <div class="flex-1"></div>
            <button id="cmp-preview" class="px-4 py-2 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 border border-white/10">${t('compose.preview')}</button>
            <button id="cmp-run" class="px-5 py-2.5 rounded-xl text-sm font-black bg-primary text-black hover:shadow-glow">${t('compose.make')}</button>
          </div>
        </div>

        <div id="cmp-plan" class="hidden bg-[#111]/60 border border-white/10 rounded-2xl p-4 text-sm"></div>

        <div id="cmp-progress" class="hidden flex-col gap-2">
          <div class="flex justify-between text-xs"><span id="cmp-msg" class="text-secondary"></span>
            <button id="cmp-cancel" class="text-red-400 font-bold">${t('common.cancel')}</button></div>
          <div class="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div id="cmp-bar" class="h-full bg-primary rounded-full transition-all" style="width:0%"></div>
          </div>
        </div>

        <div id="cmp-result" class="hidden flex-col items-center gap-3"></div>
      </div>
    `;

    const $ = (id) => container.querySelector(id);
    const planBox = $('#cmp-plan');
    const progress = $('#cmp-progress');
    const result = $('#cmp-result');

    const readOpts = () => ({
        brief: $('#cmp-brief').value.trim(),
        aspect_ratio: $('#cmp-ar').value,
        maxShots: Number($('#cmp-shots').value),
        theme: $('#cmp-theme').value,
    });

    const renderPlan = (plan) => {
        planBox.classList.remove('hidden');
        const by = plan.plannedBy === 'llm' ? t('compose.byModel') : t('compose.byKeywords');
        planBox.innerHTML = `
          <div class="flex items-center justify-between mb-3">
            <span class="text-xs font-bold uppercase tracking-wider text-secondary">${t('compose.plan')}</span>
            <span class="text-[10px] px-2 py-0.5 rounded bg-white/5 text-muted">${by}</span>
          </div>
          ${plan.title ? `<div class="mb-3 text-xs"><span class="text-muted">${t('compose.titleCard')}</span>
             <span class="font-bold">${plan.title}</span>${plan.subtitle ? ` · <span class="text-muted">${plan.subtitle}</span>` : ''}</div>` : ''}
          <ol class="flex flex-col gap-2">
            ${plan.shots.map((s, i) => `
              <li class="flex items-start gap-3">
                <span class="text-[10px] font-black bg-white/5 rounded px-1.5 py-0.5 mt-0.5">${i + 1}</span>
                <div class="flex-1">
                  <div class="text-xs">${s.prompt}</div>
                  <div class="text-[10px] text-muted mt-0.5">${s.cameraMove} · ${s.seconds}s${
                    plan.transitions[i] ? ` · ${t('compose.then')} ${plan.transitions[i]}` : ''}</div>
                </div>
              </li>`).join('')}
          </ol>`;
    };

    $('#cmp-preview').onclick = async () => {
        const opts = readOpts();
        if (!opts.brief) { $('#cmp-brief').focus(); return; }
        const btn = $('#cmp-preview');
        btn.disabled = true; btn.textContent = t('common.loading');
        try {
            renderPlan(await composer.plan(opts.brief, { maxShots: opts.maxShots }));
        } catch (e) {
            planBox.classList.remove('hidden');
            planBox.textContent = e?.message || String(e);
        } finally {
            btn.disabled = false; btn.textContent = t('compose.preview');
        }
    };

    $('#cmp-run').onclick = async () => {
        const opts = readOpts();
        if (!opts.brief) { $('#cmp-brief').focus(); return; }
        const btn = $('#cmp-run');
        btn.disabled = true;
        result.classList.add('hidden');
        progress.classList.remove('hidden');
        progress.classList.add('flex');

        const unsub = composer.onProgress(({ progress: p, message, plan }) => {
            if (plan) renderPlan(plan);
            $('#cmp-bar').style.width = `${Math.round((p ?? 0) * 100)}%`;
            $('#cmp-msg').textContent = message || '';
        });

        try {
            const res = await composer.run(opts);
            result.classList.remove('hidden');
            result.classList.add('flex');
            result.innerHTML = `
              <img src="${res.poster}" class="rounded-2xl max-w-full border border-white/10" />
              <div class="text-xs text-muted">${res.seconds}s · ${t('compose.savedTo')} <span class="text-white">${res.path}</span></div>`;
        } catch (e) {
            result.classList.remove('hidden');
            result.classList.add('flex');
            result.innerHTML = `<div class="text-sm text-red-400">${e?.message || e}</div>`;
        } finally {
            unsub();
            progress.classList.add('hidden');
            progress.classList.remove('flex');
            btn.disabled = false;
        }
    };

    $('#cmp-cancel').onclick = () => composer.cancel();

    return container;
}
