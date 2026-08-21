/**
 * lark2pad-converter.js
 * LiquidConvert / Lark2Pad 原生转换核心 (100% 对齐 EtherpadExporter.swift 与 Turndown 规则)
 */
(function (global) {
  'use strict';

  const DEFAULT_HEADER_BANNER_GIF = 'https://mmbiz.qpic.cn/mmbiz_gif/fc90sFPPBCMNz9EtBfUDyjCYbZMtTTBiaUAWvglz5a8etUicmQFMtJn68NOxWbdRBgPTn3ic4tbT1MwKfzoV1P7m36Kmtm8QiaPQHr5jLkqa2Dw/640?wx_fmt=gif&from=appmsg';
  const APPSO_HEADER_BANNER_GIF = 'https://mmbiz.qpic.cn/sz_mmbiz_gif/fc90sFPPBCOWvNq34l9yiaWic07yZqJb0g4EiaicrD254vCibxKibWn09bY992cE1oiaZ5v7z2c6k4c/640?wx_fmt=gif&from=appmsg';
  const ETHERPAD_HEADER_BANNER_PNG = 'https://s3.ifanr.com/images/ep/uploads/lark2pad_upload/4eab7d0a-39f1-41ae-b014-ae2163db4c4c.png';
  const ETHERPAD_FOOTER_BANNER_PNG = 'https://s3.ifanr.com/images/ep/uploads/lark2pad_upload/2a4b3d7f-2b5e-4c3e-8219-53e7f45eb0a2.png';

  const WECHAT_FOOTER_IMAGES_HTML = `
<p style="white-space: normal;margin: 0px;padding: 0px;box-sizing: border-box;"><span leaf=""></span></p>
<section style="text-align: center;line-height: 0;box-sizing: border-box;"><section style="max-width: 100%;vertical-align: middle;display: inline-block;line-height: 0;box-sizing: border-box;" nodeleaf=""><img src="https://mmbiz.qpic.cn/sz_mmbiz_png/fc90sFPPBCO5sTlJseFUfia8Hu5P9EWwc4YHFvbFXrYWWDVxISzy2Vl3HGU4ibnqLPR6U8BgFRGxhS86OwDH6OCMnIDr4UnyEhYy6dTib2qiaBA/640?wx_fmt=png" data-src="https://mmbiz.qpic.cn/sz_mmbiz_png/fc90sFPPBCO5sTlJseFUfia8Hu5P9EWwc4YHFvbFXrYWWDVxISzy2Vl3HGU4ibnqLPR6U8BgFRGxhS86OwDH6OCMnIDr4UnyEhYy6dTib2qiaBA/640?wx_fmt=png" class="rich_pages wxw-img" data-ratio="0.05804" data-s="300,640" data-w="1051" data-type="png" style="vertical-align:middle;max-width:100%;width:100%;box-sizing:border-box;" width="100%"></section></section>
<p style="white-space: normal;margin: 0px;padding: 0px;box-sizing: border-box;"><span leaf=""></span></p>
<p style="white-space: normal;margin: 0px;padding: 0px;box-sizing: border-box;"><span leaf=""></span></p>
<section style="text-align: left;justify-content: flex-start;display: flex;flex-flow: row;box-sizing: border-box;"><section style="display: inline-block;width: 100%;vertical-align: top;align-self: flex-start;flex: 0 0 auto;background-repeat: repeat;background-attachment: scroll;border-radius: 10px;overflow: hidden;background-image: url(&quot;https://mmbiz.qpic.cn/mmbiz_png/fc90sFPPBCMRTjiay36FKj1KwiaibBpEPbK583nGuBnJjNNeR13rq3IA6sia1fzibcJKicGLZcIfTOVU00ATFq7mmDMSKd18TqTmZzT7EmGykuQbk/640?wx_fmt=png&quot;);box-sizing: border-box;background-position: 0% 0% !important;background-size: auto !important;"><section style="justify-content: flex-start;display: flex;flex-flow: row;margin: 50px 0px 0px;box-sizing: border-box;"><section style="display: inline-block;width: 100%;vertical-align: top;align-self: flex-start;flex: 0 0 auto;box-sizing: border-box;"><section style="text-align: center;line-height: 0;box-sizing: border-box;"><section style="max-width: 100%;vertical-align: middle;display: inline-block;line-height: 0;box-sizing: border-box;" nodeleaf=""><img src="https://mmbiz.qpic.cn/sz_mmbiz_png/fc90sFPPBCP8MG80wljJC4cT2s8YibQ2t5hoaVEAoIZ8ftGmllAI5ehMD28ExTwBdfsibfyOqZBmTyjhrdXklbqcCa3CeMiaAXdeyzjKY11lIE/640?wx_fmt=png" data-src="https://mmbiz.qpic.cn/sz_mmbiz_png/fc90sFPPBCP8MG80wljJC4cT2s8YibQ2t5hoaVEAoIZ8ftGmllAI5ehMD28ExTwBdfsibfyOqZBmTyjhrdXklbqcCa3CeMiaAXdeyzjKY11lIE/640?wx_fmt=png" class="rich_pages wxw-img" data-ratio="0.6003805899143673" data-s="300,640" data-w="1051" data-type="png" style="vertical-align: middle;max-width: 100%;width: 100%;box-sizing: border-box;"></section></section></section></section><section style="justify-content: flex-start;display: flex;flex-flow: row;box-sizing: border-box;"><section style="display: inline-block;width: 100%;vertical-align: top;align-self: flex-start;flex: 0 0 auto;box-sizing: border-box;"><section style="text-align: center;line-height: 0;box-sizing: border-box;"><section style="max-width: 100%;vertical-align: middle;display: inline-block;line-height: 0;box-sizing: border-box;"><a href="https://mp.weixin.qq.com/s?__biz=MjgzMTAwODI0MA==&amp;mid=2652396877&amp;idx=2&amp;sn=dfef25453a6bf0dca147b0adca3deaf7&amp;scene=21#wechat_redirect" target="_blank"><span style="width:100%" class="js_jump_icon h5_image_link"><img src="https://mmbiz.qpic.cn/sz_mmbiz_png/fc90sFPPBCPyDFWbJT8y9ibibmFbtvMJbwHxCAZQskte81K91q7QwkwXPevnDR7bvHUD9ntPN43bDibM6svwxrCkBaVruzvjKVBLnTwJYk5pOk/640?wx_fmt=png" data-src="https://mmbiz.qpic.cn/sz_mmbiz_png/fc90sFPPBCPyDFWbJT8y9ibibmFbtvMJbwHxCAZQskte81K91q7QwkwXPevnDR7bvHUD9ntPN43bDibM6svwxrCkBaVruzvjKVBLnTwJYk5pOk/640?wx_fmt=png" class="rich_pages wxw-img" data-ratio="0.14367269267364416" data-s="300,640" data-w="1051" data-type="png" style="vertical-align: middle;max-width: 100%;width: 100%;box-sizing: border-box;"></span></a></section></section><section style="text-align: justify;box-sizing: border-box;"><p style="white-space: normal;margin: 0px;padding: 0px;box-sizing: border-box;"></p></section></section></section></section></section>
<p style="white-space: normal;margin: 0px;padding: 0px;box-sizing: border-box;"><span leaf=""></span></p>
<section style="text-align: center;line-height: 0;box-sizing: border-box;margin-top: 16px;"><section style="max-width: 100%;vertical-align: middle;display: inline-block;line-height: 0;border-radius: 10px;overflow: hidden;box-sizing: border-box;" nodeleaf=""><img src="https://mmbiz.qpic.cn/mmbiz_png/fc90sFPPBCNnChuCqY5TK78KORbHN3ficOaIgpjRfNqQWMJqRxxNGpMb2Om3ebIfpJGIs7nfu2WrCYzYjLkH6qicYms1ibfJbFujmoNFYaavpw/640?wx_fmt=png" data-src="https://mmbiz.qpic.cn/mmbiz_png/fc90sFPPBCNnChuCqY5TK78KORbHN3ficOaIgpjRfNqQWMJqRxxNGpMb2Om3ebIfpJGIs7nfu2WrCYzYjLkH6qicYms1ibfJbFujmoNFYaavpw/640?wx_fmt=png" class="rich_pages wxw-img" data-ratio="1.3333333333333333" data-s="300,640" data-w="1080" data-type="png" style="vertical-align: middle;max-width: 100%;width: 100%;box-sizing: border-box;"></section></section>
`.trim();

  const WECHAT_FOOTER_BANNER_HTML = `
<p style="margin-left: 16px;margin-right: 16px;margin-bottom: 0px;"><span style="color: rgba(0, 0, 0, 0.9);font-size: 12px;font-weight: bold;font-family: mp-quote, &quot;PingFang SC&quot;, system-ui, -apple-system, BlinkMacSystemFont, &quot;Helvetica Neue&quot;, &quot;Hiragino Sans GB&quot;, &quot;Microsoft YaHei UI&quot;, &quot;Microsoft YaHei&quot;, Arial, sans-serif;line-height: 1.6;letter-spacing: 0.034em;">作者｜ifanr</span></p>
<p style="margin-left: 16px;margin-right: 16px;margin-bottom: 24px;"><span style="color: rgba(0, 0, 0, 0.9);font-size: 12px;font-weight: bold;font-family: mp-quote, &quot;PingFang SC&quot;, system-ui, -apple-system, BlinkMacSystemFont, &quot;Helvetica Neue&quot;, &quot;Hiragino Sans GB&quot;, &quot;Microsoft YaHei UI&quot;, &quot;Microsoft YaHei&quot;, Arial, sans-serif;line-height: 1.6;letter-spacing: 0.034em;">编辑｜ifanr</span></p>
${WECHAT_FOOTER_IMAGES_HTML}
`.trim();

  function escapeHtml(text = '') {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function isWeChatOfficialUrl(url = '') {
    const lower = String(url).toLowerCase();
    return lower.includes('qpic.cn') || lower.includes('weixin.qq.com');
  }

  const META_PREFIXES = ['作者', '编辑', '声明', '题图', '插图', '封面', '策划', '排版', '免责声明', '文', '注'];

  function isArticleMetaLine(text = '') {
    const trimmed = String(text).trim();
    for (const prefix of META_PREFIXES) {
      if (
        trimmed.startsWith(`${prefix}｜`) ||
        trimmed.startsWith(`${prefix}|`) ||
        trimmed.startsWith(`${prefix}：`) ||
        trimmed.startsWith(`${prefix}:`)
      ) {
        return true;
      }
    }
    return false;
  }

  function hasNextArticleMetaLine(index, lines) {
    let nextIdx = index + 1;
    while (nextIdx < lines.length) {
      const candidate = String(lines[nextIdx] || '').trim();
      if (!candidate) {
        nextIdx++;
        continue;
      }
      return isArticleMetaLine(candidate);
    }
    return false;
  }

  function isCaptionText(text = '') {
    const trimmed = String(text).trim();
    if (trimmed.startsWith('▲') || trimmed.startsWith('△') || trimmed.startsWith('▼') || trimmed.startsWith('▽')) {
      return true;
    }
    if (trimmed.startsWith('图') || trimmed.startsWith('注')) {
      const afterPrefix = trimmed.slice(1).trim();
      if (afterPrefix.length > 0) {
        const firstChar = afterPrefix[0];
        return firstChar === '｜' || firstChar === '|' || firstChar === '：' || firstChar === ':';
      }
    }
    if (/^(?:图片来源|摄影|照片|photo|image|source)\s*(?:[|｜:：]|by\b)/i.test(trimmed)) {
      return true;
    }
    return false;
  }

  function normalizeCaptionText(text = '') {
    const trimmed = String(text).trim();
    guardCaption: {
      if (!isCaptionText(trimmed)) break guardCaption;
      if (trimmed.startsWith('▲') || trimmed.startsWith('△') || trimmed.startsWith('▼') || trimmed.startsWith('▽')) {
        return trimmed;
      }
      if (trimmed.startsWith('图') || trimmed.startsWith('注')) {
        const afterPrefix = trimmed.slice(1).trim();
        if (afterPrefix.length > 0) {
          const content = afterPrefix.slice(1).trim();
          return `图｜${content}`;
        }
      }
    }
    return trimmed;
  }

  function hasNextCaptionLine(index, lines) {
    let nextIdx = index + 1;
    while (nextIdx < lines.length) {
      const candidate = String(lines[nextIdx] || '').trim();
      if (!candidate) {
        nextIdx++;
        continue;
      }
      return isCaptionText(candidate);
    }
    return false;
  }

  function parseHeaderWithLevel(line = '') {
    const trimmed = line.trim();
    for (let i = 6; i >= 1; i--) {
      const hashes = '#'.repeat(i);
      const prefix = hashes + ' ';
      if (trimmed.startsWith(prefix)) {
        return { level: i, content: trimmed.slice(prefix.length).trim() };
      }
    }
    return null;
  }

  function parseStandaloneImage(line = '', imgRadius = '6px', hasCaption = false) {
    const trimmed = line.trim();
    // 1. Markdown image: ![alt](url)
    const mdMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (mdMatch) {
      const alt = escapeHtml(mdMatch[1]);
      const url = mdMatch[2];
      const isOfficial = isWeChatOfficialUrl(url);
      const dataSrcAttr = isOfficial ? ` data-src="${escapeHtml(url)}"` : '';
      const imgClass = isOfficial ? ' class="rich_pages wxw-img"' : '';
      const marginStyle = hasCaption ? 'margin: 30px 0 0 0;' : 'margin: 30px 0 26px 0;';
      const wrapperStyle = `padding: 0 14px; ${marginStyle} text-align: center; box-sizing: border-box;`;
      const imgStyle = `width: 100%; max-width: 100%; height: auto; display: block; margin: 0 auto; border-radius: ${imgRadius};`;
      return `<section style="${wrapperStyle}" data-type="custom-block"><img src="${escapeHtml(url)}"${dataSrcAttr}${imgClass} alt="${alt}" style="${imgStyle}" /></section>`;
    }
    // 2. HTML <img> tag
    if (trimmed.startsWith('<img') || trimmed.startsWith('<figure') || (trimmed.startsWith('<p') && trimmed.includes('<img'))) {
      const srcMatch = trimmed.match(/src=["']([^"']+)["']/i);
      if (srcMatch) {
        const url = srcMatch[1];
        const isOfficial = isWeChatOfficialUrl(url);
        const dataSrcAttr = isOfficial ? ` data-src="${escapeHtml(url)}"` : '';
        const imgClass = isOfficial ? ' class="rich_pages wxw-img"' : '';
        const marginStyle = hasCaption ? 'margin: 30px 0 0 0;' : 'margin: 30px 0 26px 0;';
        const wrapperStyle = `padding: 0 14px; ${marginStyle} text-align: center; box-sizing: border-box;`;
        const imgStyle = `width: 100%; max-width: 100%; height: auto; display: block; margin: 0 auto; border-radius: ${imgRadius};`;
        return `<section style="${wrapperStyle}" data-type="custom-block"><img src="${escapeHtml(url)}"${dataSrcAttr}${imgClass} style="${imgStyle}" /></section>`;
      }
    }
    return null;
  }

  function parseWeChatInline(text = '', imgRadius = '6px') {
    let result = escapeHtml(text);
    // Bold: **text**
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:600;">$1</strong>');
    // Italic: *text*
    result = result.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
    // Strikethrough: ~~text~~
    result = result.replace(/~~(.+?)~~/g, '<span style="text-decoration:line-through;">$1</span>');
    // Link: [text](url)
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#576B95;text-decoration:none;">$1</a>');
    return result;
  }

  function parseInline(text = '') {
    let result = text;
    // Images: ![alt](url) -> <img>
    result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" name="$1">');
    // Links: [text](url) -> <a>
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // Bold: **text**
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic: *text*
    result = result.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
    return result;
  }

  /**
   * 将 Markdown 转换为微信公众号标准 HTML (与 EtherpadExporter.swift markdownToWeChatHTML 100% 对齐)
   */
  function markdownToWeChatHTML(markdown = '', options = {}) {
    const {
      brand = 'ifanr',
      roundImages = true,
      addHeaderBanner = true,
      addFooterBanner = true
    } = options;

    const imgRadius = roundImages ? '8px' : '0px';
    const lines = String(markdown)
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .split('\n');

    let result = '';

    // 1. 顶部 Banner
    if (addHeaderBanner) {
      const bannerUrl = brand === 'appso' ? APPSO_HEADER_BANNER_GIF : DEFAULT_HEADER_BANNER_GIF;
      result += `<section style="text-align: left;justify-content: flex-start;display: flex;flex-flow: row;margin: 0px 0px 24px 0px;width: 100%;align-self: flex-start;background-color: rgb(255, 113, 20);border-radius: 10px;overflow: hidden;box-sizing: border-box;"><section style="text-align: center;line-height: 0;width: 100%;box-sizing: border-box;"><section style="max-width: 100%;vertical-align: middle;display: inline-block;line-height: 0;box-sizing: border-box;"><img src="${bannerUrl}" data-src="${bannerUrl}" class="rich_pages wxw-img" data-ratio="0.5333333333333333" data-type="gif" data-w="720" style="vertical-align: middle;max-width: 100%;width: 100%;box-sizing: border-box;"></section></section></section>\n`;
    }

    const pStyle = 'margin: 26px 0; padding: 0 14px; font-size: 15px; color: #222222; text-align: justify; line-height: 27px; word-break: break-all; word-wrap: break-word; font-family: &quot;PingFangSC-Light&quot;, &quot;PingFang SC&quot;, -apple-system, BlinkMacSystemFont, sans-serif;';
    const bqStyle = 'padding: 0 15px; border-left: 4px solid #D8D8D8; padding-left: 14px; font-family: &quot;PingFangSC-Light&quot;, sans-serif; font-weight: 600; font-size: 15px; color: #222222; text-align: justify; line-height: 27px; margin: 26px 0;';

    let inList = false;
    const hasMetaInMarkdown = lines.some((l) => isArticleMetaLine(l));

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        if (inList) {
          result += '</section>\n';
          inList = false;
        }
        i++;
        continue;
      }

      // 列表处理
      const isListItem = trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('▪ ') || trimmed.startsWith('• ') || trimmed.startsWith('■ ');
      if (isListItem) {
        if (!inList) {
          result += '<section style="margin: 32px 0; padding: 0 11px;">\n';
          inList = true;
        }
        let rawText = trimmed;
        if (rawText.startsWith('- ') || rawText.startsWith('* ') || rawText.startsWith('▪ ') || rawText.startsWith('• ') || rawText.startsWith('■ ')) {
          rawText = rawText.slice(2);
        }
        const content = parseWeChatInline(rawText, imgRadius);
        const itemStyle = 'display: flex; margin-bottom: 8px; font-family: &quot;PingFangSC-Light&quot;; font-size: 15px; color: #363636; letter-spacing: 0; text-align: justify; line-height: 27px;';
        const dotStyle = 'margin-top: 10px; margin-right: 12px; width: 6px; height: 6px; background: #363636; flex-shrink: 0;';
        result += `<section style="${itemStyle}"><section style="${dotStyle}"></section><section style="flex: 1;">${content}</section></section>\n`;
        i++;
        continue;
      } else if (inList) {
        result += '</section>\n';
        inList = false;
      }

      // 单张图片处理
      const hasCaption = hasNextCaptionLine(i, lines);
      const imgSection = parseStandaloneImage(trimmed, imgRadius, hasCaption);
      if (imgSection) {
        result += `${imgSection}\n`;
        i++;
        continue;
      }

      // 图注处理
      if (isCaptionText(trimmed)) {
        const caption = normalizeCaptionText(trimmed);
        const content = parseWeChatInline(caption, imgRadius);
        const captionStyle = 'display: inline-block; width: 100%; font-family: &quot;PingFang SC&quot;, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; font-weight: 400; font-size: 12px; color: rgb(167, 167, 167); letter-spacing: 0px; text-align: left; margin-left: 16px; margin-right: 16px; margin-bottom: 24px; box-sizing: border-box;';
        result += `<section style="${captionStyle}" data-type="custom-block">${content}</section>\n`;
        i++;
        continue;
      }

      // 标题处理 (H1 ~ H4)
      const header = parseHeaderWithLevel(trimmed);
      if (header) {
        const { level, content: rawContent } = header;
        let content = rawContent;
        if (content.startsWith('**') && content.endsWith('**') && content.length > 4) {
          content = content.slice(2, -2).trim();
        }

        let fontSize = '18px';
        let lineHeight = '26px';
        let margin = '42px 0 22px 0';
        if (level === 1) {
          fontSize = '24px';
          lineHeight = '32px';
          margin = '62px 0 26px 0';
        } else if (level === 2) {
          fontSize = '22px';
          lineHeight = '30px';
          margin = '62px 0 26px 0';
        } else if (level === 3) {
          fontSize = '20px';
          lineHeight = '28px';
          margin = '62px 0 26px 0';
        }

        const inlineContent = parseWeChatInline(content, imgRadius);
        const hStyle = `font-family: &quot;PingFangSC-Semibold&quot;; font-weight: 600; color: #FD4606; text-align: justify; line-height: ${lineHeight}; margin: ${margin}; padding: 0 14px; font-size: ${fontSize};`;
        result += `<h3 style="${hStyle}">${inlineContent}</h3>\n`;
        i++;
        continue;
      }

      // Callout 块
      const lowerTrimmed = trimmed.toLowerCase();
      if (lowerTrimmed.startsWith('<section data-type="callout"') || lowerTrimmed.startsWith('<callout')) {
        const endTag = lowerTrimmed.startsWith('<callout') ? '</callout>' : '</section>';
        const calloutLines = [];
        let subIdx = i;
        while (subIdx < lines.length) {
          const cur = lines[subIdx];
          const curLower = cur.trim().toLowerCase();
          const cleaned = cur
            .replace(/<section data-type="callout">/gi, '')
            .replace(/<\/section>/gi, '')
            .replace(/<callout>/gi, '')
            .replace(/<\/callout>/gi, '')
            .trim();
          if (cleaned) calloutLines.push(cleaned);
          if (curLower.includes(endTag)) {
            subIdx++;
            break;
          }
          subIdx++;
        }
        if (calloutLines.length) {
          const innerSections = calloutLines
            .map((cLine) => `<section style="margin-bottom: 16px;"><span>${parseWeChatInline(cLine, imgRadius)}</span></section>`)
            .join('\n');
          result += `<section style="margin-bottom: 46px; padding: 24px 15px 8px; font-size: 14px; line-height: 28px; background: rgb(248, 248, 248); color: rgb(105, 105, 105); border-radius: 12px; text-align: justify;" data-type="custom-block">\n${innerSections}\n</section>\n`;
          i = subIdx;
          continue;
        }
      }

      // 引用块 (> ...)
      if (trimmed.startsWith('> ')) {
        const content = parseWeChatInline(trimmed.slice(2), imgRadius);
        result += `<section style="${bqStyle}">${content}</section>\n`;
        i++;
        continue;
      }

      // 文章尾部 Meta 信息行 (作者/编辑/声明/题图等)
      if (isArticleMetaLine(trimmed)) {
        const content = parseWeChatInline(trimmed, imgRadius);
        const hasNextMeta = hasNextArticleMetaLine(i, lines);
        const marginBottom = hasNextMeta ? '0px' : '24px';
        const authorStyle = `margin-left: 16px;margin-right: 16px;margin-bottom: ${marginBottom};`;
        const spanStyle = 'color: rgba(0, 0, 0, 0.9);font-size: 12px;font-weight: bold;font-family: mp-quote, &quot;PingFang SC&quot;, system-ui, -apple-system, BlinkMacSystemFont, &quot;Helvetica Neue&quot;, &quot;Hiragino Sans GB&quot;, &quot;Microsoft YaHei UI&quot;, &quot;Microsoft YaHei&quot;, Arial, sans-serif;line-height: 1.6;letter-spacing: 0.034em;';
        result += `<p style="${authorStyle}"><span style="${spanStyle}">${content}</span></p>\n`;
        i++;
        continue;
      }

      // 普通正文段落
      const content = parseWeChatInline(line, imgRadius);
      result += `<section style="${pStyle}">${content}</section>\n`;
      i++;
    }

    if (inList) {
      result += '</section>\n';
      inList = false;
    }

    // 底部 Banner 与素材
    if (addFooterBanner) {
      if (hasMetaInMarkdown) {
        result += `${WECHAT_FOOTER_IMAGES_HTML}\n`;
      } else {
        result += `${WECHAT_FOOTER_BANNER_HTML}\n`;
      }
    }

    return result.trim();
  }

  /**
  * 将 Markdown 转换为标准 Etherpad (Pad) HTML (与 Lark2Pad 官方导出 100% 对齐)
  */
  function markdownToEtherpadHTML(markdown = '', options = {}) {
    const {
      addHeaderBanner = true,
      addFooterBanner = true
    } = options;

    const rawLines = String(markdown)
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .split('\n');

    let body = '';
    let lastImageSrc = '';

    if (addHeaderBanner) {
      body += `<img src="${ETHERPAD_HEADER_BANNER_PNG}"><br>\n`;
      lastImageSrc = ETHERPAD_HEADER_BANNER_PNG;
    }

    let i = 0;
    while (i < rawLines.length) {
      const line = rawLines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        body += '<br>\n';
        i++;
        continue;
      }

      // 检查是否为独立图片行
      const mdMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      const imgTagMatch = trimmed.match(/^<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/i);

      if (mdMatch || imgTagMatch) {
        const url = mdMatch ? mdMatch[2] : imgTagMatch[1];
        const alt = mdMatch ? mdMatch[1] : '';
        const cleanSrc = url.split('?')[0];

        // 图片防重复：跳过连续相同的图片
        if (cleanSrc && cleanSrc === lastImageSrc) {
          i++;
          continue;
        }
        if (cleanSrc) {
          lastImageSrc = cleanSrc;
        }

        const altAttr = alt ? ` name="${escapeHtml(alt)}"` : '';
        body += `<img src="${escapeHtml(url)}"${altAttr}><br>\n`;

        // 检查下一行是否为图注
        let nextIdx = i + 1;
        while (nextIdx < rawLines.length && !rawLines[nextIdx].trim()) {
          nextIdx++;
        }
        if (nextIdx < rawLines.length) {
          const nextTrimmed = rawLines[nextIdx].trim();
          if (isCaptionText(nextTrimmed)) {
            const caption = normalizeCaptionText(nextTrimmed);
            const captionStyle = 'display: block; width: 100%; font-family: PingFangSC-Regular; font-size: 12px; color: rgb(167, 167, 167); text-align: center;';
            body += `<span class="image-caption" data-image-caption="true" style="${captionStyle}">${escapeHtml(caption)}</span><br>\n`;
            i = nextIdx + 1;
            continue;
          }
        }

        i++;
        continue;
      }

      // 图注
      if (isCaptionText(trimmed)) {
        const caption = normalizeCaptionText(trimmed);
        const captionStyle = 'display: block; width: 100%; font-family: PingFangSC-Regular; font-size: 12px; color: rgb(167, 167, 167); text-align: center;';
        body += `<span class="image-caption" data-image-caption="true" style="${captionStyle}">${escapeHtml(caption)}</span><br>\n`;
        i++;
        continue;
      }

      // 普通文字/标题/列表行：Etherpad 逐行以 <br> 分隔
      lastImageSrc = '';
      body += escapeHtml(line) + '<br>\n';
      i++;
    }

    if (addFooterBanner) {
      body += `<img src="${ETHERPAD_FOOTER_BANNER_PNG}"><br>\n`;
    }

    return `<!doctype html>
<html lang="en">
<head>
<title>Lark2Pad Export</title>
<meta name="generator" content="Etherpad">
<meta name="author" content="Etherpad">
<meta name="changedby" content="Etherpad">
<meta charset="utf-8">
<style>
ol {
  counter-reset: item;
}

ol > li {
  counter-increment: item;
}

ol ol > li {
  display: block;
}

ol > li {
  display: block;
}

ol > li:before {
  content: counters(item, ".") ". ";
}

ol ol > li:before {
  content: counters(item, ".") ". ";
  margin-left: -20px;
}

ul.indent {
  list-style-type: none;
}

img{max-width:100%}
</style>
</head>
<body>
${body}
</body>
</html>`;
  }

  function renderRunsToMarkdown(runs = [], fallbackText = '') {
    if (!Array.isArray(runs) || runs.length === 0) {
      return (fallbackText || '').trim();
    }
    return runs.map((run) => {
      let text = run.text || '';
      if (!text) return '';
      if (run.bold) text = `**${text}**`;
      if (run.italic) text = `*${text}*`;
      if (run.strike) text = `~~${text}~~`;
      if (run.link) text = `[${text}](${run.link})`;
      return text;
    }).join('').trim();
  }

  const FEISHU_UI_NOISE_TEXT = /^(?:添加图标|添加封面|点击添加图标|点击添加封面|更换图标|更换封面|移除封面|移除图标|添加表情|添加背景|添加描述|添加标签|新建页面|关联页面|评论|#|\/\/)$/i;

  function blocksToMarkdown(blocks = []) {
    const lines = [];
    let lastImageKey = '';

    for (const block of blocks) {
      const type = String(block.type || '').toLowerCase();
      const rawText = String(block.text || '').trim();

      if (rawText && FEISHU_UI_NOISE_TEXT.test(rawText)) {
        continue;
      }

      // Heading
      const headingMatch = type.match(/^heading([1-6])$/i);
      if (headingMatch) {
        lastImageKey = '';
        const level = Math.min(4, Number(headingMatch[1]));
        const content = renderRunsToMarkdown(block.runs, block.text);
        lines.push(`${'#'.repeat(level)} ${content}`);
        lines.push('');
        continue;
      }

      // Image
      if (type === 'image' || block.image) {
        const src = block.image?.dataUri || block.image?.currentSrc || block.image?.src || '';
        const token = block.image?.token || '';
        const alt = block.image?.alt || '';
        const imageKey = token || (src ? src.split('?')[0] : '');

        // 防重：跳过连续相同的图片
        if (imageKey && imageKey === lastImageKey) {
          continue;
        }
        if (imageKey) {
          lastImageKey = imageKey;
        }

        if (src) {
          lines.push(`![${alt}](${src})`);
          lines.push('');
        }
        continue;
      }

      lastImageKey = '';

      // List
      if (block.listKind === 'ordered' || type === 'ordered') {
        const content = renderRunsToMarkdown(block.runs, block.text);
        lines.push(`1. ${content}`);
        continue;
      }
      if (block.listKind === 'bullet' || ['bullet', 'todo', 'task'].includes(type)) {
        const content = renderRunsToMarkdown(block.runs, block.text);
        lines.push(`- ${content}`);
        continue;
      }

      // Quote
      if (block.quote || /quote/i.test(type)) {
        const content = renderRunsToMarkdown(block.runs, block.text);
        lines.push(`> ${content}`);
        lines.push('');
        continue;
      }

      // Divider
      if (['divider', 'horizontal_rule'].includes(type)) {
        lines.push('---');
        lines.push('');
        continue;
      }

      // Regular text / Paragraph
      const text = block.text || '';
      if (text.trim()) {
        const content = renderRunsToMarkdown(block.runs, text);
        lines.push(content);
        lines.push('');
      }
    }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * 将飞书 HTML 转换为 Clean Markdown (使用 Lark2Pad Turndown 规则)
   */
  function convertHtmlToMarkdown(htmlStr = '') {
    if (!global.turndownService && typeof global.initTurndown === 'function') {
      global.initTurndown();
    }

    if (global.turndownService) {
      if (typeof global.loadHtmlAndGetImages === 'function') {
        global.loadHtmlAndGetImages(htmlStr);
      }
      const doc = global.activeDoc || new DOMParser().parseFromString(htmlStr, 'text/html');
      let markdown = global.turndownService.turndown(doc.body);
      markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
      return markdown;
    }

    // Fallback simple HTML-to-Markdown if TurndownService is not ready
    return htmlStr
      .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_, l, t) => `\n\n${'#'.repeat(Number(l))} ${t.trim()}\n\n`)
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n\n$1\n\n')
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1')
      .replace(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi, '\n![]($1)\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 全流程单步转换：输入飞书 blocks、原生 HTML 或 Markdown，输出 WeChat HTML 与 Etherpad HTML
   */
  function convertFeishuDoc(input = '', options = {}) {
    let markdown = '';
    if (Array.isArray(input)) {
      markdown = blocksToMarkdown(input);
    } else if (typeof input === 'string') {
      const isHtml = /<[a-z][\s\S]*>/i.test(input);
      markdown = isHtml ? convertHtmlToMarkdown(input) : input;
    }

    const wechatHtml = markdownToWeChatHTML(markdown, options);
    const etherpadHtml = markdownToEtherpadHTML(markdown, options);

    // 统计图片数量
    const imgMatches = markdown.match(/!\[[^\]]*\]\([^)]+\)|<img[^>]+>/gi) || [];
    const imageCount = imgMatches.length;

    // 估算内容块
    const blockCount = markdown.split('\n\n').filter(Boolean).length;

    return {
      markdown,
      wechatHtml,
      etherpadHtml,
      imageCount,
      blockCount
    };
  }

  global.IFANR_LARK2PAD_CONVERTER = Object.freeze({
    DEFAULT_HEADER_BANNER_GIF,
    APPSO_HEADER_BANNER_GIF,
    ETHERPAD_HEADER_BANNER_PNG,
    ETHERPAD_FOOTER_BANNER_PNG,
    WECHAT_FOOTER_IMAGES_HTML,
    WECHAT_FOOTER_BANNER_HTML,
    isWeChatOfficialUrl,
    isArticleMetaLine,
    hasNextArticleMetaLine,
    isCaptionText,
    normalizeCaptionText,
    convertHtmlToMarkdown,
    markdownToWeChatHTML,
    markdownToEtherpadHTML,
    convertFeishuDoc
  });
})(globalThis);
