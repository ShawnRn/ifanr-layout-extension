(function attachTitleImageBrand(global) {
  const BRANDS = Object.freeze({
    ifanr: Object.freeze({
      id: 'ifanr',
      label: '爱范儿',
      assetPath: 'assets/ifanr-title.gif',
      token: 'ifanr-discover-the-next',
      sourceName: 'ifanr-discover-the-next.gif',
      alt: 'DISCOVER THE NEXT',
      width: 720,
      height: 384
    }),
    appso: Object.freeze({
      id: 'appso',
      label: 'AppSo',
      assetPath: 'assets/appso-title.gif',
      token: 'appso-inspiration-guide',
      sourceName: 'appso-inspiration-guide.gif',
      alt: 'AppSo 灵感指南',
      width: 640,
      height: 260
    })
  });

  function normalizePreference(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ['auto', 'ifanr', 'appso'].includes(normalized) ? normalized : 'auto';
  }

  function cleanSignalText(value = '') {
    return String(value).replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
  }

  function blockText(block) {
    return cleanSignalText(block?.text || block?.content || '');
  }

  function resolve({ preference = 'auto', title = '', blocks = [], text = '' } = {}) {
    const normalizedPreference = normalizePreference(preference);
    if (normalizedPreference !== 'auto') {
      return {
        brand: normalizedPreference,
        preference: normalizedPreference,
        mode: 'manual',
        reason: 'manual-selection',
        score: null,
        signals: []
      };
    }

    const cleanTitle = cleanSignalText(title);
    const leadingText = cleanSignalText(
      text || blocks.slice(0, 12).map(blockText).filter(Boolean).join('\n')
    );
    const signals = [];
    let score = 0;

    if (/\bappso\b/i.test(cleanTitle)) {
      score += 8;
      signals.push('title-appso');
    }
    if (/(?:^|[\s《「])A\s*君(?:$|[\s，。！？：:》」])/i.test(cleanTitle)) {
      score += 5;
      signals.push('title-a-jun');
    }
    if (/(?:appso\s*(?:出品|团队|编辑部|原创)|(?:出品|来自)\s*appso)/i.test(leadingText)) {
      score += 6;
      signals.push('body-appso-credit');
    }
    if (/(?:^|\n)\s*appso\s*(?:\n|$)/i.test(leadingText)) {
      score += 6;
      signals.push('body-appso-label');
    }
    if (/灵感指南/.test(cleanTitle) || /灵感指南/.test(leadingText)) {
      score += 6;
      signals.push('inspiration-guide');
    }
    const bodyAppsoMentions = leadingText.match(/\bappso\b/gi)?.length || 0;
    if (bodyAppsoMentions >= 2) {
      score += 4;
      signals.push('body-appso-repeated');
    } else if (bodyAppsoMentions === 1) {
      score += 2;
      signals.push('body-appso-single');
    }
    if (/(?:^|[\s《「])A\s*君(?:$|[\s，。！？：:》」])/i.test(leadingText)) {
      score += 3;
      signals.push('body-a-jun');
    }

    const brand = score >= 5 ? 'appso' : 'ifanr';
    return {
      brand,
      preference: 'auto',
      mode: 'automatic',
      reason: brand === 'appso' ? signals.join('+') || 'appso-signal' : 'default-ifanr',
      score,
      signals
    };
  }

  function getBrand(value) {
    return BRANDS[value] || BRANDS.ifanr;
  }

  global.IFANR_TITLE_IMAGE_BRAND = Object.freeze({
    BRANDS,
    getBrand,
    normalizePreference,
    resolve
  });
})(globalThis);
