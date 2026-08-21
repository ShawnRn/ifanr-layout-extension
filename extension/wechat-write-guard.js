(function attachWechatWriteGuard(global) {
  const interruptingPageStates = new Set(['page-reloaded', 'page-changed', 'editor-refreshed', 'page-leaving']);

  function findEditorTabs(tabs, activeTab, sourceLink = global.IFANR_SOURCE_LINK) {
    const editors = (Array.isArray(tabs) ? tabs : []).filter((tab) => sourceLink?.isWechatEditorUrl(tab?.url));
    if (sourceLink?.isWechatEditorUrl(activeTab?.url) && !editors.some((tab) => tab.id === activeTab.id)) {
      editors.push(activeTab);
    }
    return editors;
  }

  function staleWriteReason(status, currentPageStatus = null, now = Date.now()) {
    if (status?.state !== 'processing') return null;
    const deadline = Date.parse(status.deadlineAt || 0);
    if (Number.isFinite(deadline) && now >= deadline) {
      return {
        code: 'WECHAT_WRITE_TIMEOUT',
        message: '公众号写入已超过本次任务时限，旧任务已经停止。'
      };
    }

    const pageAt = Date.parse(currentPageStatus?.at || 0);
    const startedAt = Date.parse(status.startedAt || 0);
    const sameDraft = !status.draftKey || !currentPageStatus?.draftKey || status.draftKey === currentPageStatus.draftKey;
    if (
      sameDraft &&
      interruptingPageStates.has(currentPageStatus?.type) &&
      Number.isFinite(pageAt) &&
      Number.isFinite(startedAt) &&
      pageAt >= startedAt
    ) {
      return {
        code: 'WECHAT_EDITOR_RELOADED',
        message: '微信在写入过程中刷新或重新载入了编辑器，旧任务已经停止。',
        pageType: currentPageStatus.type
      };
    }
    return null;
  }

  function isRecoverableFailure(status) {
    return status?.state === 'failed' && ['WECHAT_EDITOR_RELOADED', 'WECHAT_WRITE_TIMEOUT'].includes(status.error?.code);
  }

  global.IFANR_WECHAT_WRITE_GUARD = Object.freeze({ findEditorTabs, staleWriteReason, isRecoverableFailure });
})(globalThis);
