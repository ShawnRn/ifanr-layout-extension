(function installIfanrFeishuExportBridge() {
  if (globalThis.__IFANR_FEISHU_EXPORT_BRIDGE__) return;
  globalThis.__IFANR_FEISHU_EXPORT_BRIDGE__ = true;

  const CONTROL_SOURCE = 'ifanr-feishu-export-control';
  const MESSAGE_SOURCE = 'ifanr-feishu-export-bridge';
  let active = null;

  function post(requestId, type, detail = {}, transfer = []) {
    globalThis.postMessage({ source: MESSAGE_SOURCE, requestId, type, ...detail }, '*', transfer);
  }

  function restoreActive() {
    if (!active) return;
    clearTimeout(active.timeout);
    globalThis.fetch = active.originals.fetch;
    XMLHttpRequest.prototype.open = active.originals.xhrOpen;
    XMLHttpRequest.prototype.send = active.originals.xhrSend;
    URL.createObjectURL = active.originals.createObjectURL;
    HTMLAnchorElement.prototype.click = active.originals.anchorClick;
    active = null;
  }

  function finishWithBlob(requestId, blob, filename = '') {
    if (!active || active.requestId !== requestId || !(blob instanceof Blob)) return;
    const type = String(blob.type || '').toLowerCase();
    const looksLikeZip = /zip|octet-stream/.test(type) || /\.zip$/i.test(filename);
    const looksLikeMarkdown = /markdown|text\/plain/.test(type) || /\.md$/i.test(filename);
    if (!looksLikeZip && !looksLikeMarkdown) return;
    blob.arrayBuffer().then((buffer) => {
      if (!active || active.requestId !== requestId) return;
      post(requestId, 'payload', {
        filename,
        mime: type || 'application/octet-stream',
        buffer
      }, [buffer]);
      restoreActive();
    }).catch((error) => {
      post(requestId, 'error', { error: error?.message || String(error) });
      restoreActive();
    });
  }

  function begin(requestId) {
    restoreActive();
    const originals = {
      fetch: globalThis.fetch,
      xhrOpen: XMLHttpRequest.prototype.open,
      xhrSend: XMLHttpRequest.prototype.send,
      createObjectURL: URL.createObjectURL,
      anchorClick: HTMLAnchorElement.prototype.click
    };
    const objectUrls = new Map();
    active = {
      requestId,
      originals,
      objectUrls,
      timeout: setTimeout(() => {
        post(requestId, 'error', { error: 'FEISHU_MARKDOWN_EXPORT_TIMEOUT' });
        restoreActive();
      }, 60000)
    };

    globalThis.fetch = async function ifanrExportFetch(...args) {
      const response = await originals.fetch.apply(this, args);
      try {
        const disposition = response.headers.get('content-disposition') || '';
        const type = response.headers.get('content-type') || '';
        if (/attachment|\.zip|\.md/i.test(disposition) || /zip|markdown/i.test(type)) {
          const filename = disposition.match(/filename\*?=(?:UTF-8''|["']?)([^"';]+)/i)?.[1] || '';
          response.clone().blob().then((blob) => finishWithBlob(requestId, blob, decodeURIComponent(filename))).catch(() => {});
        }
      } catch {}
      return response;
    };

    XMLHttpRequest.prototype.open = function ifanrExportXhrOpen(method, url, ...rest) {
      this.__ifanrExportUrl = String(url || '');
      return originals.xhrOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function ifanrExportXhrSend(...args) {
      this.addEventListener('load', () => {
        try {
          // Calling getResponseHeader('content-disposition') directly emits a
          // Chrome extension error when Feishu does not expose that CORS
          // response header. getAllResponseHeaders() returns only the safe,
          // exposed header block and does not produce that console error.
          const headerBlock = String(this.getAllResponseHeaders?.() || '');
          const disposition = headerBlock.match(/^content-disposition:\s*(.+)$/im)?.[1] || '';
          const response = this.response;
          const type = headerBlock.match(/^content-type:\s*(.+)$/im)?.[1] || response?.type || '';
          const exportUrl = String(this.__ifanrExportUrl || '');
          const looksLikeExport = /export|download|markdown|docx|file/i.test(exportUrl);
          if (!/attachment|\.zip|\.md/i.test(disposition) && !/zip|markdown|octet-stream/i.test(type) && !looksLikeExport) return;
          const filename = disposition.match(/filename\*?=(?:UTF-8''|["']?)([^"';]+)/i)?.[1] || '';
          if (response instanceof Blob) finishWithBlob(requestId, response, decodeURIComponent(filename));
          else if (response instanceof ArrayBuffer) finishWithBlob(requestId, new Blob([response], { type }), decodeURIComponent(filename));
        } catch {}
      }, { once: true });
      return originals.xhrSend.apply(this, args);
    };

    URL.createObjectURL = function ifanrExportCreateObjectURL(value) {
      const url = originals.createObjectURL.call(this, value);
      if (value instanceof Blob) objectUrls.set(url, value);
      return url;
    };

    HTMLAnchorElement.prototype.click = function ifanrExportAnchorClick() {
      const href = this.href || '';
      const filename = this.download || '';
      const blob = objectUrls.get(href);
      if (active?.requestId === requestId && (blob || /\.zip$|\.md$/i.test(filename))) {
        if (blob) finishWithBlob(requestId, blob, filename);
        else post(requestId, 'download-url', { url: href, filename });
        return;
      }
      return originals.anchorClick.call(this);
    };

    post(requestId, 'ready');
  }

  globalThis.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== globalThis || data?.source !== CONTROL_SOURCE) return;
    if (data.type === 'start') begin(String(data.requestId || ''));
    if (data.type === 'cancel') {
      if (!active || (data.requestId && data.requestId !== active.requestId)) return;
      restoreActive();
    }
  });
})();
