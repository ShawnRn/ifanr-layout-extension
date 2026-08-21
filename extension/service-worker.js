importScripts('source-link.js', 'title-image-brand.js');

const SERVICE_ORIGIN = 'http://127.0.0.1:43127';
const COMPILE_START_URL = `${SERVICE_ORIGIN}/compile/start`;
const COMPILE_STATUS_URL = `${SERVICE_ORIGIN}/compile/status`;
const COMPILE_RESULT_URL = `${SERVICE_ORIGIN}/compile/result`;
const COMPILE_CANCEL_URL = `${SERVICE_ORIGIN}/compile/cancel`;
const HEALTH_URL = `${SERVICE_ORIGIN}/health`;
const PROTOCOL_VERSION = 4;
const REQUIRED_SERVICE_VERSION = '1.11.0';
const CLIENT_COMPILE_TIMEOUT_MS = 45000;
const PACKAGE_KEY = 'ifanrArticlePackage';
const STATUS_KEY = 'ifanrCompileStatus';
const STAGING_KEY_PREFIX = 'ifanrArticlePackageStaging:';
const NON_FALLBACK_BROWSER_ERRORS = new Set([
  'COMPILE_CANCELLED',
  'COMPILE_TIMEOUT',
  'SOURCE_MISMATCH',
  'STALE_COMPILE_IGNORED',
  'FEISHU_DOCUMENT_UNSTABLE',
  'FEISHU_ARTICLE_MEDIA_TOO_LARGE',
  'FEISHU_IMAGE_TOO_LARGE'
]);
const inFlight = new Map();
let activeCompileRequestId = null;
let compileStartQueue = Promise.resolve();

function initializeCompileRequest(requestId, sourceUrl, source, startedAt) {
  const operation = compileStartQueue.then(async () => {
    if (activeCompileRequestId !== requestId) throw { code: 'STALE_COMPILE_IGNORED', message: '较早的读取任务已停止。' };
    const before = await chrome.storage.local.get(STATUS_KEY);
    const obsoleteReviewKey = String(before[STATUS_KEY]?.reviewPackageKey || '');
    await chrome.storage.local.remove([
      PACKAGE_KEY,
      ...(obsoleteReviewKey.startsWith(STAGING_KEY_PREFIX) ? [obsoleteReviewKey] : [])
    ]);
    if (activeCompileRequestId !== requestId) throw { code: 'STALE_COMPILE_IGNORED', message: '较早的读取任务已停止。' };
    await chrome.storage.local.set({
      [STATUS_KEY]: {
        state: 'processing',
        phase: 'accepted',
        readerMode: 'browser-session-pending',
        tabId: source?.tabId || null,
        progress: { phase: 'accepted', percent: 1, message: '任务已收录，正在读取当前飞书页面' },
        requestId,
        sourceUrl,
        startedAt,
        deadlineAt: new Date(Date.now() + CLIENT_COMPILE_TIMEOUT_MS).toISOString()
      }
    });
  });
  compileStartQueue = operation.catch(() => null);
  return operation;
}

async function findFeishuTab(sourceUrl, preferredTabId) {
  if (preferredTabId != null) {
    const preferred = await chrome.tabs.get(preferredTabId).catch(() => null);
    if (preferred?.url && globalThis.IFANR_SOURCE_LINK.sameFeishuDoc(preferred.url, sourceUrl)) return preferred;
  }
  const tabs = await chrome.tabs.query({ url: 'https://*.feishu.cn/*' });
  return tabs.find((tab) => globalThis.IFANR_SOURCE_LINK.sameFeishuDoc(tab.url, sourceUrl)) || null;
}

async function captureFromFeishuPage(source, requestId, options) {
  const tab = await findFeishuTab(source.canonicalUrl, source.tabId);
  if (!tab?.id) throw { code: 'FEISHU_TAB_NOT_FOUND', message: '没有找到仍然打开的飞书文档页面，请回到文档后重试。' };
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: 'IFANR_CAPTURE_FEISHU_PAGE',
    requestId,
    sourceUrl: source.canonicalUrl,
    options
  }).catch((error) => {
    throw { code: 'FEISHU_PAGE_READER_UNAVAILABLE', message: '飞书页面读取器尚未加载，请刷新飞书页面后重试。', detail: error.message };
  });
  if (!response?.ok) throw response?.error || { code: 'FEISHU_BROWSER_CAPTURE_FAILED', message: '浏览器没有完成飞书文档读取。' };
  return response;
}

async function updateBrowserCaptureProgress(message) {
  if (activeCompileRequestId && activeCompileRequestId !== message.requestId) {
    return { ok: false, ignored: true, error: { code: 'STALE_COMPILE_IGNORED', message: '较早的读取任务已停止。' } };
  }
  const stored = await chrome.storage.local.get(STATUS_KEY);
  const status = stored[STATUS_KEY];
  if (status?.state !== 'processing' || status?.requestId !== message.requestId) {
    return { ok: false, ignored: true, error: { code: 'STALE_COMPILE_IGNORED', message: '较早的读取任务已停止。' } };
  }
  await chrome.storage.local.set({
    [STATUS_KEY]: {
      ...status,
      sourceUrl: message.sourceUrl,
      readerMode: 'browser-session',
      startedAt: message.startedAt || status.startedAt,
      deadlineAt: message.deadlineAt || status.deadlineAt,
      phase: message.progress?.phase || status.phase,
      progress: { ...message.progress, updatedAt: new Date().toISOString() }
    }
  });
  return { ok: true };
}

function assertFixtureFidelity(fixture) {
  const textConfirmed = fixture?.textFidelity?.confirmed === true;
  const imagesConfirmed = fixture?.imageFidelity?.confirmed === true;
  if (textConfirmed && imagesConfirmed) return;
  throw {
    code: 'CONTENT_FIDELITY_NOT_CONFIRMED',
    message: '源文档与排版结果的一致性检查没有通过，已停止收录。',
    textFidelity: fixture?.textFidelity || null,
    imageFidelity: fixture?.imageFidelity || null
  };
}

async function promoteBrowserCapture(response, requestId, sourceUrl) {
  const stagingKey = String(response?.stagingKey || '');
  if (stagingKey !== `${STAGING_KEY_PREFIX}${requestId}`) {
    throw { code: 'COMPILE_RESULT_MISSING', message: '浏览器读取完成，但没有找到对应的隔离内容包。' };
  }
  const stored = await chrome.storage.local.get([STATUS_KEY, stagingKey]);
  const status = stored[STATUS_KEY];
  const staged = stored[stagingKey];
  if (status?.state !== 'processing' || status?.requestId !== requestId) {
    await chrome.storage.local.remove(stagingKey);
    throw { code: 'STALE_COMPILE_IGNORED', message: '较早的读取结果已忽略。' };
  }
  if (!staged?.fixture || staged.requestId !== requestId) {
    await chrome.storage.local.remove(stagingKey);
    throw { code: 'COMPILE_RESULT_MISSING', message: '浏览器读取完成，但隔离内容包不完整。' };
  }
  if (!globalThis.IFANR_SOURCE_LINK.sameFeishuDoc(sourceUrl, staged.sourceUrl) || !globalThis.IFANR_SOURCE_LINK.sameFeishuDoc(sourceUrl, staged.fixture.sourceUrl)) {
    await chrome.storage.local.remove(stagingKey);
    throw { code: 'SOURCE_MISMATCH', message: '读取结果不属于当前飞书文档，已阻止覆盖。' };
  }
  const fixture = staged.fixture;
  assertFixtureFidelity(fixture);
  const completedAt = staged.completedAt || new Date().toISOString();
  await chrome.storage.local.set({
    [PACKAGE_KEY]: fixture,
    [STATUS_KEY]: {
      state: 'ready',
      requestId,
      sourceUrl,
      title: fixture.title,
      blockCount: fixture.blockCount,
      imageCount: fixture.imageCount,
      galleryCount: fixture.galleryCount,
      galleryMode: fixture.galleryMode,
      titleImageBrand: fixture.titleImageBrand,
      titleImagePreference: fixture.titleImagePreference,
      gifWarningCount: fixture.gifWarnings?.length || 0,
      contentWarningCount: fixture.contentWarnings?.length || 0,
      readerMode: 'browser-session',
      progress: { phase: 'completed', percent: 100, message: '已通过当前飞书页面完成收录' },
      completedAt
    }
  });
  await chrome.storage.local.remove(stagingKey);
  return {
    ok: true,
    fixture: {
      title: fixture.title,
      blockCount: fixture.blockCount,
      imageCount: fixture.imageCount,
      galleryCount: fixture.galleryCount,
      titleImageBrand: fixture.titleImageBrand,
      titleImagePreference: fixture.titleImagePreference,
      gifWarningCount: fixture.gifWarnings?.length || 0,
      contentWarningCount: fixture.contentWarnings?.length || 0,
      sourceUrl: fixture.sourceUrl,
      readerMode: fixture.readerMode
    }
  };
}

async function setActionState(state) {
  const settings = {
    processing: { text: '…', color: '#FD4606', title: '爱范儿一键排版：正在生成排版内容' },
    ready: { text: '✓', color: '#287A50', title: '爱范儿一键排版：排版内容已收录成功' },
    failed: { text: '!', color: '#B43A32', title: '爱范儿一键排版：读取失败，请打开插件查看' },
    idle: { text: '', color: '#FD4606', title: '爱范儿一键排版' }
  };
  const value = settings[state] || settings.idle;
  await Promise.all([
    chrome.action.setBadgeText({ text: value.text }),
    chrome.action.setBadgeBackgroundColor({ color: value.color }),
    chrome.action.setTitle({ title: value.title })
  ]).catch(() => {});
}

async function checkServiceHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1600);
  try {
    const response = await fetch(HEALTH_URL, { cache: 'no-store', signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error('SERVICE_UNAVAILABLE');
    if (Number(payload.protocolVersion) !== PROTOCOL_VERSION || payload.serviceVersion !== REQUIRED_SERVICE_VERSION) {
      return {
        ok: false,
        error: {
          code: 'SERVICE_VERSION_MISMATCH',
          message: '插件与本机读取服务版本不兼容。'
        },
        service: payload
      };
    }
    return { ok: true, service: payload };
  } catch {
    return {
      ok: false,
      error: { code: 'DYNAMIC_SERVICE_UNAVAILABLE', message: '本机读取服务尚未连接。' }
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchServiceJson(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, cache: 'no-store', signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw payload?.error || { code: 'LOCAL_SERVICE_FAILED', message: '本机服务返回失败。' };
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function startCompileJob(sourceUrl, options) {
  return fetchServiceJson(COMPILE_START_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceUrl, options })
  }, 7000);
}

async function getCompileJob(jobId) {
  return fetchServiceJson(`${COMPILE_STATUS_URL}?jobId=${encodeURIComponent(jobId)}`, {}, 4000);
}

async function getCompileResult(jobId) {
  return fetchServiceJson(`${COMPILE_RESULT_URL}?jobId=${encodeURIComponent(jobId)}`, {}, 30000);
}

async function cancelCompileJob(jobId) {
  if (!jobId) return null;
  return fetchServiceJson(COMPILE_CANCEL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId })
  }, 5000);
}

async function compileSource(source) {
  const parsed = globalThis.IFANR_SOURCE_LINK.parseFeishuDocUrl(source?.canonicalUrl);
  if (!parsed) throw { code: 'INVALID_FEISHU_URL', message: '需要有效的飞书 Wiki 或 Docx 链接。' };
  const sourceUrl = parsed.canonicalUrl;
  const options = {
    galleryMode: 'automatic',
    allowRiskyGifs: true,
    titleImageBrand: globalThis.IFANR_TITLE_IMAGE_BRAND.normalizePreference(source?.titleImageBrand),
    staticImageQuality: [75, 90, 95].includes(Number(source?.staticImageQuality))
      ? Number(source.staticImageQuality)
      : 90,
    larkImageProcessing: source?.options?.larkImageProcessing !== false,
    larkRoundImages: source?.options?.larkRoundImages !== false,
    larkMaxImageWidth: Number(source?.options?.larkMaxImageWidth) || 1280
  };
  const taskKey = `${sourceUrl}|${options.galleryMode}|${options.allowRiskyGifs ? 'gif-override' : 'gif-gate'}|quality-${options.staticImageQuality}|title-${options.titleImageBrand}|lark-${options.larkImageProcessing ? 'on' : 'off'}-${options.larkRoundImages ? 'round' : 'flat'}`;
  if (inFlight.has(taskKey)) return inFlight.get(taskKey);
  const requestId = crypto.randomUUID();

  const task = (async () => {
    activeCompileRequestId = requestId;
    const startedAt = new Date().toISOString();
    try {
      await initializeCompileRequest(requestId, sourceUrl, source, startedAt);
      await setActionState('processing');
      let browserCaptureError = null;
      try {
        const browserResult = await captureFromFeishuPage({ ...source, canonicalUrl: sourceUrl }, requestId, options);
        const promoted = await promoteBrowserCapture(browserResult, requestId, sourceUrl);
        await setActionState('ready');
        return promoted;
      } catch (error) {
        browserCaptureError = error?.code ? error : { code: 'FEISHU_BROWSER_CAPTURE_FAILED', message: error?.message || '浏览器直读失败。' };
        if (NON_FALLBACK_BROWSER_ERRORS.has(browserCaptureError.code)) throw browserCaptureError;
        const current = await chrome.storage.local.get(STATUS_KEY);
        if (current[STATUS_KEY]?.state !== 'processing' || current[STATUS_KEY]?.requestId !== requestId) {
          throw { code: 'STALE_COMPILE_IGNORED', message: '较早的读取任务已停止。' };
        }
        await chrome.storage.local.set({
          [STATUS_KEY]: {
            state: 'processing',
            phase: 'service-fallback',
            readerMode: 'service-pending',
            progress: { phase: 'service-fallback', percent: 2, message: '页面直读未完成，正在尝试本机增强服务' },
            requestId,
            sourceUrl,
            startedAt,
            deadlineAt: new Date(Date.now() + CLIENT_COMPILE_TIMEOUT_MS).toISOString(),
            browserCaptureError
          }
        });
      }

      const health = await checkServiceHealth();
      if (!health.ok) {
        throw {
          code: browserCaptureError.code,
          message: `${browserCaptureError.message} 本机增强服务也未连接。`,
          browserCaptureError,
          serviceError: health.error
        };
      }
      const started = await startCompileJob(sourceUrl, options);
      const jobId = started.job?.jobId;
      if (!jobId) throw { code: 'COMPILE_JOB_NOT_CREATED', message: '本机服务没有创建处理任务。' };
      const afterStart = await chrome.storage.local.get(STATUS_KEY);
      if (afterStart[STATUS_KEY]?.state !== 'processing' || afterStart[STATUS_KEY]?.requestId !== requestId) {
        await cancelCompileJob(jobId).catch(() => null);
        throw { code: 'STALE_COMPILE_IGNORED', message: '较早的读取任务已停止。' };
      }
      const deadlineAt = started.job.deadlineAt || new Date(Date.now() + CLIENT_COMPILE_TIMEOUT_MS).toISOString();
      let job = started.job;
      let consecutivePollFailures = 0;

      while (['queued', 'processing'].includes(job.state)) {
        const current = await chrome.storage.local.get(STATUS_KEY);
        if (current[STATUS_KEY]?.requestId !== requestId || current[STATUS_KEY]?.state !== 'processing') {
          await cancelCompileJob(jobId).catch(() => null);
          return { ok: false, ignored: true, error: { code: 'STALE_COMPILE_IGNORED', message: '较早的读取任务已停止。' } };
        }
        await chrome.storage.local.set({
          [STATUS_KEY]: {
            state: 'processing',
            phase: job.progress?.phase || 'building',
            progress: job.progress || { phase: 'building', percent: 2, message: '正在生成排版内容' },
            requestId,
            jobId,
            sourceUrl,
            startedAt: job.startedAt || startedAt,
            deadlineAt
          }
        });
        if (Date.now() >= Math.min(Date.parse(deadlineAt) + 5000, Date.parse(startedAt) + CLIENT_COMPILE_TIMEOUT_MS)) {
          await cancelCompileJob(jobId).catch(() => null);
          throw {
            code: 'COMPILE_TIMEOUT',
            message: '生成排版内容超过 45 秒，已自动停止。',
            phase: job.progress?.phase,
            progressMessage: job.progress?.message,
            imageIndex: job.progress?.imageIndex || 0,
            imageCount: job.progress?.imageCount || 0
          };
        }
        await sleep(500);
        try {
          const response = await getCompileJob(jobId);
          job = response.job;
          consecutivePollFailures = 0;
        } catch (error) {
          // Only network-level failures are retried; application errors (e.g. job gone) abort immediately.
          const transient = !error?.code || error.code === 'LOCAL_SERVICE_FAILED';
          if (!transient) throw error;
          consecutivePollFailures += 1;
          if (consecutivePollFailures >= 4) throw error;
        }
      }

      if (job.state === 'cancelled') throw job.error || { code: 'COMPILE_CANCELLED', message: '任务已停止。' };
      if (job.state === 'failed') throw job.error || { code: 'DYNAMIC_SERVICE_FAILED', message: '动态读取服务返回失败。' };
      const result = await getCompileResult(jobId);
      const fixture = result.fixture;
      if (!fixture) throw { code: 'COMPILE_RESULT_MISSING', message: '任务完成，但没有返回排版内容。' };
      if (!globalThis.IFANR_SOURCE_LINK.sameFeishuDoc(sourceUrl, fixture.sourceUrl)) {
        throw { code: 'SOURCE_MISMATCH', message: '服务返回的内容不属于当前飞书文档。' };
      }
      assertFixtureFidelity(fixture);

      const current = await chrome.storage.local.get(STATUS_KEY);
      if (current[STATUS_KEY]?.requestId !== requestId) {
        return { ok: false, ignored: true, error: { code: 'STALE_COMPILE_IGNORED', message: '较早的读取结果已忽略。' } };
      }

      const completedAt = new Date().toISOString();
      await chrome.storage.local.set({
        [PACKAGE_KEY]: fixture,
        [STATUS_KEY]: {
          state: 'ready',
          requestId,
          sourceUrl,
          title: fixture.title,
          blockCount: fixture.blockCount,
          imageCount: fixture.imageCount,
          galleryCount: fixture.galleryCount,
          galleryMode: fixture.galleryMode,
          titleImageBrand: fixture.titleImageBrand,
          titleImagePreference: fixture.titleImagePreference,
          gifWarningCount: fixture.gifWarnings?.length || 0,
          gifQualityOverride: fixture.gifQualityOverride === true,
          progress: { phase: 'completed', percent: 100, message: '排版内容已准备完成' },
          completedAt
        }
      });
      await setActionState('ready');
      return {
        ok: true,
        fixture: {
          title: fixture.title,
          blockCount: fixture.blockCount,
          imageCount: fixture.imageCount,
          galleryCount: fixture.galleryCount,
          titleImageBrand: fixture.titleImageBrand,
          titleImagePreference: fixture.titleImagePreference,
          gifWarningCount: fixture.gifWarnings?.length || 0,
          sourceUrl: fixture.sourceUrl
        }
      };
    } catch (error) {
      const normalized = error?.code
        ? error
        : { code: 'DYNAMIC_SERVICE_UNAVAILABLE', message: '动态读取服务未启动或无法连接。' };
      const current = await chrome.storage.local.get(STATUS_KEY);
      if (current[STATUS_KEY]?.requestId === requestId) {
        await chrome.storage.local.set({
          [STATUS_KEY]: {
            state: 'failed',
            requestId,
            sourceUrl,
            error: normalized,
            reviewPackageKey: normalized.reusablePackageAvailable ? normalized.stagingKey : null,
            completedAt: new Date().toISOString()
          }
        });
        await setActionState('failed');
      }
      return { ok: false, error: normalized };
    }
  })().finally(() => {
    inFlight.delete(taskKey);
    if (activeCompileRequestId === requestId) activeCompileRequestId = null;
  });

  inFlight.set(taskKey, task);
  return task;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'IFANR_COMPILE_FEISHU') {
    compileSource(message.source)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error?.code ? error : { code: 'INVALID_FEISHU_URL', message: error?.message || '无法开始收录。' } }));
    return true;
  }
  if (message?.type === 'IFANR_SERVICE_HEALTH') {
    checkServiceHealth().then(sendResponse);
    return true;
  }
  if (message?.type === 'IFANR_FEISHU_CAPTURE_PROGRESS') {
    updateBrowserCaptureProgress(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error }));
    return true;
  }
  if (message?.type === 'IFANR_CANCEL_COMPILE') {
    (async () => {
      const stored = await chrome.storage.local.get(STATUS_KEY);
      const status = stored[STATUS_KEY];
      if (status?.state !== 'processing') {
        return { ok: false, error: { code: 'NO_ACTIVE_COMPILE', message: '当前没有正在处理的任务。' } };
      }
      if (status.jobId) {
        await cancelCompileJob(status.jobId).catch(() => null);
      } else if (String(status.readerMode || '').startsWith('browser-session')) {
        const tab = await findFeishuTab(status.sourceUrl, status.tabId || null);
        if (tab?.id) {
          await chrome.tabs.sendMessage(tab.id, { type: 'IFANR_CANCEL_FEISHU_CAPTURE', requestId: status.requestId }).catch(() => null);
        }
      } else if (status.readerMode !== 'service-pending') {
        return { ok: false, error: { code: 'NO_ACTIVE_COMPILE', message: '当前没有正在处理的任务。' } };
      }
      if (activeCompileRequestId === status.requestId) activeCompileRequestId = null;
      const completedAt = new Date().toISOString();
      await chrome.storage.local.set({
        [STATUS_KEY]: {
          ...status,
          state: 'failed',
          error: { code: 'COMPILE_CANCELLED', message: '任务已停止。' },
          completedAt
        }
      });
      await setActionState('failed');
      return { ok: true, completedAt };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error }));
    return true;
  }
  return false;
});

async function restoreActionState() {
  const stored = await chrome.storage.local.get(STATUS_KEY);
  const status = stored[STATUS_KEY];
  if (status?.state === 'processing') {
    const started = Date.parse(status.startedAt || 0);
    const deadline = Date.parse(status.deadlineAt || 0);
    if ((!status.jobId && !String(status.readerMode || '').startsWith('browser-session')) || (Number.isFinite(deadline) && Date.now() > deadline + 5000) || (Number.isFinite(started) && Date.now() - started > CLIENT_COMPILE_TIMEOUT_MS)) {
      const failed = {
        ...status,
        state: 'failed',
        error: {
          code: 'COMPILE_TIMEOUT',
          message: '上一次生成任务已经超时，已停止等待。',
          phase: status.progress?.phase,
          progressMessage: status.progress?.message
        },
        completedAt: new Date().toISOString()
      };
      await chrome.storage.local.set({ [STATUS_KEY]: failed });
      await setActionState('failed');
      return;
    }
  }
  await setActionState(status?.state || 'idle');
}

chrome.runtime.onInstalled.addListener(restoreActionState);
chrome.runtime.onStartup.addListener(restoreActionState);
void restoreActionState();
