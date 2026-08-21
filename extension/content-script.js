const WECHAT_PAGE_STATUS_KEY = 'ifanrWechatPageStatus';
const WECHAT_WRITE_STATUS_KEY = 'ifanrWechatWriteStatus';
const IFANR_ARTICLE_PACKAGE_KEY = 'ifanrArticlePackage';
const SAVE_SELECTORS = [
  '[data-save-status]',
  '.weui-desktop-editor__status',
  '.js_save_status',
  '[role="alert"]',
  '[class*="save"][class*="status"]'
];
const EDITOR_SELECTORS = [
  '#ueditor_0 .ProseMirror',
  '.ProseMirror[contenteditable="true"]',
  '[contenteditable="true"][data-wechat-editor]'
];

function findFirst(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element;
  }
  return null;
}

function readSaveText() {
  for (const selector of SAVE_SELECTORS) {
    for (const node of document.querySelectorAll(selector)) {
      const text = node.textContent?.trim() || '';
      if (globalThis.IFANR_PAGE_STATE.classifySaveText(text) !== 'unknown') return text;
    }
  }
  return '';
}

async function recordPageStatus(type, detail = {}) {
  if (!chrome.runtime?.id) return null;
  const status = {
    type,
    draftKey: globalThis.IFANR_SOURCE_LINK?.wechatEditorKey(location.href) || null,
    title: document.title,
    at: new Date().toISOString(),
    ...detail
  };
  try {
    await chrome.storage.local.set({ [WECHAT_PAGE_STATUS_KEY]: status });
  } catch {}
  return status;
}

async function recordWriteStatus(status) {
  if (!chrome.runtime?.id) return null;
  const payload = {
    draftKey: globalThis.IFANR_SOURCE_LINK?.wechatEditorKey(location.href) || null,
    updatedAt: new Date().toISOString(),
    ...status
  };
  try {
    await chrome.storage.local.set({ [WECHAT_WRITE_STATUS_KEY]: payload });
  } catch {}
  return payload;
}

let toastTimer;
function hidePageToast() {
  const toast = document.querySelector('#ifanr-layout-page-toast');
  if (!toast) return;
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(-6px)';
  toast.style.pointerEvents = 'none';
  toast.style.visibility = 'hidden';
}

function showPageToast(status) {
  const description = globalThis.IFANR_PAGE_STATE.describeWechatPageStatus(status);
  if (!description) return;
  let toast = document.querySelector('#ifanr-layout-page-toast');
  if (!toast) {
    toast = document.createElement('aside');
    toast.id = 'ifanr-layout-page-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    Object.assign(toast.style, {
      position: 'fixed',
      right: '24px',
      top: '72px',
      zIndex: '2147483647',
      width: '290px',
      padding: '12px 32px 12px 14px',
      border: '1px solid #E8DED2',
      borderLeft: '3px solid #FD4606',
      borderRadius: '10px',
      color: '#25211F',
      background: '#FFFDFC',
      boxShadow: '0 12px 30px rgba(70,46,30,.14)',
      fontFamily: 'PingFang SC, Hiragino Sans GB, -apple-system, BlinkMacSystemFont, sans-serif',
      transition: 'opacity .18s ease, transform .18s ease, visibility .18s step-end',
      pointerEvents: 'none',
      visibility: 'hidden',
      opacity: '0'
    });
    const title = document.createElement('strong');
    title.dataset.role = 'title';
    Object.assign(title.style, { display: 'block', fontSize: '13px', fontWeight: '600', lineHeight: '1.45' });
    const copy = document.createElement('span');
    copy.dataset.role = 'copy';
    Object.assign(copy.style, { display: 'block', marginTop: '3px', color: '#756D67', fontSize: '12px', lineHeight: '1.5' });
    const closeBtn = document.createElement('button');
    closeBtn.setAttribute('aria-label', '关闭通知');
    closeBtn.textContent = '×';
    Object.assign(closeBtn.style, {
      position: 'absolute',
      top: '8px',
      right: '10px',
      border: 'none',
      background: 'transparent',
      color: '#A89E96',
      fontSize: '16px',
      fontWeight: '400',
      lineHeight: '1',
      cursor: 'pointer',
      padding: '2px 4px',
      borderRadius: '4px'
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hidePageToast();
    });
    toast.append(title, copy, closeBtn);
    document.documentElement.append(toast);
  }
  toast.querySelector('[data-role="title"]').textContent = description.title;
  toast.querySelector('[data-role="copy"]').textContent = description.message;
  const progressTrack = toast.querySelector('[data-role="progress-track"]');
  if (progressTrack) progressTrack.hidden = true;
  toast.style.borderLeftColor = description.tone === 'success'
    ? '#287A50'
    : description.tone === 'warning' ? '#9A5A14' : '#FD4606';
  toast.style.visibility = 'visible';
  toast.style.pointerEvents = 'auto';
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    hidePageToast();
  }, 4200);
}

function showPageWriteProgress(progress = {}) {
  let toast = document.querySelector('#ifanr-layout-page-toast');
  if (!toast) {
    showPageToast({ type: 'syncing' });
    toast = document.querySelector('#ifanr-layout-page-toast');
  }
  if (!toast) return;

  let progressTrack = toast.querySelector('[data-role="progress-track"]');
  if (!progressTrack) {
    progressTrack = document.createElement('div');
    progressTrack.dataset.role = 'progress-track';
    progressTrack.setAttribute('role', 'progressbar');
    progressTrack.setAttribute('aria-valuemin', '0');
    progressTrack.setAttribute('aria-valuemax', '100');
    Object.assign(progressTrack.style, {
      height: '6px',
      marginTop: '9px',
      overflow: 'hidden',
      borderRadius: '999px',
      background: 'rgba(7,193,96,.15)'
    });
    const bar = document.createElement('div');
    bar.dataset.role = 'progress-bar';
    Object.assign(bar.style, {
      width: '0%',
      height: '100%',
      borderRadius: 'inherit',
      background: '#07C160',
      transition: 'width .2s ease'
    });
    progressTrack.append(bar);
    toast.append(progressTrack);
  }

  const percent = Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0)));
  toast.querySelector('[data-role="title"]').textContent = `正在注入公众号·${percent}%`;
  toast.querySelector('[data-role="copy"]').textContent = progress.message || '正在处理正文和图片';
  progressTrack.hidden = false;
  progressTrack.setAttribute('aria-valuenow', String(percent));
  progressTrack.querySelector('[data-role="progress-bar"]').style.width = `${percent}%`;
  toast.style.borderLeftColor = '#07C160';
  toast.style.visibility = 'visible';
  toast.style.pointerEvents = 'auto';
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  clearTimeout(toastTimer);
}

async function announcePageStatus(type, detail = {}) {
  const status = await recordPageStatus(type, detail);
  showPageToast(status);
}

function startWechatPageMonitor() {
  if (location.hostname !== 'mp.weixin.qq.com' || globalThis.__IFANR_WECHAT_MONITOR_STARTED__) return;
  globalThis.__IFANR_WECHAT_MONITOR_STARTED__ = true;

  const navigation = performance.getEntriesByType('navigation')[0];
  let currentUrl = location.href;
  let currentEditor = findFirst(EDITOR_SELECTORS);
  let currentSaveState = globalThis.IFANR_PAGE_STATE.classifySaveText(readSaveText());
  let previousSaveState = currentSaveState;
  let debounceTimer;

  if (navigation?.type === 'reload') {
    void announcePageStatus('page-reloaded');
  } else {
    void recordPageStatus('page-loaded');
  }

  const inspect = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        void announcePageStatus('page-changed');
      }

      const nextEditor = findFirst(EDITOR_SELECTORS);
      if (currentEditor && nextEditor && nextEditor !== currentEditor) {
        void announcePageStatus('editor-refreshed');
      }
      currentEditor = nextEditor || currentEditor;

      const saveText = readSaveText();
      currentSaveState = globalThis.IFANR_PAGE_STATE.classifySaveText(saveText);
      if (currentSaveState !== previousSaveState) {
        if (currentSaveState === 'saving') void announcePageStatus('saving', { saveText });
        if (currentSaveState === 'saved' && previousSaveState === 'saving') {
          void announcePageStatus('saved', { saveText });
        }
        previousSaveState = currentSaveState;
      }
    }, 180);
  };

  const observer = new MutationObserver(inspect);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void announcePageStatus('page-reloaded', { restoredFromCache: true });
  });
  window.addEventListener('beforeunload', () => {
    void recordPageStatus('page-leaving');
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'IFANR_REFRESH_MANUAL_FORMATTING') {
    globalThis.WechatEditorAdapter.refreshManualFormatting({ saveTimeoutMs: 3000 })
      .then((result) => sendResponse({ ok: true, result, completedAt: new Date().toISOString() }))
      .catch((error) => sendResponse({
        ok: false,
        error: error.message || String(error),
        completedAt: new Date().toISOString()
      }));
    return true;
  }
  if (!['IFANR_INJECT_HTML', 'IFANR_INJECT_STORED_PACKAGE'].includes(message?.type)) return false;
  const requestId = message.requestId || globalThis.crypto?.randomUUID?.() || String(Date.now());
  const startedAt = new Date().toISOString();
  const deadlineAt = new Date(Date.now() + Number(message.options?.timeoutMs || 180000)).toISOString();
  const baseStatus = {
    requestId,
    sourceUrl: message.sourceUrl || null,
    startedAt,
    deadlineAt
  };
  let lastProgressSignature = '';
  const resolveArticleHtml = async () => {
    if (message.html) {
      const html = message.html;
      // Avoid retaining a second full Base64-rich article while the adapter
      // streams its image batches into the editor.
      message.html = '';
      return html;
    }
    if (message.type === 'IFANR_INJECT_HTML') return message.html;
    const stored = await chrome.storage.local.get([IFANR_ARTICLE_PACKAGE_KEY, 'ifanrLark2PadCache']);
    const articlePackage = stored[IFANR_ARTICLE_PACKAGE_KEY] || stored['ifanrLark2PadCache'];
    if (articlePackage?.wechatHtml) return articlePackage.wechatHtml;
    if (articlePackage?.html) return articlePackage.html;
    throw new Error('ARTICLE_PACKAGE_NOT_READY');
  };
  const reportProgress = async (progress) => {
    const signature = `${progress.phase}:${progress.percent}:${progress.message}`;
    if (signature === lastProgressSignature) return;
    lastProgressSignature = signature;
    showPageWriteProgress(progress);
    await recordWriteStatus({
      ...baseStatus,
      state: 'processing',
      phase: progress.phase,
      progress
    });
  };

  void announcePageStatus('syncing');
  recordWriteStatus({
    ...baseStatus,
    state: 'processing',
    phase: 'preparing-write',
    progress: { phase: 'preparing-write', percent: 1, message: '正在准备公众号编辑器' }
  })
    .then(resolveArticleHtml)
    .then((html) => globalThis.WechatEditorAdapter.injectHtml(html, {
      title: message.title,
      ...message.options,
      onProgress: reportProgress
    }))
    .then(async (result) => {
      const response = { ok: true, result, completedAt: new Date().toISOString() };
      response.sourceUrl = message.sourceUrl || null;
      const manualImageCount = Number(result.manualImagePlaceholderCount || 0);
      const hostingFallbackCount = Number(result.hostingFallbackPlaceholderCount || 0);
      const imageIssueCount = manualImageCount + hostingFallbackCount;
      await chrome.storage.local.set({
        ifanrLastResult: response,
        [WECHAT_WRITE_STATUS_KEY]: {
          ...baseStatus,
          state: 'completed',
          phase: 'write-completed',
          progress: {
            phase: 'write-completed',
            percent: 100,
            message: imageIssueCount
              ? `正文已保存，${imageIssueCount} 张图片已在原位置标记待补`
              : '正文、图片和自动保存均已确认'
          },
          completedAt: response.completedAt,
          resultSummary: {
            saved: result.saved,
            imageUploadConfirmed: result.imageUploadConfirmed,
            layoutStyleConfirmed: result.layoutStyleConfirmed,
            metadataConfirmed: result.metadataConfirmed,
            titleConfirmed: result.titleConfirmed,
            summaryConfirmed: result.summaryConfirmed,
            visibleHostedImageCount: result.visibleHostedImageCount,
            manualImagePlaceholderCount: manualImageCount,
            manualImageOrders: result.manualImageOrders || [],
            hostingFallbackPlaceholderCount: hostingFallbackCount,
            hostingFallbackImageOrders: result.hostingFallbackImageOrders || []
          }
        }
      });
      await announcePageStatus(imageIssueCount ? 'sync-complete-with-manual-images' : 'sync-complete', {
        saved: result.saved,
        imageUploadConfirmed: result.imageUploadConfirmed,
        imageWriteAccountedConfirmed: result.imageWriteAccountedConfirmed,
        manualImagePlaceholderCount: manualImageCount,
        manualImageOrders: result.manualImageOrders || [],
        hostingFallbackPlaceholderCount: hostingFallbackCount,
        hostingFallbackImageOrders: result.hostingFallbackImageOrders || []
      });
      sendResponse(response);
    })
    .catch(async (error) => {
      const response = { ok: false, error: error.message, result: error.result, completedAt: new Date().toISOString() };
      response.sourceUrl = message.sourceUrl || null;
      const isPreuploadFailure = ['WECHAT_CDN_UPLOAD_FAILED', 'WECHAT_TOKEN_NOT_FOUND'].includes(error.message);
      const isHostedImageFailure = error.message === 'WECHAT_IMAGE_UPLOAD_NOT_CONFIRMED';
      const failurePhase = isPreuploadFailure || isHostedImageFailure
        ? 'uploading-images'
        : error.message === 'WECHAT_STYLE_NOT_CONFIRMED'
          ? 'validating-write'
          : error.message === 'WECHAT_EDITOR_CLEAR_NOT_CONFIRMED' ? 'clearing-editor' : 'write-failed';
      const uploadedImageCount = Number(error.result?.uploadedImageCount || error.result?.wechatCdnImageCount || 0);
      const expectedUploadImageCount = Number(error.result?.expectedUploadImageCount || message.options?.expectedImageCount || 0);
      await chrome.storage.local.set({
        ifanrLastResult: response,
        [WECHAT_WRITE_STATUS_KEY]: {
          ...baseStatus,
          state: 'failed',
          phase: failurePhase,
          progress: {
            phase: failurePhase,
            percent: isPreuploadFailure || isHostedImageFailure
              ? Math.min(99, Math.round(73 * uploadedImageCount / Math.max(1, expectedUploadImageCount)))
              : 0,
            message: isPreuploadFailure
              ? `图片预上传失败（${uploadedImageCount} / ${expectedUploadImageCount}），当前公众号草稿未改动`
              : isHostedImageFailure
                ? `正文已保留，但仅确认 ${uploadedImageCount} / ${expectedUploadImageCount} 张微信图片`
              : error.message === 'WECHAT_STYLE_NOT_CONFIRMED'
                ? '样式或结构校验失败，已尝试恢复原草稿'
              : error.message === 'WECHAT_EDITOR_CLEAR_NOT_CONFIRMED'
                ? '原草稿未能完全净空，已恢复原内容'
              : '写入未完整通过校验'
          },
          completedAt: response.completedAt,
          error: {
            code: error.message,
            pendingEmbeddedImageCount: error.result?.pendingEmbeddedImageCount || 0,
            pendingImageOrders: error.result?.pendingImageOrders || [],
            pendingAnimatedImageCount: error.result?.pendingAnimatedImageCount || 0,
            layoutStyleConfirmed: error.result?.layoutStyleConfirmed ?? null,
            headingStyleCount: error.result?.headingStyleCount || 0,
            bodyStyleCount: error.result?.bodyStyleCount || 0,
            editorCleared: error.result?.editorCleared ?? null,
            clearConfirmed: error.result?.clearConfirmed ?? null,
            uploadedImageCount,
            expectedUploadImageCount,
            editorUntouched: error.result?.editorUntouched ?? false,
            contentPreservedAfterFailure: error.result?.contentPreservedAfterFailure ?? false,
            rollbackPerformed: error.result?.rollbackPerformed ?? false,
            rollbackConfirmed: error.result?.rollbackConfirmed ?? null
          }
        }
      });
      await announcePageStatus('sync-needs-confirmation', {
        error: error.message,
        saved: error.result?.saved,
        pendingEmbeddedImageCount: error.result?.pendingEmbeddedImageCount || 0
      });
      sendResponse(response);
    });
  return true;
});

startWechatPageMonitor();
