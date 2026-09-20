const LANG_KEY = 'og_lang';

/** Normalize legacy `zh` and browser locales to BCP-47 zh-CN. */
export function normalizeLang(raw) {
    if (!raw) return 'en';
    const lower = String(raw).toLowerCase();
    if (lower === 'zh' || lower.startsWith('zh-') || lower.startsWith('zh_')) return 'zh-CN';
    return lower === 'zh-cn' ? 'zh-CN' : 'en';
}

/** Detect browser locale on first visit; migrates stored `zh` → `zh-CN`. */
export function initLocale() {
    if (typeof localStorage === 'undefined') return 'en';
    const stored = localStorage.getItem(LANG_KEY);
    if (stored) {
        const normalized = normalizeLang(stored);
        if (normalized !== stored) localStorage.setItem(LANG_KEY, normalized);
        return normalized;
    }
    const detected = typeof navigator !== 'undefined' ? navigator.language : 'en';
    const lang = normalizeLang(detected);
    localStorage.setItem(LANG_KEY, lang);
    return lang;
}

export function getLang() {
    if (typeof localStorage === 'undefined') return 'en';
    const stored = localStorage.getItem(LANG_KEY);
    if (!stored) return initLocale();
    const normalized = normalizeLang(stored);
    if (normalized !== stored) localStorage.setItem(LANG_KEY, normalized);
    return normalized;
}

export function setLang(lang, { reload = true } = {}) {
    const normalized = normalizeLang(lang);
    localStorage.setItem(LANG_KEY, normalized);
    if (reload && typeof location !== 'undefined') {
        location.reload();
    } else if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('og_lang_change', { detail: normalized }));
    }
}

function dictFor(lang) {
    const key = normalizeLang(lang);
    if (key === 'zh-CN') return translations['zh-CN'] || translations.zh;
    return translations.en;
}

const translations = {
    en: {
        // Navigation
        'nav.image': 'Image',
        'nav.video': 'Video',
        'nav.lipsync': 'Lip Sync',
        'nav.cinema': 'Cinema Studio',
        'nav.workflows': 'Workflows',
        'nav.agents': 'Agents',
        'nav.mcpcli': 'MCP & CLI',
        'nav.settings': 'Settings',

        // Sidebar
        'sidebar.canvas': 'Canvas',
        'sidebar.video': 'Video',
        'sidebar.library': 'Library',
        'sidebar.settings': 'Settings',

        // Common
        'common.generate': 'Generate ✨',
        'common.generating': 'Generating...',
        'common.download': '↓ Download',
        'common.cancel': 'Cancel',
        'common.save': 'Save',
        'common.history': 'History',
        'common.advanced': 'Advanced',
        'common.less': 'Less',
        'common.tools': 'Tools',
        'common.copy': 'Copy',
        'common.copied': 'Copied!',
        'common.searchModels': 'Search models...',
        'common.retry': 'Retry',
        'common.loading': 'Loading...',
        'common.noResults': 'No local models match',
        'common.regenerate': '↻ Regenerate',
        'common.newItem': '+ New',
        'common.useInGenerator': 'Use in Generator',
        'common.randomize': 'Randomize',

        // Settings Modal
        'settings.title': 'Settings',
        'settings.apiKey': 'API Key',
        'settings.localModels': 'Local Models',
        'settings.muapiKeyLabel': 'Muapi API Key',
        'settings.keyPlaceholder': 'Enter your Muapi API key...',
        'settings.keyNote': 'Your API key is stored locally and never sent anywhere except api.muapi.ai.',
        'settings.invalidKey': 'Please enter a valid API key.',
        'settings.llm': 'Prompt LLM',
        'settings.llmBaseUrl': 'Base URL (OpenAI-compatible)',
        'settings.llmKey': 'API key',
        'settings.llmModel': 'Model',
        'settings.llmNote': 'Default is OpenRouter. Ollama (http://localhost:11434/v1) and LM Studio (http://localhost:1234/v1) work too and need no key. The key is stored locally and only sent to the Base URL above. An OpenRouter key here also pays for the OpenRouter image source in the studio.',
        'settings.llmTestOk': 'OK — ',
        'settings.llmTestFail': 'Failed — ',
        'settings.llmFree': 'free',
        'settings.llmCustom': 'Other (type the id)',
        'settings.llmFallbackUrl': 'Offline backup — Base URL',
        'settings.llmFallbackModel': 'Offline backup — model',
        'settings.llmFallbackNote': 'Used only when the endpoint above cannot be reached: no connection, rejected key, spent credit. Point it at a local server (llama-server, Ollama, LM Studio). Costs nothing, needs no key. Leave the URL empty to turn the backup off.',
        'settings.llmViaLocal': '(local backup) ',
        'common.enhance': 'Enhance prompt',
        'common.enhancing': 'Enhancing...',
        'common.test': 'Test',
        'llm.tooltip': 'Rewrite the prompt with an LLM (Settings → Prompt LLM)',
        'llm.error': 'Prompt enhancement failed: ',
        'settings.higgsfield': 'Higgsfield',
        'settings.hfCredentialLabel': 'API credential (KEY_ID:KEY_SECRET)',
        'settings.hfPlaceholder': 'Paste the credential from console.higgsfield.ai',
        'settings.hfNote': 'Pay-per-generation against your Higgsfield USD balance — separate from your higgsfield.ai plan. The secret is encrypted by macOS Keychain in the main process and never reaches this window.',
        'settings.hfSaved': 'Saved credential: ',
        'settings.hfNone': 'No credential saved.',
        'settings.hfCleared': 'Credential removed.',
        'settings.hfClear': 'Remove',
        'hf.source': 'Higgsfield',
        'hf.noModel': 'Select a Higgsfield model first.',
        'or.source': 'OpenRouter',
        'or.noModel': 'Select an OpenRouter model first.',
        'comfy.source': 'ComfyUI',
        'comfy.noModels': 'No models found in ComfyUI/models/checkpoints.',
        'comfy.freeLocal': 'Local · free · runs on this Mac',
        'compose.title': 'Composição',
        'compose.subtitle': 'Descreva a peça. As cenas, o movimento de câmera, as transições e o título são decididos a partir do que você escrever.',
        'compose.placeholder': 'Ex.: abertura cinematográfica do mar ao amanhecer, depois a cidade acordando. Título: "Bom dia"',
        'compose.preview': 'Ver o plano',
        'compose.make': 'Montar',
        'compose.plan': 'Plano',
        'compose.byModel': 'planejado por modelo',
        'compose.byKeywords': 'planejado por palavras-chave',
        'compose.titleCard': 'Cartela:',
        'compose.then': 'depois',
        'compose.shot': 'cena',
        'compose.shots': 'cenas',
        'compose.themeDark': 'Escuro',
        'compose.themeLight': 'Claro',
        'compose.themeWarm': 'Quente',
        'compose.savedTo': 'salvo em',
        'compose.desktopOnly': 'Disponível no aplicativo desktop.',
        'settings.comfy': 'ComfyUI',
        'settings.comfyDir': 'ComfyUI folder',
        'settings.comfyNote': 'Local image and video, free and offline. The app starts the server when you generate and stops it when it quits, so the weights do not sit in memory.',
        'settings.comfyModels': 'Models found: ',
        'settings.comfyMissing': 'Not found. Point this at a folder containing main.py and .venv/bin/python.',
        'settings.comfyRunning': 'Running',
        'settings.comfyStopped': 'Stopped',
        'settings.comfyStarting': 'Starting, this takes a few seconds...',
        'settings.comfyStart': 'Start',
        'settings.comfyStop': 'Stop',
        'local.ignoresReference': 'Local models generate from text only — the reference image you uploaded will be ignored, and generation takes several minutes.\n\nFor a result based on that image, switch the source to OpenRouter (Nano Banana reads reference images and costs a few cents).\n\nGenerate from the text alone anyway?',

        // Auth Modal
        'auth.title': 'Muapi API Key Required',
        'auth.subtitle': 'Create a Muapi access key, then paste the key value here to start creating high-aesthetic images.',
        'auth.keyLabel': 'Muapi Access Key',
        'auth.keyPlaceholder': 'Paste your access key value...',
        'auth.keyNote': 'Do not enter the key name or label; paste the generated key value from Muapi.',
        'auth.initBtn': 'Initialize Studio',
        'auth.createKey': 'Create or copy a Muapi access key →',

        // Image Studio
        'image.title': 'Image Studio',
        'image.subtitle': 'Transform images with AI — upscale, stylize, animate and more',
        'image.placeholder': 'Describe the image you want to create',
        'image.placeholderTransform': 'Describe how to transform this image (optional)',
        'image.generateTooltip': 'Generate AI image from prompt',
        'image.modelTooltip': 'Select AI generation model',
        'image.arTooltip': 'Change aspect ratio',
        'image.qualityTooltip': 'Set output quality',
        'image.advancedTooltip': 'Show advanced options',
        'image.toolsTooltip': 'Quick starters & prompt enhancer',
        'image.local': '⚡ Local',
        'image.api': '☁ API',
        'image.generatingLocally': 'Generating locally...',
        'image.quickTools': 'Quick Tools',
        'image.quickStarters': 'Quick Starters',
        'image.promptEnhancer': 'Prompt Enhancer',
        'image.basePromptPlaceholder': 'Enter base prompt...',
        'image.enhancementTags': 'Enhancement Tags',
        'image.enhancedPrompt': 'Enhanced Prompt',
        'image.enhancedPlaceholder': 'Your enhanced prompt will appear here...',
        'image.advancedOptions': 'Advanced Options',
        'image.stylePreset': 'Style Preset',
        'image.negPromptLabel': 'Negative Prompt',
        'image.negPromptPlaceholder': 'What to exclude from the image (e.g., blurry, distorted, watermark)',
        'image.guidanceScale': 'Guidance Scale',
        'image.steps': 'Steps',
        'image.seed': 'Seed',
        'image.seedPlaceholder': '-1 for random',
        'image.batchCount': 'Batch Count',
        'image.width': 'Width',
        'image.height': 'Height',
        'image.widthPlaceholder': 'Auto',
        'image.heightPlaceholder': 'Auto',
        'image.refStrength': 'Reference Strength',
        'image.refStrengthNote': 'How much to preserve the reference image characteristics',
        'image.lora': 'LoRA Model (Optional)',
        'image.loraPlaceholder': 'e.g., civitai:1642876@1864626',
        'image.loraWeight': 'LoRA Weight:',
        'image.loraNote': 'Enter a LoRA model ID from Civitai (format: civitai:id@version)',

        // Video Studio
        'video.title': 'Video Studio',
        'video.subtitle': 'Animate images into stunning AI videos with motion effects',
        'video.placeholder': 'Describe the video you want to create',
        'video.generateTooltip': 'Generate AI video',
        'video.history': 'History',
        'video.regenerate': '↻ Regenerate',
        'video.download': '↓ Download',
        'video.extend': '↗ Extend',
        'video.new': '+ New',
        'video.videoTools': 'Video Tools',

        // Lip Sync Studio
        'lipsync.title': 'Lip Sync',
        'lipsync.subtitle': 'Animate portraits or sync lips to audio with AI',
        'lipsync.input': 'Input:',
        'lipsync.portraitImage': '🖼 Portrait Image',
        'lipsync.video': '🎬 Video',
        'lipsync.noImage': 'No image',
        'lipsync.noVideo': 'No video',
        'lipsync.noAudio': 'No audio',
        'lipsync.imageReady': '✓ Image ready',
        'lipsync.videoReady': '✓ Video ready',
        'lipsync.promptPlaceholder': 'Optional: describe the talking style or motion...',
        'lipsync.regenerate': '↻ Regenerate',
        'lipsync.download': '↓ Download',
        'lipsync.new': '+ New',
        'lipsync.history': 'History',
        'lipsync.noAudioAlert': 'Please upload an audio file first.',
        'lipsync.noImageAlert': 'Please upload a portrait image first.',
        'lipsync.noVideoAlert': 'Please upload a source video first.',

        // Cinema Studio
        'cinema.tagline': 'Cinema Studio 2.0',
        'cinema.headline': 'What would you shoot<br>with infinite budget?',
        'cinema.placeholder': 'Describe your scene - use @ to add characters & props',
        'cinema.builderTooltip': 'Quick camera builder',
        'cinema.cameraSettings': 'Open camera settings',
        'cinema.generateBtn': 'GENERATE ✨',
        'cinema.shooting': 'SHOOTING...',
        'cinema.history': 'History',
        'cinema.load': 'Load',
        'cinema.regenerate': '↻ Regenerate',
        'cinema.download': '↓ Download',
        'cinema.newShot': '+ New Shot',
        'cinema.cameraBuilder': 'Camera Builder',
        'cinema.camera': 'Camera',
        'cinema.lens': 'Lens',
        'cinema.focal': 'Focal',
        'cinema.aperture': 'Aperture',
        'cinema.preview': 'Preview',
        'cinema.useSetup': 'Use This Setup',
        'cinema.selectSettings': 'Select camera settings to see preview...',
        'cinema.generationFailed': 'Generation Failed: ',

        // Agent Studio
        'agents.title': 'Agent Studio',
        'agents.webOnly': 'Available in the web app at open-generative-ai.com',

        // Workflow Studio
        'workflows.title': 'Workflow Studio',
        'workflows.webOnly': 'Available in the web app at open-generative-ai.com',

        // Local Model Manager
        'localModels.title': 'Local Models',
        'localModels.webOnly': 'Local model inference is only available in the desktop app (Electron build). Use npm run electron:build to build.',
        'localModels.inferenceEngine': 'Inference Engine',
        'localModels.checking': 'Checking...',
        'localModels.installed': 'Installed and ready',
        'localModels.notInstalled': 'Not installed — required for local generation',
        'localModels.installEngine': 'Install Engine',
        'localModels.downloading': 'Downloading...',
        'localModels.extracting': 'Extracting...',
        'localModels.storedIn': 'Stored in',
        'localModels.storedDefault': 'Stored in your app data folder',
        'localModels.checkingStorage': 'Checking storage...',
        'localModels.loading': 'Loading...',
        'localModels.featured': '⚡ Featured',
        'localModels.download': 'Download',
        'localModels.requiredComponents': 'Required components',
        'localModels.ready': 'Ready',
        'localModels.available': 'Available',
        'localModels.offline': 'Unavailable',
        'localModels.starting': 'Starting...',
        'localModels.complete': 'Complete!',
        'localModels.preparing': 'Preparing...',
        'localModels.get': 'Get',
        'localModels.notConfigured': 'Not configured',
        'localModels.notConfiguredNote': 'Not configured (Wan2GP models will appear offline)',
        'localModels.probing': 'Probing...',
        'localModels.errorLoading': 'Error loading models: ',
        'localModels.deleteConfirm': (name) => `Delete "${name}"? You'll need to re-download it to use it again.`,

        // Web shell
        'web.settingsTitle': 'Settings — API key, local models, preferences',
        'web.switchToEn': 'Switch to English',
        'web.switchToZh': '切换为中文',

        // MCP & CLI page
        'mcp.tagline': 'For developers & AI agents',
        'mcp.title': 'MCP & CLI',
        'mcp.subtitle': 'Use Open Generative AI from your terminal, your IDE, or any MCP-compatible assistant. Generate cinematic images, videos, and audio across 100+ models — without leaving your workflow.',
        'mcp.quickStart': 'Quick start',
    },
    zh: {
        // Navigation
        'nav.image': '图像',
        'nav.video': '视频',
        'nav.lipsync': '唇语同步',
        'nav.cinema': '电影工作室',
        'nav.workflows': '工作流',
        'nav.agents': '智能体',
        'nav.mcpcli': 'MCP & CLI',
        'nav.settings': '设置',

        // Sidebar
        'sidebar.canvas': '画布',
        'sidebar.video': '视频',
        'sidebar.library': '素材库',
        'sidebar.settings': '设置',

        // Common
        'common.generate': '生成 ✨',
        'common.generating': '生成中...',
        'common.download': '↓ 下载',
        'common.cancel': '取消',
        'common.save': '保存',
        'common.history': '历史记录',
        'common.advanced': '高级',
        'common.less': '收起',
        'common.tools': '工具',
        'common.copy': '复制',
        'common.copied': '已复制！',
        'common.searchModels': '搜索模型...',
        'common.retry': '重试',
        'common.loading': '加载中...',
        'common.noResults': '未找到本地模型',
        'common.regenerate': '↻ 重新生成',
        'common.newItem': '+ 新建',
        'common.useInGenerator': '用于生成器',
        'common.randomize': '随机',

        // Settings Modal
        'settings.title': '设置',
        'settings.apiKey': 'API 密钥',
        'settings.localModels': '本地模型',
        'settings.muapiKeyLabel': 'Muapi API 密钥',
        'settings.keyPlaceholder': '输入您的 Muapi API 密钥...',
        'settings.keyNote': '您的 API 密钥仅存储在本地，除 api.muapi.ai 外不会发送到任何地方。',
        'settings.invalidKey': '请输入有效的 API 密钥。',
        'settings.llm': '提示词 LLM',
        'settings.llmBaseUrl': '接口地址（OpenAI 兼容）',
        'settings.llmKey': 'API 密钥',
        'settings.llmModel': '模型',
        'settings.llmNote': '默认使用 OpenRouter。也支持 Ollama（http://localhost:11434/v1）和 LM Studio（http://localhost:1234/v1），无需密钥。密钥仅存储在本地，只会发送到上方的接口地址。在此填写的 OpenRouter 密钥同样用于工作室中的 OpenRouter 图像来源。',
        'settings.llmTestOk': '成功 — ',
        'settings.llmTestFail': '失败 — ',
        'settings.llmFree': '免费',
        'settings.llmCustom': '其他（手动输入 id）',
        'settings.llmFallbackUrl': '离线备用 — 接口地址',
        'settings.llmFallbackModel': '离线备用 — 模型',
        'settings.llmFallbackNote': '仅在上方接口无法访问时使用：断网、密钥被拒、额度耗尽。请指向本地服务（llama-server、Ollama、LM Studio）。免费且无需密钥。留空即关闭备用。',
        'settings.llmViaLocal': '（本地备用）',
        'common.enhance': '优化提示词',
        'common.enhancing': '优化中...',
        'common.test': '测试',
        'llm.tooltip': '用 LLM 重写提示词（设置 → 提示词 LLM）',
        'llm.error': '提示词优化失败：',
        'settings.higgsfield': 'Higgsfield',
        'settings.hfCredentialLabel': 'API 凭证（KEY_ID:KEY_SECRET）',
        'settings.hfPlaceholder': '粘贴来自 console.higgsfield.ai 的凭证',
        'settings.hfNote': '按次计费，使用你的 Higgsfield 美元余额，与 higgsfield.ai 套餐相互独立。密钥由 macOS 钥匙串在主进程中加密，不会进入此窗口。',
        'settings.hfSaved': '已保存凭证：',
        'settings.hfNone': '未保存凭证。',
        'settings.hfCleared': '凭证已删除。',
        'settings.hfClear': '删除',
        'hf.source': 'Higgsfield',
        'hf.noModel': '请先选择一个 Higgsfield 模型。',
        'or.source': 'OpenRouter',
        'or.noModel': '请先选择一个 OpenRouter 模型。',
        'comfy.source': 'ComfyUI',
        'comfy.noModels': '在 ComfyUI/models/checkpoints 中未找到模型。',
        'comfy.freeLocal': '本地 · 免费 · 在这台 Mac 上运行',
        'compose.title': '合成',
        'compose.subtitle': '描述你要的片子。分镜、运镜、转场和标题都由你写的内容决定。',
        'compose.placeholder': '例如：日出海景的电影感开场，然后是苏醒的城市。标题："早安"',
        'compose.preview': '查看方案',
        'compose.make': '合成',
        'compose.plan': '方案',
        'compose.byModel': '由模型规划',
        'compose.byKeywords': '由关键词规划',
        'compose.titleCard': '标题卡：',
        'compose.then': '然后',
        'compose.shot': '个镜头',
        'compose.shots': '个镜头',
        'compose.themeDark': '深色',
        'compose.themeLight': '浅色',
        'compose.themeWarm': '暖色',
        'compose.savedTo': '保存至',
        'compose.desktopOnly': '仅桌面应用可用。',
        'settings.comfy': 'ComfyUI',
        'settings.comfyDir': 'ComfyUI 目录',
        'settings.comfyNote': '本地图像与视频，免费且离线。生成时应用会启动服务，退出时关闭，避免权重常驻内存。',
        'settings.comfyModels': '找到的模型：',
        'settings.comfyMissing': '未找到。请指向包含 main.py 和 .venv/bin/python 的目录。',
        'settings.comfyRunning': '运行中',
        'settings.comfyStopped': '已停止',
        'settings.comfyStarting': '正在启动，需要几秒...',
        'settings.comfyStart': '启动',
        'settings.comfyStop': '停止',
        'local.ignoresReference': '本地模型只能从文本生成——你上传的参考图会被忽略，而且生成需要几分钟。\n\n如果需要基于该图片的结果，请将来源切换为 OpenRouter（Nano Banana 支持参考图，费用几美分）。\n\n仍然仅按文本生成吗？',

        // Auth Modal
        'auth.title': '需要 Muapi API 密钥',
        'auth.subtitle': '创建一个 Muapi 访问密钥，然后将密钥值粘贴到这里开始创建高质量图像。',
        'auth.keyLabel': 'Muapi 访问密钥',
        'auth.keyPlaceholder': '粘贴您的访问密钥值...',
        'auth.keyNote': '请不要输入密钥名称或标签；粘贴从 Muapi 生成的密钥值。',
        'auth.initBtn': '初始化工作室',
        'auth.createKey': '创建或复制 Muapi 访问密钥 →',

        // Image Studio
        'image.title': '图像工作室',
        'image.subtitle': '用 AI 转换图像 — 超分辨率、风格化、动画等更多功能',
        'image.placeholder': '描述您想创建的图像',
        'image.placeholderTransform': '描述您想如何转换此图像（可选）',
        'image.generateTooltip': '根据提示词生成 AI 图像',
        'image.modelTooltip': '选择 AI 生成模型',
        'image.arTooltip': '更改宽高比',
        'image.qualityTooltip': '设置输出质量',
        'image.advancedTooltip': '显示高级选项',
        'image.toolsTooltip': '快速启动器与提示词增强器',
        'image.local': '⚡ 本地',
        'image.api': '☁ API',
        'image.generatingLocally': '本地生成中...',
        'image.quickTools': '快速工具',
        'image.quickStarters': '快速启动',
        'image.promptEnhancer': '提示词增强器',
        'image.basePromptPlaceholder': '输入基础提示词...',
        'image.enhancementTags': '增强标签',
        'image.enhancedPrompt': '增强后的提示词',
        'image.enhancedPlaceholder': '增强后的提示词将显示在这里...',
        'image.advancedOptions': '高级选项',
        'image.stylePreset': '风格预设',
        'image.negPromptLabel': '反向提示词',
        'image.negPromptPlaceholder': '图像中要排除的内容（如：模糊、失真、水印）',
        'image.guidanceScale': '引导系数',
        'image.steps': '步数',
        'image.seed': '随机种子',
        'image.seedPlaceholder': '-1 表示随机',
        'image.batchCount': '批量数量',
        'image.width': '宽度',
        'image.height': '高度',
        'image.widthPlaceholder': '自动',
        'image.heightPlaceholder': '自动',
        'image.refStrength': '参考强度',
        'image.refStrengthNote': '保留参考图像特征的程度',
        'image.lora': 'LoRA 模型（可选）',
        'image.loraPlaceholder': '例如：civitai:1642876@1864626',
        'image.loraWeight': 'LoRA 权重：',
        'image.loraNote': '输入来自 Civitai 的 LoRA 模型 ID（格式：civitai:id@version）',

        // Video Studio
        'video.title': '视频工作室',
        'video.subtitle': '用 AI 将图像动态化为精彩视频，配合运动效果',
        'video.placeholder': '描述您想创建的视频',
        'video.generateTooltip': '生成 AI 视频',
        'video.history': '历史记录',
        'video.regenerate': '↻ 重新生成',
        'video.download': '↓ 下载',
        'video.extend': '↗ 延伸',
        'video.new': '+ 新建',
        'video.videoTools': '视频工具',

        // Lip Sync Studio
        'lipsync.title': '唇语同步',
        'lipsync.subtitle': '用 AI 为人像制作动画或将音频与唇语同步',
        'lipsync.input': '输入：',
        'lipsync.portraitImage': '🖼 人像图',
        'lipsync.video': '🎬 视频',
        'lipsync.noImage': '无图像',
        'lipsync.noVideo': '无视频',
        'lipsync.noAudio': '无音频',
        'lipsync.imageReady': '✓ 图像已就绪',
        'lipsync.videoReady': '✓ 视频已就绪',
        'lipsync.promptPlaceholder': '可选：描述说话风格或动作...',
        'lipsync.regenerate': '↻ 重新生成',
        'lipsync.download': '↓ 下载',
        'lipsync.new': '+ 新建',
        'lipsync.history': '历史记录',
        'lipsync.noAudioAlert': '请先上传音频文件。',
        'lipsync.noImageAlert': '请先上传人像图片。',
        'lipsync.noVideoAlert': '请先上传源视频。',

        // Cinema Studio
        'cinema.tagline': '电影工作室 2.0',
        'cinema.headline': '如果预算无限，<br>你会拍什么？',
        'cinema.placeholder': '描述您的场景 - 使用 @ 添加角色和道具',
        'cinema.builderTooltip': '快速摄像机设置',
        'cinema.cameraSettings': '打开摄像机设置',
        'cinema.generateBtn': '生成 ✨',
        'cinema.shooting': '拍摄中...',
        'cinema.history': '历史记录',
        'cinema.load': '加载',
        'cinema.regenerate': '↻ 重新生成',
        'cinema.download': '↓ 下载',
        'cinema.newShot': '+ 新镜头',
        'cinema.cameraBuilder': '摄像机设置',
        'cinema.camera': '摄像机',
        'cinema.lens': '镜头',
        'cinema.focal': '焦距',
        'cinema.aperture': '光圈',
        'cinema.preview': '预览',
        'cinema.useSetup': '使用此设置',
        'cinema.selectSettings': '选择摄像机设置以查看预览...',
        'cinema.generationFailed': '生成失败：',

        // Agent Studio
        'agents.title': '智能体工作室',
        'agents.webOnly': '在网页应用 open-generative-ai.com 上可用',

        // Workflow Studio
        'workflows.title': '工作流工作室',
        'workflows.webOnly': '在网页应用 open-generative-ai.com 上可用',

        // Local Model Manager
        'localModels.title': '本地模型',
        'localModels.webOnly': '本地模型推理仅在桌面应用（Electron 构建版）中可用。使用 npm run electron:build 进行构建。',
        'localModels.inferenceEngine': '推理引擎',
        'localModels.checking': '检查中...',
        'localModels.installed': '已安装，可以使用',
        'localModels.notInstalled': '未安装 — 本地生成所必需',
        'localModels.installEngine': '安装引擎',
        'localModels.downloading': '下载中...',
        'localModels.extracting': '解压中...',
        'localModels.storedIn': '存储于',
        'localModels.storedDefault': '存储在应用数据文件夹中',
        'localModels.checkingStorage': '检查存储...',
        'localModels.loading': '加载中...',
        'localModels.featured': '⚡ 推荐',
        'localModels.download': '下载',
        'localModels.requiredComponents': '所需组件',
        'localModels.ready': '已就绪',
        'localModels.available': '可用',
        'localModels.offline': '不可用',
        'localModels.starting': '启动中...',
        'localModels.complete': '完成！',
        'localModels.preparing': '准备中...',
        'localModels.get': '获取',
        'localModels.notConfigured': '未配置',
        'localModels.notConfiguredNote': '未配置（Wan2GP 模型将显示为离线）',
        'localModels.probing': '探测中...',
        'localModels.errorLoading': '加载模型时出错：',
        'localModels.deleteConfirm': (name) => `删除"${name}"？您需要重新下载才能再次使用。`,

        // Web shell
        'web.settingsTitle': '设置 — API 密钥、本地模型、偏好',
        'web.switchToEn': 'Switch to English',
        'web.switchToZh': '切换为中文',

        // MCP & CLI page
        'mcp.tagline': '面向开发者与 AI 智能体',
        'mcp.title': 'MCP & CLI',
        'mcp.subtitle': '在终端、IDE 或任何兼容 MCP 的助手中使用 Open Generative AI。跨 100+ 模型生成电影级图像、视频和音频 — 无需离开您的工作流。',
        'mcp.quickStart': '快速开始',
    },
};

translations['zh-CN'] = translations.zh;

export function t(key) {
    const lang = getLang();
    const dict = dictFor(lang);
    const val = dict[key] !== undefined ? dict[key] : (translations.en[key] !== undefined ? translations.en[key] : key);
    return typeof val === 'function' ? val : val;
}

export function tf(key, ...args) {
    const lang = getLang();
    const dict = dictFor(lang);
    const val = dict[key] !== undefined ? dict[key] : (translations.en[key] !== undefined ? translations.en[key] : key);
    return typeof val === 'function' ? val(...args) : val;
}
