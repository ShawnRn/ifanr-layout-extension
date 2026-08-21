(function attachPageState(global) {
  function classifySaveText(input) {
    const text = String(input || '').trim();
    if (!text) return 'unknown';
    if (/保存失败|保存异常|未保存/i.test(text)) return 'failed';
    if (/保存中|正在保存|同步中/i.test(text)) return 'saving';
    if (/已保存|保存成功|草稿已保存/i.test(text)) return 'saved';
    return 'unknown';
  }

  function describeWechatPageStatus(status) {
    if (!status?.type) return null;
    if (status.type === 'sync-needs-confirmation' && status.error === 'WECHAT_IMAGE_UPLOAD_NOT_CONFIRMED') {
      const pending = Number(status.pendingEmbeddedImageCount || 0);
      return {
        tone: 'warning',
        title: '正文已保存，图片未全部完成',
        message: pending > 0
          ? `微信仍有 ${pending} 张图片没有完成托管，不必继续等待；请打开插件查看失败位置。`
          : '微信仍有图片没有完成托管，不必继续等待；请打开插件查看失败位置。'
      };
    }
    const descriptions = {
      'page-reloaded': {
        tone: 'warning',
        title: '微信页面刚刚刷新',
        message: '草稿已由微信重新载入，请确认正文和图片仍然完整。'
      },
      'page-changed': {
        tone: 'warning',
        title: '微信页面发生变化',
        message: '编辑页已切换，继续操作前请确认当前仍是目标草稿。'
      },
      'editor-refreshed': {
        tone: 'warning',
        title: '编辑器已重新载入',
        message: '微信更新了编辑区域，插件正在重新确认页面状态。'
      },
      saving: {
        tone: 'neutral',
        title: '微信正在自动保存',
        message: '请暂时不要关闭或刷新页面。'
      },
      saved: {
        tone: 'success',
        title: '微信已自动保存',
        message: '当前草稿的最新修改已保存。'
      },
      syncing: {
        tone: 'neutral',
        title: '正在排入公众号',
        message: '正文和图片正在写入，请保持当前页面打开。'
      },
      'sync-complete': {
        tone: 'success',
        title: '排版完成，草稿已保存',
        message: '正文和图片已经写入，并通过保存状态确认。'
      },
      'sync-complete-with-manual-images': {
        tone: 'warning',
        title: '正文已保存，部分图片待补',
        message: (() => {
          const manual = Number(status.manualImagePlaceholderCount || 0);
          const hostingFallback = Number(status.hostingFallbackPlaceholderCount || 0);
          const total = manual + hostingFallback;
          if (total > 0) {
            const manualCopy = manual > 0 ? `其中 ${manual} 张超过微信限制` : '';
            const fallbackCopy = hostingFallback > 0 ? `其中 ${hostingFallback} 张未完成托管` : '';
            return `${total} 张图片已在原位置留下标记（${[manualCopy, fallbackCopy].filter(Boolean).join('、')}），请压缩或手动补充。`;
          }
          return '部分图片未完成微信托管，已在原位置留下标记，请手动补充。';
        })()
      },
      'sync-needs-confirmation': {
        tone: 'warning',
        title: '写入未完整确认',
        message: status.saved
          ? '正文已经保存，但仍有一项校验没有通过，请打开插件查看详情。'
          : '微信没有返回明确的保存结果，请先不要离开页面。'
      }
    };
    return descriptions[status.type] || null;
  }

  global.IFANR_PAGE_STATE = Object.freeze({ classifySaveText, describeWechatPageStatus });
})(globalThis);
