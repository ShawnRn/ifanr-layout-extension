(function (global) {
  const WECHAT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
  const SAFE_TARGET_BYTES = Math.floor(4.72 * 1024 * 1024);
  const MAX_INPUT_BYTES = 80 * 1024 * 1024;
  const MAX_DECODED_PIXELS = 60 * 1000 * 1000;
  const QUALITY_LEVELS = Object.freeze([75, 90, 95]);

  function normalizeQuality(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 90;
    return QUALITY_LEVELS.reduce((best, candidate) => (
      Math.abs(candidate - numeric) < Math.abs(best - numeric) ? candidate : best
    ), 90);
  }

  function qualityProfile(value) {
    const quality = normalizeQuality(value);
    if (quality === 75) return { quality, initial: 0.9, floor: 0.76 };
    if (quality === 95) return { quality, initial: 0.97, floor: 0.88 };
    return { quality, initial: 0.95, floor: 0.83 };
  }

  function boundedDimensions(width, height, inputBytes, maxPixels = MAX_DECODED_PIXELS) {
    const safeWidth = Number(width || 0);
    const safeHeight = Number(height || 0);
    if (!(safeWidth > 0 && safeHeight > 0)) return { width: 0, height: 0, scale: 1 };
    const pixelScale = Math.min(1, Math.sqrt(maxPixels / Math.max(1, safeWidth * safeHeight)));
    const byteScale = inputBytes > SAFE_TARGET_BYTES
      ? Math.min(1, Math.sqrt(SAFE_TARGET_BYTES / inputBytes) * 1.12)
      : 1;
    const scale = Math.min(pixelScale, Math.max(0.72, byteScale));
    return {
      width: Math.max(1, Math.round(safeWidth * scale)),
      height: Math.max(1, Math.round(safeHeight * scale)),
      scale
    };
  }

  function nextDimensions(width, height, attempt, outputBytes) {
    if (attempt < 2 && outputBytes <= SAFE_TARGET_BYTES * 1.35) return { width, height };
    const pressure = Math.sqrt(SAFE_TARGET_BYTES / Math.max(SAFE_TARGET_BYTES, outputBytes));
    const scale = Math.max(0.78, Math.min(0.9, pressure * 0.96));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('STATIC_IMAGE_ENCODE_FAILED'));
      }, mime, quality);
    });
  }

  async function decodeImage(blob, width, height) {
    if (typeof createImageBitmap !== 'function') throw new Error('STATIC_IMAGE_DECODER_UNAVAILABLE');
    const options = width > 0 && height > 0
      ? { imageOrientation: 'from-image', resizeWidth: width, resizeHeight: height, resizeQuality: 'high' }
      : { imageOrientation: 'from-image' };
    try {
      return await createImageBitmap(blob, options);
    } catch {
      return createImageBitmap(blob);
    }
  }

  async function compressStaticImage(blob, options = {}) {
    const mime = String(blob?.type || '').toLowerCase().split(';')[0];
    if (!blob || blob.size <= WECHAT_IMAGE_MAX_BYTES || mime === 'image/gif') {
      return {
        blob,
        mime,
        width: Number(options.width || 0),
        height: Number(options.height || 0),
        compressed: false,
        originalBytes: Number(blob?.size || 0),
        outputBytes: Number(blob?.size || 0),
        quality: normalizeQuality(options.quality),
        decision: 'browser-original'
      };
    }
    if (blob.size > MAX_INPUT_BYTES) {
      throw {
        code: 'STATIC_IMAGE_INPUT_TOO_LARGE',
        message: '静态图片超过 80MB，浏览器无法安全自动处理。'
      };
    }
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      throw {
        code: 'STATIC_IMAGE_COMPRESSOR_UNAVAILABLE',
        message: '当前浏览器页面不支持静态图片压缩。'
      };
    }

    const profile = qualityProfile(options.quality);
    const initial = boundedDimensions(options.width, options.height, blob.size);
    const bitmap = await decodeImage(blob, initial.width, initial.height);
    let width = Number(bitmap.width || initial.width);
    let height = Number(bitmap.height || initial.height);
    let latestBlob = null;
    const outputMime = mime === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    try {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        if (Number(options.deadlineAt || 0) > 0 && Date.now() >= Number(options.deadlineAt)) {
          throw { code: 'COMPILE_TIMEOUT', message: '静态图片压缩超过本次任务时限。' };
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { alpha: outputMime !== 'image/jpeg' });
        if (!context) throw new Error('STATIC_IMAGE_CANVAS_UNAVAILABLE');
        if (outputMime === 'image/jpeg') {
          context.fillStyle = '#FFFFFF';
          context.fillRect(0, 0, width, height);
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(bitmap, 0, 0, width, height);
        const progress = Math.min(1, attempt / 4);
        const encodeQuality = Math.max(profile.floor, profile.initial - (profile.initial - profile.floor) * progress);
        latestBlob = await canvasToBlob(canvas, outputMime, encodeQuality);
        if (latestBlob.size <= SAFE_TARGET_BYTES) {
          return {
            blob: latestBlob,
            mime: outputMime,
            width,
            height,
            compressed: true,
            originalBytes: blob.size,
            outputBytes: latestBlob.size,
            quality: profile.quality,
            encodeQuality,
            decision: 'browser-high-quality-compressed'
          };
        }
        const next = nextDimensions(width, height, attempt, latestBlob.size);
        width = next.width;
        height = next.height;
      }
    } finally {
      bitmap.close?.();
    }
    throw {
      code: 'STATIC_IMAGE_COMPRESSION_REQUIRED',
      message: '静态图片在高质量压缩后仍超过微信 5MB 上限。',
      originalBytes: blob.size,
      outputBytes: Number(latestBlob?.size || 0),
      targetBytes: SAFE_TARGET_BYTES
    };
  }

  global.IFANR_STATIC_IMAGE_COMPRESSION = Object.freeze({
    WECHAT_IMAGE_MAX_BYTES,
    SAFE_TARGET_BYTES,
    MAX_INPUT_BYTES,
    MAX_DECODED_PIXELS,
    QUALITY_LEVELS,
    normalizeQuality,
    qualityProfile,
    boundedDimensions,
    nextDimensions,
    compressStaticImage
  });
})(globalThis);
