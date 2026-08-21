/**
 * popup.js
 * 爱范儿一键排版 (Lark2Pad) 极速弹窗交互控制器
 * 支持：提取/注入同级双大主按钮、公众号/Pad 智能环境识别与直注、无损高保真原图直通
 */
(function () {
  'use strict';

  // DOM Elements
  const mainConvertBtn = document.querySelector('#main-convert-btn');
  const mainInjectBtn = document.querySelector('#main-inject-btn');
  const extractBtnText = document.querySelector('#extract-btn-text');
  const injectBtnText = document.querySelector('#inject-btn-text');

  const copyWechatBtn = document.querySelector('#copy-wechat');
  const copyPadBtn = document.querySelector('#copy-pad');
  const convertClipboardBtn = document.querySelector('#convert-clipboard-btn');
  const clearBtn = document.querySelector('#clear-btn');

  const statusTag = document.querySelector('#status-tag');
  const statusMsg = document.querySelector('#status-msg');
  const serviceIndicator = document.querySelector('#service-indicator');
  const sourceTitle = document.querySelector('#source-title');
  const sourceMeta = document.querySelector('#source-meta');

  const packageCard = document.querySelector('#package-card');
  const metricBlocks = document.querySelector('#metric-blocks');
  const metricImages = document.querySelector('#metric-images');
  const metricBrand = document.querySelector('#metric-brand');

  const titleImageBrandSelect = document.querySelector('#title-image-brand');
  const roundImagesToggle = document.querySelector('#round-images');
  const autoBannersToggle = document.querySelector('#auto-banners');

  const resultCard = document.querySelector('#result-card');
  const resultTitle = document.querySelector('#result-title');
  const resultCopy = document.querySelector('#result-copy');
  const toastMsg = document.querySelector('#toast-msg');

  // Keys
  const CACHE_KEY = 'ifanrLark2PadCache';
  const ARTICLE_PKG_KEY = 'ifanrArticlePackage';
  const SETTINGS_KEY = 'ifanrLark2PadSettings';

  let activeTab = null;
  let cachedPackage = null;
  let targetPlatform = 'wechat'; // 'wechat' | 'pad'
  let settings = {
    titleImageBrand: 'auto',
    roundImages: true,
    autoBanners: true
  };

  let toastTimer = null;
  function showToast(msg) {
    if (!toastMsg) return;
    toastMsg.textContent = msg;
    toastMsg.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastMsg.classList.remove('show');
    }, 2200);
  }

  function setStatus(tag, message) {
    if (statusTag) statusTag.textContent = tag;
    if (statusMsg) statusMsg.textContent = message;
  }

  function showResult(title, copy, tone = 'neutral') {
    if (!resultCard) return;
    resultCard.hidden = false;
    resultCard.dataset.tone = tone;
    if (resultTitle) resultTitle.textContent = title;
    if (resultCopy) resultCopy.textContent = copy;
  }

  function hideResult() {
    if (resultCard) resultCard.hidden = true;
  }

  function renderPackage(pkg) {
    if (!pkg) {
      if (packageCard) packageCard.hidden = true;
      if (sourceTitle) sourceTitle.textContent = '尚未选择文档';
      if (sourceMeta) sourceMeta.textContent = '在飞书文档页打开，或点击“从剪贴板读取”';
      if (metricBlocks) metricBlocks.textContent = '—';
      if (metricImages) metricImages.textContent = '—';
      return;
    }

    if (packageCard) packageCard.hidden = false;
    if (sourceTitle) sourceTitle.textContent = pkg.title || '已转换文档';
    if (sourceMeta) sourceMeta.textContent = pkg.sourceUrl || '来自剪贴板';

    if (metricBlocks) metricBlocks.textContent = String(pkg.blockCount || 0);
    if (metricImages) metricImages.textContent = `${pkg.imageCount || 0} 张`;
    if (metricBrand) {
      const brand = pkg.brand || settings.titleImageBrand;
      metricBrand.textContent = brand === 'appso' ? 'AppSo' : '爱范儿';
    }
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get([SETTINGS_KEY, CACHE_KEY, ARTICLE_PKG_KEY]);
    if (data[SETTINGS_KEY]) {
      settings = { ...settings, ...data[SETTINGS_KEY] };
    }
    if (titleImageBrandSelect) titleImageBrandSelect.value = settings.titleImageBrand;
    if (roundImagesToggle) roundImagesToggle.checked = settings.roundImages !== false;
    if (autoBannersToggle) autoBannersToggle.checked = settings.autoBanners !== false;

    if (data[CACHE_KEY]) {
      cachedPackage = data[CACHE_KEY];
      renderPackage(cachedPackage);
      setStatus('已就绪', '历史内容已就绪，可直接注入或复制');
    }
  }

  async function saveSettings() {
    settings.titleImageBrand = titleImageBrandSelect?.value || 'auto';
    settings.roundImages = roundImagesToggle?.checked !== false;
    settings.autoBanners = autoBannersToggle?.checked !== false;
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  function determineBrand(title = '', rawHtml = '') {
    if (settings.titleImageBrand !== 'auto') {
      return settings.titleImageBrand;
    }
    const lower = (title + ' ' + rawHtml).toLowerCase();
    if (lower.includes('appso') || lower.includes('灵感指南') || lower.includes('ios') || lower.includes('iphone') || lower.includes('apple')) {
      return 'appso';
    }
    return 'ifanr';
  }

  function cleanDisplayTitle(raw = '') {
    return String(raw || '').replace(/\s*-\s*飞书云文档\s*$/i, '').trim();
  }

  async function readClipboardFull() {
    let html = '';
    let text = '';

    if (navigator.clipboard?.read) {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.includes('text/html')) {
            const blob = await item.getType('text/html');
            html = await blob.text();
          }
          if (item.types.includes('text/plain')) {
            const blob = await item.getType('text/plain');
            text = await blob.text();
          }
        }
      } catch (e) {
        console.warn('navigator.clipboard.read() error:', e);
      }
    }

    if (!html && !text) {
      try {
        text = await navigator.clipboard.readText();
      } catch (e) {
        console.warn('readText error:', e);
      }
    }

    return { html, text };
  }

  /**
   * 执行核心转换逻辑 (纯前端 100% 内存极速转换)
   */
  async function performConversion(htmlOrMarkdown, title = '未命名飞书文档', sourceUrl = '') {
    const converter = globalThis.IFANR_LARK2PAD_CONVERTER;
    if (!converter) {
      throw new Error('转换器引擎尚未就绪，请刷新重试');
    }

    const brand = determineBrand(title, typeof htmlOrMarkdown === 'string' ? htmlOrMarkdown : '');
    const converted = converter.convertFeishuDoc(htmlOrMarkdown, {
      brand,
      roundImages: settings.roundImages,
      addHeaderBanner: settings.autoBanners,
      addFooterBanner: settings.autoBanners
    });

    const pkg = {
      title: cleanDisplayTitle(title),
      sourceUrl,
      brand,
      markdown: converted.markdown,
      cleanMarkdown: converted.cleanMarkdown || converted.markdown,
      wechatMarkdown: converted.wechatMarkdown || converted.markdown,
      rawInput: (typeof htmlOrMarkdown === 'object' || Array.isArray(htmlOrMarkdown)) ? htmlOrMarkdown : (cachedPackage?.rawInput || htmlOrMarkdown),
      wechatHtml: converted.wechatHtml,
      etherpadBody: converted.etherpadBody || converted.etherpadHtml,
      etherpadHtml: converted.etherpadHtml,
      imageCount: converted.imageCount,
      blockCount: converted.blockCount,
      convertedAt: new Date().toISOString()
    };

    cachedPackage = pkg;
    await chrome.storage.local.set({
      [CACHE_KEY]: pkg,
      [ARTICLE_PKG_KEY]: {
        html: converted.wechatHtml,
        sourceUrl,
        title: pkg.title,
        brand
      }
    });
    renderPackage(pkg);
    return pkg;
  }

  /**
   * 一键从当前飞书页面提取并转换 (100% 自动读取全文内容块与无损原图)
   */
  async function convertCurrentFeishuDoc() {
    if (!activeTab || !activeTab.id) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tab;
    }

    const isFeishu = activeTab?.url && (activeTab.url.includes('feishu.cn/wiki/') || activeTab.url.includes('feishu.cn/docx/'));

    setStatus('读取中', '正在自动扫描并读取飞书文档…');
    mainConvertBtn.disabled = true;

    try {
      let docTitle = cleanDisplayTitle(activeTab?.title) || '未命名飞书文档';
      let docUrl = activeTab?.url || '';

      if (isFeishu) {
        const response = await chrome.tabs.sendMessage(activeTab.id, {
          type: 'IFANR_EXTRACT_FEISHU_DIRECT'
        }).catch(async () => {
          const [execResult] = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: () => {
              const h1 = document.querySelector('h1');
              const title = h1?.innerText?.trim() || document.title.replace(/\s*-\s*飞书云文档\s*$/i, '').trim();
              const container = document.querySelector('.bear-web-x-container') || document.body;
              return {
                ok: true,
                title,
                sourceUrl: location.href,
                html: container?.innerHTML || ''
              };
            }
          });
          return execResult?.result;
        });

        if (response?.ok && (response.blocks?.length || response.html)) {
          docTitle = cleanDisplayTitle(response.title) || docTitle;
          docUrl = response.sourceUrl || docUrl;
          const inputData = (response.blocks && response.blocks.length > 0) ? response.blocks : response.html;
          const pkg = await performConversion(inputData, docTitle, docUrl);
          setStatus('转换完成', `已转换 ${pkg.blockCount} 个内容块，${pkg.imageCount} 张图片`);
          showToast('已自动读取全文并生成公众号/Pad 排版！');
          return;
        }
      }

      // 如果非飞书页面，从剪贴板读取
      await convertFromClipboard();
    } catch (err) {
      console.error('Convert error:', err);
      setStatus('转换失败', err.message || '读取失败');
      showToast('读取文档异常，请重试');
    } finally {
      mainConvertBtn.disabled = false;
    }
  }

  /**
   * 从系统剪贴板读取并转换
   */
  async function convertFromClipboard() {
    try {
      setStatus('读取中', '正在读取剪贴板内容…');
      const clip = await readClipboardFull();
      const payload = clip.html || clip.text;

      if (!payload || payload.trim().length === 0) {
        showToast('剪贴板为空，请先在飞书中复制文档');
        setStatus('剪贴板为空', '请在飞书中复制文档后重试');
        return;
      }

      const firstLine = (clip.text || payload).trim().split('\n')[0].replace(/<[^>]+>/g, '').replace(/^[#\s]+/, '').trim();
      const title = cleanDisplayTitle(firstLine.slice(0, 50)) || '剪贴板内容';

      const pkg = await performConversion(payload, title, '来自剪贴板');
      setStatus('转换完成', `已从剪贴板转换 ${pkg.blockCount} 个内容块，${pkg.imageCount} 张图片`);
      showToast('剪贴板转换成功！可直接注入或复制');
    } catch (err) {
      console.error('Clipboard convert error:', err);
      showToast('读取剪贴板失败，请检查剪贴板权限');
      setStatus('读取失败', '未能成功读取剪贴板');
    }
  }

  /**
   * 复制微信公众号富文本
   */
  async function copyWechat() {
    if (!cachedPackage || !cachedPackage.wechatHtml) {
      await convertCurrentFeishuDoc();
      if (!cachedPackage || !cachedPackage.wechatHtml) return;
    }

    try {
      const html = cachedPackage.wechatHtml;
      const text = cachedPackage.markdown || cleanDisplayTitle(cachedPackage.title);

      if (navigator.clipboard?.write && window.ClipboardItem && html) {
        const blobHtml = new Blob([html], { type: 'text/html' });
        const blobText = new Blob([text], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': blobHtml,
          'text/plain': blobText
        })]);
      } else {
        await navigator.clipboard.writeText(html);
      }

      showToast('已复制微信公众号排版！可直接粘贴至公众号草稿');
      setStatus('已复制', '公众号富文本已写入剪贴板');
    } catch (err) {
      console.error('Copy wechat error:', err);
      showToast('复制失败，请重试');
    }
  }

  /**
   * 复制 Pad 标准 HTML 与 Markdown (与 Lark2Pad 完全对齐)
   */
  async function copyPad() {
    if (!cachedPackage || !cachedPackage.etherpadHtml) {
      await convertCurrentFeishuDoc();
      if (!cachedPackage || !cachedPackage.etherpadHtml) return;
    }

    try {
      const html = cachedPackage.etherpadHtml;
      const markdown = cachedPackage.cleanMarkdown || cachedPackage.markdown || html;

      if (navigator.clipboard?.write && window.ClipboardItem && html) {
        const blobHtml = new Blob([html], { type: 'text/html' });
        const blobText = new Blob([markdown], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': blobHtml,
          'text/plain': blobText
        })]);
      } else {
        await navigator.clipboard.writeText(markdown);
      }

      showToast('已复制 Pad 格式！可在 Pad 或 Markdown 编辑器直接粘贴');
      setStatus('已复制', 'Pad 标准格式已写入剪贴板');
    } catch (err) {
      console.error('Copy pad error:', err);
      showToast('复制失败，请重试');
    }
  }

  /**
   * 智能注入：自动识别公众号 / Pad
   */
  async function smartInject() {
    if (!cachedPackage || (!cachedPackage.wechatHtml && !cachedPackage.etherpadHtml)) {
      await convertCurrentFeishuDoc();
      if (!cachedPackage) return;
    }

    // 1. 判断当前激活标签页
    if (activeTab?.url) {
      if (isPadUrl(activeTab.url)) {
        await injectToPadTab(activeTab.id);
        return;
      }
      if (isWechatUrl(activeTab.url)) {
        await injectToWechatTab(activeTab.id);
        return;
      }
    }

    // 2. 如果当前不是目标页，扫描后台已打开的标签页
    const allTabs = await chrome.tabs.query({}).catch(() => []);
    const padTabs = allTabs.filter(t => t.url && isPadUrl(t.url));
    const wechatTabs = allTabs.filter(t => t.url && isWechatUrl(t.url));

    if (targetPlatform === 'pad' && padTabs.length > 0) {
      await injectToPadTab(padTabs[0].id);
      return;
    }

    if (targetPlatform === 'wechat' && wechatTabs.length > 0) {
      await injectToWechatTab(wechatTabs[0].id);
      return;
    }

    if (padTabs.length > 0) {
      await injectToPadTab(padTabs[0].id);
      return;
    }

    if (wechatTabs.length > 0) {
      await injectToWechatTab(wechatTabs[0].id);
      return;
    }

    // 3. 若无打开的编辑器，复制富文本并提示
    await copyWechat();
    showToast('未检测到已打开的公众号或 Pad 编辑页，已自动复制排版！');
    setStatus('已自动复制', '请在目标编辑器中直接粘贴 (Cmd+V)');
  }

  function isWechatUrl(url = '') {
    return url.includes('mp.weixin.qq.com');
  }

  function isPadUrl(url = '') {
    if (!url || typeof url !== 'string') return false;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const path = u.pathname.toLowerCase();
      if (host.startsWith('pad.') || host.includes('.pad.') || host.startsWith('ep.') || host.includes('etherpad')) return true;
      if ((host.includes('ifanr.com') || host.includes('ifanr.cn')) && (path.startsWith('/p/') || path.startsWith('/pad/'))) return true;
      if (path.includes('etherpad') || path.includes('/pad/')) return true;
    } catch {
      return /(?:pad\.|\.pad\.|etherpad|\/p\/|\/pad\/|ep\.ifanr)/i.test(url);
    }
    return /(?:pad\.|\.pad\.|etherpad|\/p\/|\/pad\/|ep\.ifanr)/i.test(url);
  }

  /**
   * 注入微信公众号草稿
   */
  async function injectToWechatTab(tabId) {
    setStatus('注入中', '正在向微信公众号草稿写入正文…');

    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'IFANR_INJECT_HTML',
        html: cachedPackage.wechatHtml,
        title: cachedPackage.title,
        sourceUrl: cachedPackage.sourceUrl,
        options: {
          roundImages: settings.roundImages,
          titleImageBrand: cachedPackage.brand || settings.titleImageBrand,
          forceEditorReplace: true,
          requireHostedImages: false
        }
      }).catch(() => null);

      if (!response || !response.ok) {
        await chrome.scripting.executeScript({
          target: { tabId },
          args: [cachedPackage.wechatHtml, cachedPackage.title],
          func: (htmlContent, docTitle) => {
            const editor = document.querySelector('#ueditor_0 .ProseMirror') ||
                           document.querySelector('.ProseMirror[contenteditable="true"]') ||
                           document.querySelector('[contenteditable="true"][data-wechat-editor]') ||
                           document.querySelector('[contenteditable="true"]');
            if (editor) {
              editor.innerHTML = htmlContent;
              editor.dispatchEvent(new Event('input', { bubbles: true }));
              editor.dispatchEvent(new Event('change', { bubbles: true }));

              const titleInput = document.querySelector('input#title, textarea#title, .js_title, [placeholder*="标题"]');
              if (titleInput && docTitle && !titleInput.value) {
                titleInput.value = docTitle;
                titleInput.dispatchEvent(new Event('input', { bubbles: true }));
                titleInput.dispatchEvent(new Event('change', { bubbles: true }));
              }
              return { ok: true };
            }
            return { ok: false };
          }
        });
      }

      showToast('已成功注入微信公众号草稿！');
      setStatus('注入成功', '公众号草稿已写入，可切换到公众号页面查看');
      showResult('注入完成', '正文与标题已成功填入公众号草稿。', 'success');
    } catch (err) {
      console.error('WeChat inject error:', err);
      await copyWechat();
      showToast('注入受阻，已为您自动复制排版富文本，直接粘贴即可！');
    }
  }

  /**
   * 注入 Pad 编辑器
   */
  async function injectToPadTab(tabId) {
    setStatus('注入中', '正在向 Pad 编辑器写入排版…');

    try {
      const [execResult] = await chrome.scripting.executeScript({
        target: { tabId },
        args: [cachedPackage.etherpadBody || cachedPackage.etherpadHtml, cachedPackage.cleanMarkdown || cachedPackage.markdown, cachedPackage.title],
        func: (bodyHtml, markdownContent, docTitle) => {
          const outerFrame = document.querySelector('iframe[name="ace_outer"]') || document.querySelector('#ace_outer');
          const innerFrame = outerFrame?.contentDocument?.querySelector('iframe[name="ace_inner"]') || outerFrame?.contentDocument?.querySelector('#ace_inner');
          const innerDoc = innerFrame?.contentDocument || document;
          const editorBody = innerDoc.querySelector('#innerdocbody') ||
                             document.querySelector('#innerdocbody') ||
                             document.querySelector('.ProseMirror') ||
                             document.querySelector('[contenteditable="true"]');

          if (editorBody) {
            editorBody.innerHTML = bodyHtml;
            editorBody.dispatchEvent(new Event('input', { bubbles: true }));
            editorBody.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true };
          }

          if (window.pad && typeof window.pad.setHtml === 'function') {
            window.pad.setHtml(bodyHtml);
            return { ok: true };
          }

          return { ok: false };
        }
      });

      if (execResult?.result?.ok) {
        showToast('已成功注入 Pad 编辑器！');
        setStatus('注入成功', 'Pad 格式已写入目标页面');
        showResult('注入完成', '已成功将 Pad 标准排版填入当前 Pad。', 'success');
      } else {
        await copyPad();
        showToast('已复制 Pad 格式，可在 Pad 中直接粘贴 (Cmd+V)！');
      }
    } catch (err) {
      console.error('Pad inject error:', err);
      await copyPad();
      showToast('已复制 Pad 格式，可直接在 Pad 中粘贴 (Cmd+V)！');
    }
  }

  /**
   * 清除数据
   */
  async function clearAll() {
    cachedPackage = null;
    await chrome.storage.local.remove([CACHE_KEY, ARTICLE_PKG_KEY]);
    renderPackage(null);
    hideResult();
    setStatus('已重置', '点击上方按钮开始转换新文档');
    showToast('已清除历史缓存');
  }

  // Event Listeners
  mainConvertBtn?.addEventListener('click', convertCurrentFeishuDoc);
  mainInjectBtn?.addEventListener('click', smartInject);
  copyWechatBtn?.addEventListener('click', copyWechat);
  copyPadBtn?.addEventListener('click', copyPad);
  convertClipboardBtn?.addEventListener('click', convertFromClipboard);
  clearBtn?.addEventListener('click', clearAll);

  titleImageBrandSelect?.addEventListener('change', async () => {
    await saveSettings();
    if (cachedPackage) {
      const input = cachedPackage.rawInput || cachedPackage.markdown || cachedPackage.wechatHtml;
      await performConversion(input, cachedPackage.title, cachedPackage.sourceUrl);
      showToast('已更新题图品牌并重新渲染');
    }
  });

  roundImagesToggle?.addEventListener('change', async () => {
    await saveSettings();
    if (cachedPackage) {
      const input = cachedPackage.rawInput || cachedPackage.markdown || cachedPackage.wechatHtml;
      await performConversion(input, cachedPackage.title, cachedPackage.sourceUrl);
      showToast(roundImagesToggle.checked ? '已开启图片 8px 连续圆角' : '已关闭图片圆角（直角直出）');
    } else {
      showToast(roundImagesToggle.checked ? '图片圆角已开启' : '图片圆角已关闭');
    }
  });

  autoBannersToggle?.addEventListener('change', async () => {
    await saveSettings();
    if (cachedPackage) {
      const input = cachedPackage.rawInput || cachedPackage.markdown || cachedPackage.wechatHtml;
      await performConversion(input, cachedPackage.title, cachedPackage.sourceUrl);
      showToast('已更新 Banner 设置并重新渲染');
    }
  });

  // Initialization & Auto-detection
  async function init() {
    await loadSettings();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;

    if (activeTab?.url) {
      if (isPadUrl(activeTab.url)) {
        targetPlatform = 'pad';
        if (mainInjectBtn) mainInjectBtn.dataset.target = 'pad';
        if (injectBtnText) injectBtnText.textContent = '一键注入 Pad';
        if (serviceIndicator) {
          serviceIndicator.textContent = '识别到 Pad 编辑器';
          serviceIndicator.dataset.state = 'pad';
        }
        setStatus('Pad 就绪', '点击右上方按钮一键注入当前 Pad');
      } else if (isWechatUrl(activeTab.url)) {
        targetPlatform = 'wechat';
        if (mainInjectBtn) mainInjectBtn.dataset.target = 'wechat';
        if (injectBtnText) injectBtnText.textContent = '一键注入公众号';
        if (serviceIndicator) {
          serviceIndicator.textContent = '识别到微信公众号';
          serviceIndicator.dataset.state = 'online';
        }
        setStatus('公众号就绪', '点击右上方按钮一键注入当前草稿');
      } else if (activeTab.url.includes('feishu.cn/wiki/') || activeTab.url.includes('feishu.cn/docx/')) {
        if (serviceIndicator) {
          serviceIndicator.textContent = '识别到飞书文档';
          serviceIndicator.dataset.state = 'online';
        }
        setStatus('飞书文档就绪', '点击左上方秒级读取全文与高清图片');
      }
    }
  }

  init();
})();
