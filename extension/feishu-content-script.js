const IFANR_STAGING_KEY_PREFIX = 'ifanrArticlePackageStaging:';
const IFANR_BROWSER_CAPTURE_TIMEOUT_MS = 45000;
const IFANR_IMAGE_DOWNLOAD_TIMEOUT_MS = 10000;
const IFANR_IMAGE_DOWNLOAD_CONCURRENCY = 6;
const IFANR_MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const IFANR_MAX_ARTICLE_MEDIA_BYTES = 96 * 1024 * 1024;
const IFANR_SUPPORTED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function feishuDelay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function feishuScrollContainer() {
  const preferred = document.querySelector('.bear-web-x-container');
  if (preferred && preferred.scrollHeight > preferred.clientHeight + 100) return preferred;
  return [...document.querySelectorAll('div')]
    .find((element) => element.clientHeight > 200 && element.scrollHeight > element.clientHeight + 300) || null;
}

function feishuTitle() {
  const page = document.querySelector('[data-block-type="page"]');
  const heading = page?.querySelector('h1') || document.querySelector('h1');
  const title = globalThis.IFANR_FEISHU_PAGE_READER.cleanText(heading?.innerText || heading?.textContent || '');
  return title || document.title.replace(/\s*-\s*飞书云文档\s*$/i, '').trim();
}

function inlineRuns(block) {
  const leaves = [...block.querySelectorAll('[data-string="true"]')];
  const runs = [];
  for (const leaf of leaves) {
    const text = String(leaf.textContent || '').replace(/\p{Cf}/gu, '').replace(/\u00A0/g, ' ');
    if (!text) continue;
    const link = leaf.closest('a[href]');
    const styleNode = leaf.closest('[data-leaf="true"]') || leaf;
    const style = getComputedStyle(styleNode);
    const decoration = `${style.textDecorationLine || ''} ${style.textDecoration || ''}`;
    const run = {
      text,
      bold: Number.parseInt(style.fontWeight, 10) >= 600 || styleNode.closest('strong,b') != null,
      italic: style.fontStyle === 'italic' || styleNode.closest('em,i') != null,
      underline: /underline/.test(decoration) || styleNode.closest('u') != null,
      strike: /line-through/.test(decoration) || styleNode.closest('s,strike,del') != null,
      link: /^https?:\/\//i.test(link?.href || '') ? link.href : null
    };
    const previous = runs.at(-1);
    if (previous && previous.bold === run.bold && previous.italic === run.italic && previous.underline === run.underline && previous.strike === run.strike && previous.link === run.link) {
      previous.text += run.text;
    } else {
      runs.push(run);
    }
  }
  return runs;
}

function cleanCapturedListText(value = '') {
  return globalThis.IFANR_FEISHU_PAGE_READER.cleanListItemText(value);
}

function snapshotFeishuBlock(block, captureSequence) {
  const type = block.getAttribute('data-block-type') || '';
  if (!type || ['page', 'back_ref_list', 'catalog', 'table_of_contents', 'comment', 'doc_info'].includes(type)) return null;
  if (block.closest('.wiki-catalog, .docx-catalog, .doc-info-sidebar, [data-block-type="catalog"], .bear-web-catalog')) return null;

  const rawId = block.getAttribute('data-block-id') || block.getAttribute('data-record-id') || '';
  const rect = block.getBoundingClientRect();
  const container = feishuScrollContainer();
  const top = Math.round(rect.top + (container ? container.scrollTop : window.scrollY));
  const order = captureSequence;

  if (type === 'image') {
    const image = block.querySelector('.image-block img, img.docx-image, img');
    const imageBlock = block.querySelector('[image-token]') || block.closest('[image-token]') || block;
    const token = imageBlock?.getAttribute('image-token') || block.getAttribute('data-record-id') || null;
    const originSrc = image?.getAttribute('data-origin-src') || image?.getAttribute('data-full-src') || image?.getAttribute('data-src') || image?.getAttribute('data-url') || null;
    const source = originSrc || image?.src || null;
    const srcset = image?.getAttribute('srcset') || null;
    return {
      id: rawId,
      top,
      order,
      captureSequence,
      type,
      recordId: block.getAttribute('data-record-id') || null,
      image: {
        src: source,
        currentSrc: source ? (image?.currentSrc || source) : null,
        originSrc,
        srcset,
        alt: image?.alt || '',
        token,
        width: Number(image?.naturalWidth || image?.width || 0),
        height: Number(image?.naturalHeight || image?.height || 0)
      }
    };
  }
  const rawText = globalThis.IFANR_FEISHU_PAGE_READER.cleanText(block.innerText || block.textContent || '');
  const className = String(block.className || '');
  const caption = /(?:^|[-_])(?:image[-_])?(?:caption|description)(?:$|[-_])/i.test(className);
  const explicitListKind = type === 'ordered'
    ? 'ordered'
    : ['bullet', 'todo', 'task'].includes(type)
      ? 'bullet'
      : null;
  const listKind = explicitListKind || (/ordered|number/i.test(className) ? 'ordered' : /bullet|list/i.test(className) ? 'bullet' : null);
  const text = listKind ? cleanCapturedListText(rawText) : rawText;
  if (!text && !['divider', 'horizontal_rule'].includes(type)) return null;
  return {
    id: rawId,
    top,
    order,
    captureSequence,
    type,
    recordId: block.getAttribute('data-record-id') || null,
    text,
    runs: listKind ? [] : inlineRuns(block),
    listKind,
    quote: /quote|blockquote/i.test(className),
    caption
  };
}

function scanVisibleFeishuBlocks(blocksById, sequence) {
  for (const element of document.querySelectorAll('[data-block-id]')) {
    if (element.closest('.wiki-catalog, .docx-catalog, .doc-info-sidebar, [data-block-type="catalog"], .bear-web-catalog')) continue;
    const rawId = element.getAttribute('data-block-id') || element.getAttribute('data-record-id') || '';
    if (!rawId) continue;
    const key = rawId || `observed-${sequence.next}`;
    const previous = blocksById.get(key);
    const snapshot = snapshotFeishuBlock(element, previous?.captureSequence || sequence.next);
    if (!snapshot) continue;
    if (!previous) sequence.next += 1;
    if (previous && snapshot.top > 0) {
      previous.top = snapshot.top;
    }
    if (!previous || (!previous.text && snapshot.text) || (!previous.image && snapshot.image)) blocksById.set(key, snapshot);
  }
}

function capturedBlocksSignature(blocksById) {
  return [...blocksById.entries()]
    .map(([key, block]) => `${key}:${block.type}:${block.text?.length || 0}:${block.image?.src || ''}`)
    .sort()
    .join('|');
}

async function collectFeishuBlocks(onProgress, isCancelled) {
  const container = feishuScrollContainer();
  if (!container) throw { code: 'FEISHU_DOCUMENT_NOT_READY', message: '没有找到飞书正文滚动区域，请等待文档加载完成后重试。' };
  const originalScrollTop = container.scrollTop;
  const blocksById = new Map();
  const sequence = { next: 1 };
  let visited = 0;
  let passCount = 0;
  let stable = false;
  try {
    const step = Math.max(180, Math.floor(container.clientHeight * 0.5));
    let previousSignature = '';
    let previousHeight = 0;
    for (let pass = 1; pass <= 4; pass += 1) {
      passCount = pass;
      let maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      const positions = [];
      for (let position = 0; position < maxScroll; position += step) positions.push(position);
      positions.push(maxScroll);
      if (pass % 2 === 0) positions.reverse();
      for (let index = 0; index < positions.length; index += 1) {
        if (isCancelled?.()) throw { code: 'COMPILE_CANCELLED', message: '任务已经停止。' };
        maxScroll = Math.max(maxScroll, container.scrollHeight - container.clientHeight);
        container.scrollTop = Math.min(positions[index], maxScroll);
        container.dispatchEvent(new Event('scroll', { bubbles: true }));
        await feishuDelay(90);
        scanVisibleFeishuBlocks(blocksById, sequence);
        visited += 1;
        const passProgress = (index + 1) / Math.max(1, positions.length);
        const percent = Math.min(52, 5 + Math.round(47 * ((pass - 1 + passProgress) / 4)));
        await onProgress?.({
          phase: 'browser-reading',
          percent,
          message: `正在核对全文（第 ${pass} 轮），已发现 ${blocksById.size} 个内容块`
        });
      }
      const signature = capturedBlocksSignature(blocksById);
      const height = container.scrollHeight;
      if (pass >= 2 && signature === previousSignature && Math.abs(height - previousHeight) <= 2) {
        stable = true;
        break;
      }
      previousSignature = signature;
      previousHeight = height;
    }
  } finally {
    container.scrollTop = originalScrollTop;
    container.dispatchEvent(new Event('scroll', { bubbles: true }));
  }
  if (!stable) {
    throw {
      code: 'FEISHU_DOCUMENT_UNSTABLE',
      message: '飞书正文仍在变化，插件没有冒险生成可能缺段的内容。请等待页面停止加载后重试。',
      observedBlockCount: blocksById.size,
      passCount
    };
  }
  const blocks = [...blocksById.values()].sort((a, b) => {
    const byOrder = Number(a.order || 0) - Number(b.order || 0);
    return byOrder || Number(a.captureSequence || 0) - Number(b.captureSequence || 0);
  });
  if (!blocks.some((block) => block.text)) {
    throw { code: 'FEISHU_DOCUMENT_EMPTY', message: '没有从当前飞书页面读取到正文，请确认文档已经加载且你有查看权限。' };
  }
  return { blocks, visited, passCount, stable, scrollHeight: container.scrollHeight, viewportHeight: container.clientHeight };
}

function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('IMAGE_DATA_URL_FAILED'));
    reader.readAsDataURL(blob);
  });
}

const titleImagePromises = new Map();
function loadTitleImage(brandId = 'ifanr') {
  const selector = globalThis.IFANR_TITLE_IMAGE_BRAND;
  const brand = selector?.getBrand(brandId) || {
    id: 'ifanr',
    label: '爱范儿',
    assetPath: 'assets/ifanr-title.gif',
    token: 'ifanr-discover-the-next',
    sourceName: 'ifanr-discover-the-next.gif',
    alt: 'DISCOVER THE NEXT',
    width: 720,
    height: 384
  };
  if (!titleImagePromises.has(brand.id)) {
    titleImagePromises.set(brand.id, fetch(chrome.runtime.getURL(brand.assetPath))
      .then((response) => {
        if (!response.ok) throw new Error(`TITLE_IMAGE_HTTP_${response.status}`);
        return response.blob();
      })
      .then(async (blob) => ({
        dataUri: await blobToDataUri(blob),
        mime: 'image/gif',
        bytes: blob.size,
        width: brand.width,
        height: brand.height,
        token: brand.token,
        sourceName: brand.sourceName,
        alt: brand.alt,
        brand: brand.id,
        brandLabel: brand.label
      })));
  }
  return titleImagePromises.get(brand.id);
}

async function attachFeishuImages(blocks, onProgress, isCancelled, deadlineAt, options = {}) {
  const images = blocks.filter((block) => block.image);
  const staticCompressor = globalThis.IFANR_STATIC_IMAGE_COMPRESSION || null;
  const staticImageQuality = staticCompressor?.normalizeQuality(options.staticImageQuality) || 90;
  let nextIndex = 0;
  let completed = 0;
  let totalBytes = 0;
  let compressedStaticImageCount = 0;
  let larkProcessedImageCount = 0;
  let roundImageCount = 0;
  async function fetchImage(block, index) {
    const imageUrl = block.image.currentSrc || block.image.src;
    if (!imageUrl) {
      throw {
        code: 'FEISHU_IMAGE_SOURCE_UNAVAILABLE',
        message: `第 ${index + 1} 张图片尚未加载出可读取地址。`,
        imageIndex: index + 1,
        imageCount: images.length
      };
    }
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(
        IFANR_IMAGE_DOWNLOAD_TIMEOUT_MS,
        Math.max(1000, deadlineAt - Date.now())
      ));
      try {
        const response = await fetch(imageUrl, {
          credentials: 'include',
          cache: attempt === 1 ? 'force-cache' : 'no-cache',
          signal: controller.signal
        });
        if (response.ok) return response;
        lastError = { status: response.status };
        if (response.status < 500 && response.status !== 429) break;
      } catch (error) {
        lastError = error;
        if (error?.name === 'AbortError' || Date.now() >= deadlineAt) break;
      } finally {
        clearTimeout(timeout);
      }
      await feishuDelay(180);
    }
    const timedOut = lastError?.name === 'AbortError';
    throw {
      code: timedOut ? 'FEISHU_IMAGE_DOWNLOAD_TIMEOUT' : 'FEISHU_IMAGE_DOWNLOAD_FAILED',
      message: timedOut
        ? `第 ${index + 1} 张图片读取超时，已停止等待。`
        : `第 ${index + 1} 张图片无法通过当前飞书登录状态下载。`,
      imageIndex: index + 1,
      imageCount: images.length,
      detail: lastError?.message || (lastError?.status ? `HTTP ${lastError.status}` : '')
    };
  }
  async function worker() {
    while (nextIndex < images.length) {
      if (isCancelled?.()) throw { code: 'COMPILE_CANCELLED', message: '任务已经停止。' };
      const index = nextIndex;
      nextIndex += 1;
      const block = images[index];
      if (Date.now() >= deadlineAt) {
        throw {
          code: 'COMPILE_TIMEOUT',
          message: '通过当前飞书页面读取超过 45 秒，已自动停止。',
          phase: 'browser-images',
          imageIndex: index + 1,
          imageCount: images.length
        };
      }
      try {
        const response = await fetchImage(block, index);
        const blob = await response.blob();
        const mime = String(blob.type || '').toLowerCase().split(';')[0];
        if (!IFANR_SUPPORTED_IMAGE_MIMES.has(mime)) {
          throw {
            code: 'FEISHU_IMAGE_FORMAT_UNSUPPORTED',
            message: `第 ${index + 1} 张媒体格式为 ${mime || '未知'}，暂不支持直接写入微信。`,
            imageIndex: index + 1,
            mime
          };
        }
        if (blob.size > IFANR_MAX_IMAGE_BYTES) {
          throw { code: 'FEISHU_IMAGE_TOO_LARGE', message: `第 ${index + 1} 张图片超过 80MB，已保留原位补图标记。`, imageIndex: index + 1, bytes: blob.size };
        }
        let output = {
          blob,
          mime,
          width: Number(block.image.width || 0),
          height: Number(block.image.height || 0),
          compressed: false,
          originalBytes: blob.size,
          outputBytes: blob.size,
          quality: staticImageQuality,
          decision: 'browser-original'
        };
        const larkProcessor = globalThis.IFANR_LARK_IMAGE_PROCESSOR || null;
        if (mime !== 'image/gif' && larkProcessor && options.larkImageProcessing !== false) {
          await onProgress?.({
            phase: 'processing-images',
            percent: 55 + Math.round(30 * completed / Math.max(1, images.length)),
            message: `正在按 Lark2Pad 规则处理第 ${index + 1} / ${images.length} 张图片`,
            imageIndex: index + 1,
            imageCount: images.length
          });
          output = await larkProcessor.processStaticImage(blob, {
            maxWidth: Number(options.larkMaxImageWidth) || larkProcessor.DEFAULT_MAX_WIDTH,
            roundImages: options.larkRoundImages !== false,
            quality: staticImageQuality / 100,
            deadlineAt
          });
          if (output.processed) larkProcessedImageCount += 1;
          if (output.roundImages) roundImageCount += 1;
        }
        if (mime !== 'image/gif' && blob.size > (staticCompressor?.WECHAT_IMAGE_MAX_BYTES || 5 * 1024 * 1024)) {
          const needsFallbackCompression = !output.processed ||
            output.decision === 'lark-over-limit' ||
            output.decision === 'lark-decode-fallback';
          if (needsFallbackCompression) {
            if (!staticCompressor) {
              throw {
                code: 'STATIC_IMAGE_COMPRESSOR_UNAVAILABLE',
                message: `第 ${index + 1} 张静态图超过微信 5MB 上限，请刷新飞书页面后重新收录或手动压缩。`
              };
            }
            await onProgress?.({
              phase: 'compressing-static-images',
              percent: 55 + Math.round(30 * completed / Math.max(1, images.length)),
              message: `正在高质量压缩第 ${index + 1} / ${images.length} 张超限静态图`,
              imageIndex: index + 1,
              imageCount: images.length
            });
            output = await staticCompressor.compressStaticImage(blob, {
              quality: staticImageQuality,
              width: block.image.width,
              height: block.image.height,
              deadlineAt
            });
            if (output.compressed) compressedStaticImageCount += 1;
          }
        }
        totalBytes += output.blob.size;
        if (totalBytes > IFANR_MAX_ARTICLE_MEDIA_BYTES) {
          throw { code: 'FEISHU_ARTICLE_MEDIA_TOO_LARGE', message: '文档图片总量超过 96MB，已停止收录以避免浏览器卡死。请拆分文章或使用增强服务。', imageIndex: index + 1, bytes: totalBytes };
        }
        const disposition = response.headers.get('content-disposition') || '';
        const filenameMatch = disposition.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)/i);
        let sourceName = filenameMatch ? filenameMatch[1].replace(/^\"|\"$/g, '') : '';
        try {
          sourceName = decodeURIComponent(sourceName);
        } catch {
          // Keep the server-provided name when it is not valid percent-encoded text.
        }
        block.image.mime = output.mime;
        block.image.bytes = output.blob.size;
        block.image.originalBytes = output.originalBytes;
        block.image.originalMime = mime;
        block.image.originalWidth = Number(block.image.width || 0);
        block.image.originalHeight = Number(block.image.height || 0);
        block.image.width = output.width || block.image.width;
        block.image.height = output.height || block.image.height;
        block.image.compression = {
          compressed: Boolean(output.compressed || output.processed),
          quality: output.encodeQuality || output.quality || staticImageQuality,
          encodeQuality: output.encodeQuality || null,
          inputBytes: output.originalBytes,
          outputBytes: output.outputBytes,
          decision: output.decision,
          roundImages: Boolean(output.roundImages)
        };
        block.image.larkProcessing = {
          processedBy: output.processed ? 'lark' : null,
          roundImages: Boolean(output.roundImages),
          maxWidth: Number(output.maxWidth || 0) || null,
          encodeQuality: output.encodeQuality || null,
          inputBytes: output.originalBytes,
          outputBytes: output.outputBytes,
          decision: output.decision
        };
        block.image.sourceName = sourceName;
        block.image.animationUnverified = /\.gif$/i.test(sourceName) && mime !== 'image/gif';
        block.image.dataUri = await blobToDataUri(output.blob);
      } catch (error) {
        if (
          error?.code === 'COMPILE_CANCELLED' ||
          error?.code === 'COMPILE_TIMEOUT' ||
          error?.code === 'FEISHU_ARTICLE_MEDIA_TOO_LARGE' ||
          Date.now() >= deadlineAt
        ) throw error;
        block.image.downloadError = {
          code: error?.code || 'FEISHU_IMAGE_DOWNLOAD_FAILED',
          message: error?.message || `第 ${index + 1} 张图片暂时无法读取。`,
          detail: error?.detail || null
        };
      }
      completed += 1;
      await onProgress?.({
        phase: 'browser-images',
        percent: 55 + Math.round(35 * completed / Math.max(1, images.length)),
        message: block.image.dataUri
          ? `已通过当前页面读取 ${completed} / ${images.length} 张图片`
          : `已核对 ${completed} / ${images.length} 张图片，当前图片已保留补图标记`,
        imageIndex: completed,
        imageCount: images.length
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(IFANR_IMAGE_DOWNLOAD_CONCURRENCY, images.length) }, () => worker()));
  return {
    imageCount: images.length,
    totalBytes,
    compressedStaticImageCount,
    larkProcessedImageCount,
    roundImageCount,
    staticImageQuality
  };
}

let activeFeishuCapture = null;

async function captureCurrentFeishuPage(message) {
  const requestId = message.requestId;
  const sourceUrl = message.sourceUrl;
  if (!globalThis.IFANR_SOURCE_LINK.sameFeishuDoc(location.href, sourceUrl)) {
    throw { code: 'SOURCE_MISMATCH', message: '当前页面已经切换到另一篇飞书文档，已停止收录。' };
  }
  activeFeishuCapture = { requestId, cancelled: false };
  const deadlineAt = Date.now() + IFANR_BROWSER_CAPTURE_TIMEOUT_MS;
  const isCancelled = () => {
    if (!activeFeishuCapture || activeFeishuCapture.requestId !== requestId) return true;
    if (activeFeishuCapture?.requestId === requestId && activeFeishuCapture.cancelled) return true;
    if (Date.now() >= deadlineAt) {
      throw {
        code: 'COMPILE_TIMEOUT',
        message: '通过当前飞书页面读取超过 45 秒，已自动停止。',
        phase: 'browser-reading'
      };
    }
    return false;
  };
  const startedAt = new Date().toISOString();
  const updateProgress = async (progress) => {
    const response = await chrome.runtime.sendMessage({
      type: 'IFANR_FEISHU_CAPTURE_PROGRESS',
      requestId,
      sourceUrl,
      startedAt,
      deadlineAt: new Date(deadlineAt).toISOString(),
      progress
    }).catch(() => null);
    if (!response?.ok) throw { code: 'STALE_COMPILE_IGNORED', message: '较早的读取任务已停止。' };
  };
  try {
    await updateProgress({ phase: 'browser-starting', percent: 2, message: '正在使用当前飞书页面读取文档' });
    const collected = await collectFeishuBlocks(updateProgress, isCancelled);
    const title = feishuTitle();
    const titleImageSelection = globalThis.IFANR_TITLE_IMAGE_BRAND?.resolve({
      preference: message.options?.titleImageBrand,
      title,
      blocks: collected.blocks
    }) || {
      brand: 'ifanr',
      preference: 'auto',
      mode: 'automatic',
      reason: 'default-ifanr',
      score: 0,
      signals: []
    };
    const [media, titleImage] = await Promise.all([
      attachFeishuImages(collected.blocks, updateProgress, isCancelled, deadlineAt, message.options || {}),
      loadTitleImage(titleImageSelection.brand)
    ]);
    await updateProgress({ phase: 'browser-rendering', percent: 94, message: '正在生成微信兼容排版', imageCount: media.imageCount });
    const fixture = globalThis.IFANR_FEISHU_PAGE_READER.buildFixture({
      title,
      sourceUrl,
      blocks: collected.blocks,
      titleImage,
      titleImageSelection,
      capture: {
        visitedViewportCount: collected.visited,
        verificationPassCount: collected.passCount,
        collectionStable: collected.stable,
        observedBlockCount: collected.blocks.length,
        mediaBytes: media.totalBytes + titleImage.bytes,
        compressedStaticImageCount: media.compressedStaticImageCount,
        larkProcessedImageCount: media.larkProcessedImageCount,
        roundImageCount: media.roundImageCount,
        staticImageQuality: media.staticImageQuality,
        titleImageBrand: titleImage.brand,
        titleImagePreference: titleImageSelection.preference,
        scrollHeight: collected.scrollHeight,
        viewportHeight: collected.viewportHeight
      }
    });
    const completedAt = new Date().toISOString();
    const stagingKey = `${IFANR_STAGING_KEY_PREFIX}${requestId}`;
    fixture.gifQualityOverride = true;
    fixture.warningMode = 'non-blocking';
    await chrome.storage.local.set({
      [stagingKey]: { requestId, sourceUrl, fixture, completedAt }
    });
    return {
      ok: true,
      stagingKey,
      fixture: {
        title: fixture.title,
        blockCount: fixture.blockCount,
        imageCount: fixture.imageCount,
        galleryCount: fixture.galleryCount,
        gifWarningCount: fixture.gifWarnings.length,
        sourceUrl: fixture.sourceUrl,
        readerMode: fixture.readerMode
      }
    };
  } finally {
    if (activeFeishuCapture?.requestId === requestId) activeFeishuCapture = null;
  }
}

function getHighResFeishuImageCandidates(src = '', token = '', srcset = '', originSrc = '') {
  if (!src && !token && !originSrc) return [];
  const candidates = [];

  // 1. 显式原图属性
  if (originSrc) candidates.push(originSrc);

  // 2. 解析 srcset
  if (srcset) {
    const entries = srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
    candidates.push(...entries.reverse());
  }

  // 3. 针对飞书 Drive API 构造全高清原图地址 (preview_type=1 为官方全分辨率原图, preview_type=15 为 4K 极清)
  const baseSrc = originSrc || src;
  if (baseSrc) {
    try {
      const u = new URL(baseSrc, location.href);
      if (u.hostname.includes('feishu.cn') || u.hostname.includes('feishucdn.com')) {
        // preview_type=1 (官方无损全分辨率)
        const u1 = new URL(baseSrc, location.href);
        u1.searchParams.set('preview_type', '1');
        u1.searchParams.delete('width');
        u1.searchParams.delete('height');
        u1.searchParams.delete('size');
        u1.searchParams.delete('rule');
        candidates.push(u1.toString());

        // preview_type=15 (4K超清)
        const u15 = new URL(baseSrc, location.href);
        u15.searchParams.set('preview_type', '15');
        u15.searchParams.delete('width');
        u15.searchParams.delete('height');
        u15.searchParams.delete('size');
        u15.searchParams.delete('rule');
        candidates.push(u15.toString());

        // 移除 preview_type（原始直连流）
        const uRaw = new URL(baseSrc, location.href);
        uRaw.searchParams.delete('preview_type');
        uRaw.searchParams.delete('width');
        uRaw.searchParams.delete('height');
        uRaw.searchParams.delete('size');
        uRaw.searchParams.delete('rule');
        candidates.push(uRaw.toString());
      }
    } catch {}
  }

  // 4. 基于 Token 构造高清地址
  if (token && (token.startsWith('boxcn') || token.startsWith('box'))) {
    const host = location.host.includes('feishu.cn') ? location.host : 'internal-api-drive-stream.feishu.cn';
    candidates.push(`https://${host}/space/api/box/stream/download/preview/${token}/?preview_type=1`);
    candidates.push(`https://${host}/space/api/box/stream/download/preview/${token}/?preview_type=15`);
    candidates.push(`https://${host}/space/api/box/stream/download/preview/${token}/`);
  }

  // 5. 兜底原始地址
  if (src) candidates.push(src);

  return [...new Set(candidates)];
}

async function fetchImageAsDataUri(src, token = '', srcset = '', originSrc = '') {
  if (!src || src.startsWith('data:')) return src;
  const candidates = getHighResFeishuImageCandidates(src, token, srcset, originSrc);

  let bestBlob = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size > 200) {
          if (!bestBlob || blob.size > bestBlob.size) {
            bestBlob = blob;
          }
          // 如果获取到了大于 40KB 的图片二进制，说明成功拿到高清/原图
          if (blob.size > 40 * 1024) {
            break;
          }
        }
      }
    } catch {}
  }

  if (bestBlob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(src);
      reader.readAsDataURL(bestBlob);
    });
  }

  return src;
}

async function extractFeishuDocDirect() {
  const title = feishuTitle() || document.title.replace(/\s*-\s*飞书云文档\s*$/i, '').trim();
  const container = feishuScrollContainer();
  if (!container) {
    throw { code: 'FEISHU_DOCUMENT_NOT_READY', message: '没有找到飞书正文滚动区域，请等待文档加载完成后重试。' };
  }

  const originalScrollTop = container.scrollTop;
  const blocksById = new Map();
  const sequence = { next: 1 };

  try {
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    const step = Math.max(280, Math.floor(container.clientHeight * 0.7));

    // 1. 先重置到顶部，等待飞书首屏虚拟 DOM 渲染
    container.scrollTop = 0;
    container.dispatchEvent(new Event('scroll', { bubbles: true }));
    await feishuDelay(60);
    scanVisibleFeishuBlocks(blocksById, sequence);

    // 2. 依次平滑滚动扫描全文
    for (let pos = 0; pos <= maxScroll; pos += step) {
      container.scrollTop = pos;
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
      await feishuDelay(20);
      scanVisibleFeishuBlocks(blocksById, sequence);
    }
    container.scrollTop = maxScroll;
    container.dispatchEvent(new Event('scroll', { bubbles: true }));
    await feishuDelay(20);
    scanVisibleFeishuBlocks(blocksById, sequence);
  } finally {
    container.scrollTop = originalScrollTop;
    container.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  // 3. 按真实文档物理纵向绝对坐标 (top) 严格从头到尾排序，确保文章开头 100% 正确
  const blocks = [...blocksById.values()].sort((a, b) => {
    const byTop = (a.top ?? 0) - (b.top ?? 0);
    if (Math.abs(byTop) > 2) return byTop;
    return Number(a.order || 0) - Number(b.order || 0);
  });

  // 并发高速将所有图片以 100% 原图无损画质转换为微信可直读与托管的 DataURI (Base64)
  const imageBlocks = blocks.filter((b) => b.type === 'image' || b.image);
  await Promise.all(imageBlocks.map(async (block) => {
    const src = block.image?.currentSrc || block.image?.src;
    const token = block.image?.token;
    const srcset = block.image?.srcset;
    const originSrc = block.image?.originSrc;
    if (src && !src.startsWith('data:')) {
      const dataUri = await fetchImageAsDataUri(src, token, srcset, originSrc);
      if (dataUri && dataUri.startsWith('data:')) {
        block.image.dataUri = dataUri;
        block.image.src = dataUri;
        block.image.currentSrc = dataUri;
      }
    }
  }));

  return {
    ok: true,
    title,
    sourceUrl: location.href,
    blocks,
    extractedAt: new Date().toISOString()
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'IFANR_EXTRACT_FEISHU_DIRECT') {
    extractFeishuDocDirect()
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }
  if (message?.type === 'IFANR_CANCEL_FEISHU_CAPTURE') {
    if (activeFeishuCapture && (!message.requestId || activeFeishuCapture.requestId === message.requestId)) {
      activeFeishuCapture.cancelled = true;
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: { code: 'NO_ACTIVE_COMPILE', message: '当前没有页面读取任务。' } });
    }
    return false;
  }
  if (message?.type !== 'IFANR_CAPTURE_FEISHU_PAGE') return false;
  captureCurrentFeishuPage(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error?.code ? error : { code: 'FEISHU_BROWSER_CAPTURE_FAILED', message: error?.message || '浏览器直读失败。' }
      });
    });
  return true;
});
