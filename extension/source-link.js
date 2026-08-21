(function attachSourceLink(global) {
  function parseFeishuDocUrl(input) {
    try {
      const url = new URL(String(input || ''));
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || (host !== 'feishu.cn' && !host.endsWith('.feishu.cn'))) return null;
      const match = url.pathname.match(/^\/(wiki|docx)\/([a-z0-9_-]+)/i);
      if (!match) return null;
      const kind = match[1].toLowerCase();
      const token = match[2];
      return {
        kind,
        token,
        host,
        canonicalUrl: `${url.protocol}//${url.host}/${kind}/${token}`
      };
    } catch {
      return null;
    }
  }

  function isWechatEditorUrl(input) {
    try {
      const url = new URL(String(input || ''));
      const template = url.searchParams.get('t') || '';
      const action = url.searchParams.get('action') || '';
      return url.protocol === 'https:' &&
        url.hostname === 'mp.weixin.qq.com' &&
        url.pathname === '/cgi-bin/appmsg' &&
        (template.includes('appmsg_edit') || action === 'edit');
    } catch {
      return false;
    }
  }

  function wechatEditorKey(input) {
    try {
      const url = new URL(String(input || ''));
      if (!isWechatEditorUrl(url.href)) return null;
      const appmsgId = url.searchParams.get('appmsgid');
      if (appmsgId) return `appmsg:${appmsgId}`;
      const type = url.searchParams.get('type') || 'unknown';
      const isNew = url.searchParams.get('isNew') || 'unknown';
      return `editor:${type}:${isNew}`;
    } catch {
      return null;
    }
  }

  function sameFeishuDoc(left, right) {
    const a = typeof left === 'string' ? parseFeishuDocUrl(left) : left;
    const b = typeof right === 'string' ? parseFeishuDocUrl(right) : right;
    return Boolean(a && b && a.host === b.host && a.kind === b.kind && a.token === b.token);
  }

  global.IFANR_SOURCE_LINK = Object.freeze({ parseFeishuDocUrl, isWechatEditorUrl, wechatEditorKey, sameFeishuDoc });
})(globalThis);
