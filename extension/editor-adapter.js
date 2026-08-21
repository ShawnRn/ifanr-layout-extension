(function exposeWechatEditorAdapter(global) {
  const DEFAULT_EDITOR_SELECTORS = [
    '#ueditor_0 .ProseMirror',
    '.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"][data-wechat-editor]'
  ];

  const DEFAULT_SAVE_SELECTORS = [
    '[data-save-status]',
    '.weui-desktop-editor__status',
    '.js_save_status',
    '[role="alert"]',
    '[class*="toast"]',
    '[class*="tips"]',
    '[class*="save"][class*="status"]'
  ];

  const DEFAULT_TITLE_FIELD_SELECTORS = [
    'textarea#title',
    'input#title',
    'textarea[name="title"]',
    'input[name="title"]',
    '.js_title',
    '[data-placeholder*="标题"]',
    '[placeholder*="标题"]'
  ];

  const DEFAULT_SUMMARY_FIELD_SELECTORS = [
    'textarea#js_description',
    'textarea#js_digest',
    'textarea[name="digest"]',
    'textarea[name="description"]',
    'input[name="digest"]',
    '[data-placeholder*="摘要"]',
    '[placeholder*="摘要"]'
  ];

  const SAVED_TEXT = /已保存|保存成功|草稿已保存/i;
  const DEFAULT_IMAGE_STALL_TIMEOUT_MS = 8000;
  const DEFAULT_IMAGE_UPLOAD_BATCH_SIZE = 3;
  const DEFAULT_IMAGE_BATCH_TIMEOUT_MS = 10000;
  const DEFAULT_IMAGE_BATCH_MAX_ENCODED_BYTES = 10 * 1024 * 1024;
  const DEFAULT_SAVE_STALL_TIMEOUT_MS = 3000;
  const BODY_EDIT_STYLE = 'margin:0 16px 24px;color:#222222;font-size:15px;font-family:"PingFangSC-Light","PingFang SC",-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;font-weight:300;line-height:1.8;letter-spacing:0.02em;';

  function editorCandidateDetails(selectors) {
    const nodes = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (seen.has(node)) continue;
        seen.add(node);
        nodes.push(node);
      }
    }
    return nodes.map((node, index) => {
      const rect = node.getBoundingClientRect?.() || { width: 0, height: 0 };
      const textLength = compactNodeText(node).length;
      const htmlLength = String(node.innerHTML || '').length;
      const area = Math.max(0, Number(rect.width || node.clientWidth || 0)) *
        Math.max(0, Number(rect.height || node.clientHeight || 0));
      const editable = node.isContentEditable || node.getAttribute?.('contenteditable') === 'true';
      const insideMainEditor = Boolean(node.closest?.('#ueditor_0'));
      const visible = area > 0;
      const score = (editable ? 1_000_000 : 0) +
        (insideMainEditor ? 2_000_000 : 0) +
        (visible ? 250_000 : 0) +
        Math.min(500_000, area) +
        Math.min(250_000, Number(node.scrollHeight || 0) * Math.max(1, Number(node.clientWidth || 0))) +
        Math.min(100_000, textLength * 8) +
        Math.min(50_000, htmlLength);
      return { node, index, score, textLength, htmlLength, area, editable, insideMainEditor, visible };
    }).sort((a, b) => b.score - a.score || b.textLength - a.textLength || b.htmlLength - a.htmlLength || a.index - b.index);
  }

  function findWechatEditor(selectors) {
    const candidates = editorCandidateDetails(selectors);
    const summarize = (candidate) => candidate ? {
      score: candidate.score,
      textLength: candidate.textLength,
      htmlLength: candidate.htmlLength,
      area: Math.round(candidate.area),
      editable: candidate.editable,
      insideMainEditor: candidate.insideMainEditor,
      visible: candidate.visible
    } : null;
    return {
      editor: candidates[0]?.node || null,
      candidateCount: candidates.length,
      selected: summarize(candidates[0]),
      candidates: candidates.slice(0, 4).map(summarize)
    };
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function metadataFieldValue(field) {
    if (!field) return '';
    return 'value' in field ? String(field.value || '') : String(field.innerText || field.textContent || '');
  }

  function metadataFieldVisible(field) {
    const rect = field.getBoundingClientRect?.() || { width: 0, height: 0 };
    const style = global.getComputedStyle?.(field);
    return rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden';
  }

  function metadataFieldDescriptor(field) {
    if (!field) return null;
    return {
      tag: field.tagName,
      id: field.id || null,
      name: field.getAttribute?.('name') || null,
      className: String(field.className || '').slice(0, 120),
      placeholder: field.getAttribute?.('placeholder') || field.getAttribute?.('data-placeholder') || null,
      maxLength: Number(field.maxLength || 0) > 0 ? Number(field.maxLength) : null
    };
  }

  function findWechatMetadataField(kind, editor, selectors) {
    const exact = new Map();
    selectors.forEach((selector, index) => {
      try {
        for (const node of document.querySelectorAll(selector)) {
          if (!exact.has(node)) exact.set(node, selectors.length - index);
        }
      } catch {
        // A future selector override must not interrupt the body write.
      }
    });
    const candidates = new Set([
      ...exact.keys(),
      ...document.querySelectorAll('input,textarea,[contenteditable="true"]')
    ]);
    const wanted = kind === 'title' ? /(?:^|[-_\s])(title)(?:$|[-_\s])|标题/i : /digest|summary|description|摘要/i;
    const excluded = kind === 'title'
      ? /作者|author|摘要|digest|summary|description|封面|cover/i
      : /作者|author|标题|title|封面|cover|原文链接|source/i;
    const scored = [...candidates].filter((field) => {
      if (field === editor || editor.contains?.(field) || field.closest?.('#ueditor_0')) return false;
      if (field.disabled || field.readOnly || field.getAttribute?.('aria-disabled') === 'true') return false;
      if (field.tagName === 'INPUT' && ['hidden', 'file', 'checkbox', 'radio'].includes(String(field.type || '').toLowerCase())) return false;
      return metadataFieldVisible(field);
    }).map((field) => {
      const attributes = [
        field.id,
        field.getAttribute?.('name'),
        field.className,
        field.getAttribute?.('placeholder'),
        field.getAttribute?.('data-placeholder'),
        field.getAttribute?.('aria-label'),
        field.parentElement?.innerText
      ].filter(Boolean).join(' ').slice(0, 500);
      let score = (exact.get(field) || 0) * 1000;
      if (wanted.test(attributes)) score += 200;
      if (excluded.test(attributes)) score -= 500;
      if (field.tagName === 'TEXTAREA') score += kind === 'summary' ? 30 : 10;
      if (field.id === (kind === 'title' ? 'title' : 'js_description')) score += 500;
      return { field, score, descriptor: metadataFieldDescriptor(field) };
    }).filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    return {
      field: scored[0]?.field || null,
      candidateCount: scored.length,
      selected: scored[0]?.descriptor || null
    };
  }

  function setMetadataFieldValue(field, value) {
    if ('value' in field) {
      const prototype = field.tagName === 'TEXTAREA' ? global.HTMLTextAreaElement?.prototype : global.HTMLInputElement?.prototype;
      const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(field, value);
      else field.value = value;
    } else {
      field.replaceChildren(document.createTextNode(value));
    }
    try {
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } catch {
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function fillMetadataField(kind, editor, requestedValue, selectors) {
    const requested = String(requestedValue || '').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
    if (!requested) return { requested: false, found: false, confirmed: true, length: 0 };
    const selection = findWechatMetadataField(kind, editor, selectors);
    const field = selection.field;
    if (!field) {
      return { requested: true, found: false, confirmed: false, length: requested.length, candidateCount: selection.candidateCount };
    }
    const fallbackLimit = kind === 'title' ? 64 : 120;
    const maxLength = Number(field.maxLength || 0) > 0 ? Number(field.maxLength) : fallbackLimit;
    const value = Array.from(requested).slice(0, maxLength).join('');
    setMetadataFieldValue(field, value);
    await wait(60);
    const confirmed = metadataFieldValue(field).replace(/\s+/g, ' ').trim() === value;
    return {
      requested: true,
      found: true,
      confirmed,
      length: value.length,
      truncated: value !== requested,
      candidateCount: selection.candidateCount,
      selected: selection.selected
    };
  }

  async function fillArticleMetadata(editor, options) {
    const title = await fillMetadataField('title', editor, options.articleTitle, options.titleFieldSelectors || DEFAULT_TITLE_FIELD_SELECTORS);
    const summary = await fillMetadataField('summary', editor, options.articleSummary, options.summaryFieldSelectors || DEFAULT_SUMMARY_FIELD_SELECTORS);
    return {
      title,
      summary,
      titleConfirmed: title.confirmed,
      summaryConfirmed: summary.confirmed,
      metadataConfirmed: title.confirmed && summary.confirmed
    };
  }

  async function emitProgress(options, progress) {
    if (typeof options.onProgress !== 'function') return;
    try {
      await options.onProgress({
        ...progress,
        updatedAt: new Date().toISOString()
      });
    } catch {
      // Progress reporting must never interrupt an otherwise valid write.
    }
  }

  function readSavedSignal(selectors) {
    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        const value = node.textContent?.trim() || '';
        if (SAVED_TEXT.test(value)) return value;
      }
    }
    return '';
  }

  function findSafeDraftSaveControl() {
    const candidates = [...document.querySelectorAll('button, a, [role="button"]')]
      .filter((node) => node.textContent?.trim() === '保存为草稿')
      .filter((node) => !node.disabled && node.getAttribute('aria-disabled') !== 'true');
    return {
      candidateCount: candidates.length,
      control: candidates.length === 1 ? candidates[0] : null
    };
  }

  function textHash(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function normalizeValidationText(value = '') {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\p{Cf}/gu, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function validateReplacement({
    actualText = '',
    expectedTextContains = '',
    forbiddenTextFound = [],
    forcedReplacement = false,
    styleInspection = {},
    expectedImageCount = 0
  } = {}) {
    const normalizedActualText = normalizeValidationText(actualText);
    const normalizedExpectedText = normalizeValidationText(expectedTextContains);
    const expectedTextFound = !normalizedExpectedText || normalizedActualText.includes(normalizedExpectedText);
    const forbiddenClear = forbiddenTextFound.length === 0;
    const strictReplacementConfirmed = expectedTextFound && forbiddenClear;
    const structuralContentConfirmed = Number(styleInspection.directArticleRootCount || 0) === 1 &&
      styleInspection.editorIsolationConfirmed === true &&
      (normalizedActualText.length > 0 || Number(expectedImageCount || 0) > 0);
    const replacementValidationBypassed = forcedReplacement &&
      !strictReplacementConfirmed &&
      forbiddenClear &&
      structuralContentConfirmed;
    return {
      expectedTextFound,
      strictReplacementConfirmed,
      structuralContentConfirmed,
      replacementValidationBypassed,
      replacementConfirmed: strictReplacementConfirmed || replacementValidationBypassed
    };
  }

  function inspectImages(editor) {
    const images = [...editor.querySelectorAll('img')];
    const details = images.map((image) => {
      const src = image.getAttribute('src') || '';
      let kind = '';
      if (src.startsWith('data:')) kind = 'data';
      else if (src.startsWith('blob:')) kind = 'blob';
      else if (src.startsWith('chrome-extension:')) kind = 'extension';
      else {
        try {
          kind = new URL(src, location.href).hostname || 'relative';
        } catch {
          kind = 'invalid';
        }
      }
      const rect = image.getBoundingClientRect();
      const style = global.getComputedStyle?.(image);
      const imageContainer = image.closest?.('[data-ifanr-image-order], [data-media-name]');
      const rawOrder = image.dataset.ifanrImageOrder || imageContainer?.dataset.ifanrImageOrder || '';
      return {
        kind,
        order: Number(rawOrder) || null,
        mediaName: image.dataset.ifanrMediaName || imageContainer?.dataset.mediaName || null,
        animated: (image.dataset.ifanrImageKind || imageContainer?.dataset.ifanrImageKind) === 'gif',
        complete: image.complete,
        naturalWidth: Number(image.naturalWidth || 0),
        naturalHeight: Number(image.naturalHeight || 0),
        loaded: image.complete && Number(image.naturalWidth || 0) > 0,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: rect.width > 1 && rect.height > 1 && style?.display !== 'none' && style?.visibility !== 'hidden'
      };
    });
    const pendingKinds = new Set(['data', 'blob', 'extension', 'relative', 'invalid']);
    const pendingImages = details.filter((item) => pendingKinds.has(item.kind) || (item.order && !item.loaded));
    const visibleHostedImages = details.filter((item) => item.visible && item.loaded && !pendingKinds.has(item.kind));
    return {
      imageCount: images.length,
      visibleImageCount: details.filter((item) => item.visible).length,
      visibleHostedImageCount: visibleHostedImages.length,
      hostedImageCount: details.filter((item) => item.loaded && !pendingKinds.has(item.kind)).length,
      imageSourceKinds: details.map((item) => item.kind),
      imageSourceDetails: details,
      pendingEmbeddedImageCount: pendingImages.length,
      pendingImageOrders: [...new Set(pendingImages.map((item) => item.order).filter(Boolean))].sort((a, b) => a - b),
      pendingImageNames: [...new Set(pendingImages.map((item) => item.mediaName).filter(Boolean))],
      pendingAnimatedImageCount: pendingImages.filter((item) => item.animated).length
    };
  }

  function isUnsafeStyleValue(value) {
    if (!value || typeof value !== 'string') return false;
    if (/(?:expression\s*\(|javascript:|vbscript:|@import|-moz-binding|behavior\s*:)/i.test(value)) {
      return true;
    }
    const urlMatches = value.matchAll(/url\s*\(\s*([^)]*)\s*\)/gi);
    for (const match of urlMatches) {
      let rawUrl = match[1].trim();
      rawUrl = rawUrl.replace(/^(&quot;|&#39;|[\x27\x22])+|(&quot;|&#39;|[\x27\x22])+$/g, '').trim();
      if (!/^(?:https?:|data:image\/|\/|\.\/|#)/i.test(rawUrl)) {
        return true;
      }
    }
    return false;
  }

  function sanitizeArticleTemplate(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    const blockedTags = 'script,style,iframe,object,embed,link,meta,base,form,input,button,textarea,select,option,video,audio,canvas,svg,math';
    template.content.querySelectorAll(blockedTags).forEach((node) => node.remove());
    for (const node of template.content.querySelectorAll('*')) {
      for (const attribute of [...node.attributes]) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith('on') || ['srcdoc', 'srcset', 'formaction', 'xlink:href', 'autofocus', 'contenteditable'].includes(name)) {
          node.removeAttribute(attribute.name);
          continue;
        }
        if (name === 'href' && !/^https?:\/\//i.test(value)) {
          node.removeAttribute(attribute.name);
          continue;
        }
        if (name === 'src') {
          const safeImage = node.tagName === 'IMG' && (/^https?:\/\//i.test(value) || /^data:image\/(?:jpeg|png|gif|webp);base64,/i.test(value));
          if (!safeImage) node.removeAttribute(attribute.name);
          continue;
        }
        if (name === 'style' && isUnsafeStyleValue(value)) {
          node.removeAttribute(attribute.name);
        }
      }
    }
    return template;
  }

  function sanitizeArticleHtml(html) {
    return sanitizeArticleTemplate(html).innerHTML;
  }

  function nodeHasEditableContent(node) {
    const text = String(node?.textContent || '').replace(/[\s\u200B-\u200D\u2060\u2063\uFEFF]/g, '');
    return text.length > 0 || Boolean(node?.querySelector?.('img,video,audio,iframe,object,embed,canvas,svg'));
  }

  function cleanPastedInlineFormatting(block) {
    for (const node of block.querySelectorAll('*')) {
      if (node.hasAttribute('data-ifanr-block') || node.hasAttribute('data-ifanr-style-role')) continue;
      const tag = node.tagName;
      const href = tag === 'A' ? node.getAttribute('href') : null;
      node.removeAttribute('class');
      node.removeAttribute('color');
      node.removeAttribute('face');
      node.removeAttribute('size');
      if (['STRONG', 'B'].includes(tag)) {
        node.setAttribute('style', 'font-weight:600;');
      } else if (['EM', 'I'].includes(tag)) {
        node.setAttribute('style', 'font-style:italic;');
      } else if (tag === 'U') {
        node.setAttribute('style', 'text-decoration:underline;');
      } else if (['S', 'STRIKE', 'DEL'].includes(tag)) {
        node.setAttribute('style', 'text-decoration:line-through;');
      } else if (tag === 'A' && /^https?:\/\//i.test(href || '')) {
        node.setAttribute('style', 'color:#576B95;text-decoration:none;');
      } else {
        node.removeAttribute('style');
      }
    }
  }

  function normalizeManualBodyBlock(block) {
    block.setAttribute('data-ifanr-block', 'paragraph');
    block.setAttribute('data-ifanr-style-role', 'body');
    block.setAttribute('style', BODY_EDIT_STYLE);
    block.removeAttribute('class');
    cleanPastedInlineFormatting(block);
  }

  function normalizeManualFormattingHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    const articleRoot = template.content.querySelector('[data-ifanr-template]');
    if (!articleRoot) return { html: template.innerHTML, refreshedBlockCount: 0, movedIntoArticleCount: 0 };

    let refreshedBlockCount = 0;
    let movedIntoArticleCount = 0;
    const editorLevelNodes = [...template.content.childNodes].filter((node) => node !== articleRoot && nodeHasEditableContent(node));
    for (const node of editorLevelNodes) {
      articleRoot.append(node);
      movedIntoArticleCount += 1;
    }

    for (const node of [...articleRoot.childNodes]) {
      if (node.nodeType === 3) {
        if (!String(node.textContent || '').trim()) continue;
        const block = document.createElement('section');
        block.textContent = node.textContent;
        normalizeManualBodyBlock(block);
        node.replaceWith(block);
        refreshedBlockCount += 1;
        continue;
      }
      if (node.nodeType !== 1 || node.hasAttribute('data-ifanr-block')) continue;
      if (!nodeHasEditableContent(node)) continue;
      normalizeManualBodyBlock(node);
      refreshedBlockCount += 1;
    }

    // Pressing Enter at the end of a generated paragraph can make ProseMirror
    // place the new paragraph inside the style-preservation span. Lift only
    // those newly created block nodes back to the article root.
    for (const roleSpan of [...articleRoot.querySelectorAll('[data-ifanr-style-role]')]) {
      const owner = roleSpan.closest('[data-ifanr-block]');
      if (!owner || owner === roleSpan) continue;
      const nestedBlocks = [...roleSpan.children].filter((node) =>
        ['DIV', 'P', 'SECTION'].includes(node.tagName) &&
        !node.hasAttribute('data-ifanr-block') &&
        nodeHasEditableContent(node)
      );
      let insertionPoint = owner;
      for (const nested of nestedBlocks) {
        normalizeManualBodyBlock(nested);
        insertionPoint.after(nested);
        insertionPoint = nested;
        refreshedBlockCount += 1;
      }
    }

    return { html: template.innerHTML, refreshedBlockCount, movedIntoArticleCount };
  }

  function expectedLayoutStyles(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    return {
      headingCount: template.content.querySelectorAll('[data-ifanr-block="heading"]').length,
      bodyCount: template.content.querySelectorAll('[data-ifanr-block="paragraph"]').length,
      quoteCount: template.content.querySelectorAll('[data-ifanr-block="quote"]').length,
      rootCount: template.content.querySelectorAll('[data-ifanr-template]').length
    };
  }

  function compactNodeText(node) {
    return String(node?.textContent || '').replace(/[\s\u200B-\u200D\u2060\u2063\uFEFF]+/g, '');
  }

  function hasVisibleLeftBorder(node) {
    const style = global.getComputedStyle?.(node) || node.style;
    return Number.parseFloat(style?.borderLeftWidth || '0') > 0 &&
      !['none', 'hidden'].includes(String(style?.borderLeftStyle || '').toLowerCase());
  }

  function isNativeQuoteWrapper(node) {
    const className = String(node?.className || '');
    return node?.tagName === 'BLOCKQUOTE' ||
      node?.getAttribute?.('role') === 'blockquote' ||
      /blockquote|(^|[-_\s])quote(?:[-_\s]|$)/i.test(className);
  }

  function setImportantStyle(node, property, value) {
    const compact = (input) => String(input || '').replace(/\s+/g, '').toLowerCase();
    const unchanged = compact(node.style.getPropertyValue(property)) === compact(value) &&
      node.style.getPropertyPriority(property) === 'important';
    if (unchanged) return false;
    node.style.setProperty(property, value, 'important');
    return true;
  }

  function quoteDecorationNodes(editor, quote) {
    const quoteText = compactNodeText(quote);
    const nodes = [quote];
    for (const descendant of quote.querySelectorAll('blockquote, [role="blockquote"], [class*="quote"], [style]')) {
      if (compactNodeText(descendant) === quoteText && (isNativeQuoteWrapper(descendant) || hasVisibleLeftBorder(descendant))) {
        nodes.push(descendant);
      }
    }
    let ancestor = quote.parentElement;
    while (ancestor && ancestor !== editor) {
      if (compactNodeText(ancestor) === quoteText && (isNativeQuoteWrapper(ancestor) || hasVisibleLeftBorder(ancestor))) {
        nodes.push(ancestor);
      }
      if (ancestor.hasAttribute?.('data-ifanr-template')) break;
      ancestor = ancestor.parentElement;
    }
    return [...new Set(nodes)];
  }

  function removeDuplicateQuoteCopies(editor) {
    const quotes = [...editor.querySelectorAll('[data-ifanr-block="quote"]')];
    let removedCount = 0;
    for (const quote of quotes) {
      const quoteText = compactNodeText(quote);
      if (!quoteText) continue;
      const candidates = new Set([quote.previousElementSibling, quote.nextElementSibling]);
      const parent = quote.parentElement;
      if (parent && parent !== editor && (isNativeQuoteWrapper(parent) || hasVisibleLeftBorder(parent))) {
        for (const child of parent.children) {
          if (child !== quote && !child.contains(quote)) candidates.add(child);
        }
        candidates.add(parent.previousElementSibling);
        candidates.add(parent.nextElementSibling);
      }
      for (const candidate of candidates) {
        if (!candidate || candidate.contains(quote) || quote.contains(candidate)) continue;
        const insideNativeWrapper = candidate.parentElement === parent && parent && isNativeQuoteWrapper(parent);
        if (compactNodeText(candidate) !== quoteText) continue;
        if (!insideNativeWrapper && !isNativeQuoteWrapper(candidate) && !hasVisibleLeftBorder(candidate)) continue;
        candidate.remove();
        removedCount += 1;
      }
    }
    return removedCount;
  }

  function normalizeQuoteDecorations(editor) {
    const quotes = [...editor.querySelectorAll('[data-ifanr-block="quote"]')];
    let fixedCount = 0;
    for (const quote of quotes) {
      const related = quoteDecorationNodes(editor, quote).filter((node) => node !== quote);
      for (const node of related) {
        let changed = false;
        changed = setImportantStyle(node, 'border-left', '0') || changed;
        changed = setImportantStyle(node, 'border-inline-start', '0') || changed;
        if (isNativeQuoteWrapper(node)) {
          changed = setImportantStyle(node, 'padding-left', '0') || changed;
          changed = setImportantStyle(node, 'padding-inline-start', '0') || changed;
          changed = setImportantStyle(node, 'margin-left', '0') || changed;
          changed = setImportantStyle(node, 'margin-inline-start', '0') || changed;
        }
        if (changed) fixedCount += 1;
      }
      let quoteChanged = false;
      quoteChanged = setImportantStyle(quote, 'border-left', '3px solid #D9D9D9') || quoteChanged;
      quoteChanged = setImportantStyle(quote, 'border-inline-start', '3px solid #D9D9D9') || quoteChanged;
      if (quoteChanged) fixedCount += 1;
    }
    return fixedCount;
  }

  function inspectQuoteDecorations(editor, expectedCount = 0) {
    const quotes = [...editor.querySelectorAll('[data-ifanr-block="quote"]')];
    const decorationCounts = quotes.map((quote) => quoteDecorationNodes(editor, quote)
      .filter((node) => hasVisibleLeftBorder(node)).length);
    const countConfirmed = expectedCount === 0 || quotes.length === expectedCount;
    return {
      expectedQuoteBlockCount: expectedCount,
      quoteBlockCount: quotes.length,
      quoteDecorationCounts: decorationCounts,
      quoteDecorationConfirmed: countConfirmed && decorationCounts.every((count) => count === 1)
    };
  }

  function inspectLayoutStyles(editor, expected = { headingCount: 0, bodyCount: 0 }) {
    const styled = [...editor.querySelectorAll('[style]')].filter((node) => (node.textContent || '').trim().length > 0);
    const read = (node) => global.getComputedStyle?.(node) || node.style;
    const headingNodes = styled.filter((node) => {
      const style = read(node);
      const color = String(style?.color || '').replaceAll(' ', '').toLowerCase();
      const size = Number.parseFloat(style?.fontSize || '0');
      const weight = Number.parseInt(style?.fontWeight || '0', 10);
      return ['rgb(253,70,6)', '#fd4606'].includes(color) && [18, 20, 22, 24].includes(Math.round(size)) && weight >= 500;
    });
    const bodyNodes = styled.filter((node) => {
      const style = read(node);
      const color = String(style?.color || '').replaceAll(' ', '').toLowerCase();
      const size = Number.parseFloat(style?.fontSize || '0');
      return ['rgb(34,34,34)', '#222222'].includes(color) && Math.round(size) === 15;
    });
    const headingConfirmed = expected.headingCount === 0 || headingNodes.length >= expected.headingCount;
    const bodyConfirmed = expected.bodyCount === 0 || bodyNodes.length >= expected.bodyCount;
    const articleRoots = [...editor.querySelectorAll('[data-ifanr-template]')];
    const directArticleRootCount = articleRoots.filter((node) => node.parentElement === editor).length;
    const editorIsolationConfirmed = expected.rootCount === 0 || (
      articleRoots.length === expected.rootCount &&
      directArticleRootCount === expected.rootCount
    );
    const coreLayoutStyleConfirmed = headingConfirmed && bodyConfirmed && editorIsolationConfirmed;
    const quoteInspection = inspectQuoteDecorations(editor, expected.quoteCount || 0);
    return {
      expectedHeadingStyleCount: expected.headingCount,
      expectedBodyStyleCount: expected.bodyCount,
      headingStyleCount: headingNodes.length,
      bodyStyleCount: bodyNodes.length,
      articleRootCount: articleRoots.length,
      directArticleRootCount,
      nestedArticleRootCount: articleRoots.length - directArticleRootCount,
      editorIsolationConfirmed,
      ...quoteInspection,
      coreLayoutStyleConfirmed,
      layoutStyleConfirmed: coreLayoutStyleConfirmed && quoteInspection.quoteDecorationConfirmed
    };
  }

  function dispatchEditorMutation(editor, inputType) {
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data: null }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function editorIsSemanticallyEmpty(editor) {
    const text = (editor.innerText || editor.textContent || '')
      .replace(/[\s\u200B-\u200D\u2060\u2063\uFEFF]/g, '');
    const meaningfulMedia = editor.querySelector('img,video,audio,iframe,object,embed,canvas,svg');
    return text.length === 0 && !meaningfulMedia;
  }

  function editorHasResidualFormatting(editor) {
    return Boolean(editor.querySelector([
      '[style]',
      '[data-ifanr-block]',
      '[data-ifanr-template]',
      'blockquote',
      'ul',
      'ol',
      'table',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6'
    ].join(',')));
  }

  async function clearEditorState(editor) {
    editor.focus();
    const selection = global.getSelection?.();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);

    let transactionCleared = false;
    try {
      transactionCleared = Boolean(document.execCommand?.('delete', false, null));
    } catch {
      transactionCleared = false;
    }
    selection?.removeAllRanges();

    // ProseMirror can retain the final paragraph's marks after a selection delete.
    // Reset the DOM root as well, then notify its mutation observer before insertion.
    editor.replaceChildren();
    dispatchEditorMutation(editor, 'deleteContentBackward');
    await wait(80);

    // ProseMirror may recreate a neutral <p><br></p>; that is safe. Styled,
    // structural or article nodes are not safe because they can wrap the new root.
    const confirmed = editorIsSemanticallyEmpty(editor) && !editorHasResidualFormatting(editor);
    return {
      confirmed,
      method: transactionCleared ? 'selection-delete+root-reset' : 'root-reset-fallback'
    };
  }

  function restoreEditorSnapshot(editor, html) {
    editor.replaceChildren();
    editor.innerHTML = html;
    dispatchEditorMutation(editor, 'historyUndo');
    return editor.innerHTML === html;
  }

  function replaceEditorHtml(editor, html) {
    editor.focus();
    const selection = global.getSelection?.();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);

    let inserted = false;
    try {
      inserted = Boolean(document.execCommand?.('insertHTML', false, html));
    } catch {
      inserted = false;
    }

    selection?.removeAllRanges();
    if (inserted) {
      dispatchEditorMutation(editor, 'insertFromPaste');
      return 'selection-insert-html';
    }

    editor.innerHTML = html;
    dispatchEditorMutation(editor, 'insertFromPaste');
    return 'dom-replacement-fallback';
  }

  function forceReplaceEditorHtml(editor, html) {
    editor.focus();
    global.getSelection?.()?.removeAllRanges();
    editor.replaceChildren();
    return `force-root-replacement+${replaceEditorHtml(editor, html)}`;
  }

  async function pasteFullArticleOnce(editor, html, forceRoot = true) {
    editor.focus();
    if (forceRoot) editor.replaceChildren();
    const selection = global.getSelection?.();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);

    let pasteHandled = false;
    try {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/html', html);
      clipboardData.setData('text/plain', '');
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData
      });
      // WeChat's editor must receive one paste transaction so its native image
      // uploader sees every data URI. Direct DOM/input events preserve text but
      // do not enqueue images for hosting.
      pasteHandled = editor.dispatchEvent(pasteEvent) === false || pasteEvent.defaultPrevented;
    } catch {
      pasteHandled = false;
    } finally {
      selection?.removeAllRanges();
    }

    await wait(120);
    const inserted = Boolean(editor.querySelector('[data-ifanr-template],img')) ||
      normalizeValidationText(editor.innerText || editor.textContent || '').length > 0;
    if (pasteHandled && inserted) return 'single-rich-text-paste';

    // Compatibility fallback for editor builds that ignore untrusted paste.
    return forceRoot
      ? `single-paste-ignored+${forceReplaceEditorHtml(editor, html)}`
      : `single-paste-ignored+${replaceEditorHtml(editor, html)}`;
  }

  async function refreshManualFormatting(options = {}) {
    const editorSelection = findWechatEditor(options.editorSelectors || DEFAULT_EDITOR_SELECTORS);
    const editor = editorSelection.editor;
    if (!editor) throw new Error('WECHAT_EDITOR_NOT_FOUND');
    const normalized = normalizeManualFormattingHtml(editor.innerHTML);
    if (normalized.refreshedBlockCount === 0 && normalized.movedIntoArticleCount === 0) {
      return {
        ok: true,
        changed: false,
        refreshedBlockCount: 0,
        movedIntoArticleCount: 0,
        saveStatus: readSavedSignal(options.saveSelectors || DEFAULT_SAVE_SELECTORS) || 'UNKNOWN'
      };
    }

    const method = forceReplaceEditorHtml(editor, normalized.html);
    await wait(120);
    const quoteDuplicateRemovalCount = removeDuplicateQuoteCopies(editor);
    const quoteDecorationFixCount = normalizeQuoteDecorations(editor);
    if (quoteDuplicateRemovalCount || quoteDecorationFixCount) await wait(80);

    const saveSelectors = options.saveSelectors || DEFAULT_SAVE_SELECTORS;
    const deadlineAt = Date.now() + Number(options.saveTimeoutMs || 3000);
    let saveText = '';
    while (Date.now() < deadlineAt) {
      saveText = readSavedSignal(saveSelectors);
      if (saveText) break;
      await wait(200);
    }
    return {
      ok: true,
      changed: true,
      refreshMethod: method,
      refreshedBlockCount: normalized.refreshedBlockCount,
      movedIntoArticleCount: normalized.movedIntoArticleCount,
      quoteDuplicateRemovalCount,
      quoteDecorationFixCount,
      saveStatus: saveText || 'UNKNOWN'
    };
  }

  function recoverEditorHtmlWithInlineStyles(editor, html) {
    editor.replaceChildren();
    return `dom-style-recovery+${replaceEditorHtml(editor, html)}`;
  }

  function extractEmbeddedImagePayloads(html) {
    const sources = [];
    const skeletonHtml = String(html || '').replace(
      /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:image\/(?:jpeg|png|gif|webp);base64,[^"']+)\2/gi,
      (_match, prefix, quote, source) => {
        const id = sources.length;
        sources.push(source);
        return `${prefix}${quote}${quote} data-ifanr-embedded-image-id="${id}"`;
      }
    );
    return {
      skeletonHtml,
      sources,
      count: sources.length,
      bytes: sources.reduce((total, source) => total + source.length, 0)
    };
  }

  function stageAllImages(htmlOrTemplate, manualImageReplacements = [], embeddedSources = []) {
    const template = typeof htmlOrTemplate === 'string'
      ? (() => {
        const value = document.createElement('template');
        value.innerHTML = htmlOrTemplate;
        return value;
      })()
      : htmlOrTemplate;
    const manualByOrder = new Map((manualImageReplacements || []).map((item) => [Number(item.order), item]));
    const embeddedImages = [...template.content.querySelectorAll('img')]
      .map((image) => {
        const embeddedId = Number(image.dataset.ifanrEmbeddedImageId);
        const extractedSource = Number.isInteger(embeddedId) && embeddedId >= 0
          ? embeddedSources[embeddedId]
          : '';
        const source = extractedSource || image.getAttribute('src') || '';
        return { image, embeddedId, source };
      })
      .filter((item) => item.source.startsWith('data:image/'));
    const usedOrders = new Set();
    let generatedOrder = 1;
    const stagedImages = embeddedImages
      .map(({ image, embeddedId, source }, index) => {
        // Lark2Pad exports every image in one rich-text payload and does not
        // require private tracking attributes. Assign stable orders here so
        // those same images can be hosted by WeChat in bounded batches.
        const container = image.parentElement?.closest?.('[data-ifanr-image-order], [data-media-name]') || image.parentElement;
        let order = Number(image.dataset.ifanrImageOrder || container?.dataset.ifanrImageOrder || 0);
        if (!(order > 0) || usedOrders.has(order)) {
          while (usedOrders.has(generatedOrder)) generatedOrder += 1;
          order = generatedOrder;
          generatedOrder += 1;
        }
        usedOrders.add(order);
        const kind = image.dataset.ifanrImageKind || container?.dataset.ifanrImageKind || 'static';
        const isTitle = image.dataset.ifanrTitleImage === 'true' ||
          container?.dataset.ifanrTitleImage === 'true' ||
          image.parentElement?.dataset.ifanrTitleImage === 'true' ||
          Boolean(image.closest?.('[data-ifanr-title-image="true"]'));
        const suffix = kind === 'gif' ? 'gif' : 'image';
        const mediaName = image.dataset.ifanrMediaName || container?.dataset.ifanrMediaName || container?.dataset.mediaName || image.getAttribute('alt') || `${suffix}-${index + 1}`;
        image.dataset.ifanrImageOrder = String(order);
        image.dataset.ifanrImageKind = kind;
        image.dataset.ifanrMediaName = mediaName;
        image.removeAttribute('data-ifanr-embedded-image-id');
        image.removeAttribute('src');
        if (Number.isInteger(embeddedId) && embeddedId >= 0) embeddedSources[embeddedId] = '';
        if (container && container !== image) {
          container.dataset.ifanrImageOrder = String(order);
          container.dataset.ifanrImageKind = kind;
          container.dataset.ifanrMediaName = mediaName;
        }
        const manual = manualByOrder.get(order);
        if (manual) {
          const marker = document.createElement('span');
          marker.dataset.ifanrManualImagePlaceholder = String(order || index + 1);
          marker.dataset.ifanrImageOrder = String(order || index + 1);
          marker.dataset.ifanrMediaName = mediaName;
          marker.setAttribute('style', 'display:block;margin:24px 16px;padding:14px 16px;border:1px dashed #FD4606;border-radius:8px;background:#FFF5F0;color:#9A3A16;font-size:13px;line-height:1.65;text-align:center;box-sizing:border-box;');
          marker.textContent = `${kind === 'gif' ? '动图' : '图片'}待手动补充：第 ${order || index + 1} 张 ${manual.name || mediaName}（${manual.reason || '超过微信上传限制'}）`;
          image.replaceWith(marker);
          return null;
        }
        const placeholder = document.createElement('span');
        placeholder.dataset.ifanrImagePlaceholder = String(order || index + 1);
        placeholder.dataset.ifanrImageOrder = String(order || index + 1);
        placeholder.dataset.ifanrImageKind = kind;
        placeholder.dataset.ifanrMediaName = mediaName;
        if (isTitle) placeholder.dataset.ifanrTitleImage = 'true';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.textContent = '\u2063';
        const item = {
          order: order || index + 1,
          mediaName,
          kind,
          isTitle: Boolean(isTitle),
          html: image.outerHTML,
          source
        };
        image.replaceWith(placeholder);
        return item;
      })
      .filter(Boolean);
    return {
      html: template.innerHTML,
      stagedImages,
      animatedImages: stagedImages.filter((item) => item.kind === 'gif'),
      manualImageReplacements
    };
  }

  async function insertStagedImage(editor, item) {
    const placeholder = editor.querySelector(`[data-ifanr-image-placeholder="${item.order}"]`);
    const container = placeholder?.parentElement?.closest?.('[data-ifanr-image-order]') ||
      editor.querySelector(`[data-ifanr-image-order="${item.order}"]`);
    const target = placeholder || container;
    if (!target) return { inserted: false, method: 'placeholder-not-found' };
    const imageHtml = item.html.replace(/<img\b/i, `<img src="${item.source}"`);
    const imagesBeforePaste = new Set(editor.querySelectorAll('img'));

    editor.focus();
    const selection = global.getSelection?.();
    const range = document.createRange();
    if (placeholder) range.selectNode(placeholder);
    else range.selectNodeContents(container);
    selection?.removeAllRanges();
    selection?.addRange(range);

    let pasteDispatched = false;
    try {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/html', imageHtml);
      clipboardData.setData('text/plain', item.mediaName || '');
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData
      });
      editor.dispatchEvent(pasteEvent);
      pasteDispatched = true;
    } catch {
      pasteDispatched = false;
    }
    selection?.removeAllRanges();

    // Give the editor's paste handler a frame to create its transaction.
    await wait(240);
    const newImages = [...editor.querySelectorAll('img')].filter((image) => !imagesBeforePaste.has(image));
    const pastedImage = [...editor.querySelectorAll(`img[data-ifanr-image-order="${item.order}"]`)]
      .find((image) => Boolean(image.getAttribute('src'))) ||
      newImages.find((image) => Boolean(image.getAttribute('src'))) ||
      container?.querySelector?.('img[src]');
    const pasteInserted = Boolean(pastedImage) || (placeholder ? !placeholder.isConnected : false);
    if (pasteDispatched && pasteInserted) {
      let positionRestored = !placeholder?.isConnected || Boolean(container?.contains?.(pastedImage));
      if (placeholder?.isConnected && pastedImage && !container?.contains?.(pastedImage)) {
        placeholder.replaceWith(pastedImage);
        dispatchEditorMutation(editor, 'insertFromPaste');
        positionRestored = true;
      }
      return {
        inserted: true,
        method: 'synthetic-rich-text-paste',
        positionRestored,
        anchor: container
      };
    }

    // Older editor builds may ignore untrusted paste events. Keep a bounded
    // full-article transaction as a compatibility fallback, never a whole
    // unbounded Base64 article.
    if (placeholder?.isConnected) placeholder.outerHTML = imageHtml;
    else if (container?.isConnected) container.innerHTML = imageHtml;
    return {
      inserted: true,
      method: 'batch-dom-materialization-fallback',
      positionRestored: true,
      anchor: container
    };
  }

  function restoreImageHostingPlaceholder(editor, item, preferredContainer = null) {
    const order = Number(item.order || 0);
    let target = preferredContainer?.isConnected ? preferredContainer : null;
    if (!target) {
      const candidates = [...editor.querySelectorAll(`[data-ifanr-image-order="${order}"]`)];
      target = candidates.find((node) => node.tagName !== 'IMG' && !node.hasAttribute('data-ifanr-image-hosting-placeholder'));
    }
    if (!target) return false;
    const marker = document.createElement('section');
    marker.dataset.ifanrImageHostingPlaceholder = 'true';
    marker.dataset.ifanrImageOrder = String(order);
    marker.dataset.ifanrMediaName = item.mediaName;
    marker.setAttribute('style', 'margin:0;padding:18px 16px;border:1px solid #FD4606;background:#FFF4EE;color:#FD4606;font-size:14px;font-family:"PingFang SC",-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;line-height:1.7;text-align:center;box-sizing:border-box;');
    marker.textContent = item.isTitle
      ? '开篇题图未完成微信托管，请在这里手动补图'
      : `第 ${order} 张${item.kind === 'gif' ? '动图' : '图片'}未完成微信托管，请在这里手动补图`;
    if (target.tagName === 'IMG') target.replaceWith(marker);
    else target.replaceChildren(marker);
    dispatchEditorMutation(editor, 'insertReplacementText');
    return marker.isConnected;
  }

  function imageOrderConfirmed(inspection, order) {
    const matching = inspection.imageSourceDetails.filter((item) => item.order === order);
    const pendingKinds = new Set(['data', 'blob', 'extension', 'relative', 'invalid']);
    return matching.some((item) => item.visible && item.loaded && !pendingKinds.has(item.kind)) &&
      !matching.some((item) => pendingKinds.has(item.kind) || !item.loaded);
  }

  function imageUploadAttemptConfirmed(inspection, attempt) {
    if (imageOrderConfirmed(inspection, attempt.order)) return true;
    const anchor = attempt.anchor;
    if (!anchor?.isConnected) return false;
    const images = anchor.tagName === 'IMG' ? [anchor] : [...anchor.querySelectorAll('img')];
    return images.some((image) => {
      const src = image.getAttribute('src') || '';
      if (!/^https?:\/\//i.test(src)) return false;
      const rect = image.getBoundingClientRect();
      const style = global.getComputedStyle?.(image);
      return image.complete && image.naturalWidth > 0 && rect.width > 1 && rect.height > 1 && style?.display !== 'none' && style?.visibility !== 'hidden';
    });
  }

  async function injectHtmlAtomic(html, options = {}) {
    const startedAt = Date.now();
    const timeoutMs = Number(options.timeoutMs || 90000);
    const deadlineAt = startedAt + timeoutMs;
    await emitProgress(options, { phase: 'preparing-write', percent: 2, message: '正在确认公众号编辑器' });
    const editorSelection = findWechatEditor(options.editorSelectors || DEFAULT_EDITOR_SELECTORS);
    const editor = editorSelection.editor;
    if (!editor) throw new Error('WECHAT_EDITOR_NOT_FOUND');
    const editorDiagnostics = {
      editorCandidateCount: editorSelection.candidateCount,
      selectedEditor: editorSelection.selected,
      editorCandidates: editorSelection.candidates
    };
    const previousHtml = editor.innerHTML;
    const previousText = editor.innerText || editor.textContent || '';
    const sanitizedHtml = sanitizeArticleHtml(html);
    const expectedStyles = expectedLayoutStyles(sanitizedHtml);
    const embeddedMatches = String(sanitizedHtml).match(/data:image\/(?:jpeg|png|gif|webp);base64,[^"']+/gi) || [];
    const extractedEmbeddedPayloadBytes = embeddedMatches.reduce((total, value) => total + value.length, 0);
    const expectedImageCount = Number(options.expectedImageCount || embeddedMatches.length || 0);
    const forcedReplacement = options.forceEditorReplace !== false;
    const failWithRollback = (code, result = {}, cause = null) => {
      const rollbackConfirmed = restoreEditorSnapshot(editor, previousHtml);
      throw Object.assign(new Error(code), {
        cause,
        result: {
          injected: true,
          rollbackPerformed: true,
          rollbackConfirmed,
          previousHtmlLength: previousHtml.length,
          previousTextLength: previousText.trim().length,
          previousTextHash: textHash(previousText.trim()),
          ...editorDiagnostics,
          ...result
        }
      });
    };

    await emitProgress(options, { phase: 'clearing-editor', percent: 6, message: '正在备份并清空原草稿' });
    const clearResult = await clearEditorState(editor);
    if (!clearResult.confirmed && !forcedReplacement) {
      return failWithRollback('WECHAT_EDITOR_CLEAR_NOT_CONFIRMED', {
        editorCleared: false,
        clearMethod: clearResult.method,
        clearConfirmed: false
      });
    }

    let injectionMethod = '';
    try {
      await emitProgress(options, {
        phase: 'inserting-content',
        percent: 10,
        message: `正在一次写入完整正文和 ${expectedImageCount} 张已压缩图片`
      });
      await wait(0);
      injectionMethod = await pasteFullArticleOnce(editor, sanitizedHtml, forcedReplacement);
      await wait(240);
    } catch (error) {
      return failWithRollback('WECHAT_INSERTION_FAILED', {
        editorCleared: true,
        clearMethod: clearResult.method,
        clearConfirmed: clearResult.confirmed,
        forcedReplacement
      }, error);
    }

    let quoteDuplicateRemovalCount = removeDuplicateQuoteCopies(editor);
    let quoteDecorationFixCount = normalizeQuoteDecorations(editor);
    if (quoteDuplicateRemovalCount || quoteDecorationFixCount) await wait(80);
    let styleInspection = inspectLayoutStyles(editor, expectedStyles);
    await emitProgress(options, { phase: 'filling-metadata', percent: 14, message: '完整正文已写入，正在填写标题和摘要' });
    const metadataResult = await fillArticleMetadata(editor, options);

    const saveSelectors = options.saveSelectors || DEFAULT_SAVE_SELECTORS;
    const imageStallTimeoutMs = Number(options.imageStallTimeoutMs || 15000);
    const saveStallTimeoutMs = Number(options.saveStallTimeoutMs || 5000);
    let imageInspection = inspectImages(editor);
    let lastHostedCount = imageInspection.visibleHostedImageCount;
    let lastImageProgressAt = Date.now();
    let imagesConfirmedAt = null;
    let saveText = '';
    let saveTriggered = false;
    let saveMethod = 'auto-status';
    let saveControlCandidateCount = 0;
    let waitStoppedReason = null;
    let observedUnsavedState = false;
    let lastProgressSignature = '';

    while (Date.now() < deadlineAt) {
      const currentSaveText = readSavedSignal(saveSelectors);
      if (!currentSaveText) observedUnsavedState = true;
      if (currentSaveText && (observedUnsavedState || Date.now() - startedAt > 1200)) saveText = currentSaveText;
      imageInspection = inspectImages(editor);
      const hostedCount = imageInspection.visibleHostedImageCount;
      if (hostedCount > lastHostedCount) {
        lastHostedCount = hostedCount;
        lastImageProgressAt = Date.now();
      }
      const imagesConfirmed = expectedImageCount === 0 || (
        imageInspection.imageCount >= expectedImageCount &&
        imageInspection.visibleHostedImageCount >= expectedImageCount &&
        imageInspection.pendingEmbeddedImageCount === 0
      );
      if (imagesConfirmed && imagesConfirmedAt == null) imagesConfirmedAt = Date.now();
      const ratio = expectedImageCount ? Math.min(1, hostedCount / expectedImageCount) : 1;
      const progress = imagesConfirmed
        ? { phase: saveText ? 'validating-write' : 'waiting-save', percent: saveText ? 96 : 90, message: saveText ? '图片已托管，正在校验全文尾部' : '图片已全部托管，正在等待自动保存' }
        : { phase: 'uploading-images', percent: 15 + Math.round(73 * ratio), message: `微信已托管 ${hostedCount} / ${expectedImageCount} 张图片` };
      const signature = `${progress.phase}:${progress.percent}:${progress.message}`;
      if (signature !== lastProgressSignature) {
        lastProgressSignature = signature;
        await emitProgress(options, progress);
      }
      if (imagesConfirmed && saveText) break;
      if (!imagesConfirmed && Date.now() - lastImageProgressAt >= imageStallTimeoutMs) {
        waitStoppedReason = 'image-hosting-stalled';
        break;
      }
      if (imagesConfirmed && !saveText && imagesConfirmedAt && Date.now() - imagesConfirmedAt >= 1200 && options.clickSaveAsDraft !== false && !saveTriggered) {
        const safeSave = findSafeDraftSaveControl();
        saveControlCandidateCount = safeSave.candidateCount;
        if (safeSave.control) {
          safeSave.control.click();
          saveTriggered = true;
          saveMethod = 'exact-save-as-draft-button';
        } else {
          saveMethod = safeSave.candidateCount === 0 ? 'save-control-not-found' : 'save-control-ambiguous';
        }
      }
      if (imagesConfirmed && !saveText && imagesConfirmedAt && Date.now() - imagesConfirmedAt >= saveStallTimeoutMs) {
        waitStoppedReason = 'save-status-stalled';
        break;
      }
      await wait(250);
    }

    quoteDuplicateRemovalCount += removeDuplicateQuoteCopies(editor);
    quoteDecorationFixCount += normalizeQuoteDecorations(editor);
    if (quoteDuplicateRemovalCount || quoteDecorationFixCount) await wait(80);
    imageInspection = inspectImages(editor);
    styleInspection = inspectLayoutStyles(editor, expectedStyles);
    const validationScope = editor.closest('#ueditor_0') || editor;
    const text = validationScope.innerText || validationScope.textContent || '';
    const normalizedText = normalizeValidationText(text);
    const expectedTextContains = options.expectedTextContains || '';
    const expectedMinimumTextLength = Number(options.expectedMinimumTextLength || 0);
    const forbiddenTextMarkers = options.forbiddenTextMarkers || [];
    const visiblePageText = document.body.innerText || '';
    const forbiddenTextFound = forbiddenTextMarkers.filter((marker) => marker && visiblePageText.includes(marker));
    const baseValidation = validateReplacement({
      actualText: text,
      expectedTextContains,
      forbiddenTextFound,
      forcedReplacement,
      styleInspection,
      expectedImageCount
    });
    const minimumTextLengthConfirmed = expectedMinimumTextLength === 0 || normalizedText.length >= expectedMinimumTextLength;
    const replacementConfirmed = baseValidation.replacementConfirmed && minimumTextLengthConfirmed;
    const imageUploadConfirmed = expectedImageCount === 0 ? null : (
      imageInspection.imageCount >= expectedImageCount &&
      imageInspection.visibleHostedImageCount >= expectedImageCount &&
      imageInspection.pendingEmbeddedImageCount === 0
    );
    const pendingImageOrders = imageInspection.pendingImageOrders || [];
    const result = {
      ok: Boolean(saveText) && replacementConfirmed && (!options.requireHostedImages || imageUploadConfirmed !== false),
      injected: true,
      injectionMethod: `${injectionMethod}+atomic-full-article`,
      replacementConfirmed,
      expectedTextFound: baseValidation.expectedTextFound,
      minimumTextLengthConfirmed,
      expectedMinimumTextLength,
      strictReplacementConfirmed: baseValidation.strictReplacementConfirmed && minimumTextLengthConfirmed,
      structuralContentConfirmed: baseValidation.structuralContentConfirmed,
      replacementValidationBypassed: baseValidation.replacementValidationBypassed,
      forbiddenTextFound,
      saved: Boolean(saveText),
      saveStatus: saveText || 'UNKNOWN',
      saveTriggered,
      saveMethod,
      saveControlCandidateCount,
      waitStoppedReason,
      editorCleared: true,
      clearMethod: forcedReplacement ? `${clearResult.method}+force-root-replacement` : clearResult.method,
      clearConfirmed: clearResult.confirmed,
      forcedReplacement,
      styleValidationBypassed: forcedReplacement && !styleInspection.layoutStyleConfirmed,
      styleRecoveryError: null,
      quoteDecorationFixCount,
      quoteDuplicateRemovalCount,
      finalQuoteNormalizationApplied: quoteDecorationFixCount > 0 || quoteDuplicateRemovalCount > 0,
      ...metadataResult,
      rollbackPerformed: false,
      rollbackConfirmed: null,
      ...editorDiagnostics,
      previousHtmlLength: previousHtml.length,
      previousTextLength: previousText.trim().length,
      previousTextHash: textHash(previousText.trim()),
      paragraphCount: editor.querySelectorAll('[data-ifanr-block="paragraph"], p').length,
      headingCount: editor.querySelectorAll('[data-ifanr-block="heading"], h1, h2, h3, h4, h5, h6').length,
      imageCount: imageInspection.imageCount,
      sourceImageCount: Number(options.sourceImageCount || expectedImageCount),
      visibleImageCount: imageInspection.visibleImageCount,
      visibleHostedImageCount: imageInspection.visibleHostedImageCount,
      hostedImageCount: imageInspection.hostedImageCount,
      imageSourceKinds: imageInspection.imageSourceKinds,
      imageSourceDetails: imageInspection.imageSourceDetails,
      pendingEmbeddedImageCount: imageInspection.pendingEmbeddedImageCount,
      pendingImageOrders,
      pendingImageNames: imageInspection.pendingImageNames || [],
      pendingAnimatedImageCount: imageInspection.pendingAnimatedImageCount,
      stagedImageCount: expectedImageCount,
      stagedAnimatedImageCount: 0,
      extractedEmbeddedImageCount: embeddedMatches.length,
      extractedEmbeddedPayloadBytes,
      initiallyHostedImageCount: 0,
      confirmedStagedImageCount: imageInspection.visibleHostedImageCount,
      imageUploadBatchSize: 0,
      imageUploadBatchCount: expectedImageCount ? 1 : 0,
      stagedImageUploadAttempts: [],
      manualImagePlaceholderCount: Number(options.manualImageReplacements?.length || 0),
      manualImageOrders: (options.manualImageReplacements || []).map((item) => item.order),
      manualImageNames: (options.manualImageReplacements || []).map((item) => item.name),
      hostingFallbackPlaceholderCount: 0,
      hostingFallbackImageOrders: [],
      animatedUploadAttempts: [],
      imageUploadConfirmed,
      imageWriteAccountedConfirmed: expectedImageCount === 0 || imageUploadConfirmed === true,
      ...styleInspection,
      textLength: text.trim().length,
      textHash: textHash(text.trim())
    };

    if (!replacementConfirmed) return failWithRollback('WECHAT_REPLACEMENT_NOT_CONFIRMED', result);
    if (options.requireHostedImages && imageUploadConfirmed !== true && expectedImageCount > 0) {
      return failWithRollback('WECHAT_IMAGE_UPLOAD_NOT_CONFIRMED', result);
    }
    if (!result.saved) return failWithRollback('WECHAT_SAVE_NOT_CONFIRMED', result);
    await emitProgress(options, { phase: 'write-completed', percent: 100, message: '全文、全部图片和自动保存均已确认' });
    return result;
  }

  async function injectHtml(html, options = {}) {
    return injectHtmlAtomic(html, options);
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs || 45000;
    const deadlineAt = startedAt + timeoutMs;
    await emitProgress(options, {
      phase: 'preparing-write',
      percent: 2,
      message: '正在确认公众号编辑器'
    });
    const editorSelection = findWechatEditor(options.editorSelectors || DEFAULT_EDITOR_SELECTORS);
    const editor = editorSelection.editor;
    if (!editor) throw new Error('WECHAT_EDITOR_NOT_FOUND');
    const editorDiagnostics = {
      editorCandidateCount: editorSelection.candidateCount,
      selectedEditor: editorSelection.selected,
      editorCandidates: editorSelection.candidates
    };

    // Keep multi-megabyte Base64 payloads out of the DOM parser. Only the
    // lightweight article skeleton is sanitized and inserted; image payloads
    // are materialized for the one bounded upload batch that needs them.
    const embeddedPayloads = extractEmbeddedImagePayloads(html);
    html = '';
    const sanitizedTemplate = sanitizeArticleTemplate(embeddedPayloads.skeletonHtml);
    embeddedPayloads.skeletonHtml = '';
    const previousHtml = editor.innerHTML;
    const previousText = editor.innerText || editor.textContent || '';
    const staged = stageAllImages(sanitizedTemplate, options.manualImageReplacements, embeddedPayloads.sources);
    const expectedStyles = expectedLayoutStyles(staged.html);
    await emitProgress(options, {
      phase: 'clearing-editor',
      percent: 6,
      message: '正在备份并清空原草稿格式'
    });
    const clearResult = await clearEditorState(editor);
    const forcedReplacement = options.forceEditorReplace !== false;
    if (!clearResult.confirmed && !forcedReplacement) {
      const rollbackConfirmed = restoreEditorSnapshot(editor, previousHtml);
      throw Object.assign(new Error('WECHAT_EDITOR_CLEAR_NOT_CONFIRMED'), {
        result: {
          injected: false,
          editorCleared: false,
          clearMethod: clearResult.method,
          clearConfirmed: false,
          forceReplaceAvailable: true,
          rollbackPerformed: true,
          rollbackConfirmed,
          ...editorDiagnostics,
          previousHtmlLength: previousHtml.length,
          previousTextLength: previousText.trim().length,
          previousTextHash: textHash(previousText.trim())
        }
      });
    }
    if (forcedReplacement) {
      await emitProgress(options, {
        phase: 'clearing-editor',
        percent: 8,
        message: '正在直接净空并覆盖原草稿正文'
      });
    }
    await emitProgress(options, {
      phase: 'inserting-content',
      percent: 9,
      message: forcedReplacement
        ? '正在用新排版覆盖当前正文和图片'
        : '原草稿已净空，正在写入正文和图片占位'
    });
    let injectionMethod = '';
    let styleInspection;
    let styleRecoveryError = null;
    let quoteDecorationFixCount = 0;
    let quoteDuplicateRemovalCount = 0;
    try {
      injectionMethod = forcedReplacement
        ? forceReplaceEditorHtml(editor, staged.html)
        : replaceEditorHtml(editor, staged.html);
      await wait(80);
      quoteDuplicateRemovalCount += removeDuplicateQuoteCopies(editor);
      quoteDecorationFixCount += normalizeQuoteDecorations(editor);
      if (quoteDecorationFixCount > 0) await wait(80);
      styleInspection = inspectLayoutStyles(editor, expectedStyles);
      if (!styleInspection.coreLayoutStyleConfirmed) {
        try {
          injectionMethod = `${injectionMethod}+${recoverEditorHtmlWithInlineStyles(editor, staged.html)}`;
          await wait(120);
          quoteDuplicateRemovalCount += removeDuplicateQuoteCopies(editor);
          quoteDecorationFixCount += normalizeQuoteDecorations(editor);
          if (quoteDecorationFixCount > 0) await wait(80);
          styleInspection = inspectLayoutStyles(editor, expectedStyles);
        } catch (error) {
          if (!forcedReplacement) throw error;
          styleRecoveryError = error?.message || String(error);
        }
      }
    } catch (error) {
      const rollbackConfirmed = restoreEditorSnapshot(editor, previousHtml);
      throw Object.assign(new Error('WECHAT_INSERTION_FAILED'), {
        cause: error,
        result: {
          injected: false,
          editorCleared: true,
          clearMethod: forcedReplacement ? `${clearResult.method}+force-root-replacement` : clearResult.method,
          clearConfirmed: clearResult.confirmed,
          forcedReplacement,
          rollbackPerformed: true,
          rollbackConfirmed,
          ...editorDiagnostics,
          previousHtmlLength: previousHtml.length,
          previousTextLength: previousText.trim().length,
          previousTextHash: textHash(previousText.trim())
        }
      });
    }
    if (!styleInspection.layoutStyleConfirmed && !forcedReplacement) {
      const rollbackConfirmed = restoreEditorSnapshot(editor, previousHtml);
      throw Object.assign(new Error('WECHAT_STYLE_NOT_CONFIRMED'), {
        result: {
          injected: false,
          editorCleared: true,
          clearMethod: forcedReplacement ? `${clearResult.method}+force-root-replacement` : clearResult.method,
          clearConfirmed: clearResult.confirmed,
          forcedReplacement,
          rollbackPerformed: true,
          rollbackConfirmed,
          ...editorDiagnostics,
          previousHtmlLength: previousHtml.length,
          previousTextLength: previousText.trim().length,
          previousTextHash: textHash(previousText.trim()),
          ...styleInspection
        }
      });
    }
    if (!styleInspection.layoutStyleConfirmed && forcedReplacement) {
      await emitProgress(options, {
        phase: 'inserting-content',
        percent: 15,
        message: '正文已直接覆盖；样式差异仅作提醒，不会回滚正文'
      });
    }
    await emitProgress(options, {
      phase: 'filling-metadata',
      percent: 16,
      message: '正在填写文章标题和摘要'
    });
    const metadataResult = await fillArticleMetadata(editor, options);
    await emitProgress(options, {
      phase: 'inserting-content',
      percent: 18,
      message: staged.stagedImages.length
        ? `正文骨架已写入，准备逐张托管 ${staged.stagedImages.length} 个图片位置`
        : '正文已写入，正在等待微信托管图片'
    });

    const saveSelectors = options.saveSelectors || DEFAULT_SAVE_SELECTORS;
    let saveText = '';
    let saveTriggered = false;
    let saveMethod = 'auto-status';
    let saveControlCandidateCount = 0;

    const expectedImageCount = Number(options.expectedImageCount || 0);
    let imageInspection = inspectImages(editor);
    const initiallyHostedImageCount = imageInspection.visibleHostedImageCount;
    let lastProgressSignature = '';
    const imageUploadAttempts = [];
    const stagedImages = staged.stagedImages || [];

    // The native Lark2Pad workflow prepares the whole rich-text payload before
    // handing it to WeChat. Direct DOM injection needs an equivalent backpressure
    // mechanism: keep only a few uploads in flight, confirm that batch, then
    // advance. Bursting every data URI at once makes WeChat drop the tail.
    const requestedBatchSize = Number(options.imageUploadBatchSize || DEFAULT_IMAGE_UPLOAD_BATCH_SIZE);
    const imageUploadBatchSize = Math.max(1, Math.min(5, requestedBatchSize));
    const imageBatchTimeoutMs = Number(options.imageBatchTimeoutMs || DEFAULT_IMAGE_BATCH_TIMEOUT_MS);
    const imageBatchMaxEncodedBytes = Math.max(
      1024 * 1024,
      Number(options.imageBatchMaxEncodedBytes || DEFAULT_IMAGE_BATCH_MAX_ENCODED_BYTES)
    );
    let imageUploadBatchCount = 0;
    for (let batchStart = 0; batchStart < stagedImages.length && Date.now() < deadlineAt;) {
      const batch = [];
      let batchEncodedBytes = 0;
      while (batch.length < imageUploadBatchSize && batchStart + batch.length < stagedImages.length) {
        const candidate = stagedImages[batchStart + batch.length];
        const candidateBytes = candidate.source.length;
        if (batch.length > 0 && batchEncodedBytes + candidateBytes > imageBatchMaxEncodedBytes) break;
        batch.push(candidate);
        batchEncodedBytes += candidateBytes;
      }
      imageUploadBatchCount += 1;
      const batchAttempts = [];
      for (const item of batch) {
        const inserted = await insertStagedImage(editor, item);
        const attempt = {
          order: item.order,
          mediaName: item.mediaName,
          kind: item.kind,
          isTitle: item.isTitle,
          inserted: inserted.inserted,
          insertionMethod: inserted.method,
          positionRestored: inserted.positionRestored,
          hostingPlaceholderRestored: false,
          confirmed: false
        };
        Object.defineProperty(attempt, 'anchor', {
          value: inserted.anchor,
          enumerable: false,
          writable: true,
          configurable: true
        });
        imageUploadAttempts.push(attempt);
        batchAttempts.push(attempt);
      }

      const needsBatchCommit = batchAttempts.some((attempt) => attempt.insertionMethod === 'batch-dom-materialization-fallback');
      const batchCommitMethod = needsBatchCommit
        ? forceReplaceEditorHtml(editor, editor.innerHTML)
        : 'paste-handler-transaction';
      for (const attempt of batchAttempts) {
        attempt.insertionMethod = `${attempt.insertionMethod}+${batchCommitMethod}`;
        const candidates = [...editor.querySelectorAll(`[data-ifanr-image-order="${attempt.order}"]`)];
        attempt.anchor = candidates.find((node) => node.tagName !== 'IMG') || candidates[0] || null;
      }
      // The editor transaction now owns the temporary data URIs. Drop the
      // extension's extra references so only the current batch remains hot.
      for (const item of batch) item.source = '';
      await wait(160);

      const batchDeadlineAt = Math.min(deadlineAt, Date.now() + imageBatchTimeoutMs);
      while (Date.now() < batchDeadlineAt) {
        imageInspection = inspectImages(editor);
        for (const attempt of batchAttempts) {
          if (!attempt.confirmed) attempt.confirmed = imageUploadAttemptConfirmed(imageInspection, attempt);
        }
        if (batchAttempts.every((attempt) => attempt.confirmed)) break;
        await wait(250);
      }

      const insertedCount = Math.min(batchStart + batch.length, stagedImages.length);
      const confirmedCount = imageUploadAttempts.filter((attempt) => attempt.confirmed).length;
      await emitProgress(options, {
        phase: 'uploading-images',
        percent: 18 + Math.round(70 * confirmedCount / Math.max(1, stagedImages.length)),
        message: `已写入 ${insertedCount} / ${stagedImages.length} 张图片，微信已托管 ${confirmedCount} 张`
      });
      batchStart += batch.length;
    }

    quoteDuplicateRemovalCount += removeDuplicateQuoteCopies(editor);
    quoteDecorationFixCount += normalizeQuoteDecorations(editor);
    if (quoteDecorationFixCount > 0 || quoteDuplicateRemovalCount > 0) await wait(80);

    // Saving before the upload queue drains can snapshot only the first few
    // images. Observe or trigger save only after all batches have been handed
    // to WeChat.
    const autoSaveStart = Date.now();
    let observedUnsavedState = false;
    while (Date.now() - autoSaveStart < 1500 && Date.now() < deadlineAt) {
      const currentSaveText = readSavedSignal(saveSelectors);
      if (!currentSaveText) observedUnsavedState = true;
      // Do not accept an "已保存" label left over from the previous draft.
      // A fresh signal must follow an unsaved state or a short post-write settling window.
      if (currentSaveText && (observedUnsavedState || Date.now() - autoSaveStart >= 700)) {
        saveText = currentSaveText;
        break;
      }
      await wait(100);
    }

    if (!saveText && options.clickSaveAsDraft !== false) {
      const safeSave = findSafeDraftSaveControl();
      saveControlCandidateCount = safeSave.candidateCount;
      if (safeSave.control) {
        safeSave.control.click();
        saveTriggered = true;
        saveMethod = 'exact-save-as-draft-button';
      } else {
        saveMethod = safeSave.candidateCount === 0 ? 'save-control-not-found' : 'save-control-ambiguous';
      }
    }

    const imageStallTimeoutMs = Number(options.imageStallTimeoutMs || DEFAULT_IMAGE_STALL_TIMEOUT_MS);
    const saveStallTimeoutMs = Number(options.saveStallTimeoutMs || DEFAULT_SAVE_STALL_TIMEOUT_MS);
    let lastHostedCount = imageUploadAttempts.filter((attempt) => attempt.confirmed).length;
    let lastImageProgressAt = Date.now();
    let imagesConfirmedAt = stagedImages.length === 0 ? Date.now() : null;
    let waitStoppedReason = null;
    while (Date.now() < deadlineAt) {
      if (!saveText) saveText = readSavedSignal(saveSelectors);
      imageInspection = inspectImages(editor);
      for (const attempt of imageUploadAttempts) {
        if (!attempt.confirmed) attempt.confirmed = imageUploadAttemptConfirmed(imageInspection, attempt);
      }
      const hostedStagedCount = imageUploadAttempts.filter((attempt) => attempt.confirmed).length;
      if (hostedStagedCount > lastHostedCount) {
        lastHostedCount = hostedStagedCount;
        lastImageProgressAt = Date.now();
      }
      const imageRatio = stagedImages.length > 0
        ? Math.min(1, hostedStagedCount / stagedImages.length)
        : 1;
      const imagesConfirmed = stagedImages.length === 0 || (
        hostedStagedCount >= stagedImages.length &&
        imageInspection.pendingEmbeddedImageCount === 0
      );
      if (imagesConfirmed && imagesConfirmedAt == null) imagesConfirmedAt = Date.now();
      const phase = !imagesConfirmed
        ? 'uploading-images'
        : saveText ? 'validating-write' : 'waiting-save';
      const percent = !imagesConfirmed
        ? 18 + Math.round(imageRatio * 70)
        : saveText ? 96 : 90;
      const message = !imagesConfirmed
        ? `微信已托管 ${hostedStagedCount} / ${stagedImages.length} 张待上传图片${imageInspection.pendingEmbeddedImageCount ? `，还有 ${imageInspection.pendingEmbeddedImageCount} 张正在处理` : ''}`
        : saveText ? '图片已托管，正在完成最后检查' : '图片已托管，正在等待微信自动保存';
      const signature = `${phase}:${percent}:${message}`;
      if (signature !== lastProgressSignature) {
        lastProgressSignature = signature;
        await emitProgress(options, { phase, percent, message });
      }
      if (saveText && (!options.requireHostedImages || imagesConfirmed)) break;
      if (options.requireHostedImages && !imagesConfirmed && Date.now() - lastImageProgressAt >= imageStallTimeoutMs) {
        waitStoppedReason = 'image-hosting-stalled';
        await emitProgress(options, {
          phase: 'uploading-images',
          percent: 18 + Math.round(imageRatio * 70),
          message: `图片托管超过 ${Math.round(imageStallTimeoutMs / 1000)} 秒没有进展，已停止等待`
        });
        break;
      }
      if (imagesConfirmed && !saveText && imagesConfirmedAt != null && Date.now() - imagesConfirmedAt >= saveStallTimeoutMs) {
        waitStoppedReason = 'save-status-stalled';
        await emitProgress(options, {
          phase: 'waiting-save',
          percent: 90,
          message: `微信在 ${Math.round(saveStallTimeoutMs / 1000)} 秒内没有返回保存状态，已停止等待`
        });
        break;
      }
      await wait(250);
    }

    // WeChat may have finished hosting most images; any image that still
    // points at a data URI after the wait was not hosted. Replace it with an
    // in-place marker so the user can manually patch it without losing place.
    for (const img of [...editor.querySelectorAll('img[data-ifanr-image-order]')]) {
      const src = img.getAttribute('src') || '';
      if (!src.startsWith('data:')) continue;
      const order = Number(img.dataset.ifanrImageOrder || 0);
      const item = stagedImages.find((candidate) => Number(candidate.order) === order);
      if (!item) continue;
      const restored = restoreImageHostingPlaceholder(editor, item, img);
      const attempt = imageUploadAttempts.find((candidate) => candidate.order === order);
      if (attempt) {
        attempt.hostingPlaceholderRestored = restored || attempt.hostingPlaceholderRestored;
        attempt.confirmed = false;
      }
    }
    imageInspection = inspectImages(editor);

    let finalQuoteNormalizationApplied = false;
    const finalDuplicateRemovalCount = removeDuplicateQuoteCopies(editor);
    if (finalDuplicateRemovalCount > 0) {
      finalQuoteNormalizationApplied = true;
      quoteDuplicateRemovalCount += finalDuplicateRemovalCount;
    }
    const beforeFinalQuoteInspection = inspectQuoteDecorations(editor, expectedStyles.quoteCount || 0);
    if (!beforeFinalQuoteInspection.quoteDecorationConfirmed) {
      const finalFixCount = normalizeQuoteDecorations(editor);
      if (finalFixCount > 0) {
        finalQuoteNormalizationApplied = true;
        quoteDecorationFixCount += finalFixCount;
        await wait(80);
      }
    }

    const saved = Boolean(saveText);

    styleInspection = inspectLayoutStyles(editor, expectedStyles);

    const confirmedStagedImageCount = imageUploadAttempts.filter((attempt) => attempt.confirmed).length;
    const imageUploadConfirmed = stagedImages.length === 0 && expectedImageCount === 0
      ? null
      : confirmedStagedImageCount >= stagedImages.length &&
        imageInspection.pendingEmbeddedImageCount === 0;
    const hostingFallbackImageOrders = [...editor.querySelectorAll('[data-ifanr-image-hosting-placeholder]')]
      .map((node) => Number(node.dataset.ifanrImageOrder || 0))
      .filter((order) => order > 0);
    const hostingFallbackPlaceholderCount = hostingFallbackImageOrders.length;
    const imageWriteAccountedConfirmed = stagedImages.length === 0 || (
      confirmedStagedImageCount + hostingFallbackPlaceholderCount >= stagedImages.length &&
      imageInspection.pendingEmbeddedImageCount === 0
    );
    const validationScope = editor.closest('#ueditor_0') || editor;
    const text = validationScope.innerText || validationScope.textContent || '';
    const visiblePageText = document.body.innerText || '';
    const expectedTextContains = options.expectedTextContains || '';
    const forbiddenTextMarkers = options.forbiddenTextMarkers || [];
    const forbiddenTextFound = forbiddenTextMarkers.filter((marker) => marker && visiblePageText.includes(marker));
    const {
      expectedTextFound,
      strictReplacementConfirmed,
      structuralContentConfirmed,
      replacementValidationBypassed,
      replacementConfirmed
    } = validateReplacement({
      actualText: text,
      expectedTextContains,
      forbiddenTextFound,
      forcedReplacement,
      styleInspection,
      expectedImageCount
    });
    const headings = [...editor.querySelectorAll('[data-ifanr-block="heading"], h1, h2, h3, h4, h5, h6')];
    const failedImageAttempts = imageUploadAttempts.filter((attempt) => !attempt.confirmed);
    const failedAnimatedAttempts = failedImageAttempts.filter((attempt) => attempt.kind === 'gif');
    const pendingImageOrders = [...new Set([
      ...imageInspection.pendingImageOrders,
      ...failedImageAttempts.map((attempt) => attempt.order),
      ...failedAnimatedAttempts.map((attempt) => attempt.order)
    ])].sort((a, b) => a - b);
    const pendingImageNames = [...new Set([
      ...imageInspection.pendingImageNames,
      ...failedImageAttempts.map((attempt) => attempt.mediaName),
      ...failedAnimatedAttempts.map((attempt) => attempt.mediaName)
    ])];
    const result = {
      ok: saved && replacementConfirmed && (!options.requireHostedImages || imageWriteAccountedConfirmed),
      injected: true,
      injectionMethod,
      replacementConfirmed,
      expectedTextFound,
      strictReplacementConfirmed,
      structuralContentConfirmed,
      replacementValidationBypassed,
      forbiddenTextFound,
      saved,
      saveStatus: saveText || 'UNKNOWN',
      saveTriggered,
      saveMethod,
      saveControlCandidateCount,
      waitStoppedReason,
      editorCleared: true,
      clearMethod: forcedReplacement ? `${clearResult.method}+force-root-replacement` : clearResult.method,
      clearConfirmed: clearResult.confirmed,
      forcedReplacement,
      styleValidationBypassed: forcedReplacement && !styleInspection.layoutStyleConfirmed,
      styleRecoveryError,
      quoteDecorationFixCount,
      quoteDuplicateRemovalCount,
      finalQuoteNormalizationApplied,
      ...metadataResult,
      rollbackPerformed: false,
      rollbackConfirmed: null,
      ...editorDiagnostics,
      previousHtmlLength: previousHtml.length,
      previousTextLength: previousText.trim().length,
      previousTextHash: textHash(previousText.trim()),
      paragraphCount: editor.querySelectorAll('[data-ifanr-block="paragraph"], p').length || Math.min(expectedStyles.bodyCount, styleInspection.bodyStyleCount),
      headingCount: headings.length || Math.min(expectedStyles.headingCount, styleInspection.headingStyleCount),
      headingTexts: headings.map((heading) => (heading.innerText || heading.textContent || '').trim()).slice(0, 10),
      imageCount: imageInspection.imageCount,
      sourceImageCount: Number(options.sourceImageCount || expectedImageCount + staged.manualImageReplacements.length),
      visibleImageCount: imageInspection.visibleImageCount,
      visibleHostedImageCount: imageInspection.visibleHostedImageCount,
      hostedImageCount: imageInspection.hostedImageCount,
      imageSourceKinds: imageInspection.imageSourceKinds,
      imageSourceDetails: imageInspection.imageSourceDetails,
      pendingEmbeddedImageCount: imageInspection.pendingEmbeddedImageCount,
      pendingImageOrders,
      pendingImageNames,
      pendingAnimatedImageCount: Math.max(imageInspection.pendingAnimatedImageCount, failedAnimatedAttempts.length),
      stagedImageCount: stagedImages.length,
      stagedAnimatedImageCount: staged.animatedImages.length,
      extractedEmbeddedImageCount: embeddedPayloads.count,
      extractedEmbeddedPayloadBytes: embeddedPayloads.bytes,
      initiallyHostedImageCount,
      confirmedStagedImageCount,
      imageUploadBatchSize,
      imageUploadBatchCount,
      imageBatchMaxEncodedBytes,
      stagedImageUploadAttempts: imageUploadAttempts,
      manualImagePlaceholderCount: staged.manualImageReplacements.length,
      manualImageOrders: staged.manualImageReplacements.map((item) => item.order),
      manualImageNames: staged.manualImageReplacements.map((item) => item.name),
      hostingFallbackPlaceholderCount,
      hostingFallbackImageOrders,
      animatedUploadAttempts: imageUploadAttempts.filter((attempt) => attempt.kind === 'gif'),
      imageUploadConfirmed,
      imageWriteAccountedConfirmed,
      ...styleInspection,
      textLength: text.trim().length,
      textHash: textHash(text.trim())
    };

    if (!replacementConfirmed) {
      result.rollbackPerformed = true;
      result.rollbackConfirmed = restoreEditorSnapshot(editor, previousHtml);
      throw Object.assign(new Error('WECHAT_REPLACEMENT_NOT_CONFIRMED'), { result });
    }
    if (!styleInspection.layoutStyleConfirmed && !forcedReplacement) {
      result.rollbackPerformed = true;
      result.rollbackConfirmed = restoreEditorSnapshot(editor, previousHtml);
      throw Object.assign(new Error('WECHAT_STYLE_NOT_CONFIRMED'), { result });
    }
    if (options.requireHostedImages && !imageWriteAccountedConfirmed) {
      throw Object.assign(new Error('WECHAT_IMAGE_UPLOAD_NOT_CONFIRMED'), { result });
    }
    if (!saved) throw Object.assign(new Error('WECHAT_SAVE_NOT_CONFIRMED'), { result });
    await emitProgress(options, {
      phase: 'write-completed',
      percent: 100,
      message: result.styleValidationBypassed
        ? '正文已强制覆盖并保存，请在发布前人工检查样式'
        : hostingFallbackPlaceholderCount
        ? `正文已保存，${hostingFallbackPlaceholderCount} 张图片未完成托管并已在原位置标记待补`
        : staged.manualImageReplacements.length
        ? `正文已保存，${staged.manualImageReplacements.length} 张超限图片已在原位置标记待补`
        : '正文、图片和自动保存均已确认'
    });
    return result;
  }

  global.WechatEditorAdapter = {
    injectHtml,
    refreshManualFormatting,
    inspectImages,
    inspectLayoutStyles,
    normalizeManualFormattingHtml,
    sanitizeArticleHtml,
    editorIsSemanticallyEmpty,
    normalizeValidationText,
    validateReplacement
  };
})(globalThis);
