(function attachLarkImageProcessor(global) {
  const DEFAULT_MAX_WIDTH = 1280;
  const ROUND_CORNER_RATIO = 0.02;
  const WECHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
  const SAFE_TARGET_BYTES = Math.floor(4.72 * 1024 * 1024);
  const SKIP_SMALL_BYTES = 512 * 1024;
  const MAX_DECODED_PIXELS = 60 * 1000 * 1000;
  const OUTPUT_QUALITY = [0.6, 0.68, 0.76, 0.85, 0.92];

  function clampQuality(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0.85;
    return Math.max(0.6, Math.min(0.92, numeric));
  }

  function blobMime(blob) {
    return String(blob?.type || '').toLowerCase().split(';')[0];
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((output) => {
        if (output) resolve(output);
        else reject(new Error('LARK_IMAGE_ENCODE_FAILED'));
      }, mime, quality);
    });
  }

  async function decodeBitmap(blob, targetWidth = 0, targetHeight = 0) {
    if (typeof createImageBitmap !== 'function') throw new Error('LARK_IMAGE_DECODER_UNAVAILABLE');
    const options = targetWidth > 0 && targetHeight > 0
      ? { imageOrientation: 'from-image', resizeWidth: targetWidth, resizeHeight: targetHeight, resizeQuality: 'high' }
      : { imageOrientation: 'from-image', resizeQuality: 'high' };
    try {
      return await createImageBitmap(blob, options);
    } catch {
      return createImageBitmap(blob);
    }
  }

  function boundedDimensions(width, height, inputBytes) {
    const safeWidth = Number(width || 0);
    const safeHeight = Number(height || 0);
    if (!(safeWidth > 0 && safeHeight > 0)) return { width: 0, height: 0 };
    let targetWidth = safeWidth;
    let targetHeight = safeHeight;
    const pixelScale = Math.min(1, Math.sqrt(MAX_DECODED_PIXELS / Math.max(1, safeWidth * safeHeight)));
    if (pixelScale < 1) {
      targetWidth = Math.max(1, Math.round(safeWidth * pixelScale));
      targetHeight = Math.max(1, Math.round(safeHeight * pixelScale));
    }
    const byteScale = inputBytes > SAFE_TARGET_BYTES
      ? Math.min(1, Math.sqrt(SAFE_TARGET_BYTES / Math.max(1, inputBytes)) * 1.12)
      : 1;
    if (byteScale < 1) {
      targetWidth = Math.max(1, Math.round(targetWidth * byteScale));
      targetHeight = Math.max(1, Math.round(targetHeight * byteScale));
    }
    return { width: targetWidth, height: targetHeight };
  }

  // Approximate SwiftUI RoundedRectangle(style: .continuous) with a
  // corner-local superellipse arc (exponent 5), matching LiquidConvert's
  // continuous-corner look: each corner is an arc of visual radius `radius`.
  function traceContinuousRoundRect(context, x, y, width, height, radius, exponent = 5) {
    const r = Math.max(1, Math.min(radius, Math.min(width, height) / 2));
    const n = exponent;
    const corners = [
      { cx: x + r, cy: y + r, a0: Math.PI, a1: Math.PI * 1.5 },
      { cx: x + width - r, cy: y + r, a0: -Math.PI / 2, a1: 0 },
      { cx: x + width - r, cy: y + height - r, a0: 0, a1: Math.PI / 2 },
      { cx: x + r, cy: y + height - r, a0: Math.PI / 2, a1: Math.PI }
    ];
    const sample = (cx, cy, t) => {
      const cosT = Math.cos(t);
      const sinT = Math.sin(t);
      return [
        cx + r * Math.sign(cosT) * Math.pow(Math.abs(cosT), 2 / n),
        cy + r * Math.sign(sinT) * Math.pow(Math.abs(sinT), 2 / n)
      ];
    };
    const start = sample(corners[0].cx, corners[0].cy, corners[0].a0);
    context.moveTo(start[0], start[1]);
    const steps = 40;
    for (const corner of corners) {
      for (let i = 1; i <= steps; i += 1) {
        const t = corner.a0 + (corner.a1 - corner.a0) * (i / steps);
        const [px, py] = sample(corner.cx, corner.cy, t);
        context.lineTo(px, py);
      }
    }
    context.closePath();
  }

  async function renderToCanvas(bitmap, options = {}) {
    const maxWidth = Number(options.maxWidth || DEFAULT_MAX_WIDTH);
    const roundImages = options.roundImages !== false;
    const rawWidth = Number(bitmap.width || 0);
    const rawHeight = Number(bitmap.height || 0);
    if (!(rawWidth > 0 && rawHeight > 0)) throw new Error('LARK_IMAGE_EMPTY_BITMAP');
    const scale = Math.min(1, maxWidth / rawWidth);
    const width = Math.max(1, Math.round(rawWidth * scale));
    const height = Math.max(1, Math.round(rawHeight * scale));
    const outputMime = roundImages ? 'image/png' : 'image/jpeg';
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: roundImages });
    if (!context) throw new Error('LARK_IMAGE_CANVAS_UNAVAILABLE');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (roundImages) {
      const radius = Math.max(1, Math.round(width * ROUND_CORNER_RATIO));
      traceContinuousRoundRect(context, 0, 0, width, height, radius);
      context.clip();
    } else {
      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0, width, height);
    return { canvas, width, height, outputMime };
  }

  async function encodeWithinLimit(canvas, mime, quality, deadlineAt) {
    let currentQuality = clampQuality(quality);
    let latestBlob = await canvasToBlob(canvas, mime, currentQuality);
    if (latestBlob.size <= SAFE_TARGET_BYTES) {
      return { blob: latestBlob, encodeQuality: currentQuality };
    }
    for (const candidate of OUTPUT_QUALITY.filter((value) => value < currentQuality).sort((a, b) => b - a)) {
      if (Number(deadlineAt) > 0 && Date.now() >= Number(deadlineAt)) break;
      currentQuality = candidate;
      latestBlob = await canvasToBlob(canvas, mime, currentQuality);
      if (latestBlob.size <= SAFE_TARGET_BYTES) break;
    }
    return { blob: latestBlob, encodeQuality: currentQuality };
  }

  function maybeSkipOriginal({ blob, mime, roundImages, maxWidth, width, height }) {
    if (roundImages) return false;
    if (blob.size > SKIP_SMALL_BYTES) return false;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return false;
    if (Number(width) > 0 && Number(width) <= Number(maxWidth)) return true;
    return false;
  }

  async function processStaticImage(blob, options = {}) {
    const mime = blobMime(blob);
    const maxWidth = Number(options.maxWidth || DEFAULT_MAX_WIDTH);
    const roundImages = options.roundImages !== false;
    const originalBytes = Number(blob?.size || 0);
    const originalWidth = Number(options.width || 0);
    const originalHeight = Number(options.height || 0);
    const bounded = boundedDimensions(originalWidth, originalHeight, blob.size);
    const sourceScale = originalWidth > 0 ? Math.min(1, maxWidth / originalWidth) : 1;
    const targetWidth = originalWidth > 0 ? Math.max(1, Math.round(originalWidth * sourceScale)) : bounded.width;
    const targetHeight = originalHeight > 0 ? Math.max(1, Math.round(originalHeight * sourceScale)) : bounded.height;
    const base = {
      blob,
      mime,
      width: originalWidth,
      height: originalHeight,
      originalBytes,
      outputBytes: originalBytes,
      roundImages,
      maxWidth,
      processed: false,
      decision: 'lark-original'
    };
    if (mime === 'image/gif') {
      return { ...base, decision: 'lark-gif-passthrough' };
    }
    if (maybeSkipOriginal({ blob, mime, roundImages, maxWidth, width: originalWidth, height: originalHeight })) {
      return { ...base, decision: 'lark-small-original' };
    }
    let bitmap = null;
    try {
      bitmap = await decodeBitmap(blob, targetWidth, targetHeight);
      const rendered = await renderToCanvas(bitmap, { maxWidth, roundImages });
      const encoded = await encodeWithinLimit(rendered.canvas, rendered.outputMime, options.quality, options.deadlineAt);
      const processed = {
        ...base,
        blob: encoded.blob,
        mime: rendered.outputMime,
        width: rendered.width,
        height: rendered.height,
        originalWidth,
        originalHeight,
        outputBytes: Number(encoded.blob.size || 0),
        encodeQuality: encoded.encodeQuality,
        roundImages,
        maxWidth: rendered.width,
        processed: true,
        decision: roundImages ? 'lark-processed-round' : 'lark-processed-plain'
      };
      if (encoded.blob.size > WECHAT_IMAGE_MAX_BYTES) {
        return { ...processed, decision: 'lark-over-limit' };
      }
      return processed;
    } catch (error) {
      console.warn('[LarkImageProcessor] 图片处理失败，保留原图', error);
      return { ...base, decision: 'lark-decode-fallback', error: error?.message || String(error) };
    } finally {
      bitmap?.close?.();
    }
  }

  global.IFANR_LARK_IMAGE_PROCESSOR = Object.freeze({
    DEFAULT_MAX_WIDTH,
    ROUND_CORNER_RATIO,
    WECHAT_IMAGE_MAX_BYTES,
    SAFE_TARGET_BYTES,
    clampQuality,
    processStaticImage
  });
})(globalThis);
