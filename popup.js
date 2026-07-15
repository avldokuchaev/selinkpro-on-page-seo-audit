
document.addEventListener('DOMContentLoaded', () => {

  document.querySelectorAll('.tab').forEach(tabEl => {
    tabEl.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      tabEl.classList.add('active');
      const pane = document.getElementById(tabEl.getAttribute('data-target'));
      if (pane) pane.classList.add('active');
    });
  });

  document.addEventListener('click', e => {
    const hdr = e.target.closest('.resource-block-header');
    if (!hdr) return;
    const body = hdr.nextElementSibling;
    if (!body) return;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    hdr.querySelector('.toggle-icon').textContent = isOpen ? '▶' : '▼';
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript(
      { target: { tabId: tabs[0].id }, func: scrapePageData },
      (results) => {
        document.getElementById('loading').style.display = 'none';
        if (results && results[0] && results[0].result) {
          renderAll(results[0].result);
        } else {
          document.getElementById('tab-meta').innerHTML =
            '<div class="alert alert-danger">Failed to scan page. Try refreshing the tab first.</div>';
          document.getElementById('tab-meta').classList.add('active');
        }
      }
    );
  });
});



async function scrapePageData() {

  const getMeta = sel => document.querySelector(sel)?.content || '';
  const getHref = sel => document.querySelector(sel)?.href    || '';

  const pageHeaders = {};
  try {
    const resp = await fetch(location.href, { method: 'HEAD' });
    for (const [k, v] of resp.headers.entries()) {
      pageHeaders[k] = v;
    }
  } catch(e) {}

  
  const perf = {};
  try {
    const nav = performance.getEntriesByType('navigation')[0];

        
        
    const HTTP_STATUS_MAP = {
      200:'OK', 201:'Created', 204:'No Content',
      301:'Moved Permanently', 302:'Found', 303:'See Other',
      304:'Not Modified', 307:'Temporary Redirect', 308:'Permanent Redirect',
      400:'Bad Request', 401:'Unauthorized', 403:'Forbidden',
      404:'Not Found', 405:'Method Not Allowed', 410:'Gone',
      429:'Too Many Requests', 451:'Unavailable For Legal Reasons',
      500:'Internal Server Error', 502:'Bad Gateway',
      503:'Service Unavailable', 504:'Gateway Timeout',
    };
    perf.httpStatus     = nav && nav.responseStatus ? nav.responseStatus : null;
    perf.httpStatusText = perf.httpStatus ? (HTTP_STATUS_MAP[perf.httpStatus] || 'Unknown') : null;
    perf.redirectCount  = nav ? nav.redirectCount : 0;
    perf.navigationType = nav ? nav.type : 'unknown';
    perf.fromCache      = nav ? (nav.transferSize === 0 && nav.decodedBodySize > 0) : false;
    perf.httpVersion    = nav && nav.nextHopProtocol ? nav.nextHopProtocol : 'unknown';
    perf.isCompressed   = nav ? (nav.encodedBodySize > 0 && nav.encodedBodySize < nav.decodedBodySize) : null;
    perf.compressionRatio = (nav && nav.encodedBodySize > 0 && nav.decodedBodySize > 0)
      ? ((1 - nav.encodedBodySize / nav.decodedBodySize) * 100).toFixed(1)
      : null;

    const pt  = performance.timing;
    perf.ttfb     = nav ? Math.round(nav.responseStart - nav.startTime)
                        : Math.round(pt.responseStart - pt.navigationStart);
    perf.loadTime = nav ? Math.round(nav.loadEventEnd - nav.startTime)
                        : Math.round(pt.loadEventEnd  - pt.navigationStart);
    perf.domReady = nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime)
                        : Math.round(pt.domContentLoadedEventEnd - pt.navigationStart);
    perf.transferKB  = nav && nav.transferSize    ? Math.round(nav.transferSize    / 1024) : null;
    perf.decodedKB   = nav && nav.decodedBodySize ? Math.round(nav.decodedBodySize / 1024) : null;
    perf.resourceCount = performance.getEntriesByType('resource').length;
    
    const allRes = performance.getEntriesByType('resource');
    perf.slowResources = allRes
      .filter(r => r.duration > 500)
      .map(r => ({ url: r.name, duration: Math.round(r.duration), type: r.initiatorType }))
      .sort((a,b) => b.duration - a.duration)
      .slice(0, 10);
    perf.thirdPartyRequests = allRes.filter(r => {
      try { return new URL(r.name).hostname !== location.hostname; } catch(e) { return false; }
    }).length;
    perf.renderBlockingScripts = Array.from(document.querySelectorAll('script[src]'))
      .filter(s => !s.async && !s.defer && s.closest('head'))
      .map(s => s.src);
    perf.renderBlockingStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .filter(l => !l.media || l.media === 'all' || l.media === 'screen')
      .map(l => l.href);
  } catch(e) { perf.error = e.message; }

  
  const inlineScripts = Array.from(document.querySelectorAll('script:not([src])')).map((s, i) => {
    const raw = s.textContent.trim();
    return { index: i+1, location: s.closest('head') ? 'HEAD' : 'BODY',
             length: raw.length, preview: raw.slice(0, 200),
             isAnalytics: /gtag|ga\(|fbq|_gaq|dataLayer|analytics|pixel/i.test(raw),
             isJsonLd: s.type === 'application/ld+json' };
  }).filter(s => !s.isJsonLd);

  
  const inlineStyles = Array.from(document.querySelectorAll('style')).map((s, i) => {
    const raw = s.textContent.trim();
    return { index: i+1, location: s.closest('head') ? 'HEAD' : 'BODY',
             length: raw.length, preview: raw.slice(0, 200) };
  });

  
  const extScripts = Array.from(document.querySelectorAll('script[src]')).map(s => ({
    src: s.src, async: s.async, defer: s.defer,
    integrity: s.integrity || '',
    location: s.closest('head') ? 'HEAD' : 'BODY',
  }));

  
  const extStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => ({
    href: l.href, media: l.media || 'all', integrity: l.integrity || '',
  }));

  
  const resourceHints = Array.from(document.querySelectorAll('link[rel="preload"],link[rel="prefetch"],link[rel="preconnect"],link[rel="dns-prefetch"]')).map(l => ({
    rel: l.rel, href: l.href, as: l.getAttribute('as') || '',
  }));

  
  const faviconEl = document.querySelector('link[rel="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]');
  const favicon = faviconEl ? { found: true, href: faviconEl.href, rel: faviconEl.rel } : { found: false };

  perf.inlineScripts = inlineScripts;
  perf.inlineStyles  = inlineStyles;
  perf.extScripts    = extScripts;
  perf.extStyles     = extStyles;
  perf.favicon       = favicon;
  perf.resourceHints = resourceHints;

  
  
  const cwv = { lcp: null, cls: null, lcpElement: '', longTasks: 0 };
  
  await new Promise(resolve => {
    
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) {
          cwv.lcp = Math.round(last.startTime);
          if (last.element) {
            const el = last.element;
            cwv.lcpElement = el.tagName.toLowerCase() + (el.id ? '#'+el.id : '') + (el.className ? '.'+String(el.className).split(' ')[0] : '');
          }
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch(e) {}

    
    try {
      let clsValue = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) clsValue += entry.value;
        }
        cwv.cls = clsValue.toFixed(4);
      }).observe({ type: 'layout-shift', buffered: true });
    } catch(e) {}

    
    try {
      let ltCount = 0;
      new PerformanceObserver((list) => {
        ltCount += list.getEntries().length;
        cwv.longTasks = ltCount;
      }).observe({ type: 'longtask', buffered: true });
    } catch(e) {}

    
    setTimeout(resolve, 150);
  });
  
  perf.cwv = cwv;
  

  
  const rendering = (() => {
    const html = document.documentElement.innerHTML;
    let fw = 'Unknown', rt = 'Unknown';
    const signals = [];
    if (document.getElementById('__nuxt') || html.includes('data-server-rendered')) fw = 'Nuxt.js';
    else if (document.getElementById('__next') || window.__NEXT_DATA__)              fw = 'Next.js';
    else if (document.querySelector('[data-reactroot]') || window.__REACT_DEVTOOLS_GLOBAL_HOOK__) fw = 'React';
    else if (document.querySelector('[data-v-]') || window.__vue_devtools_global_hook__)          fw = 'Vue.js';
    else if (document.querySelector('[ng-version]') || window.getAllAngularRootElements)           fw = 'Angular';
    else if (html.includes('__svelte'))  fw = 'Svelte';
    else if (window.Gatsby || document.getElementById('gatsby-focus-wrapper')) fw = 'Gatsby';
    const structTags = (html.match(/<(p|h[1-6]|li|article|section)[\s>]/gi) || []).length;
    if (fw === 'Next.js') {
      try { const nd = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent||'{}');
            rt = nd.gssp ? 'SSR' : nd.gip ? 'SSG' : 'CSR'; } catch(e) { rt = structTags>10?'SSR/SSG':'CSR'; }
    } else if (fw === 'Nuxt.js') {
      rt = document.querySelector('[data-server-rendered="true"]') ? 'SSR' : 'CSR/SSG';
    } else if (fw !== 'Unknown') {
      rt = structTags > 15 ? 'SSR' : 'CSR';
    } else {
      rt = structTags > 5 ? 'Server-side' : 'Static/CSR';
    }
    const gen = document.querySelector('meta[name="generator"]');
    if (gen)                                 signals.push('Generator: '+gen.content);
    if (/wp-content|wp-json/.test(html))     signals.push('WordPress');
    if (/Shopify\.shop|shopify/i.test(html)) signals.push('Shopify');
    if (/wix\.com|_wixCssModules/.test(html))signals.push('Wix');
    if (/squarespace/i.test(html))           signals.push('Squarespace');
    if (/ghost-url|ghost\//i.test(html))     signals.push('Ghost CMS');
    if (/drupal/i.test(html))                signals.push('Drupal');
    if (/joomla/i.test(html))                signals.push('Joomla');
    return { fw, rt, signals };
  })();

  
  const bodyText = document.body.innerText.trim();
  const htmlLen  = document.documentElement.innerHTML.length;
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;
  const content = {
    wordCount,
    readTime   : Math.ceil(wordCount / 200),
    textToHtml : htmlLen > 0 ? ((bodyText.length / htmlLen) * 100).toFixed(2) : 0,
  };

  
  const stopWordsList = new Set(['the','a','an','and','or','but','in','on','at','to','for',
    'of','with','by','from','is','it','its','was','are','be','been','has','have','that',
    'this','as','not','he','she','they','we','you','i','do','did','will','would','can',
    'could','should','may','might','shall','their','there','then','than','so','if','my',
    'our','your','his','her','also','more','about','up','out','no','what','which']);
  const words = bodyText.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  const freqMap = {};
  words.forEach(w => { if (!stopWordsList.has(w)) freqMap[w] = (freqMap[w]||0) + 1; });
  const topKeywords = Object.entries(freqMap)
    .sort((a,b) => b[1]-a[1]).slice(0, 15)
    .map(([word, count]) => ({ word, count, density: ((count/wordCount)*100).toFixed(2) }));
  content.topKeywords = topKeywords;
  content.thinContent = wordCount < 300;
  content.longParagraph = Array.from(document.querySelectorAll('p'))
    .map(p => p.innerText.trim().split(/\s+/).length)
    .filter(l => l > 150).length;

  
  const headings = [], hSkips = [];
  let prevLevel = 0;
  document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
    const level = parseInt(h.tagName[1]);
    const text  = h.innerText.trim().replace(/\s+/g,' ') || '[Empty]';
    const skip  = prevLevel > 0 && level > prevLevel + 1;
    headings.push({ tag: h.tagName.toLowerCase(), text, skip });
    if (skip) hSkips.push({ from: 'H'+prevLevel, to: 'H'+level, text });
    prevLevel = level;
  });

  
  const AFFILIATE_RE = [
    /amzn\.to/i,/amazon\.[a-z]+.*[?&]tag=/i,/awin\.com/i,/shareasale\.com/i,
    /clickbank\.net/i,/cj\.com\/click/i,/impact\.com/i,/prf\.hn/i,
    /[?&](aff|affiliate|partner)=/i,/go\.skimresources\.com/i,
    /linksynergy\.com/i,/howl\.me/i,/rstyle\.me/i,
  ];
  const links = { internal: [], external: [] };
  const affiliateLinks = [];
  const currentHost = window.location.hostname;
  let externalDofollowCount = 0, internalDofollowCount = 0;

  Array.from(document.links).forEach(a => {
    const href = a.href;
    if (!href || /^(javascript:|mailto:|tel:)/.test(href)) return;
    const rel       = (a.rel||'').toLowerCase();
    const isInt     = a.hostname === currentHost;
    const dofollow  = !rel.includes('nofollow');
    const sponsored = rel.includes('sponsored');
    const ugc       = rel.includes('ugc');
    const noOpener  = rel.includes('noopener');
    const isAff     = AFFILIATE_RE.some(r => r.test(href));
    let anchor      = a.innerText.trim().replace(/\s+/g,' ');
    if (!anchor) { const img = a.querySelector('img'); anchor = img ? '[IMG: '+(img.alt||'no-alt')+']' : '[Empty Anchor]'; }
    if (isAff) affiliateLinks.push({ url: href, anchor });
    if (isInt && dofollow) internalDofollowCount++;
    if (!isInt && dofollow) externalDofollowCount++;
    const entry = { url: href, anchor, dofollow, sponsored, ugc, affiliate: isAff, noOpener };
    if (isInt) links.internal.push(entry); else links.external.push(entry);
  });
  links.externalDofollowCount = externalDofollowCount;
  links.internalDofollowCount = internalDofollowCount;

  const unsafeExtLinks = links.external.filter(l => !l.noOpener);

  
  
  const imgPerf = performance.getEntriesByType('resource').filter(r => r.initiatorType === 'img' || r.name.match(/\.(png|jpg|jpeg|webp|avif|gif)/i));
  const images = Array.from(document.images).map(img => {
    const src = img.src || '';
    const ext = src.split('?')[0].split('.').pop().toLowerCase();
    
    const res = imgPerf.find(r => r.name === src);
    // Используем decodedBodySize (если из кэша) или transferSize (по сети)
    const sizeBytes = res ? (res.decodedBodySize || res.transferSize) : 0;
    const sizeKB = sizeBytes ? (sizeBytes / 1024).toFixed(1) : null;

    return {
      src, alt: img.getAttribute('alt') !== null ? img.alt.trim() : null,
      width: img.naturalWidth||img.width||0, height: img.naturalHeight||img.height||0,
      isLazy: img.loading === 'lazy',
      hasDimensions: !!(img.getAttribute('width') && img.getAttribute('height')),
      format: ext,
      isModernFormat: ['webp','avif','jxl'].includes(ext),
      sizeKB: sizeKB
    };
  });
  

  
  const og = {}, twitter = {};
  document.querySelectorAll('meta[property^="og:"]').forEach(m  => og[m.getAttribute('property')]  = m.content);
  document.querySelectorAll('meta[name^="twitter:"]').forEach(m => twitter[m.getAttribute('name')] = m.content);

 
  const schema = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try { const p = JSON.parse(s.textContent); if (Array.isArray(p)) p.forEach(i=>schema.push(i)); else schema.push(p); } catch(e) {}
  });

  
  const SCHEMA_REQUIRED = {
    'Article':        ['headline','author','datePublished','image'],
    'NewsArticle':    ['headline','author','datePublished','image'],
    'BlogPosting':    ['headline','author','datePublished'],
    'Product':        ['name','image','description','offers'],
    'Offer':          ['price','priceCurrency'],
    'Review':         ['itemReviewed','reviewRating','author'],
    'AggregateRating':['ratingValue','reviewCount'],
    'FAQPage':        ['mainEntity'],
    'Question':       ['name','acceptedAnswer'],
    'HowTo':          ['name','step'],
    'Recipe':         ['name','recipeIngredient','recipeInstructions'],
    'Event':          ['name','startDate','location'],
    'Organization':   ['name','url'],
    'LocalBusiness':  ['name','address','telephone'],
    'Person':         ['name'],
    'BreadcrumbList': ['itemListElement'],
    'WebPage':        ['name'],
    'WebSite':        ['name','url'],
    'VideoObject':    ['name','description','thumbnailUrl','uploadDate'],
    'SoftwareApplication':['name','applicationCategory','offers'],
  };
  const schemaQuality = schema.map(item => {
    const type = Array.isArray(item['@type']) ? item['@type'][0] : (item['@type'] || 'Unknown');
    const required = SCHEMA_REQUIRED[type] || [];
    const missing = required.filter(field => !item[field]);
    const present = required.filter(field => !!item[field]);
    return { type, required, missing, present, score: required.length ? Math.round((present.length/required.length)*100) : 100 };
  });

  
const hiddenContent = (() => {
  const hidden = [];

  
  const SKIP_TAGS = new Set([
    'SCRIPT','STYLE','NOSCRIPT','HEAD','HTML','META','LINK',
    'TITLE','BASE','BR','HR','INPUT','SELECT','TEXTAREA',
    'BUTTON','OPTION','OPTGROUP','DATALIST','TEMPLATE',
    'IFRAME','OBJECT','EMBED','PARAM','SOURCE','TRACK',
    'SVG','PATH','DEFS','SYMBOL','USE','G','CIRCLE',
    'RECT','LINE','POLYGON','POLYLINE','ELLIPSE',
  ]);

  const shouldSkip = el =>
    SKIP_TAGS.has(el.tagName) ||
    !document.body.contains(el) ||
    el.closest('head') !== null;

  
  document.body.querySelectorAll('*').forEach(el => {
    if (shouldSkip(el)) return;
    const text = el.innerText ? el.innerText.trim() : '';
    if (!text || text.length < 20) return;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
     
      const parentHidden = el.parentElement &&
        (window.getComputedStyle(el.parentElement).display === 'none' ||
         window.getComputedStyle(el.parentElement).visibility === 'hidden');
      if (parentHidden) return; 
      hidden.push({
        tag     : el.tagName.toLowerCase(),
        reason  : style.display === 'none' ? 'display:none' : 'visibility:hidden',
        textSnip: text.slice(0, 100),
        id      : el.id || '',
        cls     : typeof el.className === 'string' ? el.className.slice(0,40) : '',
      });
    }
  });

  
  document.body.querySelectorAll('*').forEach(el => {
    if (shouldSkip(el)) return;
    const text = el.innerText ? el.innerText.trim() : '';
    if (!text || text.length < 20) return;
    const style = window.getComputedStyle(el);
    if (parseFloat(style.opacity) === 0) {
      const parentHidden = el.parentElement &&
        parseFloat(window.getComputedStyle(el.parentElement).opacity) === 0;
      if (parentHidden) return;
      hidden.push({
        tag     : el.tagName.toLowerCase(),
        reason  : 'opacity:0',
        textSnip: text.slice(0, 100),
        id      : el.id || '',
        cls     : typeof el.className === 'string' ? el.className.slice(0,40) : '',
      });
    }
  });

  
  document.body.querySelectorAll('*').forEach(el => {
    if (shouldSkip(el)) return;
    const text = el.innerText ? el.innerText.trim() : '';
    if (!text || text.length < 10) return;
    const style = window.getComputedStyle(el);
    if (parseFloat(style.fontSize) === 0) {
      hidden.push({
        tag     : el.tagName.toLowerCase(),
        reason  : 'font-size:0',
        textSnip: text.slice(0, 100),
        id      : el.id || '',
        cls     : typeof el.className === 'string' ? el.className.slice(0,40) : '',
      });
    }
  });

  
  document.body.querySelectorAll('p,span,div,li,h1,h2,h3,h4,h5,h6,a,td,th').forEach(el => {
    if (shouldSkip(el)) return;
    const text = el.innerText ? el.innerText.trim() : '';
    if (!text || text.length < 20) return;
    const style = window.getComputedStyle(el);
    // Skip transparent backgrounds
    if (style.backgroundColor === 'rgba(0, 0, 0, 0)' ||
        style.backgroundColor === 'transparent') return;
    if (style.color === style.backgroundColor) {
      hidden.push({
        tag     : el.tagName.toLowerCase(),
        reason  : 'color == background (invisible text)',
        textSnip: text.slice(0, 100),
        id      : el.id || '',
        cls     : typeof el.className === 'string' ? el.className.slice(0,40) : '',
      });
    }
  });

  
  document.body.querySelectorAll('*').forEach(el => {
    if (shouldSkip(el)) return;
    const text = el.innerText ? el.innerText.trim() : '';
    if (!text || text.length < 20) return;
    const style = window.getComputedStyle(el);
    if (style.position !== 'absolute' && style.position !== 'fixed') return;
    const left = parseInt(style.left) || 0;
    const top  = parseInt(style.top)  || 0;
    if (left < -500 || top < -500) {
      hidden.push({
        tag     : el.tagName.toLowerCase(),
        reason  : 'off-screen position',
        textSnip: text.slice(0, 100),
        id      : el.id || '',
        cls     : typeof el.className === 'string' ? el.className.slice(0,40) : '',
      });
    }
  });

  
  const seen = new Set();
  return hidden.filter(h => {
    const key = h.reason + '::' + h.textSnip.slice(0,50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
})();

  
  const seoConflicts = (() => {
    const conflicts = [];
    const canonical = getHref('link[rel="canonical"]');
    const currentUrl = location.href;
    const robotsMeta = getMeta('meta[name="robots"]');
    const ogUrl = document.querySelector('meta[property="og:url"]')?.content || '';
    const title = document.title || '';
    const desc  = getMeta('meta[name="description"]');
    const h1s   = Array.from(document.querySelectorAll('h1'));
    const h1Text = h1s.length ? h1s[0].innerText.trim() : '';

   
    if (canonical && canonical.split('?')[0].split('#')[0] !== currentUrl.split('?')[0].split('#')[0]) {
      conflicts.push({
        severity : 'error',
        type     : 'Canonical Mismatch',
        detail   : 'Canonical points to a different URL than current page.',
        current  : currentUrl,
        expected : canonical,
        fix      : 'If this is the canonical page, change canonical to match current URL. If this is a duplicate, this is intentional.',
      });
    }

    
    if (canonical && /noindex/i.test(robotsMeta)) {
      conflicts.push({
        severity : 'error',
        type     : 'noindex + Canonical conflict',
        detail   : 'Page has both noindex and a canonical tag. Googlebot will not index this page but the canonical signal is meaningless.',
        fix      : 'Remove canonical from noindexed pages, or remove noindex if page should be indexed.',
      });
    }

   
    if (ogUrl && canonical && ogUrl.split('?')[0] !== canonical.split('?')[0]) {
      conflicts.push({
        severity : 'warning',
        type     : 'OG URL vs Canonical mismatch',
        detail   : 'og:url and canonical point to different URLs. Social shares may use wrong URL.',
        current  : 'canonical: ' + canonical,
        expected : 'og:url: ' + ogUrl,
        fix      : 'Set og:url to match canonical URL.',
      });
    }

    
    if (/noindex/i.test(robotsMeta)) {
      conflicts.push({
        severity : 'warning',
        type     : 'noindex detected',
        detail   : 'Page is marked noindex. Googlebot will not index this page in search results.',
        fix      : 'Remove noindex if page should appear in search. Check if this is intentional (staging, thank-you pages, etc.)',
      });
    }

    
    if (title && h1Text && title.toLowerCase() !== h1Text.toLowerCase()) {
      const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const h1Words    = h1Text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const overlap    = titleWords.filter(w => h1Words.includes(w));
      if (overlap.length === 0 && titleWords.length > 0 && h1Words.length > 0) {
        conflicts.push({
          severity : 'warning',
          type     : 'Title vs H1 — no keyword overlap',
          detail   : 'Title tag and H1 share no common keywords. Usually they should target same topic.',
          current  : 'Title: "' + title.slice(0,60) + '"',
          expected : 'H1: "' + h1Text.slice(0,60) + '"',
          fix      : 'Align title and H1 to target the same primary keyword.',
        });
      }
    }

    
    if (title && desc && title.toLowerCase() === desc.toLowerCase()) {
      conflicts.push({
        severity : 'error',
        type     : 'Title equals Description',
        detail   : 'Title and meta description are identical. Description should be a unique summary.',
        fix      : 'Write a unique meta description (70-160 chars) that expands on the title.',
      });
    }

   
    const hreflangs = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]'));
    if (hreflangs.length > 1) {
      const hasXDefault = hreflangs.some(el => el.getAttribute('hreflang') === 'x-default');
      if (!hasXDefault) {
        conflicts.push({
          severity : 'warning',
          type     : 'Hreflang missing x-default',
          detail   : hreflangs.length + ' hreflang tags found but no x-default. Google recommends x-default for fallback language.',
          fix      : 'Add <link rel="alternate" hreflang="x-default" href="[your-default-url]" />',
        });
      }
    }

    
    if (/nofollow/i.test(robotsMeta) && (!canonical || canonical.split('?')[0] === currentUrl.split('?')[0])) {
      conflicts.push({
        severity : 'warning',
        type     : 'nofollow on canonical page',
        detail   : 'Page has robots nofollow — Googlebot will not follow links on this page, preventing PageRank flow.',
        fix      : 'Remove nofollow from robots meta unless you intentionally want to block link equity flow.',
      });
    }

    
    const ogDesc = document.querySelector('meta[property="og:description"]')?.content || '';
    if (!desc && ogDesc) {
      conflicts.push({
        severity : 'warning',
        type     : 'Missing meta description, OG description exists',
        detail   : 'No meta description set for search engines but og:description exists for social. Google may auto-generate a poor snippet.',
        fix      : 'Add <meta name="description"> matching your og:description.',
      });
    }

    
    const viewport = getMeta('meta[name="viewport"]');
    if (!viewport) {
      conflicts.push({
        severity : 'error',
        type     : 'Missing viewport meta tag',
        detail   : 'No viewport tag found. Google uses mobile-first indexing — pages without viewport may rank lower on mobile.',
        fix      : 'Add <meta name="viewport" content="width=device-width, initial-scale=1">',
      });
    }

    return conflicts;
  })();

  
  const security = (() => {
    const isHttps = location.protocol === 'https:';
    const allResources = performance.getEntriesByType('resource');
    const mixedContent = isHttps ? allResources.filter(r => r.name.startsWith('http:')).map(r => r.name) : [];
    const forms = Array.from(document.querySelectorAll('form')).map(f => ({
      action   : f.action || '',
      method   : f.method || 'get',
      isCross  : f.action && !f.action.startsWith(location.origin) && !f.action.startsWith('/'),
    }));
    const sriCount   = document.querySelectorAll('script[integrity],link[integrity]').length;
    const csp        = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '';
    const unsafeLinks = Array.from(document.querySelectorAll('a[target="_blank"]'))
      .filter(a => !a.rel.includes('noopener')).length;
    const baseHref   = document.querySelector('base')?.href || '';
    return { isHttps, mixedContent, forms, sriCount, csp, unsafeLinks, baseHref };
  })();

  
  const crawl = (() => {
    const robotsMeta   = getMeta('meta[name="robots"]');
    const googlebot    = getMeta('meta[name="googlebot"]');
    const bingbot      = getMeta('meta[name="bingbot"]');
    const noindex      = /noindex/i.test(robotsMeta) || /noindex/i.test(googlebot);
    const nofollow     = /nofollow/i.test(robotsMeta);
    const noarchive    = /noarchive/i.test(robotsMeta);
    const nosnippet    = /nosnippet/i.test(robotsMeta);
    const noimageindex = /noimageindex/i.test(robotsMeta);
    const dataNoSnippet= document.querySelectorAll('[data-nosnippet]').length;
    const totalLinks   = document.links.length;
    const tooManyLinks = totalLinks > 150;
    const hasHomepageLink = Array.from(document.links).some(a =>
      a.hostname === location.hostname && (a.pathname === '/' || a.pathname === '')
    );
    const metaRefresh  = document.querySelector('meta[http-equiv="refresh"]')?.content || '';
    const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
      src         : f.src || f.getAttribute('data-src') || '',
      title       : f.getAttribute('title') || '',
      width       : f.getAttribute('width') || f.offsetWidth || '',
      height      : f.getAttribute('height') || f.offsetHeight || '',
      loading     : f.loading || 'auto',
      sandbox     : f.getAttribute('sandbox') !== null ? (f.getAttribute('sandbox') || '[empty]') : 'not set',
      isThirdParty: !!f.src && !f.src.startsWith(location.origin) && !f.src.startsWith('/'),
      location    : (() => {
        const p = f.closest('header,nav,main,article,section,aside,footer');
        return p ? p.tagName.toLowerCase() : 'unknown';
      })(),
    }));
    const iframeCount = iframes.length;
    return { robotsMeta, googlebot, bingbot, noindex, nofollow, noarchive, nosnippet,
             noimageindex, dataNoSnippet, totalLinks, tooManyLinks, hasHomepageLink,
             metaRefresh, iframeCount, iframes };
  })();

  
  const loc  = window.location;
  const path = loc.pathname;
  const segs = path.split('/').filter(Boolean);
  const stopWordsUrl = ['and','or','the','a','an','of','in','for','on','with','at','by','from'];
  const foundStop = segs.flatMap(s => s.split('-')).filter(w => stopWordsUrl.includes(w.toLowerCase()));
  const urlAnalysis = {
    full: loc.href, path, depth: segs.length,
    hasUppercase: /[A-Z]/.test(path),
    hasParams: loc.search.length > 1,
    paramCount: loc.search.length > 1 ? [...new URLSearchParams(loc.search)].length : 0,
    hasFragment: loc.hash.length > 1,
    hasUnderscores: path.includes('_'),
    urlLength: loc.href.length,
    trailingSlash: path.length > 1 && path.endsWith('/'),
    segments: segs, stopWords: foundStop,
  };

  
  const hreflang = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]'))
    .map(el => ({ lang: el.getAttribute('hreflang'), href: el.href }));
  const pagination = { next: getHref('link[rel="next"]'), prev: getHref('link[rel="prev"]') };

  return {
    url: loc.href, title: document.title,
    desc: getMeta('meta[name="description"]'),
    canonical: getHref('link[rel="canonical"]'),
    robots: getMeta('meta[name="robots"]'),
    lang: document.documentElement.lang || '',
    charset: document.characterSet || '',
    viewport: getMeta('meta[name="viewport"]'),
    content, headings, hSkips,
    links, affiliateLinks,
    images, social: { og, twitter }, schema, schemaQuality,
    perf, rendering, urlAnalysis,
    hreflang, pagination,
    security, crawl, unsafeExtLinks,
    hiddenContent, seoConflicts, pageHeaders,
  };
}



function renderAll(d) {

  const esc = str => String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const b = (text, color) => '<span class="badge bg-'+color+'">'+esc(String(text))+'</span>';
  const perfColor = (val,good,warn) => (!val&&val!==0)?'': val<=good?'c-good':val<=warn?'c-warn':'c-bad';
  const perfLabel = (val,good,warn) => val===null||val<0?'N/A': val<=good?'Good':val<=warn?'Needs work':'Poor';

  function collapsible(title, countBadge, bodyHtml, startOpen=false) {
    return '<div class="resource-block">'
      +'<div class="resource-block-header"><span>'+esc(title)+' '+countBadge+'</span>'
      +'<span class="toggle-icon">'+(startOpen?'▼':'▶')+'</span></div>'
      +'<div class="resource-block-body" style="display:'+(startOpen?'block':'none')+'">'+bodyHtml+'</div>'
      +'</div>';
  }

  // Tip box helper
  function tipBox(text) {
    return '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:4px;padding:7px 10px;'
      +'font-size:10px;color:#0c4a6e;margin-top:6px;line-height:1.5;">'
      +'<b>&#128161; What to do:</b> '+text+'</div>';
  }

  
  document.getElementById('quickStats').textContent =
    'Words: '+d.content.wordCount+' | '+d.content.readTime+' min read';
  document.getElementById('cnt-int').textContent = d.links.internal.length;
  document.getElementById('cnt-ext').textContent = d.links.external.length;

  const hCounts = {h1:0,h2:0,h3:0,h4:0,h5:0,h6:0};
  d.headings.forEach(h => { if (hCounts[h.tag]!==undefined) hCounts[h.tag]++; });

  
  const scoreChecks = [
    d.title.length >= 30 && d.title.length <= 65,
    d.desc.length  >= 70 && d.desc.length  <= 160,
    !!d.canonical,
    !/noindex/i.test(d.robots),
    hCounts.h1 === 1,
    d.hSkips.length === 0,
    d.content.wordCount >= 300,
    d.images.filter(i=>i.alt===null).length === 0,
    Object.keys(d.social.og).length >= 4,
    d.schema.length > 0,
    d.security.isHttps,
    d.security.mixedContent.length === 0,
    d.security.unsafeLinks === 0,
    !d.crawl.noindex,
    d.crawl.totalLinks <= 150,
    d.content.topKeywords.length > 0,
    !!d.perf.favicon.found,
    d.urlAnalysis.urlLength <= 115,
    !d.urlAnalysis.hasUppercase,
    !d.urlAnalysis.hasUnderscores,
    d.seoConflicts.filter(c=>c.severity==='error').length === 0,
    d.hiddenContent.length === 0,
  ];
  const score = Math.round((scoreChecks.filter(Boolean).length / scoreChecks.length) * 100);
  const scoreColor = score >= 80 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
  const scoreLabel = score >= 80 ? 'Good' : score >= 50 ? 'Needs Work' : 'Poor';

  
  const tLen=d.title.length, dLen=d.desc.length;
  const tB  = tLen===0?b('Missing','red'):(tLen<30||tLen>65)?b(tLen+' chars','orange'):b(tLen+' chars','green');
  const dB  = dLen===0?b('Missing','red'):(dLen<70||dLen>160)?b(dLen+' chars','orange'):b(dLen+' chars','green');
  const canB= !d.canonical?b('Missing','red'):d.canonical.split('?')[0]===d.url.split('?')[0]?b('Self-ref','green'):b('Custom','orange');
  const robB= /noindex|nofollow/i.test(d.robots)?b('Blocked','red'):b('Indexable','green');
  const urlF= [];
  if (d.urlAnalysis.hasUppercase)    urlF.push(b('Uppercase','orange'));
  if (d.urlAnalysis.hasUnderscores)  urlF.push(b('Underscores','orange'));
  if (d.urlAnalysis.urlLength > 115) urlF.push(b('Long URL','orange'));
  if (d.urlAnalysis.hasParams)       urlF.push(b(d.urlAnalysis.paramCount+' param(s)','gray'));
  if (!urlF.length)                  urlF.push(b('Clean','green'));

  const errCount  = d.seoConflicts.filter(c=>c.severity==='error').length;
  const warnCount = d.seoConflicts.filter(c=>c.severity==='warning').length;

  const scoreBar = '<div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:10px;margin-bottom:12px;display:flex;align-items:center;gap:12px;">'
    +'<div style="font-size:28px;font-weight:900;color:'+scoreColor+'">'+score+'</div>'
    +'<div style="flex:1;">'
    +'<div style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;margin-bottom:4px;">SEO Score — '+scoreLabel+'</div>'
    +'<div style="background:#e2e8f0;border-radius:4px;height:8px;overflow:hidden;">'
    +'<div style="background:'+scoreColor+';width:'+score+'%;height:100%;border-radius:4px;"></div>'
    +'</div></div>'
    +'<div style="font-size:10px;color:#94a3b8;text-align:right;">'
    +scoreChecks.filter(Boolean).length+'/'+scoreChecks.length+' checks<br>'
    +(errCount?'<span style="color:#dc2626;font-weight:700;">'+errCount+' errors</span> ':'')
    +(warnCount?'<span style="color:#d97706;font-weight:700;">'+warnCount+' warnings</span>':'')
    +'</div></div>';

  document.getElementById('tab-meta').innerHTML = scoreBar+'<table class="data-table">'
    +'<tr><th>Title</th><td><b>'+esc(d.title||'N/A')+'</b><br>'+tB+'</td></tr>'
    +'<tr><th>Description</th><td>'+esc(d.desc||'N/A')+'<br>'+dB+'</td></tr>'
    +'<tr><th>URL</th><td style="font-size:10px;">'+esc(d.url)+'<br>'+urlF.join(' ')+'</td></tr>'
    +'<tr><th>Canonical</th><td style="font-size:10px;">'+(esc(d.canonical)||'Not set')+'<br>'+canB+'</td></tr>'
    +'<tr><th>Robots</th><td>'+(esc(d.robots)||'Not set')+' '+(d.robots?robB:'')+'</td></tr>'
    +'<tr><th>Content</th><td>'
      +b(d.content.wordCount+' words','gray')+' '
      +b(d.content.readTime+' min read','gray')+' '
      +b('Text/HTML: '+d.content.textToHtml+'%',+d.content.textToHtml<10?'orange':'green')
      +(d.content.thinContent?' '+b('Thin Content!','red'):'')
    +'</td></tr>'
    +'<tr><th>Headings</th><td>'
      +['h1','h2','h3','h4','h5','h6'].map(h=>b(h.toUpperCase()+': '+hCounts[h],'gray')).join(' ')+' '
      +(hCounts.h1===0?b('No H1!','red'):hCounts.h1>1?b('Multiple H1','orange'):b('H1 OK','green'))+' '
      +(d.hSkips.length?b(d.hSkips.length+' H-skip(s)','red'):b('Hierarchy OK','green'))
    +'</td></tr>'
    +'<tr><th>Framework</th><td>'+b(d.rendering.fw,'blue')+' '+b(d.rendering.rt,d.rendering.rt.includes('CSR')?'orange':'green')+'</td></tr>'
    +'<tr><th>SEO Conflicts</th><td>'
      +(errCount?b(errCount+' error(s)','red')+' ':'')
      +(warnCount?b(warnCount+' warning(s)','orange')+' ':'')
      +(!errCount&&!warnCount?b('No conflicts detected','green'):'')
      +(d.hiddenContent.length?b(d.hiddenContent.length+' hidden element(s)','red'):'')
    +'</td></tr>'
    +'<tr><th>Security</th><td>'
      +(d.security.isHttps?b('HTTPS','green'):b('HTTP!','red'))+' '
      +(d.security.mixedContent.length?b(d.security.mixedContent.length+' mixed','red'):b('No mixed','green'))+' '
      +(d.security.unsafeLinks?b(d.security.unsafeLinks+' unsafe links','orange'):b('Links safe','green'))
    +'</td></tr>'
    +'<tr><th>Crawlability</th><td>'
      +(d.crawl.noindex?b('NOINDEX!','red'):b('Indexable','green'))+' '
      +(d.crawl.tooManyLinks?b(d.crawl.totalLinks+' links (>150)','orange'):b(d.crawl.totalLinks+' links OK','green'))
    +'</td></tr>'
    +'<tr><th>Schema</th><td>'
      +(d.schema.length?b(d.schema.length+' type(s)','blue'):b('None','gray'))+' '
      +(d.schemaQuality.some(s=>s.missing.length)?b('Quality issues','orange'):d.schema.length?b('Quality OK','green'):'')
    +'</td></tr>'
    +'<tr><th>Hreflang</th><td>'+(d.hreflang.length?b(d.hreflang.length+' tag(s)','blue'):b('None','gray'))+'</td></tr>'
    +'<tr><th>Affiliate</th><td>'+(d.affiliateLinks.length?b(d.affiliateLinks.length+' detected','orange'):b('None detected','green'))+'</td></tr>'
    +'<tr><th>Tech</th><td>'
      +'Lang: <b>'+(d.lang||'N/A')+'</b> '
      +'Charset: <b>'+(d.charset||'N/A')+'</b> '
      +'Viewport: '+(d.viewport?b('Yes','green'):b('Missing!','red'))+' '
      +'Favicon: '+(d.perf.favicon&&d.perf.favicon.found?b('Yes','green'):b('Missing','red'))
    +'</td></tr>'
    +'</table>';

  
  const h1c = hCounts.h1;
  const h1Alert = h1c===0?'<div class="alert alert-danger">&#10060; Missing H1 tag!</div>'
    :h1c>1?'<div class="alert alert-warning">&#9888; Multiple H1 tags ('+h1c+') — should be exactly 1</div>'
    :'<div class="alert alert-success">&#10003; Exactly one H1 tag — perfect</div>';
  const skipAlert = d.hSkips.length
    ?'<div class="alert alert-danger">&#10060; Heading hierarchy skips: '+d.hSkips.map(s=>'<b>'+s.from+'&rarr;'+s.to+'</b>').join(', ')+'</div>'
    :'<div class="alert alert-success">&#10003; Heading hierarchy is correct — no skips</div>';
  let hTree = '<div style="background:#fff;border:1px solid #e2e8f0;border-radius:5px;padding:8px;">';
  if (!d.headings.length) { hTree += '<div style="color:#94a3b8;text-align:center;padding:20px;">No headings found</div>'; }
  else { d.headings.forEach(h => { hTree += '<div class="h-tag '+h.tag+(h.skip?' skip-error':'')+'"><span class="tag-label">'+h.tag.toUpperCase()+'</span>'+esc(h.text)+(h.skip?' <b style="color:#dc2626">&#9888; SKIP</b>':'')+'</div>'; }); }
  hTree += '</div>';
  document.getElementById('tab-headers').innerHTML = h1Alert + skipAlert + hTree;

  
  function buildLinkTable(links) {
    if (!links.length) return '<div class="alert alert-gray">No links found.</div>';
    const anchorMap = {};
    links.forEach(l => { if (!l.anchor.startsWith('[')) anchorMap[l.anchor]=(anchorMap[l.anchor]||0)+1; });
    const dupCount = Object.values(anchorMap).filter(v=>v>1).length;
    const dupAlert = dupCount?'<div class="alert alert-warning">&#9888; '+dupCount+' duplicate anchor text(s)</div>':'';
    let html = dupAlert+'<table class="data-table list-table"><thead><tr>'
      +'<th style="width:28%">Anchor</th><th style="width:48%">URL</th><th style="width:24%">Rel</th>'
      +'</tr></thead><tbody>';
    links.forEach(l => {
      const isDup = anchorMap[l.anchor]>1;
      const rels  = [];
      if (!l.dofollow) rels.push(b('nofollow','orange'));
      if (l.sponsored) rels.push(b('sponsored','purple'));
      if (l.ugc)       rels.push(b('ugc','teal'));
      if (l.dofollow&&!l.sponsored) rels.push(b('dofollow','green'));
      if (l.affiliate) rels.push(b('affiliate','yellow'));
      if (!l.noOpener && !l.url.startsWith(location.origin)) rels.push(b('no noopener','red'));
      const aStyle = l.anchor.startsWith('[')?'color:#dc2626;font-weight:700;':isDup?'color:#d97706;':'';
      html += '<tr><td style="'+aStyle+'">'+esc(l.anchor)+'</td>'
        +'<td><a href="'+l.url+'" target="_blank" style="color:#2980b9;text-decoration:none;">'+esc(l.url)+'</a></td>'
        +'<td>'+rels.join(' ')+'</td></tr>';
    });
    return html+'</tbody></table>';
  }
  const juiceSummary = '<div style="display:flex;gap:8px;margin-bottom:8px;">'
    +'<div style="flex:1;background:#fff;border:1px solid #e2e8f0;border-radius:5px;padding:8px;text-align:center;">'
    +'<div style="font-size:16px;font-weight:800;color:#166534;">'+d.links.internalDofollowCount+'</div>'
    +'<div style="font-size:9px;text-transform:uppercase;font-weight:700;color:#94a3b8;">Internal Dofollow</div></div>'
    +'<div style="flex:1;background:#fff;border:1px solid #e2e8f0;border-radius:5px;padding:8px;text-align:center;">'
    +'<div style="font-size:16px;font-weight:800;color:#1e40af;">'+d.links.externalDofollowCount+'</div>'
    +'<div style="font-size:9px;text-transform:uppercase;font-weight:700;color:#94a3b8;">External Dofollow</div></div>'
    +'<div style="flex:1;background:#fff;border:1px solid #e2e8f0;border-radius:5px;padding:8px;text-align:center;">'
    +'<div style="font-size:16px;font-weight:800;color:#9a3412;">'+d.affiliateLinks.length+'</div>'
    +'<div style="font-size:9px;text-transform:uppercase;font-weight:700;color:#94a3b8;">Affiliate</div></div>'
    +'</div>';
  document.getElementById('tab-links-int').innerHTML = juiceSummary + buildLinkTable(d.links.internal);
  document.getElementById('tab-links-ext').innerHTML = juiceSummary + buildLinkTable(d.links.external);

  
  const noAlt   = d.images.filter(i=>i.alt===null||i.alt==='');
  const noDim   = d.images.filter(i=>!i.hasDimensions);
  const lazyN   = d.images.filter(i=>i.isLazy).length;
  const modernN = d.images.filter(i=>i.isModernFormat).length;
  const legacyN = d.images.filter(i=>!i.isModernFormat&&['jpg','jpeg','png','gif'].includes(i.format)).length;
  let imgAlerts = '';
  if (!d.images.length) { imgAlerts='<div class="alert alert-gray">No images found.</div>'; }
  else {
    imgAlerts += noAlt.length?'<div class="alert alert-danger">&#10060; '+noAlt.length+' image(s) missing ALT</div>'
      :'<div class="alert alert-success">&#10003; All images have ALT attributes</div>';
    if (noDim.length)  imgAlerts+='<div class="alert alert-warning">&#9888; '+noDim.length+' image(s) missing width/height — CLS risk</div>';
    if (legacyN > 0)   imgAlerts+='<div class="alert alert-warning">&#9888; '+legacyN+' legacy format image(s) — consider WebP/AVIF</div>';
    if (modernN > 0)   imgAlerts+='<div class="alert alert-success">&#10003; '+modernN+' modern format image(s) (WebP/AVIF)</div>';
    if (lazyN > 0)     imgAlerts+='<div class="alert alert-info">&#8505; '+lazyN+' image(s) lazy loaded</div>';
  }
  
  let imgTable = '<table class="data-table list-table"><thead><tr>'
    +'<th style="width:36%">Source</th><th style="width:24%">ALT</th><th style="width:12%">Format</th><th style="width:12%">Size</th><th style="width:16%">Flags</th>'
    +'</tr></thead><tbody>';
  d.images.forEach(img => {
    const altCell  = img.alt===null?b('No tag','red'):img.alt===''?b('Empty','orange'):esc(img.alt);
    const fmtBadge = img.isModernFormat?b(img.format,'teal'):b(img.format||'?','gray');
    const sizeCell = img.sizeKB ? '<b>' + img.sizeKB + ' KB</b>' : '<span style="color:#94a3b8;font-size:9px;">N/A</span>';
    const flags    = [];
    if (!img.hasDimensions) flags.push(b('No size','orange'));
    if (img.isLazy)         flags.push(b('Lazy','blue'));
    imgTable += '<tr><td><a href="'+img.src+'" target="_blank" style="color:#2980b9;text-decoration:none;">'+esc(img.src)+'</a></td>'
      +'<td>'+altCell+'</td><td>'+fmtBadge+'</td><td>'+sizeCell+'</td><td>'+flags.join(' ')+'</td></tr>';
  });
  
  imgTable += '</tbody></table>';
  document.getElementById('tab-images').innerHTML = imgAlerts + imgTable;

  
  const reqOg     = ['og:title','og:description','og:image','og:url'];
  const missingOg = reqOg.filter(t=>!d.social.og[t]);
  let socHtml = missingOg.length
    ?'<div class="alert alert-danger">&#10060; Missing OG: <b>'+missingOg.join(', ')+'</b></div>'
    :'<div class="alert alert-success">&#10003; Required Open Graph tags present</div>';

  socHtml += '<div class="section-title">Open Graph</div><table class="data-table list-table"><tbody>';
  if (!Object.keys(d.social.og).length) socHtml+='<tr><td colspan="2" style="text-align:center;color:#94a3b8;">No OG tags found</td></tr>';
  for (const [k,v] of Object.entries(d.social.og)) {
    const val=v.startsWith('http')?'<a href="'+esc(v)+'" target="_blank">'+esc(v)+'</a>':esc(v);
    socHtml+='<tr><th style="width:35%">'+esc(k)+'</th><td>'+val+'</td></tr>';
  }
  socHtml+='</tbody></table>';

  socHtml += '<div class="section-title">Twitter / X Cards</div><table class="data-table list-table"><tbody>';
  if (!Object.keys(d.social.twitter).length) socHtml+='<tr><td colspan="2" style="text-align:center;color:#94a3b8;">No Twitter tags found</td></tr>';
  for (const [k,v] of Object.entries(d.social.twitter)) socHtml+='<tr><th style="width:35%">'+esc(k)+'</th><td>'+esc(v)+'</td></tr>';
  socHtml+='</tbody></table>';

  
  socHtml += '<div class="section-title">Schema.org JSON-LD — Quality Check</div>';
  if (!d.schema.length) {
    socHtml+='<div class="alert alert-warning">&#9888; No JSON-LD Schema found. Add structured data to get rich snippets in Google.</div>';
    socHtml+=tipBox('Add Schema markup for your page type: Article, Product, FAQ, HowTo, LocalBusiness, etc. Use Google\'s Rich Results Test to validate.');
  } else {
    d.schemaQuality.forEach((sq, idx) => {
      const statusColor = sq.missing.length===0?'#166534':sq.missing.length<=2?'#92400e':'#991b1b';
      const statusBg    = sq.missing.length===0?'#dcfce7':sq.missing.length<=2?'#fef9c3':'#fee2e2';
      const statusBorder= sq.missing.length===0?'#22c55e':sq.missing.length<=2?'#f59e0b':'#ef4444';

      socHtml += '<div style="background:'+statusBg+';border:1px solid '+statusBorder+';border-radius:5px;padding:10px;margin-bottom:8px;">';
      socHtml += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">'
        +'<span style="font-weight:700;font-size:11px;color:'+statusColor+';">@type: '+esc(sq.type)+'</span>'
        +'<span style="font-size:10px;font-weight:700;color:'+statusColor+';">Quality: '+sq.score+'%</span>'
        +'</div>';

      
      socHtml += '<div style="background:rgba(0,0,0,0.1);border-radius:3px;height:5px;margin-bottom:8px;">'
        +'<div style="background:'+statusColor+';width:'+sq.score+'%;height:100%;border-radius:3px;"></div></div>';

      if (sq.present.length) {
        socHtml += '<div style="font-size:10px;color:#166534;margin-bottom:4px;">'
          +'&#10003; Present: '+sq.present.map(f=>'<code style="background:rgba(0,0,0,0.08);padding:1px 4px;border-radius:2px;">'+esc(f)+'</code>').join(' ')+'</div>';
      }
      if (sq.missing.length) {
        socHtml += '<div style="font-size:10px;color:#991b1b;margin-bottom:4px;">'
          +'&#10060; Missing required fields: '+sq.missing.map(f=>'<code style="background:rgba(0,0,0,0.08);padding:1px 4px;border-radius:2px;">'+esc(f)+'</code>').join(' ')+'</div>';
        socHtml += tipBox('Add the missing fields to enable rich snippets. Google won\'t show rich results for '+esc(sq.type)+' without: <b>'+sq.missing.join(', ')+'</b>');
      } else if (sq.required.length > 0) {
        socHtml += '<div style="font-size:10px;color:#166534;">&#10003; All required fields present — eligible for rich snippets!</div>';
      } else {
        socHtml += '<div style="font-size:10px;color:#475569;">No required field rules defined for this type. Validate manually.</div>';
      }

      
      const item = d.schema[idx] || {};
      const showFields = ['name','headline','url','description','author','datePublished','image','price','ratingValue'];
      const dataLines = showFields.filter(f => item[f]).map(f => '<b>'+f+':</b> '+esc(String(item[f]).slice(0,60)));
      if (dataLines.length) {
        socHtml += '<div style="font-size:9px;color:#64748b;margin-top:6px;border-top:1px solid rgba(0,0,0,0.1);padding-top:5px;">'
          +dataLines.join(' &nbsp;|&nbsp; ')+'</div>';
      }
      socHtml += '</div>';
    });
  }
  document.getElementById('tab-social').innerHTML = socHtml;

  
  const p    = d.perf;
  const cwv  = p.cwv || {};
  const ttfbC= perfColor(p.ttfb,200,500);
  const loadC= perfColor(p.loadTime,2000,4000);
  const domC = perfColor(p.domReady,1500,3000);
  const lcpC = perfColor(cwv.lcp,2500,4000);
  const clsVal= cwv.cls !== null ? parseFloat(cwv.cls) : null;
  const clsC = clsVal!==null?(clsVal<=0.1?'c-good':clsVal<=0.25?'c-warn':'c-bad'):'';
  const clsLabel= clsVal!==null?(clsVal<=0.1?'Good':clsVal<=0.25?'Needs work':'Poor'):'N/A';

  let perfHtml = '<div class="metric-grid">'
    +'<div class="metric-card"><div class="metric-val '+ttfbC+'">'+(p.ttfb>=0?p.ttfb+'ms':'N/A')+'</div><div class="metric-label">TTFB</div><div class="metric-sub '+ttfbC+'">'+perfLabel(p.ttfb,200,500)+'</div></div>'
    +'<div class="metric-card"><div class="metric-val '+loadC+'">'+(p.loadTime>0?p.loadTime+'ms':'N/A')+'</div><div class="metric-label">Full Load</div><div class="metric-sub '+loadC+'">'+perfLabel(p.loadTime,2000,4000)+'</div></div>'
    +'<div class="metric-card"><div class="metric-val '+domC+'">'+(p.domReady>0?p.domReady+'ms':'N/A')+'</div><div class="metric-label">DOM Ready</div><div class="metric-sub '+domC+'">'+perfLabel(p.domReady,1500,3000)+'</div></div>'
    +'<div class="metric-card"><div class="metric-val '+lcpC+'">'+(cwv.lcp?cwv.lcp+'ms':'N/A')+'</div><div class="metric-label">LCP</div><div class="metric-sub '+lcpC+'">'
      +perfLabel(cwv.lcp,2500,4000)+(cwv.lcpElement?'<br><span style="font-size:8px;color:#94a3b8;">'+esc(cwv.lcpElement)+'</span>':'')+'</div></div>'
    +'<div class="metric-card"><div class="metric-val '+clsC+'">'+(cwv.cls!==null?cwv.cls:'N/A')+'</div><div class="metric-label">CLS</div><div class="metric-sub '+clsC+'">'+clsLabel+'</div></div>'
    +'<div class="metric-card"><div class="metric-val c-neutral">'+(p.transferKB!==null?p.transferKB+'KB':'N/A')+'</div><div class="metric-label">Transfer Size</div><div class="metric-sub c-neutral">'+(p.decodedKB!==null?'Decoded: '+p.decodedKB+'KB':'')+'</div></div>'
    +'<div class="metric-card"><div class="metric-val c-neutral">'+p.resourceCount+'</div><div class="metric-label">Total Requests</div><div class="metric-sub '+(p.resourceCount>80?'c-bad':p.resourceCount>50?'c-warn':'c-good')+'">'+(p.resourceCount>80?'Too many':p.resourceCount>50?'High':'Good')+'</div></div>'
    +'<div class="metric-card"><div class="metric-val c-neutral">'+(cwv.longTasks||0)+'</div><div class="metric-label">Long Tasks</div><div class="metric-sub '+(cwv.longTasks>5?'c-bad':cwv.longTasks>2?'c-warn':'c-good')+'">'+(cwv.longTasks>5?'Poor':cwv.longTasks>2?'Check':'Good')+'</div></div>'
    +'<div class="metric-card"><div class="metric-val" style="font-size:20px;">'+(p.favicon&&p.favicon.found?'✅':'❌')+'</div><div class="metric-label">Favicon</div><div class="metric-sub '+(p.favicon&&p.favicon.found?'c-good':'c-bad')+'">'+(p.favicon&&p.favicon.found?'Found':'Missing')+'</div></div>'
    +'</div>';

  
    
  const httpStatus = p.httpStatus;
  const statusColor = !httpStatus ? 'c-neutral'
    : httpStatus < 300 ? 'c-good'
    : httpStatus < 400 ? 'c-warn'
    : 'c-bad';
  const statusBg = !httpStatus ? '#f8fafc'
    : httpStatus < 300 ? '#dcfce7'
    : httpStatus < 400 ? '#fef9c3'
    : '#fee2e2';
  const statusBorder = !httpStatus ? '#e2e8f0'
    : httpStatus < 300 ? '#22c55e'
    : httpStatus < 400 ? '#f59e0b'
    : '#ef4444';

  perfHtml += '<div class="section-title">HTTP Status & Server</div>';

  
  if (d.pageHeaders && Object.keys(d.pageHeaders).length > 0) {
    let headersBody = '<table class="data-table list-table"><tbody>';
    for (const [key, val] of Object.entries(d.pageHeaders)) {
      
      const isImportant = ['x-robots-tag', 'canonical', 'server', 'x-powered-by', 'cache-control'].includes(key);
      headersBody += '<tr><td style="width:35%;font-weight:'+(isImportant?'700':'400')+';color:'+(isImportant?'#1e293b':'#64748b')+';">' + esc(key) + '</td>'
        + '<td style="word-break:break-all;font-family:monospace;font-size:10px;">' + esc(val) + '</td></tr>';
    }
    headersBody += '</tbody></table>';
    
    
    if (d.pageHeaders['x-robots-tag'] && /noindex/i.test(d.pageHeaders['x-robots-tag'])) {
      perfHtml += '<div class="alert alert-danger" style="margin-bottom:8px;">&#10060; <b>x-robots-tag: noindex</b> found in HTTP headers! This page is blocked from indexing, even if the HTML robots meta tag says otherwise.</div>';
    }
    
    perfHtml += collapsible('View Raw HTTP Headers', b(Object.keys(d.pageHeaders).length, 'gray'), headersBody, false);
  }
  

  perfHtml += '<div style="background:'+statusBg+';border:1px solid '+statusBorder+';border-radius:6px;padding:10px;margin-bottom:10px;">'
    
    +'<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">'
    +'<div style="font-size:32px;font-weight:900;class="'+statusColor+'" style="color:'
      +(!httpStatus?'#94a3b8':httpStatus<300?'#16a34a':httpStatus<400?'#d97706':'#dc2626')+';">'
      +(httpStatus || 'N/A')+'</div>'
    +'<div>'
    +'<div style="font-size:13px;font-weight:700;color:#1e293b;">'+(p.httpStatusText||'Not available in this browser')+'</div>'
    +'<div style="font-size:10px;color:#64748b;margin-top:2px;">'
      +(!httpStatus
        ? 'Navigation Timing responseStatus requires Chrome 102+. Try reloading the page with DevTools open.'
        : httpStatus===200 ? 'Page loaded successfully. Googlebot can access and index this page.'
        : httpStatus===301 ? 'Permanent redirect — passes ~99% of link equity. Ensure redirect target is correct.'
        : httpStatus===302 ? 'Temporary redirect — does NOT pass link equity. Use 301 for permanent moves.'
        : httpStatus===404 ? 'Page not found — Googlebot will drop this URL from index after several crawls.'
        : httpStatus===410 ? 'Gone — stronger signal than 404. Googlebot removes this URL from index faster.'
        : httpStatus===403 ? 'Forbidden — Googlebot cannot access this page. Will be dropped from index.'
        : httpStatus===503 ? 'Service Unavailable — Googlebot will retry. If persistent, URL gets dropped.'
        : 'Check server configuration for this status code.')
    +'</div>'
    +'</div></div>'

    
    +'<table style="width:100%;font-size:10px;border-collapse:collapse;">'
    +'<tr><td style="padding:3px 0;color:#64748b;width:40%;">HTTP Version</td>'
    +'<td style="font-weight:700;">'
      +(p.httpVersion==='h2'?'<span style="color:#16a34a;">HTTP/2 ✓</span>'
        :p.httpVersion==='h3'?'<span style="color:#16a34a;">HTTP/3 ✓</span>'
        :p.httpVersion==='http/1.1'?'<span style="color:#d97706;">HTTP/1.1 — consider upgrading to HTTP/2</span>'
        :'<span style="color:#94a3b8;">'+esc(p.httpVersion)+'</span>')
    +'</td></tr>'
    +'<tr><td style="padding:3px 0;color:#64748b;">Compression</td>'
    +'<td style="font-weight:700;">'
      +(p.isCompressed===true?'<span style="color:#16a34a;">Enabled ('+p.compressionRatio+'% smaller) ✓</span>'
        :p.isCompressed===false?'<span style="color:#d97706;">Not compressed — enable gzip or brotli</span>'
        :'<span style="color:#94a3b8;">N/A (cached or no data)</span>')
    +'</td></tr>'
    +'<tr><td style="padding:3px 0;color:#64748b;">Served from Cache</td>'
    +'<td style="font-weight:700;">'
      +(p.fromCache?'<span style="color:#16a34a;">Yes — browser cache ✓</span>'
        :'<span style="color:#475569;">No — fresh network request</span>')
    +'</td></tr>'
    +'<tr><td style="padding:3px 0;color:#64748b;">Redirects</td>'
    +'<td style="font-weight:700;">'
      +(p.redirectCount>0
        ?'<span style="color:#d97706;">'+p.redirectCount+' redirect(s) — each adds ~100-300ms latency</span>'
        :'<span style="color:#16a34a;">None ✓</span>')
    +'</td></tr>'
    +'<tr><td style="padding:3px 0;color:#64748b;">Navigation Type</td>'
    +'<td style="font-weight:700;color:#475569;">'+esc(p.navigationType||'unknown')+'</td></tr>'
    +'</table>';

  
  if (httpStatus && httpStatus !== 200) {
    const statusFixes = {
      301: 'Verify redirect destination is the final canonical URL. Avoid redirect chains (A→B→C).',
      302: 'If this is a permanent move, change to 301. 302 does not pass PageRank.',
      404: 'Either restore the page, redirect to relevant content with 301, or return 410 if permanently removed.',
      410: 'Good choice for permanently removed content. Googlebot will deindex faster than 404.',
      403: 'Check server permissions. If page should be public, fix server config. If private, add noindex.',
      503: 'Add Retry-After header so Googlebot knows when to retry. Fix server issues urgently.',
    };
    const fix = statusFixes[httpStatus];
    if (fix) {
      perfHtml += '<div style="background:rgba(0,0,0,0.05);padding:7px 10px;border-radius:4px;font-size:10px;margin-top:6px;">'
        +'<b>&#128161; Recommendation:</b> '+esc(fix)+'</div>';
    }
  }
  perfHtml += '</div>';

  perfHtml += '<div class="section-title">Performance Diagnostics & Recommendations</div>';

  const diagItems = [];

 
  if (p.ttfb > 200) {
    let ttfbTip = '';
    if (p.ttfb > 500) ttfbTip = 'TTFB is critically slow ('+p.ttfb+'ms, target <200ms). ';
    else              ttfbTip = 'TTFB is slow ('+p.ttfb+'ms, target <200ms). ';
    ttfbTip += 'Common causes: slow server response, no CDN, heavy server-side processing, large database queries, no server caching. '
      +'<b>Fix:</b> Enable server caching (Redis/Varnish), use a CDN (Cloudflare, Fastly), upgrade hosting, enable gzip/brotli compression.';
    diagItems.push({ level: p.ttfb>500?'danger':'warning', text: ttfbTip });
  }

 
  const rbScripts = p.renderBlockingScripts || [];
  if (rbScripts.length) {
    diagItems.push({
      level: 'danger',
      text: '<b>'+rbScripts.length+' render-blocking script(s) in &lt;head&gt;</b> delay page display. '
        +'Browser must download and execute these before rendering any HTML. '
        +'<b>Fix:</b> Add <code>async</code> or <code>defer</code> attribute to each script tag. Use <code>defer</code> for scripts that need DOM, <code>async</code> for independent scripts (analytics).',
      list: rbScripts.slice(0,5),
    });
  }

 
  const rbStyles = p.renderBlockingStyles || [];
  if (rbStyles.length > 3) {
    diagItems.push({
      level: 'warning',
      text: '<b>'+rbStyles.length+' render-blocking stylesheets</b>. Each CSS file blocks page rendering. '
        +'<b>Fix:</b> Combine CSS files, inline critical CSS in &lt;head&gt;, load non-critical CSS with media="print" onload trick, or use preload.',
      list: rbStyles.slice(0,3),
    });
  }

 
  const slow = p.slowResources || [];
  if (slow.length) {
    diagItems.push({
      level: 'warning',
      text: '<b>'+slow.length+' slow resource(s) taking >500ms each</b> — directly impact Full Load time and LCP. '
        +'<b>Fix:</b> Optimize images (compress, use WebP), enable CDN for static assets, check third-party script performance.',
      list: slow.map(r => r.url+' — <b>'+r.duration+'ms</b> ('+r.type+')'),
    });
  }

  
  if (p.thirdPartyRequests > 10) {
    diagItems.push({
      level: 'warning',
      text: '<b>'+p.thirdPartyRequests+' third-party requests</b> detected. Each third-party domain requires a separate DNS lookup, TCP connection, and TLS handshake, adding 100-300ms per domain. '
        +'<b>Fix:</b> Audit third-party scripts. Remove unused ones (old chat widgets, unused analytics). Use resource hints: <code>preconnect</code> for critical third-party domains.',
    });
  }

  
  if (clsVal !== null && clsVal > 0.1) {
    diagItems.push({
      level: clsVal > 0.25 ? 'danger' : 'warning',
      text: '<b>CLS is '+cwv.cls+'</b> (target ≤0.1). Layout shifts make the page visually unstable and hurt UX + Core Web Vitals score. '
        +'<b>Common causes:</b> images without width/height attributes ('+(d.images.filter(i=>!i.hasDimensions).length)+' found on page), '
        +'web fonts causing FOUT, iframes without fixed dimensions, dynamically injected content above existing content. '
        +'<b>Fix:</b> Add width/height to all images and iframes, use font-display:swap, avoid inserting content above fold after load.',
    });
  }

  
  if (cwv.lcp && cwv.lcp > 2500) {
    diagItems.push({
      level: cwv.lcp > 4000 ? 'danger' : 'warning',
      text: '<b>LCP is '+cwv.lcp+'ms</b> (target ≤2500ms). Largest Contentful Paint is too slow — this is a Core Web Vitals ranking factor. '
        +(cwv.lcpElement?'LCP element: <code>'+esc(cwv.lcpElement)+'</code>. ':' ')
        +'<b>Fix:</b> Preload the LCP image/element (<code>&lt;link rel="preload"&gt;</code>), use modern image formats (WebP/AVIF), avoid lazy-loading above-fold images, reduce TTFB.',
    });
  }

 
  if (cwv.longTasks > 2) {
    diagItems.push({
      level: cwv.longTasks > 5 ? 'danger' : 'warning',
      text: '<b>'+cwv.longTasks+' long tasks</b> detected (tasks >50ms blocking main thread). '
        +'These delay user interaction (INP metric) and make the page feel sluggish. '
        +'<b>Likely causes:</b> heavy JavaScript execution, large inline scripts, third-party tag managers. '
        +'<b>Fix:</b> Break large JS tasks into smaller chunks, use Web Workers for heavy computation, audit and reduce JavaScript payload.',
    });
  }

  
  if (!(p.resourceHints||[]).length && p.thirdPartyRequests > 3) {
    diagItems.push({
      level: 'warning',
      text: '<b>No resource hints found</b> despite '+p.thirdPartyRequests+' third-party requests. '
        +'<b>Fix:</b> Add <code>&lt;link rel="preconnect"&gt;</code> for critical third-party domains (Google Fonts, CDN, analytics) to save 100-300ms per domain on first connection.',
    });
  }

  if (diagItems.length === 0) {
    perfHtml += '<div class="alert alert-success">&#10003; No critical performance issues detected. Page looks well-optimized.</div>';
  } else {
    diagItems.forEach(item => {
      perfHtml += '<div class="alert alert-'+item.level+'" style="font-weight:400;">'
        + item.text
        + (item.list && item.list.length
            ? '<ul style="margin:6px 0 0 0;padding-left:16px;font-size:10px;">'
              + item.list.map(u=>'<li style="margin-bottom:2px;word-break:break-all;">'+esc(u)+'</li>').join('')
              + '</ul>'
            : '')
        + '</div>';
    });
  }

  
  const fwC = {'Next.js':'blue','Nuxt.js':'teal','React':'blue','Vue.js':'green','Angular':'red','Svelte':'orange','Gatsby':'purple','Unknown':'gray'}[d.rendering.fw]||'gray';
  const rtC = /CSR/.test(d.rendering.rt)?'orange':'green';
  const rtTip = /SSR|SSG/.test(d.rendering.rt)
    ?'Googlebot sees fully-rendered HTML on first request. Best for SEO.'
    :/CSR/.test(d.rendering.rt)
    ?'CSR detected — Googlebot must execute JavaScript to see content. Google crawls JS pages but with a delay (days to weeks). Critical content may not be indexed. Consider switching to SSR or SSG for SEO-critical pages.'
    :'Rendering mode estimated from DOM structure.';
  const signalsHtml = d.rendering.signals.length
    ?'<div style="margin-top:7px;font-size:10px;color:#475569;">Signals: '+d.rendering.signals.map(s=>b(s,'gray')).join(' ')+'</div>':'';

  perfHtml += '<div class="section-title">Rendering Detection</div>'
    +'<div style="background:#fff;border:1px solid #e2e8f0;border-radius:5px;padding:10px;margin-bottom:8px;">'
    +'<span class="badge bg-'+fwC+'" style="font-size:11px;padding:3px 10px;">'+esc(d.rendering.fw)+'</span> '
    +'<span class="badge bg-'+rtC+'" style="font-size:11px;padding:3px 10px;">'+esc(d.rendering.rt)+'</span>'
    +signalsHtml
    +'<div style="margin-top:7px;font-size:10px;color:#475569;">'+esc(rtTip)+'</div></div>';

  
  const hints = p.resourceHints || [];
  if (hints.length) {
    let hBody='<div style="font-size:10px;color:#475569;margin-bottom:6px;">Preload/preconnect hints speed up resource loading by telling browser about resources in advance.</div>';
    hBody+='<table class="data-table list-table"><thead><tr><th style="width:20%">rel</th><th style="width:15%">as</th><th>URL</th></tr></thead><tbody>';
    hints.forEach(h=>{ hBody+='<tr><td>'+b(h.rel,'blue')+'</td><td>'+esc(h.as)+'</td><td style="font-size:10px;"><a href="'+esc(h.href)+'" target="_blank" style="color:#2980b9;">'+esc(h.href)+'</a></td></tr>'; });
    hBody+='</tbody></table>';
    perfHtml += collapsible('Resource Hints (preload/prefetch/preconnect)', b(hints.length,'blue'), hBody, false);
  }

  
  const inlineScripts = p.inlineScripts || [];
  let inlineSBody = !inlineScripts.length
    ?'<div style="color:#94a3b8;padding:6px;">No inline scripts found — good, inline scripts block rendering.</div>':'';
  if (inlineScripts.length) {
    inlineSBody += '<div style="font-size:10px;color:#475569;margin-bottom:6px;padding:6px;background:#fef9c3;border-radius:3px;">'
      +'<b>Why it matters:</b> Inline scripts in &lt;head&gt; block HTML parsing. Inline scripts in body delay rendering. '
      +'Analytics scripts (GTM, GA) are normal but should use async loading.</div>';
  }
  inlineScripts.forEach(s=>{
    inlineSBody+='<div style="margin-bottom:8px;"><div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">'
      +'<b style="font-size:10px;">Script #'+s.index+'</b> '+b(s.location,s.location==='HEAD'?'blue':'orange')+' '
      +(s.isAnalytics?b('Analytics/Tracking','yellow'):b('General JS','gray'))
      +'<span style="margin-left:auto;font-size:9px;color:#94a3b8;">'+s.length+' chars</span></div>'
      +'<div class="code-item">'+esc(s.preview)+(s.length>200?'\n... ['+s.length+' chars total]':'')+'</div></div>';
  });
  perfHtml += collapsible('Inline Scripts', b(inlineScripts.length, inlineScripts.length>5?'red':inlineScripts.length>2?'orange':'green'), inlineSBody, inlineScripts.length>0);

  
  const inlineStyles = p.inlineStyles || [];
  let inlineCBody = !inlineStyles.length
    ?'<div style="color:#94a3b8;padding:6px;">No inline style blocks found.</div>':'';
  if (inlineStyles.length) {
    inlineCBody += '<div style="font-size:10px;color:#475569;margin-bottom:6px;padding:6px;background:#fef9c3;border-radius:3px;">'
      +'<b>Why it matters:</b> Inline &lt;style&gt; blocks are fine for critical CSS but large inline styles inflate HTML size and prevent browser caching.</div>';
  }
  inlineStyles.forEach(s=>{
    inlineCBody+='<div style="margin-bottom:8px;"><div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">'
      +'<b style="font-size:10px;">&lt;style&gt; #'+s.index+'</b> '+b(s.location,s.location==='HEAD'?'blue':'orange')
      +'<span style="margin-left:auto;font-size:9px;color:#94a3b8;">'+s.length+' chars</span></div>'
      +'<div class="code-item">'+esc(s.preview)+(s.length>200?'\n... ['+s.length+' chars total]':'')+'</div></div>';
  });
  perfHtml += collapsible('Inline Style Blocks', b(inlineStyles.length, inlineStyles.length>3?'orange':'green'), inlineCBody, inlineStyles.length>0);

  
  const extScripts = p.extScripts || [];
  let extSBody = '';
  if (!extScripts.length) {
    extSBody = '<div style="color:#94a3b8;padding:6px;">No external scripts found.</div>';
  } else {
    const blocking = extScripts.filter(s=>!s.async&&!s.defer&&s.location==='HEAD').length;
    if (blocking) {
      extSBody = '<div class="alert alert-danger">&#10060; <b>'+blocking+' render-blocking script(s) in &lt;head&gt;</b> — browser stops rendering HTML until these fully download and execute.'
        +'<br><b>Fix:</b> Add <code>defer</code> attribute (keeps execution order) or <code>async</code> (executes as soon as downloaded, no order guarantee).</div>';
    } else {
      extSBody = '<div class="alert alert-success">&#10003; All external scripts use async or defer — no render-blocking issues.</div>';
    }
    extSBody += '<table class="data-table list-table"><thead><tr>'
      +'<th style="width:52%">URL</th><th style="width:12%">Loc</th><th style="width:21%">Loading</th><th style="width:15%">SRI</th>'
      +'</tr></thead><tbody>';
    extScripts.forEach(s=>{
      const loading = s.defer?b('defer — OK','green'):s.async?b('async — OK','blue'):b('BLOCKING','red');
      const sri     = s.integrity?b('SRI ✓','green'):b('No SRI','orange');
      extSBody += '<tr><td><a href="'+esc(s.src)+'" target="_blank" style="color:#2980b9;text-decoration:none;">'+esc(s.src)+'</a></td>'
        +'<td>'+b(s.location,s.location==='HEAD'?'blue':'gray')+'</td><td>'+loading+'</td><td>'+sri+'</td></tr>';
    });
    extSBody += '</tbody></table>';
    extSBody += tipBox('Scripts with <b>blocking</b> badge need async or defer. Scripts in BODY are less critical but async/defer is still recommended. SRI (Subresource Integrity) protects against CDN tampering — add integrity hash for third-party scripts.');
  }
  perfHtml += collapsible('External Scripts', b(extScripts.length,'gray'), extSBody, false);

  
  const extStyles = p.extStyles || [];
  let extCBody = '';
  if (!extStyles.length) {
    extCBody = '<div style="color:#94a3b8;padding:6px;">No external stylesheets found.</div>';
  } else {
    extCBody = '<div style="font-size:10px;color:#475569;margin-bottom:6px;padding:6px;background:#f0f9ff;border-radius:3px;">'
      +'All CSS files block rendering by default. Reduce CSS file count, enable HTTP/2, use media queries for non-critical styles.</div>';
    extCBody += '<table class="data-table list-table"><thead><tr>'
      +'<th style="width:63%">URL</th><th style="width:22%">Media</th><th style="width:15%">SRI</th>'
      +'</tr></thead><tbody>';
    extStyles.forEach(s=>{
      const sri = s.integrity?b('SRI ✓','green'):b('No SRI','orange');
      extCBody += '<tr><td><a href="'+esc(s.href)+'" target="_blank" style="color:#2980b9;text-decoration:none;">'+esc(s.href)+'</a></td>'
        +'<td>'+b(s.media||'all','gray')+'</td><td>'+sri+'</td></tr>';
    });
    extCBody += '</tbody></table>';
  }
  perfHtml += collapsible('External Stylesheets', b(extStyles.length,'gray'), extCBody, false);

  if (p.favicon && p.favicon.found) {
    perfHtml += '<div class="section-title">Favicon</div><table class="data-table">'
      +'<tr><th>rel</th><td>'+esc(p.favicon.rel)+'</td></tr>'
      +'<tr><th>href</th><td><a href="'+esc(p.favicon.href)+'" target="_blank" style="color:#2980b9;">'+esc(p.favicon.href)+'</a></td></tr>'
      +'</table>';
  }
  document.getElementById('tab-perf').innerHTML = perfHtml;

  
  const sec = d.security;
  const cr  = d.crawl;
  let secHtml = '';

  secHtml += '<div class="section-title">Security</div>';
  secHtml += '<table class="data-table">'
    +'<tr><th>Protocol</th><td>'+(sec.isHttps?b('HTTPS — Secure','green'):b('HTTP — Not Secure!','red'))
      +(sec.isHttps?'':'<br>'+tipBox('Switch to HTTPS immediately. Google uses HTTPS as a ranking signal. Without it, Chrome shows "Not Secure" warning — kills user trust and conversions.'))
    +'</td></tr>'
    +'<tr><th>Mixed Content</th><td>'+(sec.mixedContent.length?b(sec.mixedContent.length+' HTTP resource(s) on HTTPS page','red'):b('None detected','green'))
      +(sec.mixedContent.length?'<br><small style="color:#991b1b;">HTTP resources on HTTPS page — browser may block them, causing broken images/scripts.</small>':'')
    +'</td></tr>'
    +'<tr><th>External Links</th><td>'+(sec.unsafeLinks?b(sec.unsafeLinks+' target=_blank without noopener','orange'):b('All safe','green'))
      +(sec.unsafeLinks?'<br><small style="color:#92400e;">Missing rel="noopener noreferrer" allows opened page to access your window object via window.opener.</small>':'')
    +'</td></tr>'
    +'<tr><th>CSP Meta Tag</th><td>'+(sec.csp?b('Present','green')+'<br><span style="font-size:9px;color:#64748b;">'+esc(sec.csp.slice(0,80))+'...</span>':b('Not set','orange')+'<br><small style="color:#92400e;">Content Security Policy prevents XSS attacks. Not critical for SEO but important for security.</small>')+'</td></tr>'
    +'<tr><th>SRI</th><td>'+b(sec.sriCount+' resource(s) with integrity attr',sec.sriCount>0?'green':'gray')+'</td></tr>'
    +'<tr><th>Base Tag</th><td>'+(sec.baseHref?b('Present — verify carefully','orange')+'<br><span style="font-size:9px;">'+esc(sec.baseHref)+'</span><br><small>base href changes all relative URLs on page — can break links and canonical signals.</small>':b('Not set','green'))+'</td></tr>'
    +'</table>';

  if (sec.mixedContent.length) {
    let mcBody = '<table class="data-table list-table"><tbody>';
    sec.mixedContent.slice(0,20).forEach(url=>{
      mcBody += '<tr><td style="font-size:10px;"><a href="'+esc(url)+'" target="_blank" style="color:#dc2626;">'+esc(url)+'</a></td></tr>';
    });
    mcBody += '</tbody></table>';
    secHtml += collapsible('Mixed Content URLs', b(sec.mixedContent.length,'red'), mcBody, true);
  }

  if (sec.forms.length) {
    const crossForms = sec.forms.filter(f=>f.isCross);
    if (crossForms.length) secHtml += '<div class="alert alert-danger">&#10060; '+crossForms.length+' form(s) submitting to external domain — potential data leak or phishing risk!</div>';
    let fBody = '<table class="data-table list-table"><thead><tr><th style="width:15%">Method</th><th style="width:85%">Action</th></tr></thead><tbody>';
    sec.forms.forEach(f=>{
      fBody += '<tr><td>'+b(f.method.toUpperCase(),'gray')+'</td>'
        +'<td style="font-size:10px;'+(f.isCross?'color:#dc2626;':'')+'">'+esc(f.action||'[no action — submits to same page]')+'</td></tr>';
    });
    fBody += '</tbody></table>';
    secHtml += collapsible('Forms on Page', b(sec.forms.length+(crossForms.length?' ('+crossForms.length+' cross-domain!)':''),'gray'), fBody, false);
  }

  secHtml += '<div class="section-title">Crawlability</div>';
  secHtml += '<table class="data-table">'
    +'<tr><th>Robots Meta</th><td>'+(cr.robotsMeta||'<span style="color:#94a3b8;">Not set (default: index, follow)</span>')+'<br>'
      +(cr.noindex?b('NOINDEX — page will NOT be indexed!','red'):b('Indexable','green'))+' '
      +(cr.nofollow?b('nofollow','orange'):'')+' '
      +(cr.noarchive?b('noarchive','orange'):'')+' '
      +(cr.nosnippet?b('nosnippet','orange'):'')+' '
      +(cr.noimageindex?b('noimageindex','orange'):'')
    +'</td></tr>'
    +(cr.googlebot?'<tr><th>Googlebot</th><td>'+esc(cr.googlebot)+'<br><small style="color:#64748b;">Overrides generic robots meta for Googlebot specifically.</small></td></tr>':'')
    +(cr.bingbot?'<tr><th>Bingbot</th><td>'+esc(cr.bingbot)+'</td></tr>':'')
    +'<tr><th>Total Links</th><td>'+(cr.tooManyLinks?b(cr.totalLinks+' links — exceeds 150 recommendation','orange'):b(cr.totalLinks+' links OK','green'))
      +(cr.tooManyLinks?'<br><small style="color:#92400e;">Google recommends keeping crawlable links per page under 150 to conserve crawl budget.</small>':'')
    +'</td></tr>'
    +'<tr><th>Homepage Link</th><td>'+(cr.hasHomepageLink?b('Present','green'):b('Not found','orange'))
      +(!cr.hasHomepageLink?'<br><small style="color:#92400e;">No link to homepage found — may indicate navigation issues or orphaned page.</small>':'')
    +'</td></tr>'
    +'<tr><th>data-nosnippet</th><td>'+(cr.dataNoSnippet?b(cr.dataNoSnippet+' zone(s)','orange'):b('None','green'))
      +(cr.dataNoSnippet?'<br><small>Zones marked data-nosnippet are excluded from Google search snippets/descriptions.</small>':'')
    +'</td></tr>'
    +'<tr><th>Meta Refresh</th><td>'+(cr.metaRefresh?b('Present: '+esc(cr.metaRefresh),'orange')+'<br><small>Meta refresh redirects are bad for SEO — use 301 server-side redirect instead.</small>':b('None','green'))+'</td></tr>'
    +'<tr><th>Iframes</th><td>'+(cr.iframeCount?b(cr.iframeCount+' found','orange'):b('None','green'))
      +(cr.iframeCount?'<br><small>Google may not index iframe content. Third-party iframes hurt performance.</small>':'')
    +'</td></tr>'
    +'</table>';

  if (cr.iframes && cr.iframes.length) {
    const tpCount = cr.iframes.filter(f=>f.isThirdParty).length;
    let ifrBody = '<table class="data-table list-table"><thead><tr>'
      +'<th style="width:35%">src</th><th style="width:13%">Location</th><th style="width:12%">Party</th>'
      +'<th style="width:13%">Loading</th><th style="width:27%">Sandbox</th>'
      +'</tr></thead><tbody>';
    cr.iframes.forEach(f=>{
      const srcD = f.src
        ?'<a href="'+esc(f.src)+'" target="_blank" style="color:#2980b9;text-decoration:none;">'+esc(f.src)+'</a>'
        :'<span style="color:#94a3b8;">[no src — JS injected]</span>';
      const titleR = f.title
        ?'<div style="font-size:9px;color:#64748b;">title: '+esc(f.title)+'</div>'
        :'<div style="font-size:9px;color:#dc2626;">&#9888; no title</div>';
      const sb = f.sandbox==='not set'?b('no sandbox','red'):f.sandbox==='[empty]'?b('fully sandboxed','green'):b('partial','orange');
      ifrBody += '<tr>'
        +'<td>'+srcD+titleR+'</td>'
        +'<td>'+b(f.location,'gray')+'</td>'
        +'<td>'+(f.isThirdParty?b('3rd party','orange'):b('1st party','green'))+'</td>'
        +'<td>'+(f.loading==='lazy'?b('lazy','blue'):b(f.loading||'auto','gray'))+'</td>'
        +'<td>'+sb+(f.sandbox!=='not set'&&f.sandbox!=='[empty]'?'<div style="font-size:8px;color:#94a3b8;">'+esc(f.sandbox)+'</div>':'')+'</td>'
        +'</tr>';
    });
    ifrBody += '</tbody></table>';
    ifrBody += tipBox('Add <code>loading="lazy"</code> to all iframes. Add <code>title</code> attribute for accessibility. '
      +'Add <code>sandbox</code> attribute to restrict iframe permissions. Use <code>preconnect</code> for YouTube/Maps iframes to pre-establish connection.');
    secHtml += collapsible('Iframe Details', b(cr.iframes.length+(tpCount?' ('+tpCount+' 3rd party)':''),'orange'), ifrBody, true);
  }
  document.getElementById('tab-security').innerHTML = secHtml;

  
  let advHtml = '';

  
  advHtml += '<div class="section-title">SEO Conflict Detector</div>';
  if (!d.seoConflicts.length) {
    advHtml += '<div class="alert alert-success">&#10003; No SEO logic conflicts detected. Page signals are consistent.</div>';
  } else {
    d.seoConflicts.forEach(c => {
      advHtml += '<div class="alert alert-'+(c.severity==='error'?'danger':'warning')+'" style="font-weight:400;">'
        +'<div style="font-weight:700;margin-bottom:4px;">'
        +(c.severity==='error'?'&#10060; ':'&#9888; ')
        +'['+esc(c.type)+']</div>'
        +'<div style="margin-bottom:4px;">'+esc(c.detail)+'</div>'
        +(c.current?'<div style="font-size:10px;margin-bottom:2px;"><b>Found:</b> '+esc(c.current)+'</div>':'')
        +(c.expected?'<div style="font-size:10px;margin-bottom:4px;"><b>Expected:</b> '+esc(c.expected)+'</div>':'')
        +'<div style="font-size:10px;background:rgba(0,0,0,0.06);padding:4px 7px;border-radius:3px;">'
        +'<b>&#128161; Fix:</b> '+esc(c.fix)+'</div>'
        +'</div>';
    });
  }

  
  advHtml += '<div class="section-title">Hidden Content / Cloaking Detector</div>';
  if (!d.hiddenContent.length) {
    advHtml += '<div class="alert alert-success">&#10003; No hidden text or cloaking patterns detected.</div>';
  } else {
    advHtml += '<div class="alert alert-danger">&#10060; <b>'+d.hiddenContent.length+' hidden element(s) with text content found!</b> '
      +'This may be intentional (modals, accordions, tabs) or cloaking (showing different content to users vs Googlebot). '
      +'Google can detect and penalize deliberate cloaking.</div>';
    advHtml += tipBox('Review each hidden element below. Accordions/tabs/modals are fine — Google indexes them. '
      +'Off-screen text, invisible text (same color as background), and font-size:0 tricks are cloaking signals and can cause manual penalties.');
    let hcBody = '<table class="data-table list-table"><thead><tr>'
      +'<th style="width:15%">Tag</th><th style="width:25%">Reason</th><th style="width:60%">Text snippet</th>'
      +'</tr></thead><tbody>';
    d.hiddenContent.forEach(h=>{
      const reasonColor = h.reason.includes('off-screen')||h.reason.includes('color')||h.reason.includes('font-size')
        ?'red':'orange';
      hcBody += '<tr>'
        +'<td><code>'+esc(h.tag)+(h.id?'#'+esc(h.id):'')+(h.cls?'.'+esc(h.cls):'')+'</code></td>'
        +'<td>'+b(h.reason, reasonColor)+'</td>'
        +'<td style="color:#64748b;font-style:italic;">'+esc(h.textSnip)+(h.textSnip.length>=100?'...':'')+'</td>'
        +'</tr>';
    });
    hcBody += '</tbody></table>';
    advHtml += collapsible('Hidden Elements Detail', b(d.hiddenContent.length,'red'), hcBody, true);
  }

  
  advHtml += '<div class="section-title">URL Analysis</div>';
  const ua = d.urlAnalysis;
  const urlIssues = [];
  if (ua.hasUppercase)     urlIssues.push('Uppercase letters in URL — use lowercase only (case-sensitive servers treat /Page and /page as different URLs)');
  if (ua.hasUnderscores)   urlIssues.push('Underscores found — Google treats "black_hat" as one word; use hyphens: "black-hat" = two words');
  if (ua.urlLength > 115)  urlIssues.push('URL too long ('+ua.urlLength+' chars) — recommended max 115. Long URLs are harder to share and may be truncated in SERPs');
  if (ua.depth > 4)        urlIssues.push('Deep nesting: '+ua.depth+' levels — recommended max 3-4. Deep pages get less crawl budget');
  if (ua.hasParams)        urlIssues.push(ua.paramCount+' URL parameter(s) — can cause duplicate content. Use canonical tags or configure Google Search Console URL params');
  if (ua.stopWords.length) urlIssues.push('Stop words in slug: "'+ua.stopWords.join('", "')+'" — removing them makes URLs shorter and cleaner');
  advHtml += urlIssues.length
    ? urlIssues.map(i=>'<div class="alert alert-warning" style="font-weight:400;">&#9888; '+esc(i)+'</div>').join('')
    : '<div class="alert alert-success">&#10003; URL looks clean and SEO-friendly</div>';
  advHtml += '<table class="data-table">'
    +'<tr><th>Path</th><td style="word-break:break-all;">'+esc(ua.path)+'</td></tr>'
    +'<tr><th>Depth</th><td>'+b(ua.depth+' levels',ua.depth>4?'orange':'green')+'</td></tr>'
    +'<tr><th>Length</th><td>'+b(ua.urlLength+' chars',ua.urlLength>115?'orange':'green')+'</td></tr>'
    +'<tr><th>Parameters</th><td>'+(ua.hasParams?b(ua.paramCount+' found','orange'):b('None','green'))+'</td></tr>'
    +'<tr><th>Uppercase</th><td>'+(ua.hasUppercase?b('Found','orange'):b('None','green'))+'</td></tr>'
    +'<tr><th>Underscores</th><td>'+(ua.hasUnderscores?b('Found','orange'):b('None','green'))+'</td></tr>'
    +'<tr><th>Trailing Slash</th><td>'+b(ua.trailingSlash?'Yes':'No','gray')
      +'<small style="color:#94a3b8;"> — be consistent across all pages to avoid duplicate content</small></td></tr>'
    +'<tr><th>Fragment (#)</th><td>'+b(ua.hasFragment?'Yes':'No',ua.hasFragment?'orange':'gray')
      +(ua.hasFragment?'<br><small>Fragments are not sent to server — Google ignores them for indexing. Don\'t use as canonical differentiator.</small>':'')
    +'</td></tr>'
    +'</table>';

  
  advHtml += '<div class="section-title">Keyword Density — Top 15 Words</div>';
  if (d.content.topKeywords.length) {
    advHtml += '<div style="font-size:10px;color:#475569;margin-bottom:6px;">Top 3 keywords (blue) should match your target search queries. Density >3% for any single word may look spammy to Google.</div>';
    advHtml += '<table class="data-table list-table"><thead><tr>'
      +'<th style="width:40%">Keyword</th><th style="width:15%">Count</th><th style="width:45%">Density</th>'
      +'</tr></thead><tbody>';
    d.content.topKeywords.forEach((kw,i)=>{
      const barW   = Math.min(100,Math.round((kw.count/d.content.topKeywords[0].count)*100));
      const isHigh = parseFloat(kw.density) > 3;
      advHtml += '<tr>'
        +'<td><b style="color:'+(i<3?'#2980b9':'#334155')+';">'+esc(kw.word)+'</b>'+(isHigh?' '+b('High density','orange'):'')+'</td>'
        +'<td>'+kw.count+'</td>'
        +'<td><div style="display:flex;align-items:center;gap:5px;">'
        +'<div style="background:#e2e8f0;border-radius:2px;height:7px;width:80px;overflow:hidden;">'
        +'<div style="background:'+(isHigh?'#f59e0b':i<3?'#2980b9':'#94a3b8')+';width:'+barW+'%;height:100%;"></div></div>'
        +'<span style="font-size:9px;color:'+(isHigh?'#d97706':'#64748b')+';">'+kw.density+'%</span>'
        +'</div></td></tr>';
    });
    advHtml += '</tbody></table>';
    if (d.content.longParagraph > 0) {
      advHtml += '<div class="alert alert-warning" style="font-weight:400;">&#9888; <b>'+d.content.longParagraph+' paragraph(s) with 150+ words.</b> '
        +'Long walls of text hurt readability and dwell time. Break into shorter paragraphs (50-100 words max), add subheadings (H2/H3), use bullet points.</div>';
    }
    if (d.content.thinContent) {
      advHtml += '<div class="alert alert-danger" style="font-weight:400;">&#10060; <b>Thin content: only '+d.content.wordCount+' words.</b> '
        +'Google\'s Panda algorithm targets thin content. Pages under 300 words rarely rank well for competitive terms. '
        +'Aim for 600-1200+ words for informational pages, 300+ for commercial pages.</div>';
    }
  } else {
    advHtml += '<div class="alert alert-gray">No keyword data available.</div>';
  }

  
  advHtml += '<div class="section-title">Hreflang Tags</div>';
  if (!d.hreflang.length) {
    advHtml += '<div class="alert alert-gray">No hreflang tags found. Add if targeting multiple languages or regions. Without hreflang, Google may show the wrong language version to users.</div>';
  } else {
    const hasXDefault = d.hreflang.some(h=>h.lang==='x-default');
    if (!hasXDefault && d.hreflang.length > 1) {
      advHtml += '<div class="alert alert-warning">&#9888; Missing x-default hreflang — add <code>hreflang="x-default"</code> as fallback for unmatched languages.</div>';
    } else {
      advHtml += '<div class="alert alert-success">&#10003; '+d.hreflang.length+' hreflang tag(s) found'+(hasXDefault?' including x-default':'')+'</div>';
    }
    advHtml += '<table class="data-table list-table"><thead><tr><th style="width:18%">Lang</th><th>URL</th></tr></thead><tbody>';
    d.hreflang.forEach(h=>{
      advHtml += '<tr><td>'+b(h.lang,h.lang==='x-default'?'blue':'gray')+'</td>'
        +'<td style="font-size:10px;"><a href="'+esc(h.href)+'" target="_blank" style="color:#2980b9;">'+esc(h.href)+'</a></td></tr>';
    });
    advHtml += '</tbody></table>';
  }

  
  advHtml += '<div class="section-title">Pagination (rel=prev/next)</div>';
  if (!d.pagination.next && !d.pagination.prev) {
    advHtml += '<div class="alert alert-gray">No rel=prev/next tags found. Note: Google deprecated rel=prev/next for pagination in 2019, but it still helps Bing and improves crawl efficiency for large paginated series.</div>';
  } else {
    advHtml += '<div class="alert alert-info">&#8505; Pagination tags found. Ensure each paginated page has a self-referencing canonical to prevent duplicate content.</div>';
    advHtml += '<table class="data-table">';
    if (d.pagination.prev) advHtml += '<tr><th>rel=prev</th><td style="font-size:10px;"><a href="'+esc(d.pagination.prev)+'" target="_blank" style="color:#2980b9;">'+esc(d.pagination.prev)+'</a></td></tr>';
    if (d.pagination.next) advHtml += '<tr><th>rel=next</th><td style="font-size:10px;"><a href="'+esc(d.pagination.next)+'" target="_blank" style="color:#2980b9;">'+esc(d.pagination.next)+'</a></td></tr>';
    advHtml += '</table>';
  }

  
  advHtml += '<div class="section-title">Affiliate Links</div>';
  if (!d.affiliateLinks.length) {
    advHtml += '<div class="alert alert-success">&#10003; No affiliate link patterns detected</div>';
  } else {
    advHtml += '<div class="alert alert-warning" style="font-weight:400;">&#9888; <b>'+d.affiliateLinks.length+' affiliate link(s) detected.</b> '
      +'Per Google\'s guidelines, affiliate links must have <code>rel="sponsored"</code>. Undisclosed affiliate links can trigger manual actions. '
      +'Ensure each link below has sponsored attribute.</div>';
    advHtml += '<table class="data-table list-table"><thead><tr><th style="width:35%">Anchor</th><th>URL</th></tr></thead><tbody>';
    d.affiliateLinks.forEach(l=>{
      advHtml += '<tr><td>'+esc(l.anchor)+'</td><td style="font-size:10px;"><a href="'+esc(l.url)+'" target="_blank" style="color:#2980b9;">'+esc(l.url)+'</a></td></tr>';
    });
    advHtml += '</tbody></table>';
  }

  document.getElementById('tab-advanced').innerHTML = advHtml;
}
