(function (global) {
  const WECHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
  const STYLE = Object.freeze({
    heading1: 'font-family:&quot;PingFangSC-Semibold&quot;;font-weight:600;color:#FD4606;text-align:justify;line-height:32px;margin:62px 0 26px 0;padding:0 14px;font-size:24px',
    heading2: 'font-family:&quot;PingFangSC-Semibold&quot;;font-weight:600;color:#FD4606;text-align:justify;line-height:30px;margin:62px 0 26px 0;padding:0 14px;font-size:22px',
    heading3: 'font-family:&quot;PingFangSC-Semibold&quot;;font-weight:600;color:#FD4606;text-align:justify;line-height:28px;margin:62px 0 26px 0;padding:0 14px;font-size:20px',
    heading4: 'font-family:&quot;PingFangSC-Semibold&quot;;font-weight:600;color:#FD4606;text-align:justify;line-height:26px;margin:42px 0 22px 0;padding:0 14px;font-size:18px',
    body: 'margin:0 16px 24px;color:#222222;font-size:15px;font-family:&quot;PingFangSC-Light&quot;,&quot;PingFang SC&quot;,-apple-system,BlinkMacSystemFont,&quot;Microsoft YaHei&quot;,sans-serif;font-weight:300;line-height:1.8;letter-spacing:0.02em',
    caption: 'margin:0 16px 16px;color:#A8A8A8;font-size:12px;font-family:&quot;PingFangSC-Light&quot;,&quot;PingFang SC&quot;,-apple-system,BlinkMacSystemFont,&quot;Microsoft YaHei&quot;,sans-serif;font-weight:300;line-height:1.6;text-align:left',
    quote: 'margin:0 16px 24px;padding:0 0 0 16px;border-left:3px solid #D9D9D9;box-sizing:border-box;color:#888888;font-size:15px;font-family:&quot;PingFangSC-Light&quot;,&quot;PingFang SC&quot;,-apple-system,BlinkMacSystemFont,&quot;Microsoft YaHei&quot;,sans-serif;font-weight:300;line-height:1.8',
    list: 'width:calc(100% - 32px);max-width:calc(100% - 32px);margin:0 16px 24px;padding-left:1.4em;box-sizing:border-box;color:#222222;font-size:15px;font-family:&quot;PingFangSC-Light&quot;,&quot;PingFang SC&quot;,-apple-system,BlinkMacSystemFont,&quot;Microsoft YaHei&quot;,sans-serif;font-weight:300;line-height:1.8;overflow-wrap:anywhere;word-break:break-word'
  });

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function cleanText(value = '') {
    return String(value)
      .replace(/\p{Cf}/gu, '')
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function cleanListItemText(value = '') {
    return cleanText(value)
      .replace(/^(?:[\u2022\u25CF\u25CB\u25AA\u25E6\u2043\u2219\u00B7\-–—]\s+|(?:\d+|[A-Za-z]|[一二三四五六七八九十]+)[.、．]\s*)/, '')
      .replace(/^[☐☑✅✓✔]\s*/, '')
      .trim();
  }

  function normalizedFidelityText(values = []) {
    return values
      .map((value) => cleanText(value).replace(/\s+/g, ' '))
      .filter(Boolean)
      .join('\n');
  }

  function textFingerprint(value = '') {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function firstCompleteSentence(value = '') {
    const text = cleanText(value).replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ');
    if (!text) return '';
    const match = text.match(/^([\s\S]*?[。！？!?])([”’」』）》】]*)/);
    return cleanText(match ? `${match[1]}${match[2] || ''}` : text);
  }

  function selectSummaryText(candidates = []) {
    const normalized = candidates.map((value) => cleanText(value).replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ')).filter(Boolean);
    const isEditorialLabel = (value) => /^(?:备选标题|标题备选|候选标题|视频脚本|开场钩子|正文|导语|摘要|作者|图片说明)\s*[：:]?$/i.test(value)
      || /^\/\//.test(value)
      || (value.length < 12 && /[：:]$/.test(value));
    const eligible = normalized.filter((value) => !isEditorialLabel(value));
    const completeSentence = eligible.find((value) => /[。！？!?]/.test(value));
    const proseFallback = eligible.find((value) => value.length >= 12 && !/[：:]$/.test(value));
    return completeSentence || proseFallback || eligible[0] || normalized[0] || '';
  }

  function looksLikeImageCaption(value = '') {
    const text = cleanText(value).replace(/\s+/g, ' ');
    if (!text || text.length > 180) return false;
    return /^(?:图(?:注|片|源)?|图片来源|摄影|照片|photo|image|source)\s*(?:[|｜:：]|by\b)/i.test(text)
      || /^(?:©|摄影：|摄影:)/i.test(text)
      || /^图\s+[^\n]{1,120}\s+@\s*(?:unsplash|pexels)\b/i.test(text);
  }

  function typographyOnly(style = '') {
    return String(style)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !/^(margin|padding|border|box-sizing)\s*:/i.test(part))
      .join(';');
  }

  function renderTextBlock({ blockType, role, style, content, attributes = '' }) {
    const innerStyle = typographyOnly(style);
    return `<section data-ifanr-block="${escapeHtml(blockType)}" data-ifanr-style-role="${escapeHtml(role)}" ${attributes}style="${style}"><span data-ifanr-style-role="${escapeHtml(role)}" style="display:block;${innerStyle}">${content || '<br>'}</span></section>`;
  }

  function renderQuoteBlock(content) {
    return `<section data-ifanr-block="quote" data-ifanr-style-role="quote" style="${STYLE.quote}">${content || '<br>'}</section>`;
  }

  function safeHttpUrl(value = '') {
    const url = String(value || '').trim();
    return /^https?:\/\//i.test(url) ? url : '';
  }

  function renderRuns(runs = [], fallbackText = '') {
    if (!runs.length) return escapeHtml(fallbackText);
    return runs.map((run) => {
      let content = escapeHtml(run.text || '');
      if (!content) return '';
      if (run.bold) content = `<strong style="font-weight:600;">${content}</strong>`;
      if (run.italic) content = `<em>${content}</em>`;
      if (run.underline) content = `<span style="text-decoration:underline;">${content}</span>`;
      if (run.strike) content = `<span style="text-decoration:line-through;">${content}</span>`;
      const href = safeHttpUrl(run.link);
      if (href) content = `<a href="${escapeHtml(href)}" style="color:#576B95;text-decoration:none;">${content}</a>`;
      return content;
    }).join('');
  }

  function imageName(block, order, mime) {
    const token = String(block.image?.token || `image-${order}`).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48) || `image-${order}`;
    const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' })[mime] || 'bin';
    return `${String(order).padStart(2, '0')}-${token}.${extension}`;
  }

  function normalizedHeadingLevels(blocks) {
    return [...new Set(blocks
      .map((block) => String(block.type || '').match(/^heading([1-6])$/i))
      .filter(Boolean)
      .map((match) => Number(match[1])))]
      .sort((a, b) => a - b);
  }

  function semanticBlock(block, headingLevels, imageOrder) {
    const type = String(block.type || '').toLowerCase();
    const text = cleanText(block.text);
    const runs = Array.isArray(block.runs) ? block.runs.filter((run) => cleanText(run.text)) : [];
    const heading = type.match(/^heading([1-6])$/);
    if (heading && text) {
      const sourceLevel = Number(heading[1]);
      return { kind: 'heading', level: Math.min(4, sourceLevel), text, runs };
    }
    if (type === 'image') {
      const mime = String(block.image?.mime || '').toLowerCase();
      if (!block.image?.dataUri) {
        return {
          kind: 'image-placeholder',
          order: imageOrder,
          safeName: imageName(block, imageOrder, mime),
          sourceName: block.image?.sourceName || null,
          bytes: Number(block.image?.originalBytes || block.image?.bytes || 0),
          error: block.image?.downloadError || {
            code: 'image-source-unavailable',
            message: '飞书页面没有返回可读取的图片地址。'
          }
        };
      }
      const animated = mime === 'image/gif';
      const safeName = imageName(block, imageOrder, mime);
      return {
        kind: 'image',
        order: imageOrder,
        src: block.image.dataUri,
        alt: block.image.alt || '',
        animated,
        safeName,
        bytes: Number(block.image.bytes || 0),
        mime,
        width: Number(block.image.width || 0),
        height: Number(block.image.height || 0),
        token: block.image.token || null,
        sourceName: block.image.sourceName || null,
        animationUnverified: block.image.animationUnverified === true,
        isTitleImage: block.image.isTitleImage === true,
        brand: block.image.brand || null,
        originalBytes: Number(block.image.originalBytes || block.image.bytes || 0),
        originalMime: block.image.originalMime || mime,
        originalWidth: Number(block.image.originalWidth || block.image.width || 0),
        originalHeight: Number(block.image.originalHeight || block.image.height || 0),
        compression: block.image.compression || null
      };
    }
    if ((type === 'caption' || type.includes('caption') || block.caption === true) && text) return { kind: 'caption', text, runs };
    if (['quote', 'callout'].includes(type) && text) return { kind: 'quote', text, runs };
    if (['divider', 'horizontal_rule'].includes(type)) return { kind: 'divider' };
    if (['bullet', 'ordered', 'todo', 'task'].includes(type) && text) {
      return { kind: 'list-item', ordered: type === 'ordered', text: cleanListItemText(text) };
    }
    if (type === 'code' && text) return { kind: 'quote', text, runs };
    if (type === 'text' && block.listKind && text) {
      return { kind: 'list-item', ordered: block.listKind === 'ordered', text: cleanListItemText(text) };
    }
    if (type === 'text' && block.quote && text) return { kind: 'quote', text, runs };
    if (text) return { kind: 'paragraph', text, runs };
    return null;
  }

  function attachImageCaptions(blocks) {
    const output = [];
    for (const block of blocks) {
      const previous = output.at(-1);
      const caption = block?.kind === 'caption' || (block?.kind === 'paragraph' && looksLikeImageCaption(block.text));
      if (caption && ['image', 'image-placeholder'].includes(previous?.kind) && !previous.isTitleImage) {
        previous.caption = block.text;
        previous.captionRuns = block.runs;
        continue;
      }
      output.push(block);
    }
    return output;
  }

  function groupBlocks(blocks) {
    const output = [];
    const isArticleImage = (block) => ['image', 'image-placeholder'].includes(block?.kind) && !block?.isTitleImage;
    for (let index = 0; index < blocks.length;) {
      const current = blocks[index];
      if (current.kind === 'list-item') {
        let end = index;
        const items = [];
        while (blocks[end]?.kind === 'list-item' && blocks[end].ordered === current.ordered) {
          items.push(blocks[end].text);
          end += 1;
        }
        output.push({ kind: 'list', ordered: current.ordered, items });
        index = end;
        continue;
      }
      if (isArticleImage(current)) {
        let end = index;
        const images = [];
        while (isArticleImage(blocks[end])) {
          images.push(blocks[end]);
          end += 1;
        }
        output.push(images.length >= 2 ? { kind: 'gallery', images } : current);
        index = end;
        continue;
      }
      output.push(current);
      index += 1;
    }
    return output;
  }

  function renderCaption(image) {
    if (!image.caption) return '';
    return `<figcaption data-ifanr-block="caption" data-ifanr-style-role="caption" style="${STYLE.caption};padding-top:8px;">${renderRuns(image.captionRuns, image.caption)}</figcaption>`;
  }

  function renderImage(image, galleryItem = false, galleryIndex = 0) {
    const titleAttribute = image.isTitleImage ? ' data-ifanr-title-image="true"' : '';
    const titleBrandAttribute = image.isTitleImage && image.brand ? ` data-ifanr-title-brand="${escapeHtml(image.brand)}"` : '';
    const attributes = `data-ifanr-image-order="${image.order}" data-ifanr-image-kind="${image.animated ? 'gif' : 'static'}" data-media-name="${escapeHtml(image.safeName)}"${titleAttribute}${titleBrandAttribute}`;
    const imageHtml = `<img src="${image.src}" alt="${escapeHtml(image.alt)}" data-ifanr-image-order="${image.order}" data-ifanr-image-kind="${image.animated ? 'gif' : 'static'}" data-ifanr-media-name="${escapeHtml(image.safeName)}"${titleBrandAttribute} style="display:block;width:100%;height:auto;margin:0 auto;${image.isTitleImage ? 'border-radius:8px;' : ''}" />`;
    const captionHtml = renderCaption(image);
    return galleryItem
      ? `<figure data-ifanr-gallery-item="${galleryIndex + 1}" ${attributes} style="display:inline-block;width:86%;margin:0 10px 0 0;vertical-align:top;white-space:normal;scroll-snap-align:start;">${imageHtml}${captionHtml}</figure>`
      : `<figure data-ifanr-block="image" ${attributes} style="margin:${image.isTitleImage ? '0 0 24px' : captionHtml ? '24px 0 0' : '24px 0'};">${imageHtml}${captionHtml}</figure>`;
  }

  function renderImagePlaceholder(image, galleryItem = false) {
    const compressionRequired = /^STATIC_IMAGE_/.test(String(image.error?.code || ''));
    const copy = compressionRequired
      ? `第 ${image.order} 张静态图超过微信上限且无法高质量压缩，请在这里手动补图`
      : `第 ${image.order} 张图片暂时无法读取，请在这里手动补图`;
    const marker = `<section data-ifanr-manual-image-placeholder="true" data-ifanr-image-order="${image.order}" style="margin:0;padding:18px 16px;border:1px solid #FD4606;background:#FFF4EE;color:#FD4606;font-size:14px;font-family:&quot;PingFang SC&quot;,-apple-system,BlinkMacSystemFont,&quot;Microsoft YaHei&quot;,sans-serif;line-height:1.7;text-align:center;box-sizing:border-box;">${copy}</section>`;
    const caption = renderCaption(image);
    return galleryItem
      ? `<figure data-ifanr-gallery-item="placeholder" data-ifanr-image-order="${image.order}" style="display:inline-block;width:86%;margin:0 10px 0 0;vertical-align:top;white-space:normal;scroll-snap-align:start;">${marker}${caption}</figure>`
      : `<figure data-ifanr-block="image-placeholder" data-ifanr-image-order="${image.order}" style="margin:${caption ? '24px 0 0' : '24px 0'};">${marker}${caption}</figure>`;
  }

  function renderSemanticBlock(block) {
    if (block.kind === 'heading') {
      const style = STYLE[`heading${block.level}`] || STYLE.heading4;
      return `<h3 data-ifanr-block="heading" data-ifanr-style-role="heading-${block.level}" data-ifanr-heading-level="${block.level}" style="${style};">${renderRuns(block.runs, block.text)}</h3>`;
    }
    if (block.kind === 'paragraph') return renderTextBlock({ blockType: 'paragraph', role: 'body', style: STYLE.body, content: renderRuns(block.runs, block.text) });
    if (block.kind === 'caption') return renderTextBlock({ blockType: 'caption', role: 'caption', style: STYLE.caption, content: renderRuns(block.runs, block.text) });
    if (block.kind === 'quote') return renderQuoteBlock(renderRuns(block.runs, block.text));
    if (block.kind === 'divider') return '<hr data-ifanr-block="divider" style="margin:28px auto;border:0;border-top:1px solid #E8E8E8;" />';
    if (block.kind === 'image') return renderImage(block);
    if (block.kind === 'image-placeholder') return renderImagePlaceholder(block);
    if (block.kind === 'gallery') {
      const gallery = `<section data-ifanr-block="gallery" data-ifanr-gallery-count="${block.images.length}" style="margin:0;padding:0 16px;overflow-x:auto;overflow-y:hidden;white-space:nowrap;-webkit-overflow-scrolling:touch;scroll-snap-type:x mandatory;box-sizing:border-box;">${block.images.map((image, index) => image.kind === 'image-placeholder' ? renderImagePlaceholder(image, true) : renderImage(image, true, index)).join('')}</section>`;
      const hint = '<p data-ifanr-gallery-hint="true" style="margin:8px 16px 24px;color:#FD4606;font-size:12px;font-family:&quot;PingFangSC-Light&quot;,&quot;PingFang SC&quot;,-apple-system,BlinkMacSystemFont,&quot;Microsoft YaHei&quot;,sans-serif;font-weight:300;line-height:1.6;text-align:left;">滑动查看样片&nbsp;→</p>';
      return `${gallery}${hint}`;
    }
    if (block.kind === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag} data-ifanr-block="list" style="${STYLE.list}">${block.items.map((item) => `<li style="margin:0 0 8px;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;word-break:break-word;"><span data-ifanr-style-role="body" style="${typographyOnly(STYLE.body)}">${escapeHtml(item)}</span></li>`).join('')}</${tag}>`;
    }
    return '';
  }

  function buildFixture({ title, sourceUrl, blocks = [], titleImage = null, titleImageSelection = null, generatedAt = new Date().toISOString(), capture = {} }) {
    const titleBrand = titleImage?.brand || titleImageSelection?.brand || 'ifanr';
    const brandDefaults = titleBrand === 'appso'
      ? { token: 'appso-inspiration-guide', sourceName: 'appso-inspiration-guide.gif', alt: 'AppSo 灵感指南' }
      : { token: 'ifanr-discover-the-next', sourceName: 'ifanr-discover-the-next.gif', alt: 'DISCOVER THE NEXT' };
    const titleBlock = titleImage?.dataUri ? {
      id: `${titleBrand}-title-image`,
      order: -1,
      type: 'image',
      image: {
        ...titleImage,
        token: titleImage.token || brandDefaults.token,
        sourceName: titleImage.sourceName || brandDefaults.sourceName,
        alt: titleImage.alt || brandDefaults.alt,
        brand: titleBrand,
        isTitleImage: true
      }
    } : null;
    const ordered = [...(titleBlock ? [titleBlock] : []), ...blocks]
      .sort((a, b) => Number(a.order || a.id || 0) - Number(b.order || b.id || 0));
    const supportedTypes = new Set([
      'text', 'image', 'quote', 'callout', 'divider', 'horizontal_rule',
      'bullet', 'ordered', 'todo', 'task', 'code',
      'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6',
      'caption', 'image_caption', 'image-caption'
    ]);
    const contentWarnings = ordered
      .filter((block) => {
        const type = String(block.type || '').toLowerCase();
        return type && !supportedTypes.has(type) && cleanText(block.text);
      })
      .map((block) => ({
        code: 'special-block-flattened',
        order: Number(block.order || block.captureSequence || 0),
        blockType: String(block.type || 'unknown'),
        message: '特殊飞书内容块已转为普通段落，请在微信草稿中抽检。'
      }));
    const headingLevels = normalizedHeadingLevels(ordered);
    let imageOrder = 0;
    const semantic = attachImageCaptions(ordered.map((block) => {
      if (String(block.type).toLowerCase() === 'image') imageOrder += 1;
      return semanticBlock(block, headingLevels, imageOrder);
    }).filter(Boolean));
    const grouped = groupBlocks(semantic);
    const sourceArticleImageCount = blocks.filter((block) => String(block.type || '').toLowerCase() === 'image').length;
    const images = semantic.filter((block) => block.kind === 'image');
    const imagePlaceholders = semantic.filter((block) => block.kind === 'image-placeholder');
    const textCandidates = semantic.flatMap((block) => [
      ...(['heading', 'paragraph', 'caption', 'quote', 'list-item'].includes(block.kind) ? [block.text] : []),
      ...(['image', 'image-placeholder'].includes(block.kind) && block.caption ? [block.caption] : [])
    ]).filter(Boolean);
    const paragraphCandidates = semantic.filter((block) => block.kind === 'paragraph').map((block) => block.text);
    const fallbackSummaryCandidates = semantic.filter((block) => ['quote', 'list-item'].includes(block.kind)).map((block) => block.text);
    const sourceText = normalizedFidelityText(ordered
      .filter((block) => !['image', 'divider', 'horizontal_rule'].includes(String(block.type || '').toLowerCase()))
      .map((block) => block.text));
    const renderedText = normalizedFidelityText(textCandidates);
    const gifWarnings = images
      .filter((image) => image.animated && image.bytes > WECHAT_IMAGE_MAX_BYTES)
      .map((image) => ({
        order: image.order,
        name: image.safeName,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        reasons: ['wechat-size-limit'],
        recommendations: ['当前文件超过微信 5MB 硬上限，请手动压缩或替换后再补入。'],
        target: { maxBytes: WECHAT_IMAGE_MAX_BYTES }
      }));
    const mediaWarnings = [
      ...images
        .filter((image) => !image.animated && image.bytes > WECHAT_IMAGE_MAX_BYTES)
        .map((image) => ({
          code: 'wechat-size-limit',
          order: image.order,
          name: image.safeName,
          bytes: image.bytes,
          message: '静态图片超过微信 5MB 上限，需要压缩后再写入。'
        })),
      ...images
        .filter((image) => image.animationUnverified)
        .map((image) => ({
          code: 'animation-unverified',
          order: image.order,
          name: image.sourceName || image.safeName,
          bytes: image.bytes,
          message: '飞书页面返回了动图静态封面，无法确认原动画是否完整。'
        })),
      ...imagePlaceholders.map((image) => ({
        code: image.error?.code || 'image-source-unavailable',
        order: image.order,
        name: image.sourceName || image.safeName,
        detail: image.error?.detail || null,
        bytes: image.bytes,
        reasons: ['download-failed'],
        recommendations: /^STATIC_IMAGE_/.test(String(image.error?.code || ''))
          ? ['请在图片工具中手动压缩到 5MB 以内，并保持原始长宽比；随后在正文橙色标记处替换。']
          : ['请确认飞书图片已经加载完成并重新收录；仍失败时可在正文标记处手动补图。'],
        message: image.error?.message || '这张图片暂时无法读取，已在正文原位置保留补图标记。'
      }))
    ];
    const html = `<section data-ifanr-template="default" data-ifanr-source="feishu-page" style="max-width:100%;box-sizing:border-box;">${grouped.map(renderSemanticBlock).join('')}</section>`;
    const mediaManifest = images.map((image) => ({
      order: image.order,
      originalName: image.safeName,
      safeName: image.safeName,
      mime: image.mime,
      width: image.width,
      height: image.height,
      inputBytes: image.bytes,
      outputBytes: image.bytes,
      originalBytes: image.originalBytes,
      originalMime: image.originalMime,
      originalWidth: image.originalWidth,
      originalHeight: image.originalHeight,
      animated: image.animated,
      sourceName: image.sourceName,
      animationVerified: image.animated || !image.animationUnverified,
      withinWechatLimit: image.bytes <= WECHAT_IMAGE_MAX_BYTES,
      decision: image.compression?.decision || 'browser-session-original',
      compression: image.compression
    }));
    return {
      title: cleanText(title) || '未命名飞书文档',
      summary: firstCompleteSentence(selectSummaryText(paragraphCandidates.length ? paragraphCandidates : fallbackSummaryCandidates)),
      html,
      semanticBlocks: semantic,
      rawBlocks: blocks,
      groupedBlocks: grouped,
      blockCount: grouped.length,
      imageCount: images.length,
      galleryCount: grouped.filter((block) => block.kind === 'gallery').length,
      galleryMode: 'automatic',
      titleImageBrand: titleBrand,
      titleImageLabel: titleImage?.brandLabel || (titleBrand === 'appso' ? 'AppSo' : '爱范儿'),
      titleImagePreference: titleImageSelection?.preference || titleBrand,
      titleImageSelection: titleImageSelection || {
        brand: titleBrand,
        preference: titleBrand,
        mode: 'manual',
        reason: 'provided-title-image',
        score: null,
        signals: []
      },
      imageMimes: [...new Set(mediaManifest.map((item) => item.mime).filter(Boolean))],
      expectedTextContains: (textCandidates.find((text) => text.length >= 8) || cleanText(title)).slice(0, 28),
      payloadMegabytes: Number((new Blob([html]).size / 1024 / 1024).toFixed(2)),
      mediaManifest,
      compressedStaticImageCount: mediaManifest.filter((item) => item.compression?.compressed === true).length,
      gifWarnings,
      mediaWarnings,
      contentWarnings,
      textFidelity: {
        confirmed: sourceText === renderedText,
        sourceCharCount: sourceText.length,
        renderedCharCount: renderedText.length,
        sourceHash: textFingerprint(sourceText),
        renderedHash: textFingerprint(renderedText)
      },
      imageFidelity: {
        confirmed: sourceArticleImageCount === (images.filter((image) => !image.isTitleImage).length + imagePlaceholders.length),
        sourceImageCount: sourceArticleImageCount,
        renderedImageCount: images.filter((image) => !image.isTitleImage).length,
        placeholderCount: imagePlaceholders.length,
        accountedImageCount: images.filter((image) => !image.isTitleImage).length + imagePlaceholders.length
      },
      gifQualityOverride: false,
      sourceRevision: null,
      sourceUrl,
      styleVersion: 'ifanr-wechat-compatible-v9-browser',
      readerMode: 'browser-session',
      capture,
      generatedAt
    };
  }

  global.IFANR_FEISHU_PAGE_READER = Object.freeze({
    WECHAT_IMAGE_MAX_BYTES,
    STYLE,
      buildFixture,
      cleanText,
      cleanListItemText,
      firstCompleteSentence,
      selectSummaryText,
    escapeHtml,
    renderRuns
  });
})(globalThis);
