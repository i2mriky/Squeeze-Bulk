/* 2mriky Squeeze Bulk — v2
 * نفس الملف بيشتغل كـ UI في الصفحة وكـ Web Worker للمعالجة.
 * كل المعالجة جوه المتصفح. مفيش أي رفع لأي سيرفر.
 */
const CDN = 'https://cdn.jsdelivr.net/npm/';
const PKG = {
  jpeg: '@jsquash/jpeg@1.6.0',
  png: '@jsquash/png@3.1.1',
  webp: '@jsquash/webp@1.5.0',
  avif: '@jsquash/avif@2.1.1',
  oxipng: '@jsquash/oxipng@2.3.0',
  resize: '@jsquash/resize@2.1.1',
  imageq: 'image-q@4.0.0',
  pdflib: 'pdf-lib@1.17.1',
  pdfjs: 'pdfjs-dist@4.10.38',
  heif: 'libheif-js@1.23.2',
  utif: 'utif2@4.1.0',
  pako: 'pako@2.1.0',
  svgo: 'svgo@3.3.5',
};
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', pdf: 'pdf', svg: 'svg' };
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', svg: 'image/svg+xml', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', tiff: 'image/tiff' };
const LABEL = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', pdf: 'PDF', svg: 'SVG', gif: 'GIF', bmp: 'BMP', avif: 'AVIF', heic: 'HEIC', tiff: 'TIFF' };
// الصيغ اللي مينفعش نطلّعها زي ما هي: بتتحول للأقرب ليها
const SAME_FALLBACK = { heic: 'jpeg', tiff: 'jpeg', avif: 'webp', bmp: 'png', gif: 'png' };

const IS_WORKER = typeof window === 'undefined' && typeof self !== 'undefined';
if (IS_WORKER) initWorker(); else initApp();

/* ================================================================
 * Shared helpers
 * ================================================================ */
function extToFmt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  if (!m) return null;
  const e = m[1].toLowerCase();
  if (e === 'jpg' || e === 'jpeg' || e === 'jfif' || e === 'jpe') return 'jpeg';
  if (e === 'png') return 'png';
  if (e === 'webp') return 'webp';
  if (e === 'pdf') return 'pdf';
  if (e === 'svg') return 'svg';
  if (e === 'gif') return 'gif';
  if (e === 'bmp') return 'bmp';
  if (e === 'avif') return 'avif';
  if (e === 'heic' || e === 'heif') return 'heic';
  if (e === 'tif' || e === 'tiff') return 'tiff';
  return null;
}
function splitName(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, i), ext: name.slice(i) };
}

/* ================================================================
 * WORKER
 * ================================================================ */
function initWorker() {
  const cache = {};
  const once = (k, fn) => (cache[k] ||= fn().catch((e) => { delete cache[k]; throw e; }));
  const bufOf = (u8) => (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer);

  const L = {
    jpegEnc: () => once('jpegEnc', async () => (await import(CDN + PKG.jpeg + '/encode.js')).default),
    jpegDec: () => once('jpegDec', async () => (await import(CDN + PKG.jpeg + '/decode.js')).default),
    pngDec: () => once('pngDec', async () => (await import(CDN + PKG.png + '/decode.js')).decode),
    webpDec: () => once('webpDec', async () => (await import(CDN + PKG.webp + '/decode.js')).default),
    avifDec: () => once('avifDec', async () => (await import(CDN + PKG.avif + '/decode.js')).default),
    webpEnc: () => once('webpEnc', async () => {
      // نستورد الكوديك مباشرة (الـ wrapper فيه bare import مش بيشتغل من CDN)
      const simd = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]));
      const file = simd ? 'webp_enc_simd.js' : 'webp_enc.js';
      const [{ default: factory }, meta] = await Promise.all([
        import(CDN + PKG.webp + '/codec/enc/' + file),
        import(CDN + PKG.webp + '/meta.js'),
      ]);
      const mod = await factory({ noInitialRun: true });
      return (img, opts) => {
        const r = mod.encode(img.data, img.width, img.height, { ...meta.defaultOptions, ...opts });
        if (!r) throw new Error('WebP encode failed');
        return new Uint8Array(r);
      };
    }),
    oxipng: () => once('oxipng', async () => {
      const m = await import(CDN + PKG.oxipng + '/codec/pkg/squoosh_oxipng.js');
      await m.default();
      return m.optimise_raw;
    }),
    resize: () => once('resize', async () => (await import(CDN + PKG.resize + '/index.js')).default),
    imageq: () => once('imageq', async () => await import(CDN + PKG.imageq + '/dist/esm/image-q.mjs')),
    pdflib: () => once('pdflib', async () => await import(CDN + PKG.pdflib + '/dist/pdf-lib.esm.min.js')),
    heif: () => once('heif', async () => {
      const m = await import(CDN + PKG.heif + '/libheif-wasm/libheif-bundle.mjs');
      const lib = await m.default();
      return lib;
    }),
    utif: () => once('utif', async () => {
      self.pako = await import(CDN + PKG.pako + '/dist/pako.esm.mjs');
      await import(CDN + PKG.utif + '/UTIF.js');
      return self.UTIF;
    }),
    svgo: () => once('svgo', async () => (await import(CDN + PKG.svgo + '/dist/svgo.browser.js')).optimize),
  };

  self.onmessage = async (e) => {
    const { jobId, type } = e.data;
    try {
      let r;
      if (type === 'image') r = await processImage(new Uint8Array(e.data.buf), e.data.name, e.data.settings);
      else if (type === 'raw') r = await processRaw(e.data);
      else if (type === 'svg') r = await processSvg(new Uint8Array(e.data.buf), e.data.settings);
      else if (type === 'pdf') r = await compressPdf(new Uint8Array(e.data.buf), e.data.settings);
      else if (type === 'buildpdf') r = await buildPdf(e.data);
      else if (type === 'preview') r = await previewImage(new Uint8Array(e.data.buf), e.data.name);
      else throw new Error('job?');
      const transfer = [];
      if (r.out) transfer.push(r.out.buffer);
      if (r.thumb) transfer.push(r.thumb.buffer);
      self.postMessage({ jobId, ok: true, ...r }, transfer);
    } catch (err) {
      self.postMessage({ jobId, ok: false, error: (err && err.message) || String(err) });
    }
  };

  /* ================= images ================= */
  async function processImage(src, name, s) {
    const srcFmt = sniff(src);
    if (!srcFmt || srcFmt === 'pdf') throw new Error('صيغة مش مدعومة');
    const nameFmt = extToFmt(name) || srcFmt;
    let outFmt = s.format === 'same' ? (SAME_FALLBACK[nameFmt] || nameFmt) : s.format;
    if (!EXT[outFmt] || outFmt === 'pdf' || outFmt === 'svg') outFmt = SAME_FALLBACK[srcFmt] || srcFmt;

    // GIF: "زي الأصل" = يفضل زي ما هو (الأنيميشن ما يضيعش)
    if (srcFmt === 'gif' && s.format === 'same') {
      return keepAsIs(src, srcFmt, isAnimatedGif(src) ? 'gifAnim' : 'gifSame');
    }

    const meta = await readMeta(src, srcFmt);
    let img = await decode(src, srcFmt);
    if (meta.orientation > 1 && !img.__oriented) img = applyOrientation(img, meta.orientation);
    const w0 = img.width, h0 = img.height;

    const [w1, h1] = fitDims(w0, h0, s);
    const resized = w1 !== w0 || h1 !== h0;
    if (resized) img = await resizeTo(img, w1, h1, 'lanczos3');

    const hasAlpha = checkAlpha(img);
    // TIFF/HEIC فيهم شفافية؟ نطلعهم PNG بدل JPG عشان الشفافية ما تضيعش
    if (s.format === 'same' && outFmt === 'jpeg' && nameFmt !== 'jpeg' && hasAlpha) outFmt = 'png';
    const target = s.targetOn ? Math.max(1, s.targetKB) * 1000 : 0;
    const enc = await encodeSmart(img, outFmt, s, hasAlpha, target);

    let out = await addMeta(enc.bytes, outFmt, meta, s.strip, hasAlpha, img.width, img.height);
    let kept = false;
    let finalFmt = outFmt;
    let mode = enc.mode;
    // الناتج أكبر من الأصل ومفيش تغيير مقاس ولا صيغة لازمة؟ نحتفظ بالأصل
    const canKeep = !resized && ['jpeg', 'png', 'webp'].includes(srcFmt) && (s.format === 'same' || s.format === srcFmt);
    if (canKeep && out.length >= src.length) {
      kept = true;
      finalFmt = srcFmt;
      out = s.strip ? await stripOriginal(src, srcFmt, meta) : src;
      if (out.length > src.length) out = src;
      mode = 'original';
    }
    out = own(out);

    const thumb = await makeThumb(img);
    const gifFrames = srcFmt === 'gif' && isAnimatedGif(src);
    return {
      out, thumb,
      outFmt: finalFmt,
      srcFmt,
      fmtChanged: !kept && finalFmt !== nameFmt,
      mime: MIME[finalFmt],
      w0, h0,
      w1: kept ? w0 : img.width,
      h1: kept ? h0 : img.height,
      kept, mode,
      targetMissed: !kept && enc.missed,
      flattened: finalFmt === 'jpeg' && hasAlpha && !kept,
      note: gifFrames ? 'gifFirst' : null,
    };
  }

  async function keepAsIs(src, fmt, note) {
    let thumb = null, w = 0, h = 0;
    try {
      const img = await decode(src, fmt);
      w = img.width; h = img.height;
      thumb = await makeThumb(img);
    } catch (_) { /* نكمل من غير thumbnail */ }
    return { out: src.slice(), thumb, outFmt: fmt, srcFmt: fmt, fmtChanged: false, mime: MIME[fmt], w0: w, h0: h, w1: w, h1: h, kept: true, mode: 'original', note };
  }

  async function makeThumb(img) {
    try {
      const tw = Math.max(img.width, img.height) > 420 ? fitLong(img.width, img.height, 420) : [img.width, img.height];
      const t = (tw[0] !== img.width || tw[1] !== img.height) ? await resizeTo(img, tw[0], tw[1], 'triangle') : img;
      return (await L.webpEnc())(t, { quality: 72, method: 2 });
    } catch (_) { return null; }
  }

  // نسخة عالية الجودة من الأصل عشان المقارنة (للصيغ اللي المتصفح مش بيعرضها زي HEIC و TIFF)
  async function previewImage(src, name) {
    const fmt = sniff(src);
    const meta = await readMeta(src, fmt);
    let img = await decode(src, fmt);
    if (meta.orientation > 1 && !img.__oriented) img = applyOrientation(img, meta.orientation);
    const out = (await L.webpEnc())(img, { quality: 100, lossless: 1, method: 0, exact: 1 });
    return { out, mime: 'image/webp' };
  }

  // صفحة PDF اترسمت على canvas في الصفحة — هنا بنضغطها زي أي صورة
  async function processRaw({ buf, w, h, settings: s }) {
    let img = new ImageData(new Uint8ClampedArray(buf), w, h);
    const [w1, h1] = fitDims(w, h, s);
    if (w1 !== w || h1 !== h) img = await resizeTo(img, w1, h1, 'lanczos3');
    const outFmt = s.format === 'same' ? 'jpeg' : s.format;
    const hasAlpha = checkAlpha(img);
    const target = s.targetOn ? Math.max(1, s.targetKB) * 1000 : 0;
    const enc = await encodeSmart(img, outFmt, s, hasAlpha, target);
    return { out: own(enc.bytes), outFmt, mime: MIME[outFmt], w1: img.width, h1: img.height, mode: enc.mode, targetMissed: enc.missed };
  }

  /* ================= SVG ================= */
  async function processSvg(src, s) {
    const text = new TextDecoder().decode(src);
    const optimize = await L.svgo();
    const plugins = [{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }];
    if (!s.strip) plugins[0].params.overrides.removeMetadata = false;
    const res = optimize(text, { multipass: true, plugins });
    let out = new TextEncoder().encode(res.data);
    let kept = false;
    if (out.length >= src.length) { out = src.slice(); kept = true; }
    return { out, outFmt: 'svg', srcFmt: 'svg', mime: MIME.svg, fmtChanged: false, kept, mode: kept ? 'original' : 'SVGO' };
  }

  /* ================= sniff / decode ================= */
  function sniff(b) {
    if (b.length < 12) return null;
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (str(b, 0, 4) === 'RIFF' && str(b, 8, 4) === 'WEBP') return 'webp';
    if (str(b, 0, 4) === 'GIF8') return 'gif';
    if (b[0] === 0x42 && b[1] === 0x4D) return 'bmp';
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4D && b[1] === 0x4D && b[2] === 0 && b[3] === 42)) return 'tiff';
    if (str(b, 4, 4) === 'ftyp') {
      const boxLen = Math.min(b.length, ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0 || 32);
      const brands = str(b, 8, Math.max(4, boxLen - 8));
      if (/avif|avis/.test(brands)) return 'avif';
      if (/heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(brands)) return 'heic';
    }
    const head = str(b, 0, Math.min(1024, b.length));
    if (head.indexOf('%PDF-') >= 0) return 'pdf';
    return null;
  }
  function str(b, o, n) { let s = ''; for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; }

  async function decode(src, fmt) {
    if (fmt === 'heic') return decodeHeic(src);
    if (fmt === 'tiff') return decodeTiff(src);
    try {
      let img;
      if (fmt === 'jpeg') img = await (await L.jpegDec())(bufOf(src));
      else if (fmt === 'png') img = await (await L.pngDec())(src);
      else if (fmt === 'webp') img = await (await L.webpDec())(bufOf(src));
      else if (fmt === 'avif') img = await (await L.avifDec())(bufOf(src));
      if (img && img.width) return img;
      throw new Error('fallback');
    } catch (err) {
      // fallback: decoder بتاع المتصفح (JPEG CMYK · GIF · BMP)
      const bmp = await createImageBitmap(new Blob([src], { type: MIME[fmt] || '' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
      bmp.close && bmp.close();
      d.__oriented = true; // المتصفح بيطبق الـ EXIF orientation لوحده
      return d;
    }
  }
  async function decodeHeic(src) {
    const lib = await L.heif();
    const dec = new lib.HeifDecoder();
    const list = dec.decode(src);
    if (!list || !list.length) throw new Error('HEIC مش قادر يتفتح');
    const im = list[0];
    const w = im.get_width(), h = im.get_height();
    const out = new ImageData(w, h);
    await new Promise((res, rej) => im.display(out, (d) => (d ? res() : rej(new Error('HEIC decode failed')))));
    for (const x of list) x.free && x.free();
    out.__oriented = true; // libheif بيطبق irot/imir
    return out;
  }
  async function decodeTiff(src) {
    const UTIF = await L.utif();
    const buf = bufOf(src);
    const ifds = UTIF.decode(buf);
    const page = ifds.find((d) => d.t256 && d.t257) || ifds[0];
    UTIF.decodeImage(buf, page, ifds);
    const rgba = UTIF.toRGBA8(page);
    const img = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, page.width * page.height * 4), page.width, page.height);
    const o = page.t274 ? page.t274[0] : 1;
    return o > 1 && o <= 8 ? applyOrientation(img, o) : Object.assign(img, { __oriented: true });
  }
  function isAnimatedGif(b) {
    let n = 0;
    for (let i = 0; i < b.length - 2; i++) if (b[i] === 0x21 && b[i + 1] === 0xF9 && b[i + 2] === 0x04) { if (++n > 1) return true; }
    return false;
  }

  function fitLong(w, h, max) {
    const sc = max / Math.max(w, h);
    return [Math.max(1, Math.round(w * sc)), Math.max(1, Math.round(h * sc))];
  }
  function fitDims(w, h, s) {
    if (!s.maxOn || !(s.maxPx > 0)) return [w, h];
    const max = Math.round(s.maxPx);
    if (s.maxMode === 'width') {
      if (w <= max) return [w, h];
      return [max, Math.max(1, Math.round(h * max / w))];
    }
    if (Math.max(w, h) <= max) return [w, h];
    if (w >= h) return [max, Math.max(1, Math.round(h * max / w))];
    return [Math.max(1, Math.round(w * max / h)), max];
  }

  function applyOrientation(img, o) {
    const W = img.width, H = img.height;
    const swap = o >= 5;
    const nw = swap ? H : W, nh = swap ? W : H;
    const s32 = new Uint32Array(img.data.buffer, img.data.byteOffset, W * H);
    const out = new Uint8ClampedArray(nw * nh * 4);
    const d32 = new Uint32Array(out.buffer);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sx, sy;
        switch (o) {
          case 2: sx = W - 1 - x; sy = y; break;
          case 3: sx = W - 1 - x; sy = H - 1 - y; break;
          case 4: sx = x; sy = H - 1 - y; break;
          case 5: sx = y; sy = x; break;
          case 6: sx = y; sy = H - 1 - x; break;
          case 7: sx = W - 1 - y; sy = H - 1 - x; break;
          case 8: sx = W - 1 - y; sy = x; break;
          default: sx = x; sy = y;
        }
        d32[y * nw + x] = s32[sy * W + sx];
      }
    }
    return new ImageData(out, nw, nh);
  }

  async function resizeTo(img, w, h, method) {
    const resize = await L.resize();
    const input = img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    return await resize(input, { width: w, height: h, method, fitMethod: 'stretch', premultiply: true, linearRGB: true });
  }

  function checkAlpha(img) {
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true;
    return false;
  }
  function flattenWhite(img) {
    const d = img.data, o = new Uint8ClampedArray(d.length);
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255, ia = 255 * (1 - a);
      o[i] = d[i] * a + ia; o[i + 1] = d[i + 1] * a + ia; o[i + 2] = d[i + 2] * a + ia; o[i + 3] = 255;
    }
    return new ImageData(o, img.width, img.height);
  }
  function own(u8) { return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8 : u8.slice(); }

  /* ================= encode ================= */
  async function jpegEncode(img, q, gray) {
    const enc = await L.jpegEnc();
    return new Uint8Array(await enc(img, {
      quality: q, progressive: true, optimize_coding: true,
      ...(gray ? { color_space: 1 } : {}),
      ...(q >= 90 ? { auto_subsample: false, chroma_subsample: 1 } : {}),
    }));
  }
  async function encodeSmart(img, fmt, s, hasAlpha, target) {
    const qMax = clampInt(s.quality, 1, 100);
    if (fmt === 'jpeg') {
      const src = hasAlpha ? flattenWhite(img) : img;
      return lossySearch((q) => jpegEncode(src, q, false), qMax, target, 'Q');
    }
    if (fmt === 'webp') {
      const enc = await L.webpEnc();
      const at = async (q) => enc(img, { quality: q, method: 4, use_sharp_yuv: 1, alpha_quality: 100, exact: 0 });
      return lossySearch(at, qMax, target, 'Q');
    }
    // PNG
    const lossless = await pngEncode(img, 0);
    if (!s.quantize && (!target || lossless.length <= target)) {
      return { bytes: lossless, mode: 'lossless', missed: false };
    }
    if (s.quantize && !target) {
      const b = await pngEncode(img, 256);
      return b.length < lossless.length ? { bytes: b, mode: '256 colors', missed: false } : { bytes: lossless, mode: 'lossless', missed: false };
    }
    if (lossless.length <= target) return { bytes: lossless, mode: 'lossless', missed: false };
    const q256 = await pngEncode(img, 256);
    if (q256.length <= target) return { bytes: q256, mode: '256 colors', missed: false };
    let lo = 32, hi = 255, best = null, bestC = 0, smallest = q256, smallestC = 256;
    while (lo <= hi) {
      const c = (lo + hi) >> 1;
      const b = await pngEncode(img, c);
      if (b.length < smallest.length) { smallest = b; smallestC = c; }
      if (b.length <= target) { best = b; bestC = c; lo = c + 1; } else hi = c - 1;
    }
    if (best) return { bytes: best, mode: bestC + ' colors', missed: false };
    return { bytes: smallest, mode: smallestC + ' colors', missed: true };
  }

  async function lossySearch(at, qMax, target, tag) {
    const top = await at(qMax);
    if (!target || top.length <= target) return { bytes: top, mode: tag + qMax, missed: false };
    let lo = 30, hi = qMax - 1, best = null, bestQ = 0, smallest = top, smallestQ = qMax;
    while (lo <= hi) {
      const q = (lo + hi) >> 1;
      const b = await at(q);
      if (b.length < smallest.length) { smallest = b; smallestQ = q; }
      if (b.length <= target) { best = b; bestQ = q; lo = q + 1; } else hi = q - 1;
    }
    if (best) return { bytes: best, mode: tag + bestQ, missed: false };
    return { bytes: smallest, mode: tag + smallestQ, missed: true };
  }

  const pcCache = new WeakMap();
  async function pngEncode(img, colors) {
    const optimise = await L.oxipng();
    let data = img;
    if (colors) {
      const iq = await L.imageq();
      let pc = pcCache.get(img);
      if (!pc) { pc = iq.utils.PointContainer.fromUint8Array(img.data, img.width, img.height); pcCache.set(img, pc); }
      const palette = iq.buildPaletteSync([pc], { colors, paletteQuantization: 'wuquant', colorDistanceFormula: 'euclidean-bt709' });
      const q = iq.applyPaletteSync(pc.clone(), palette, { colorDistanceFormula: 'euclidean-bt709', imageQuantization: 'floyd-steinberg' });
      data = new ImageData(new Uint8ClampedArray(q.toUint8Array()), img.width, img.height);
    }
    return new Uint8Array(optimise(new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.length), data.width, data.height, 2, false, true));
  }

  function clampInt(v, a, b) { v = Math.round(+v); return isFinite(v) ? Math.min(b, Math.max(a, v)) : b; }

  /* ================= metadata (صور) ================= */
  async function readMeta(b, fmt) {
    const m = { orientation: 1, exif: null, icc: null };
    try {
      if (fmt === 'jpeg') {
        const icc = [];
        for (const sg of jpegSegments(b)) {
          if (sg.m === 0xE1 && !m.exif && str(sg.data, 0, 6) === 'Exif\0\0') m.exif = sg.data.slice(6);
          if (sg.m === 0xE2 && str(sg.data, 0, 12) === 'ICC_PROFILE\0') icc.push({ n: sg.data[12], d: sg.data.subarray(14) });
        }
        if (icc.length) { icc.sort((a, c) => a.n - c.n); m.icc = concat(icc.map((x) => x.d)); }
      } else if (fmt === 'png') {
        for (const c of pngChunks(b)) {
          if (c.type === 'eXIf' && !m.exif) m.exif = c.data.slice();
          if (c.type === 'iCCP' && !m.icc) {
            const z = c.data.indexOf(0);
            if (z > 0) m.icc = await inflate(c.data.subarray(z + 2));
          }
        }
      } else if (fmt === 'webp') {
        for (const c of riffChunks(b)) {
          if (c.type === 'EXIF' && !m.exif) m.exif = str(c.data, 0, 6) === 'Exif\0\0' ? c.data.slice(6) : c.data.slice();
          if (c.type === 'ICCP' && !m.icc) m.icc = c.data.slice();
        }
      }
      if (m.exif) m.orientation = tiffOrientation(m.exif, false) || 1;
      if (m.orientation < 1 || m.orientation > 8) m.orientation = 1;
    } catch (_) { /* metadata مكسورة؟ نكمل من غيرها */ }
    return m;
  }

  function jpegSegments(b) {
    const segs = [];
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xFF) break;
      const mk = b[i + 1];
      if (mk === 0xFF) { i++; continue; }
      if (mk === 0xD8 || mk === 0x01 || (mk >= 0xD0 && mk <= 0xD7)) { i += 2; continue; }
      if (mk === 0xD9) break;
      const len = (b[i + 2] << 8) | b[i + 3];
      if (mk === 0xDA) { segs.push({ m: mk, start: i, end: b.length, data: b.subarray(i + 4, i + 2 + len), sos: true }); break; }
      segs.push({ m: mk, start: i, end: i + 2 + len, data: b.subarray(i + 4, i + 2 + len) });
      i += 2 + len;
    }
    return segs;
  }
  function jpegInfo(b) {
    // SOF: الأبعاد وعدد القنوات، و Adobe APP14 (CMYK مقلوب)
    let w = 0, h = 0, comps = 0, adobe = false, sof = 0;
    for (const sg of jpegSegments(b)) {
      if (sg.m >= 0xC0 && sg.m <= 0xCF && sg.m !== 0xC4 && sg.m !== 0xC8 && sg.m !== 0xCC && !sof) {
        sof = sg.m; h = (sg.data[1] << 8) | sg.data[2]; w = (sg.data[3] << 8) | sg.data[4]; comps = sg.data[5];
      }
      if (sg.m === 0xEE && str(sg.data, 0, 5) === 'Adobe') adobe = true;
    }
    return { w, h, comps, adobe, sof };
  }
  function pngChunks(b) {
    const out = [];
    let i = 8;
    while (i + 12 <= b.length) {
      const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
      const type = str(b, i + 4, 4);
      out.push({ type, start: i, end: i + 12 + len, data: b.subarray(i + 8, i + 8 + len) });
      i += 12 + len;
      if (type === 'IEND') break;
    }
    return out;
  }
  function riffChunks(b) {
    const out = [];
    let i = 12;
    while (i + 8 <= b.length) {
      const type = str(b, i, 4);
      const len = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
      out.push({ type, start: i, end: Math.min(b.length, i + 8 + len + (len & 1)), data: b.subarray(i + 8, i + 8 + len) });
      i += 8 + len + (len & 1);
    }
    return out;
  }

  function tiffOrientation(t, patch) {
    if (t.length < 8) return 1;
    const le = t[0] === 0x49;
    const u16 = (o) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
    const u32 = (o) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3])) >>> 0;
    const ifd = u32(4);
    if (ifd + 2 > t.length) return 1;
    const n = u16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > t.length) break;
      if (u16(e) === 0x0112) {
        const v = u16(e + 8);
        if (patch) { if (le) { t[e + 8] = 1; t[e + 9] = 0; } else { t[e + 8] = 0; t[e + 9] = 1; } }
        return v;
      }
    }
    return 1;
  }
  function minimalExif(o) {
    return new Uint8Array([0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);
  }
  function isSRGB(icc) {
    // الوصف ممكن يكون UTF-16 (mluc) — نشيل الأصفار قبل البحث
    const t = str(icc, 0, Math.min(icc.length, 8192)).replace(/\0/g, '');
    return /sRGB|IEC61966/i.test(t) && !/P3|Adobe|ProPhoto|2020/i.test(t);
  }

  async function addMeta(bytes, fmt, meta, strip, hasAlpha, w, h) {
    const icc = meta.icc && meta.icc.length && !isSRGB(meta.icc) ? meta.icc : null;
    let exif = null;
    if (!strip && meta.exif) { exif = meta.exif.slice(); tiffOrientation(exif, true); }
    if (!icc && !exif) return bytes;
    if (fmt === 'jpeg') return jpegInsert(bytes, exif, icc);
    if (fmt === 'png') return pngInsert(bytes, exif, icc);
    return webpInsert(bytes, exif, icc, hasAlpha, w, h);
  }

  function jpegInsert(b, exif, icc) {
    let pos = 2;
    if (b[2] === 0xFF && b[3] === 0xE0) pos = 4 + ((b[4] << 8) | b[5]);
    const parts = [b.subarray(0, pos)];
    if (exif && exif.length + 8 <= 65533) {
      const len = exif.length + 8;
      parts.push(new Uint8Array([0xFF, 0xE1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]), exif);
    }
    if (icc) {
      const CH = 65519, n = Math.ceil(icc.length / CH);
      if (n < 256) for (let k = 0; k < n; k++) {
        const d = icc.subarray(k * CH, (k + 1) * CH);
        const len = d.length + 16;
        parts.push(new Uint8Array([0xFF, 0xE2, len >> 8, len & 255]), ascii('ICC_PROFILE\0'), new Uint8Array([k + 1, n]), d);
      }
    }
    parts.push(b.subarray(pos));
    return concat(parts);
  }

  async function pngInsert(b, exif, icc) {
    const pos = 33; // بعد الـ signature + IHDR
    const parts = [b.subarray(0, pos)];
    if (icc) parts.push(pngChunk('iCCP', concat([ascii('icc\0\0'), await deflate(icc)])));
    if (exif) parts.push(pngChunk('eXIf', exif));
    parts.push(b.subarray(pos));
    return concat(parts);
  }
  function pngChunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(ascii(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  function webpInsert(b, exif, icc, hasAlpha, w, h) {
    const chunks = riffChunks(b);
    if (!chunks.length) return b;
    let vp8x;
    const rest = [];
    for (const c of chunks) {
      if (c.type === 'VP8X') vp8x = c.data.slice();
      else if (c.type === 'ICCP' || c.type === 'EXIF') continue;
      else rest.push(b.subarray(c.start, c.end));
    }
    if (!vp8x) {
      vp8x = new Uint8Array(10);
      const cw = w - 1, ch = h - 1;
      vp8x[4] = cw & 255; vp8x[5] = (cw >> 8) & 255; vp8x[6] = (cw >> 16) & 255;
      vp8x[7] = ch & 255; vp8x[8] = (ch >> 8) & 255; vp8x[9] = (ch >> 16) & 255;
      if (hasAlpha && chunks.some((c) => c.type === 'VP8L')) vp8x[0] |= 0x10;
    }
    vp8x[0] = (vp8x[0] & ~0x28) | (icc ? 0x20 : 0) | (exif ? 0x08 : 0);
    return riffBuild([riffChunk('VP8X', vp8x), icc ? riffChunk('ICCP', icc) : null, ...rest, exif ? riffChunk('EXIF', exif) : null]);
  }
  function riffChunk(type, data) {
    const pad = data.length & 1;
    const out = new Uint8Array(8 + data.length + pad);
    out.set(ascii(type), 0);
    new DataView(out.buffer).setUint32(4, data.length, true);
    out.set(data, 8);
    return out;
  }
  function riffBuild(parts) {
    const body = concat(parts.filter(Boolean));
    const out = new Uint8Array(12 + body.length);
    out.set(ascii('RIFF'), 0);
    new DataView(out.buffer).setUint32(4, body.length + 4, true);
    out.set(ascii('WEBP'), 8);
    out.set(body, 12);
    return out;
  }

  /* شيل الـ metadata من الأصل من غير ما نلمس البيكسلز (لما الأصل أخف) */
  async function stripOriginal(b, fmt, meta) {
    const o = meta.orientation;
    if (fmt === 'jpeg') {
      const keep = [b.subarray(0, 2)];
      for (const sg of jpegSegments(b)) {
        const m = sg.m;
        if (m === 0xE1 || m === 0xFE || (m >= 0xE3 && m <= 0xED) || m === 0xEF) continue;
        if (m === 0xE2 && str(sg.data, 0, 12) !== 'ICC_PROFILE\0') continue;
        keep.push(b.subarray(sg.start, sg.end));
      }
      let out = concat(keep);
      if (o > 1) out = jpegInsert(out, minimalExif(o), null);
      return out;
    }
    if (fmt === 'png') {
      const drop = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'caBX']);
      const parts = [b.subarray(0, 8)];
      for (const c of pngChunks(b)) if (!drop.has(c.type)) parts.push(b.subarray(c.start, c.end));
      let out = concat(parts);
      if (o > 1) out = await pngInsert(out, minimalExif(o), null);
      return out;
    }
    const chunks = riffChunks(b);
    const parts = [];
    for (const c of chunks) {
      if (c.type === 'EXIF' || c.type === 'XMP ') continue;
      if (c.type === 'VP8X') {
        const d = c.data.slice();
        d[0] = (d[0] & ~0x0C) | (o > 1 ? 0x08 : 0);
        parts.push(riffChunk('VP8X', d));
      } else parts.push(b.subarray(c.start, c.end));
    }
    if (o > 1 && chunks.some((c) => c.type === 'VP8X')) parts.push(riffChunk('EXIF', minimalExif(o)));
    return riffBuild(parts);
  }

  /* ================= PDF: ضغط ================= */
  async function compressPdf(src, s) {
    const PL = await L.pdflib();
    const { PDFDocument } = PL;
    let doc;
    try {
      doc = await PDFDocument.load(src, { updateMetadata: false });
    } catch (e) {
      if (/encrypt/i.test((e && e.message) || '')) return keepPdf(src, 'locked');
      throw new Error('الـ PDF ده بايظ أو مش مدعوم');
    }
    const pages = doc.getPageCount();
    if (isSigned(PL, doc)) return keepPdf(src, 'signed', pages);

    const lossless = !!s.pdfLossless;
    const qMax = clampInt(s.quality, 40, 100);
    const target = s.targetOn ? Math.max(1, s.targetKB) * 1000 : 0;
    const qs = [];
    if (lossless) qs.push(0);
    else { qs.push(qMax); if (target) for (let q = qMax - 7; q >= 50; q -= 7) qs.push(q); }

    let best = null, bestStats = null, bestQ = 0;
    for (let i = 0; i < qs.length; i++) {
      const d = i === 0 ? doc : await PDFDocument.load(src, { updateMetadata: false });
      const stats = await optimizePdf(PL, d, qs[i], s);
      const bytes = await d.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
      if (!best || bytes.length < best.length) { best = bytes; bestStats = stats; bestQ = qs[i]; }
      if (!target || bytes.length <= target) break;
    }
    if (best.length >= src.length) return keepPdf(src, 'bigger', pages, bestStats);
    const modeParts = [lossless ? 'lossless' : 'Q' + bestQ];
    if (s.pdfDpi) modeParts.push(s.pdfDpi + ' DPI');
    return {
      out: own(best), outFmt: 'pdf', srcFmt: 'pdf', mime: MIME.pdf, fmtChanged: false, kept: false,
      pages, mode: modeParts.join(' · '),
      targetMissed: !!target && best.length > target,
      pdfStats: bestStats,
    };
  }
  function keepPdf(src, why, pages, stats) {
    return { out: src.slice(), outFmt: 'pdf', srcFmt: 'pdf', mime: MIME.pdf, fmtChanged: false, kept: true, pages: pages || 0, mode: 'original', note: why, pdfStats: stats || null };
  }
  function isSigned(PL, doc) {
    const af = doc.catalog.lookup(PL.PDFName.of('AcroForm'));
    if (!(af instanceof PL.PDFDict)) return false;
    const sf = af.lookup(PL.PDFName.of('SigFlags'));
    return sf instanceof PL.PDFNumber && (sf.asNumber() & 1) === 1;
  }

  async function optimizePdf(PL, doc, q, s) {
    const { PDFName, PDFRawStream, PDFDict, PDFArray, PDFRef, PDFNumber, PDFStream, decodePDFRawStream } = PL;
    const N = (x) => PDFName.of(x);
    const ctx = doc.context;
    const stats = { images: 0, recompressed: 0, resized: 0, pieceInfo: false, removed: 0 };
    const num = (o) => (o instanceof PDFNumber ? o.asNumber() : NaN);
    const tagOf = (ref) => ref.objectNumber + ' ' + ref.generationNumber;

    // 1) بيانات تعديل Illustrator/Photoshop والصور المصغرة: مش بتظهر، بس تقيلة
    if (doc.catalog.has(N('PieceInfo'))) { doc.catalog.delete(N('PieceInfo')); stats.pieceInfo = true; }
    for (const page of doc.getPages()) {
      if (page.node.has(N('PieceInfo'))) { page.node.delete(N('PieceInfo')); stats.pieceInfo = true; }
      page.node.delete(N('Thumb'));
    }
    if (s.strip) {
      doc.catalog.delete(N('Metadata'));
      const info = ctx.lookup(ctx.trailerInfo.Info);
      if (info instanceof PDFDict) for (const [k] of info.entries()) if (k !== N('Title')) info.delete(k);
    }

    // 2) الصور متعرضة بأي مقاس على الصفحة؟ (عشان الـ DPI)
    const place = s.pdfDpi ? measurePlacements(PL, doc) : new Map();

    // 3) نجمع الصور و الـ SMasks
    const imgs = [];
    const smaskOf = new Map(); // smask tag -> base tag
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      if (obj.dict.get(N('Subtype')) !== N('Image')) {
        // ستريم مش مضغوط خالص (نادر) — نضغطه lossless
        if (!obj.dict.has(N('Filter')) && obj.contents.length > 512 && obj.dict.get(N('Type')) !== N('Metadata') && obj.dict.get(N('Type')) !== N('XRef')) {
          const z = await deflate(obj.contents);
          if (z.length < obj.contents.length * 0.9) {
            const nd = obj.dict.clone(ctx);
            nd.set(N('Filter'), N('FlateDecode'));
            nd.delete(N('Length'));
            ctx.assign(ref, PDFRawStream.of(nd, z));
          }
        }
        continue;
      }
      imgs.push([ref, obj]);
      const sm = obj.dict.get(N('SMask'));
      if (sm instanceof PDFRef) smaskOf.set(tagOf(sm), tagOf(ref));
    }
    stats.images = imgs.length;
    const smaskResize = new Map();
    const order = [...imgs.filter(([r]) => !smaskOf.has(tagOf(r))), ...imgs.filter(([r]) => smaskOf.has(tagOf(r)))];

    for (const [ref, obj] of order) {
      try {
        const tag = tagOf(ref);
        const isMask = smaskOf.has(tag);
        const r = await recompressImage(PL, ctx, ref, obj, {
          q, lossless: !q, isMask,
          place: isMask ? place.get(smaskOf.get(tag)) : place.get(tag),
          forceDims: isMask ? smaskResize.get(tag) : null,
          dpi: s.pdfDpi, strip: s.strip,
        });
        if (r) {
          stats.recompressed++;
          if (r.resized) {
            stats.resized++;
            const sm = obj.dict.get(N('SMask'));
            if (sm instanceof PDFRef) smaskResize.set(tagOf(sm), { from: [r.w0, r.h0], to: [r.w, r.h] });
          }
        }
      } catch (_) { /* صورة مش مدعومة؟ تفضل زي ما هي */ }
    }

    // 4) نشيل أي object مالوش لازمة (زي بيانات Illustrator اللي اتفصلت)
    stats.removed = collectGarbage(PL, doc);
    return stats;
  }

  async function recompressImage(PL, ctx, ref, obj, o) {
    const { PDFName, PDFRawStream, PDFArray, PDFNumber, PDFDict, PDFBool, decodePDFRawStream } = PL;
    const N = (x) => PDFName.of(x);
    const d = obj.dict;
    const num = (x) => (x instanceof PDFNumber ? x.asNumber() : NaN);
    if (d.lookup(N('ImageMask')) === PDFBool.True) return null;
    if (d.has(N('Decode'))) return null;
    if (num(d.lookup(N('BitsPerComponent'))) !== 8) return null;
    const W = num(d.lookup(N('Width'))), H = num(d.lookup(N('Height')));
    if (!(W > 0 && H > 0)) return null;
    const n = o.isMask ? 1 : csComponents(PL, d.lookup(N('ColorSpace')));
    if (n !== 1 && n !== 3) return null;

    const fRaw = d.lookup(N('Filter'));
    const filters = !fRaw ? [] : fRaw instanceof PDFArray ? fRaw.asArray().map((x) => ctx.lookup(x)) : [fRaw];
    const pRaw = d.lookup(N('DecodeParms'));
    const parmsList = !pRaw ? [] : pRaw instanceof PDFArray ? pRaw.asArray().map((x) => ctx.lookup(x)) : [pRaw];
    const last = filters[filters.length - 1];
    const simple = new Set(['FlateDecode', 'LZWDecode', 'ASCII85Decode', 'ASCIIHexDecode', 'RunLengthDecode'].map(N));

    // الأبعاد الجديدة (لو فيه حد DPI)
    let nw = W, nh = H;
    if (o.forceDims && o.forceDims.from[0] === W && o.forceDims.from[1] === H) { [nw, nh] = o.forceDims.to; }
    else if (o.dpi && o.place) {
      const needW = Math.ceil(o.place.w / 72 * o.dpi), needH = Math.ceil(o.place.h / 72 * o.dpi);
      const f = Math.max(needW / W, needH / H);
      if (f < 0.9) { nw = Math.max(1, Math.round(W * f)); nh = Math.max(1, Math.round(H * f)); }
    }
    const resize = nw !== W || nh !== H;

    let img, wasJpeg = false;
    if (last === N('DCTDecode')) {
      if (o.isMask) return null;
      if (o.lossless && !resize) return null; // JPEG مينفعش يتضغط تاني من غير فقد
      const pre = filters.slice(0, -1);
      if (!pre.every((f) => simple.has(f))) return null;
      const jpg = pre.length ? decodeChain(PL, ctx, obj, pre, parmsList) : obj.contents;
      const info = jpegInfo(jpg);
      if (info.comps !== n) return null;
      img = await (await L.jpegDec())(bufOf(jpg));
      wasJpeg = true;
    } else if (filters.every((f) => simple.has(f))) {
      let raw = filters.length ? decodeChain(PL, ctx, obj, filters, parmsList, true) : obj.contents;
      const lastParms = parmsList[filters.length - 1];
      const pred = lastParms instanceof PDFDict ? num(lastParms.lookup(N('Predictor'))) : NaN;
      if (pred >= 10) raw = unPng(raw, W, H, n);
      else if (pred === 2) return null;
      if (!raw || raw.length < W * H * n) return null;
      img = toRGBA(raw, W, H, n);
    } else return null;

    if (resize) img = await resizeTo(img, nw, nh, 'lanczos3');

    let bytes, filter, parms = null;
    if (!o.lossless && !o.isMask && (wasJpeg || isPhoto(img))) {
      bytes = await jpegEncode(img, o.q, n === 1);
      filter = 'DCTDecode';
    } else {
      bytes = await deflate(pngFilter(img, n));
      filter = 'FlateDecode';
      parms = { Predictor: 15, Colors: n, BitsPerComponent: 8, Columns: img.width };
    }
    if (!resize && bytes.length >= obj.contents.length * 0.92) return null;

    const nd = d.clone(ctx);
    nd.set(N('Filter'), N(filter));
    nd.delete(N('DecodeParms'));
    if (parms) nd.set(N('DecodeParms'), ctx.obj(parms));
    nd.set(N('Width'), PDFNumber.of(img.width));
    nd.set(N('Height'), PDFNumber.of(img.height));
    nd.delete(N('Length'));
    if (o.strip) nd.delete(N('Metadata'));
    ctx.assign(ref, PDFRawStream.of(nd, bytes));
    return { resized: resize, w0: W, h0: H, w: img.width, h: img.height };
  }

  function csComponents(PL, cs) {
    const { PDFName, PDFArray, PDFRawStream, PDFNumber } = PL;
    if (!cs) return 0;
    if (cs instanceof PDFName) {
      const v = cs.decodeText ? cs.decodeText() : cs.asString().slice(1);
      if (v === 'DeviceRGB' || v === 'CalRGB') return 3;
      if (v === 'DeviceGray' || v === 'CalGray') return 1;
      return 0;
    }
    if (cs instanceof PDFArray) {
      const kind = cs.lookup(0);
      const k = kind && (kind.decodeText ? kind.decodeText() : kind.asString().slice(1));
      if (k === 'ICCBased') {
        const st = cs.lookup(1);
        const nn = st && st.dict && st.dict.lookup(PDFName.of('N'));
        const v = nn instanceof PDFNumber ? nn.asNumber() : 0;
        return v === 1 || v === 3 ? v : 0;
      }
      if (k === 'CalRGB') return 3;
      if (k === 'CalGray') return 1;
    }
    return 0;
  }

  function decodeChain(PL, ctx, obj, filters, parmsList, all) {
    const { PDFArray, PDFName, decodePDFRawStream, PDFRawStream } = PL;
    const dict = ctx.obj({});
    dict.set(PDFName.of('Filter'), ctx.obj(filters));
    // الـ predictor بنطبقه إحنا بعدين (pdf-lib ما بيطبقوش)
    const st = decodePDFRawStream(PDFRawStream.of(dict, obj.contents));
    return st.decode ? st.decode() : st.getBytes();
  }

  function unPng(raw, W, H, n) {
    const rowLen = W * n, out = new Uint8Array(rowLen * H);
    let p = 0;
    for (let y = 0; y < H; y++) {
      if (p >= raw.length) return null;
      const ft = raw[p++];
      const o = y * rowLen, prev = o - rowLen;
      for (let x = 0; x < rowLen; x++) {
        const v = raw[p++];
        const a = x >= n ? out[o + x - n] : 0;
        const b = y > 0 ? out[prev + x] : 0;
        const c = y > 0 && x >= n ? out[prev + x - n] : 0;
        let r;
        switch (ft) {
          case 0: r = v; break;
          case 1: r = v + a; break;
          case 2: r = v + b; break;
          case 3: r = v + ((a + b) >> 1); break;
          case 4: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
          default: return null;
        }
        out[o + x] = r & 255;
      }
    }
    return out;
  }
  // PNG filters (best-per-row) قبل الـ deflate — lossless وأصغر بكتير
  function pngFilter(img, n) {
    const W = img.width, H = img.height, d = img.data, rowLen = W * n;
    const px = new Uint8Array(rowLen * H);
    if (n === 3) { for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { px[j] = d[i]; px[j + 1] = d[i + 1]; px[j + 2] = d[i + 2]; } }
    else { for (let i = 0, j = 0; i < d.length; i += 4, j++) px[j] = d[i]; }
    const out = new Uint8Array((rowLen + 1) * H);
    const cand = [new Uint8Array(rowLen), new Uint8Array(rowLen), new Uint8Array(rowLen), new Uint8Array(rowLen), new Uint8Array(rowLen)];
    for (let y = 0; y < H; y++) {
      const o = y * rowLen, prev = o - rowLen;
      let best = 0, bestSum = Infinity;
      for (let f = 0; f < 5; f++) {
        const c = cand[f]; let sum = 0;
        for (let x = 0; x < rowLen; x++) {
          const v = px[o + x];
          const a = x >= n ? px[o + x - n] : 0;
          const b = y > 0 ? px[prev + x] : 0;
          const cc = y > 0 && x >= n ? px[prev + x - n] : 0;
          let r;
          if (f === 0) r = v;
          else if (f === 1) r = v - a;
          else if (f === 2) r = v - b;
          else if (f === 3) r = v - ((a + b) >> 1);
          else { const pp = a + b - cc, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - cc); r = v - (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc); }
          r &= 255; c[x] = r; sum += r < 128 ? r : 256 - r;
          if (sum >= bestSum) break;
        }
        if (sum < bestSum) { bestSum = sum; best = f; }
      }
      // نعيد حساب الفلتر الأحسن كامل (لو اتقطع بدري)
      const c = cand[best];
      for (let x = 0; x < rowLen; x++) {
        const v = px[o + x];
        const a = x >= n ? px[o + x - n] : 0;
        const b = y > 0 ? px[prev + x] : 0;
        const cc = y > 0 && x >= n ? px[prev + x - n] : 0;
        let r;
        if (best === 0) r = v;
        else if (best === 1) r = v - a;
        else if (best === 2) r = v - b;
        else if (best === 3) r = v - ((a + b) >> 1);
        else { const pp = a + b - cc, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - cc); r = v - (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc); }
        c[x] = r & 255;
      }
      out[y * (rowLen + 1)] = best;
      out.set(c, y * (rowLen + 1) + 1);
    }
    return out;
  }
  function toRGBA(raw, W, H, n) {
    const out = new Uint8ClampedArray(W * H * 4);
    if (n === 3) for (let i = 0, j = 0; j < out.length; i += 3, j += 4) { out[j] = raw[i]; out[j + 1] = raw[i + 1]; out[j + 2] = raw[i + 2]; out[j + 3] = 255; }
    else for (let i = 0, j = 0; j < out.length; i++, j += 4) { out[j] = out[j + 1] = out[j + 2] = raw[i]; out[j + 3] = 255; }
    return new ImageData(out, W, H);
  }
  // صورة فوتوغرافية ولا جرافيك (لوجو/سكرينشوت/نص)؟ الجرافيك بيفضل lossless
  function isPhoto(img) {
    const d = img.data, total = img.width * img.height;
    const step = Math.max(1, Math.floor(total / 60000));
    const seen = new Set();
    for (let p = 0; p < total; p += step) {
      const i = p * 4;
      seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      if (seen.size > 6000) return true;
    }
    return false;
  }

  // content stream interpreter بسيط: بيحسب أكبر مقاس اتعرضت بيه كل صورة (بالـ points)
  function measurePlacements(PL, doc) {
    const { PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream, PDFNumber, decodePDFRawStream } = PL;
    const N = (x) => PDFName.of(x);
    const ctx = doc.context;
    const res = new Map();
    let budget = 3e6; // حماية من الملفات الغريبة
    const tagOf = (ref) => ref.objectNumber + ' ' + ref.generationNumber;
    const mul = (m, c) => [m[0] * c[0] + m[1] * c[2], m[0] * c[1] + m[1] * c[3], m[2] * c[0] + m[3] * c[2], m[2] * c[1] + m[3] * c[3], m[4] * c[0] + m[5] * c[2] + c[4], m[4] * c[1] + m[5] * c[3] + c[5]];
    const bytesOf = (st) => { const s = decodePDFRawStream(st); return s.decode ? s.decode() : s.getBytes(); };
    const inherited = (node, key) => {
      let n = node, guard = 0;
      while (n instanceof PDFDict && guard++ < 50) {
        const v = n.lookup(N(key));
        if (v) return v;
        n = n.lookup(N('Parent'));
      }
      return null;
    };
    const findX = (resDict, name) => {
      if (!(resDict instanceof PDFDict)) return null;
      const xo = resDict.lookup(N('XObject'));
      if (!(xo instanceof PDFDict)) return null;
      let v = xo.get(N(name));
      if (!v) for (const [k, val] of xo.entries()) if (k.asString() === '/' + name) { v = val; break; }
      return v || null;
    };
    const run = (bytes, resDict, ctm, depth, seenForms) => {
      const stack = [];
      const ops = [];
      let cur = ctm;
      for (const t of tokenize(bytes)) {
        if (--budget < 0) return;
        if (t.t === 'num') { ops.push(t.v); if (ops.length > 8) ops.shift(); continue; }
        if (t.t === 'name') { ops.push(t.v); if (ops.length > 8) ops.shift(); continue; }
        if (t.t !== 'op') { ops.length = 0; continue; }
        const op = t.v;
        if (op === 'q') stack.push(cur);
        else if (op === 'Q') cur = stack.pop() || ctm;
        else if (op === 'cm' && ops.length >= 6) {
          const m = ops.slice(-6);
          if (m.every((x) => typeof x === 'number')) cur = mul(m, cur);
        } else if (op === 'Do' && ops.length) {
          const name = ops[ops.length - 1];
          if (typeof name === 'string') {
            const x = findX(resDict, name);
            const st = x instanceof PDFRef ? ctx.lookup(x) : x;
            if (st instanceof PDFRawStream) {
              const sub = st.dict.get(N('Subtype'));
              if (sub === N('Image') && x instanceof PDFRef) {
                const w = Math.hypot(cur[0], cur[1]), h = Math.hypot(cur[2], cur[3]);
                const k = tagOf(x), prev = res.get(k);
                res.set(k, { w: Math.max(w, prev ? prev.w : 0), h: Math.max(h, prev ? prev.h : 0) });
              } else if (sub === N('Form') && depth < 12) {
                const k = x instanceof PDFRef ? tagOf(x) : null;
                if (k && seenForms.has(k)) { /* recursion guard */ } else {
                  const mArr = st.dict.lookup(N('Matrix'));
                  const fm = mArr instanceof PDFArray ? mArr.asArray().map((v) => (ctx.lookup(v) instanceof PDFNumber ? ctx.lookup(v).asNumber() : 0)) : [1, 0, 0, 1, 0, 0];
                  const fr = st.dict.lookup(N('Resources')) || resDict;
                  const ns = new Set(seenForms); if (k) ns.add(k);
                  try { run(bytesOf(st), fr, mul(fm, cur), depth + 1, ns); } catch (_) {}
                }
              }
            }
          }
        }
        ops.length = 0;
      }
    };
    for (const page of doc.getPages()) {
      try {
        const node = page.node;
        const resDict = inherited(node, 'Resources');
        const c = node.lookup(N('Contents'));
        const parts = c instanceof PDFArray ? c.asArray().map((x) => ctx.lookup(x)) : [c];
        const chunks = [];
        for (const p of parts) if (p instanceof PDFRawStream) { chunks.push(bytesOf(p)); chunks.push(new Uint8Array([10])); }
        run(concat(chunks), resDict, [1, 0, 0, 1, 0, 0], 0, new Set());
      } catch (_) { /* الصفحة دي من غير قياس = من غير تصغير */ }
    }
    return res;
  }

  function* tokenize(b) {
    const n = b.length;
    const ws = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
    const delim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
    let i = 0;
    while (i < n) {
      const c = b[i];
      if (ws(c)) { i++; continue; }
      if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; }
      if (c === 40) {
        let depth = 1; i++;
        while (i < n && depth > 0) { if (b[i] === 92) { i += 2; continue; } if (b[i] === 40) depth++; else if (b[i] === 41) depth--; i++; }
        yield { t: 'str' }; continue;
      }
      if (c === 60) {
        if (b[i + 1] === 60) { i += 2; yield { t: 'dict' }; continue; }
        i++; while (i < n && b[i] !== 62) i++; i++; yield { t: 'hex' }; continue;
      }
      if (c === 62) { i += b[i + 1] === 62 ? 2 : 1; yield { t: 'dict' }; continue; }
      if (c === 91 || c === 93 || c === 123 || c === 125) { i++; yield { t: 'arr' }; continue; }
      if (c === 47) {
        let j = i + 1; while (j < n && !ws(b[j]) && !delim(b[j])) j++;
        yield { t: 'name', v: str(b, i + 1, j - i - 1) }; i = j; continue;
      }
      let j = i; while (j < n && !ws(b[j]) && !delim(b[j])) j++;
      if (j === i) { i++; continue; }
      const s = str(b, i, j - i); i = j;
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) { yield { t: 'num', v: +s }; continue; }
      if (s === 'ID') {
        // inline image: نعدّي البيانات لحد EI
        i++;
        while (i < n) { if (b[i] === 69 && b[i + 1] === 73 && ws(b[i - 1]) && (i + 2 >= n || ws(b[i + 2]))) { i += 2; break; } i++; }
        yield { t: 'op', v: 'EI' }; continue;
      }
      yield { t: 'op', v: s };
    }
  }

  function collectGarbage(PL, doc) {
    const { PDFRef, PDFDict, PDFArray, PDFStream } = PL;
    const ctx = doc.context;
    const seen = new Set();
    const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean);
    while (stack.length) {
      const o = stack.pop();
      if (o instanceof PDFRef) {
        const k = o.tag || (o.objectNumber + ' ' + o.generationNumber);
        if (seen.has(k)) continue;
        seen.add(k);
        const v = ctx.lookup(o);
        if (v) stack.push(v);
      } else if (o instanceof PDFDict) { for (const [, v] of o.entries()) stack.push(v); }
      else if (o instanceof PDFArray) { for (const v of o.asArray()) stack.push(v); }
      else if (o instanceof PDFStream) { stack.push(o.dict); }
    }
    let removed = 0;
    for (const [ref] of ctx.enumerateIndirectObjects()) {
      const k = ref.tag || (ref.objectNumber + ' ' + ref.generationNumber);
      if (!seen.has(k)) { ctx.delete(ref); removed++; }
    }
    return removed;
  }

  /* ================= صور → PDF ================= */
  async function buildPdf({ files, pageMode, title }) {
    const PL = await L.pdflib();
    const { PDFDocument, PDFName, PDFRawStream, PDFNumber, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = PL;
    const N = (x) => PDFName.of(x);
    const doc = await PDFDocument.create({ updateMetadata: false });
    const ctx = doc.context;
    if (title) doc.setTitle(title, { showInWindowTitleBar: true });
    const iccCache = new Map();
    const iccRef = async (icc, n) => {
      if (!icc || isSRGB(icc)) return null;
      const key = icc.length + ':' + n;
      if (iccCache.has(key)) return iccCache.get(key);
      const st = PDFRawStream.of(ctx.obj({ N: n, Alternate: n === 1 ? 'DeviceGray' : 'DeviceRGB', Filter: 'FlateDecode' }), await deflate(icc));
      const ref = ctx.register(st);
      iccCache.set(key, ref);
      return ref;
    };
    let idx = 0;
    for (const f of files) {
      idx++;
      const src = new Uint8Array(f.buf);
      const fmt = sniff(src);
      if (!fmt || fmt === 'pdf') continue;
      let imgRef, dw, dh, orient = 1;
      if (fmt === 'jpeg' && (jpegInfo(src).comps === 3 || jpegInfo(src).comps === 1 || jpegInfo(src).comps === 4)) {
        // JPG بيدخل زي ما هو بالبايت — صفر فقد
        const info = jpegInfo(src);
        const meta = await readMeta(src, 'jpeg');
        orient = meta.orientation;
        const n = info.comps;
        const icc = n !== 4 ? await iccRef(meta.icc, n) : null;
        const cs = icc ? ctx.obj([N('ICCBased'), icc]) : N(n === 1 ? 'DeviceGray' : n === 4 ? 'DeviceCMYK' : 'DeviceRGB');
        const dict = ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: info.w, Height: info.h, BitsPerComponent: 8, Filter: 'DCTDecode' });
        dict.set(N('ColorSpace'), cs);
        if (n === 4 && info.adobe) dict.set(N('Decode'), ctx.obj([1, 0, 1, 0, 1, 0, 1, 0]));
        imgRef = ctx.register(PDFRawStream.of(dict, src));
        const sw = orient >= 5; dw = sw ? info.h : info.w; dh = sw ? info.w : info.h;
      } else {
        // أي صيغة تانية: بيكسلز lossless (Flate) + شفافية لو فيه
        const meta = await readMeta(src, fmt);
        let img = await decode(src, fmt);
        if (meta.orientation > 1 && !img.__oriented) img = applyOrientation(img, meta.orientation);
        const gray = isGray(img);
        const n = gray ? 1 : 3;
        const icc = await iccRef(meta.icc, n);
        const dict = ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: img.width, Height: img.height, BitsPerComponent: 8, Filter: 'FlateDecode' });
        dict.set(N('ColorSpace'), icc ? ctx.obj([N('ICCBased'), icc]) : N(gray ? 'DeviceGray' : 'DeviceRGB'));
        dict.set(N('DecodeParms'), ctx.obj({ Predictor: 15, Colors: n, BitsPerComponent: 8, Columns: img.width }));
        if (checkAlpha(img)) {
          const a = new Uint8ClampedArray(img.width * img.height * 4);
          for (let i = 3, j = 0; i < img.data.length; i += 4, j += 4) a[j] = img.data[i];
          const mask = new ImageData(a, img.width, img.height);
          const md = ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: img.width, Height: img.height, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Filter: 'FlateDecode' });
          md.set(N('DecodeParms'), ctx.obj({ Predictor: 15, Colors: 1, BitsPerComponent: 8, Columns: img.width }));
          dict.set(N('SMask'), ctx.register(PDFRawStream.of(md, await deflate(pngFilter(mask, 1)))));
        }
        imgRef = ctx.register(PDFRawStream.of(dict, await deflate(pngFilter(img, n))));
        dw = img.width; dh = img.height;
      }
      // مقاس الصفحة
      let pw, ph, x, y, w, h;
      if (pageMode === 'a4') {
        const land = dw > dh;
        pw = land ? 841.89 : 595.28; ph = land ? 595.28 : 841.89;
        const m = 20, sc = Math.min((pw - 2 * m) / dw, (ph - 2 * m) / dh);
        w = dw * sc; h = dh * sc; x = (pw - w) / 2; y = (ph - h) / 2;
      } else {
        // مقاس الصورة: 96 DPI (زي Canva: 1920px = 1440pt)
        let sc = 0.75;
        const mx = Math.max(dw, dh) * sc;
        if (mx > 14400) sc *= 14400 / mx;
        pw = w = dw * sc; ph = h = dh * sc; x = 0; y = 0;
      }
      const page = doc.addPage([pw, ph]);
      const nm = page.node.newXObject('Im' + idx, imgRef);
      const [a, b, c, d, e, f2] = orientMatrix(orient, x, y, w, h);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f2), drawObject(nm), popGraphicsState());
    }
    if (!doc.getPageCount()) throw new Error('مفيش صور تنفع تدخل الـ PDF');
    const out = await doc.save({ useObjectStreams: true });
    return { out: own(out), pages: doc.getPageCount(), mime: MIME.pdf };
  }
  // مصفوفة بترسم الصورة المتخزنة بالاتجاه الصح (من غير ما نلمس بايتات الـ JPG)
  function orientMatrix(o, x, y, W, H) {
    const uv = (s, t) => {
      switch (o) {
        case 2: return [1 - s, t];
        case 3: return [1 - s, 1 - t];
        case 4: return [s, 1 - t];
        case 5: return [t, s];
        case 6: return [1 - t, s];
        case 7: return [1 - t, 1 - s];
        case 8: return [t, 1 - s];
        default: return [s, t];
      }
    };
    const F = (p, q) => { const [u, v] = uv(p, 1 - q); return [x + u * W, y + (1 - v) * H]; };
    const o0 = F(0, 0), px = F(1, 0), py = F(0, 1);
    return [px[0] - o0[0], px[1] - o0[1], py[0] - o0[0], py[1] - o0[1], o0[0], o0[1]];
  }
  function isGray(img) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) if (d[i] !== d[i + 1] || d[i] !== d[i + 2]) return false;
    return true;
  }

  /* ================= bytes utils ================= */
  function ascii(s) { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function concat(arrs) {
    let n = 0; for (const a of arrs) n += a.length;
    const out = new Uint8Array(n); let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }
  let CRC;
  function crc32(d) {
    if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function streamBytes(data, stream) {
    const s = new Blob([data]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const inflate = (d) => streamBytes(d, new DecompressionStream('deflate'));
  const deflate = (d) => streamBytes(d, new CompressionStream('deflate'));
}

/* ================================================================
 * APP (UI)
 * ================================================================ */
function initApp() {
  const $ = (s, r = document) => r.querySelector(s);
  const DEFAULTS = {
    quality: 82, maxOn: false, maxMode: 'long', maxPx: 1080, targetOn: false, targetKB: 200, format: 'same', strip: true, quantize: false,
    pdfMode: 'compress', pdfDpi: 0, pdfLossless: false, pageDpi: 300,
  };
  const PRESETS = [
    { id: 'web', t: 'Website', d: '1080 / 82%', s: { quality: 82, maxOn: true, maxMode: 'long', maxPx: 1080, targetOn: false } },
    { id: 'ig', t: 'Instagram', d: '1080w / 85%', s: { quality: 85, maxOn: true, maxMode: 'width', maxPx: 1080, targetOn: false } },
    { id: 'same', t: 'Same size', d: 'compress only', s: { quality: 82, maxOn: false, targetOn: false } },
    { id: 'u200', t: 'Under 200KB', d: 'target 200KB', s: { quality: 90, maxOn: false, targetOn: true, targetKB: 200 } },
  ];
  const IMAGE_FMTS = new Set(['jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'tiff']);
  const BROWSER_OK = new Set(['jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg']);

  // آخر إعدادات استخدمتها بتفضل (على جهازك بس)
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('squeeze.settings') || '{}') || {}; } catch (_) { saved = {}; }
  const state = { global: { ...DEFAULTS, ...pick(saved, Object.keys(DEFAULTS)) }, items: [], seq: 1 };
  function pick(o, keys) { const r = {}; for (const k of keys) if (o && k in o && typeof o[k] === typeof DEFAULTS[k]) r[k] = o[k]; return r; }
  function persist() { try { localStorage.setItem('squeeze.settings', JSON.stringify(state.global)); } catch (_) {} }
  const grid = $('#grid');

  /* ---------------- settings form ---------------- */
  function buildForm(root, get, set, showPdf) {
    root.innerHTML = `
      <div class="f-sec img-sec">
        <div class="f-label">Presets</div>
        <div class="presets">${PRESETS.map((p) => `<button type="button" class="preset" data-p="${p.id}"><strong>${p.t}</strong><small>${p.d}</small></button>`).join('')}</div>
      </div>
      <div class="f-sec">
        <div class="f-label"><span class="q-lbl">الكواليتي</span><b class="q-val"></b></div>
        <input type="range" class="q" min="40" max="100" step="1" aria-label="الكواليتي">
        <div class="range-scale"><span>40</span><span>100</span></div>
      </div>
      <div class="f-sec">
        <label class="switch-row"><span>أقصى مقاس<small>بتصغر بنسبتها — عمرها ما تكبر</small></span><span class="switch"><input type="checkbox" class="max-on"><i></i></span></label>
        <div class="sub-fields max-f" style="display:none">
          <div class="num-input"><input type="number" class="max-px" min="16" max="20000" step="1" inputmode="numeric"><em>px</em></div>
          <div class="seg accent max-mode"><button type="button" data-v="long">أطول ضلع</button><button type="button" data-v="width">العرض</button></div>
        </div>
      </div>
      <div class="f-sec">
        <label class="switch-row"><span>حجم مستهدف<small>أعلى كواليتي توصل للحجم ده</small></span><span class="switch"><input type="checkbox" class="t-on"><i></i></span></label>
        <div class="sub-fields t-f" style="display:none">
          <div class="num-input"><input type="number" class="t-kb" min="5" max="500000" step="1" inputmode="numeric"><em>KB</em></div>
        </div>
      </div>
      <div class="f-sec">
        <div class="f-label">صيغة الصور</div>
        <div class="seg accent fmt"><button type="button" data-v="same">زي الأصل</button><button type="button" data-v="jpeg">JPG</button><button type="button" data-v="png">PNG</button><button type="button" data-v="webp">WebP</button></div>
        <div class="note fmt-note" style="display:none"></div>
      </div>
      <div class="f-sec pdf-sec" style="display:none">
        <div class="f-label">الـ PDF يطلع</div>
        <div class="seg accent pdf-mode"><button type="button" data-v="compress">PDF مضغوط</button><button type="button" data-v="images">صفحات صور</button></div>
        <div class="pdf-c">
          <div class="f-label mt">دقة الصور جوه الـ PDF</div>
          <div class="seg pdf-dpi"><button type="button" data-v="0">زي الأصل</button><button type="button" data-v="300">300 DPI</button><button type="button" data-v="150">150 DPI</button></div>
          <label class="switch-row mt"><span>بدون أي فقد<small>lossless بس — التوفير أقل</small></span><span class="switch"><input type="checkbox" class="pdf-ll"><i></i></span></label>
        </div>
        <div class="pdf-i" style="display:none">
          <div class="f-label mt">دقة الصفحة</div>
          <div class="seg page-dpi"><button type="button" data-v="150">150 DPI</button><button type="button" data-v="300">300 DPI</button></div>
          <div class="hint mt">الصيغة والكواليتي من فوق · «زي الأصل» = JPG</div>
        </div>
      </div>
      <div class="f-sec">
        <label class="switch-row"><span>شيل الـ metadata (EXIF/GPS)<small>اتجاه الصورة بيتظبط الأول</small></span><span class="switch"><input type="checkbox" class="strip"><i></i></span></label>
      </div>
      <div class="f-sec">
        <label class="switch-row"><span>PNG Quantize<small>ألوان أقل = PNG أخف بكتير (lossy خفيف)</small></span><span class="switch"><input type="checkbox" class="quant"><i></i></span></label>
      </div>`;

    const q = $('.q', root), qv = $('.q-val', root), ql = $('.q-lbl', root);
    const maxOn = $('.max-on', root), maxPx = $('.max-px', root), maxF = $('.max-f', root);
    const tOn = $('.t-on', root), tKb = $('.t-kb', root), tF = $('.t-f', root);
    const strip = $('.strip', root), quant = $('.quant', root), fmtNote = $('.fmt-note', root);
    const pdfSec = $('.pdf-sec', root), pdfC = $('.pdf-c', root), pdfI = $('.pdf-i', root), pdfLl = $('.pdf-ll', root);
    const segOn = (sel, v) => root.querySelectorAll(sel + ' button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));

    function sync() {
      const s = get();
      q.value = s.quality; qv.textContent = s.quality + '%';
      ql.textContent = s.targetOn ? 'أقصى كواليتي' : 'الكواليتي';
      maxOn.checked = s.maxOn; maxF.style.display = s.maxOn ? '' : 'none';
      if (document.activeElement !== maxPx) maxPx.value = s.maxPx;
      tOn.checked = s.targetOn; tF.style.display = s.targetOn ? '' : 'none';
      if (document.activeElement !== tKb) tKb.value = s.targetKB;
      strip.checked = s.strip; quant.checked = s.quantize; pdfLl.checked = s.pdfLossless;
      segOn('.max-mode', s.maxMode); segOn('.fmt', s.format); segOn('.pdf-mode', s.pdfMode); segOn('.pdf-dpi', s.pdfDpi); segOn('.page-dpi', s.pageDpi);
      root.querySelectorAll('.preset').forEach((b) => {
        const p = PRESETS.find((x) => x.id === b.dataset.p);
        b.classList.toggle('on', Object.keys(p.s).every((k) => s[k] === p.s[k] || (k === 'maxPx' && !s.maxOn) || (k === 'targetKB' && !s.targetOn)));
      });
      if (s.format === 'same') fmtNote.style.display = 'none';
      else {
        fmtNote.style.display = '';
        fmtNote.innerHTML = `الامتداد بس اللي هيتغير: <bdi dir="ltr">photo.jpg → photo.${EXT[s.format]}</bdi>` + (s.format === 'jpeg' ? '<br>الشفافية هتتملّى أبيض' : '');
      }
      pdfSec.style.display = showPdf() ? '' : 'none';
      pdfC.style.display = s.pdfMode === 'compress' ? '' : 'none';
      pdfI.style.display = s.pdfMode === 'images' ? '' : 'none';
    }
    root.addEventListener('click', (e) => {
      const p = e.target.closest('.preset');
      if (p) return set({ ...PRESETS.find((x) => x.id === p.dataset.p).s });
      const b = e.target.closest('.seg button');
      if (!b) return;
      const segEl = b.parentElement;
      if (segEl.classList.contains('max-mode')) return set({ maxMode: b.dataset.v });
      if (segEl.classList.contains('fmt')) return set({ format: b.dataset.v });
      if (segEl.classList.contains('pdf-mode')) return set({ pdfMode: b.dataset.v });
      if (segEl.classList.contains('pdf-dpi')) return set({ pdfDpi: +b.dataset.v });
      if (segEl.classList.contains('page-dpi')) return set({ pageDpi: +b.dataset.v });
    });
    q.addEventListener('input', () => set({ quality: +q.value }));
    maxOn.addEventListener('change', () => set({ maxOn: maxOn.checked }));
    tOn.addEventListener('change', () => set({ targetOn: tOn.checked }));
    strip.addEventListener('change', () => set({ strip: strip.checked }));
    quant.addEventListener('change', () => set({ quantize: quant.checked }));
    pdfLl.addEventListener('change', () => set({ pdfLossless: pdfLl.checked }));
    const num = (el, key, min, max) => {
      el.addEventListener('input', () => { const v = Math.round(+el.value); if (v >= min && v <= max) set({ [key]: v }); });
      el.addEventListener('blur', () => { el.value = get()[key]; });
    };
    num(maxPx, 'maxPx', 16, 20000);
    num(tKb, 'targetKB', 5, 500000);
    sync();
    return { sync };
  }

  const hasPdf = () => state.items.some((it) => it.kind === 'pdf');
  const panel = $('#globalPanel');
  const mobileQ = window.matchMedia('(max-width:900px)');
  function panelHint() {
    const s = state.global;
    const parts = [s.quality + '%'];
    if (s.maxOn) parts.push(s.maxPx + (s.maxMode === 'width' ? 'w' : 'px'));
    if (s.targetOn) parts.push('≤' + s.targetKB + 'KB');
    parts.push(s.format === 'same' ? 'same format' : LABEL[s.format]);
    $('#panelHint').textContent = mobileQ.matches ? parts.join(' · ') : 'بتتطبق على كل الملفات';
  }
  $('#panelToggle').addEventListener('click', () => {
    if (!mobileQ.matches) return;
    const c = panel.classList.toggle('collapsed');
    $('#panelToggle').setAttribute('aria-expanded', String(!c));
  });
  mobileQ.addEventListener('change', panelHint);
  const globalForm = buildForm($('#globalForm'), () => state.global, (patch) => {
    const pdfOnly = Object.keys(patch).every((k) => k.startsWith('pdf') || k === 'pageDpi');
    Object.assign(state.global, patch);
    persist();
    globalForm.sync();
    panelHint();
    scheduleReprocess(() => state.items.filter((it) => !it.override && (!pdfOnly || it.kind === 'pdf')));
  }, hasPdf);
  panelHint();
  if (mobileQ.matches) { panel.classList.add('collapsed'); $('#panelToggle').setAttribute('aria-expanded', 'false'); }

  /* ---------------- reprocess (debounced) ---------------- */
  let rpTimer = null, rpPick = null;
  function scheduleReprocess(pick) {
    const prev = rpPick;
    rpPick = prev ? () => [...new Set([...prev(), ...pick()])] : pick;
    clearTimeout(rpTimer);
    rpTimer = setTimeout(() => { const list = rpPick(); rpPick = null; list.forEach(requeue); schedule(); renderSummary(); }, 450);
  }
  function requeue(it) {
    if (!state.items.includes(it)) return;
    it.gen++;
    it.status = 'queued';
    it.progress = null;
    renderCard(it);
  }

  /* ---------------- files in ---------------- */
  function kindOf(f) {
    const e = extToFmt(f.name);
    if (e === 'pdf' || f.type === 'application/pdf') return { kind: 'pdf', fmt: 'pdf' };
    if (e === 'svg' || f.type === 'image/svg+xml') return { kind: 'svg', fmt: 'svg' };
    if (e && IMAGE_FMTS.has(e)) return { kind: 'image', fmt: e };
    const m = /^image\/(jpeg|png|webp|gif|bmp|avif|heic|heif|tiff)$/.exec(f.type);
    if (m) return { kind: 'image', fmt: m[1] === 'heif' ? 'heic' : m[1] };
    return null;
  }
  function addFiles(files) {
    let skipped = 0;
    for (let f of files) {
      const k = kindOf(f);
      if (!k) { skipped++; continue; }
      // لصق من الكليببورد: الاسم بيبقى image.png — نديله اسم مفهوم
      if (f.__pasted) {
        const d = new Date(), p = (n) => String(n).padStart(2, '0');
        f = new File([f], `screenshot-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${EXT[k.fmt] || 'png'}`, { type: f.type });
      }
      const it = { id: state.seq++, file: f, name: f.name, size: f.size, kind: k.kind, fmt: k.fmt, status: 'queued', gen: 0, override: null, res: null };
      state.items.push(it);
      it.el = createCard(it);
      grid.appendChild(it.el);
      renderCard(it);
      if (it.kind === 'pdf') pdfThumb(it);
      if (it.kind === 'svg') { it.thumbUrl = URL.createObjectURL(f); renderCard(it); }
    }
    if (skipped) toast(`اتساب ${skipped} ملف — التوول بتقبل صور (JPG · PNG · WebP · HEIC · AVIF · TIFF · GIF · BMP · SVG) و PDF.`);
    document.querySelector('.work').classList.toggle('has-items', state.items.length > 0);
    globalForm.sync();
    schedule();
    renderSummary();
  }
  let toastT;
  function toast(msg, ms = 5000) {
    const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
    clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, ms);
  }

  const drop = $('#drop'), input = $('#fileInput');
  input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'dragend'].forEach((ev) => window.addEventListener(ev, (e) => { if (!e.relatedTarget) drop.classList.remove('over'); }));
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const dt = e.dataTransfer; if (!dt) return;
    const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.length && entries.some((en) => en.isDirectory)) addFiles(await readEntries(entries));
    else addFiles([...dt.files]);
  });
  // Cmd+V / Ctrl+V: الصق سكرينشوت أو صورة متنسخة
  window.addEventListener('paste', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const files = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (!files.length) return;
    e.preventDefault();
    files.forEach((f) => { if (/^image\.(png|jpe?g|gif|webp)$/i.test(f.name) || !f.name) f.__pasted = true; });
    addFiles(files);
  });
  async function readEntries(entries) {
    const out = [];
    const walk = async (en) => {
      if (en.isFile) out.push(await new Promise((res, rej) => en.file(res, rej)));
      else if (en.isDirectory) {
        const r = en.createReader();
        let batch;
        do { batch = await new Promise((res, rej) => r.readEntries(res, rej)); for (const b of batch) await walk(b); } while (batch.length);
      }
    };
    for (const en of entries) await walk(en);
    return out;
  }

  /* ---------------- worker pool (jobs) ---------------- */
  const POOL = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
  const workers = [];
  const jobQ = [];
  let jobSeq = 1;
  function makeWorker() {
    const w = { w: new Worker(import.meta.url, { type: 'module' }), job: null };
    w.w.onmessage = (e) => {
      const job = w.job; w.job = null;
      if (job && job.jobId === e.data.jobId) { e.data.ok ? job.resolve(e.data) : job.reject(new Error(e.data.error)); }
      pumpJobs();
    };
    w.w.onerror = (e) => {
      e.preventDefault && e.preventDefault();
      const job = w.job;
      w.w.terminate();
      const i = workers.indexOf(w);
      if (i >= 0) workers.splice(i, 1);
      if (job) job.reject(new Error('المعالجة وقعت — الملف تقيل على الجهاز، جرّب «أقصى مقاس» أو قلل الـ DPI'));
      pumpJobs();
    };
    workers.push(w);
    return w;
  }
  function runJob(msg, transfer = []) {
    return new Promise((resolve, reject) => {
      jobQ.push({ jobId: jobSeq++, msg, transfer, resolve, reject });
      pumpJobs();
    });
  }
  function pumpJobs() {
    while (workers.length < POOL) makeWorker();
    for (const w of workers) {
      if (w.job || !jobQ.length) continue;
      const job = jobQ.shift();
      w.job = job;
      w.w.postMessage({ jobId: job.jobId, ...job.msg }, job.transfer);
    }
  }

  /* ---------------- item scheduler ---------------- */
  let active = 0;
  function schedule() {
    while (active < POOL) {
      const it = state.items.find((x) => x.status === 'queued');
      if (!it) break;
      active++;
      it.status = 'working';
      renderCard(it);
      const gen = it.gen;
      processItem(it, gen)
        .then((res) => { if (it.gen === gen && state.items.includes(it)) finishItem(it, res); })
        .catch((err) => { if (it.gen === gen && state.items.includes(it)) { it.status = 'error'; it.error = (err && err.message) || String(err); renderCard(it); } })
        .finally(() => { active--; schedule(); renderSummary(); });
    }
  }
  const settingsOf = (it) => ({ ...(it.override || state.global) });

  async function processItem(it, gen) {
    const s = settingsOf(it);
    if (it.kind === 'pdf' && s.pdfMode === 'images') return pdfToImages(it, gen, s);
    const buf = await it.file.arrayBuffer();
    const type = it.kind === 'pdf' ? 'pdf' : it.kind === 'svg' ? 'svg' : 'image';
    const r = await runJob({ type, buf, name: it.name, settings: s }, [buf]);
    const outName = r.fmtChanged ? splitName(it.name).base + '.' + EXT[r.outFmt] : it.name;
    return {
      kind: it.kind, mode: r.mode, kept: r.kept, note: r.note, targetMissed: r.targetMissed, flattened: r.flattened,
      outFmt: r.outFmt, fmtChanged: r.fmtChanged, w0: r.w0, h0: r.h0, w1: r.w1, h1: r.h1, pages: r.pages, pdfStats: r.pdfStats,
      thumb: r.thumb, pdfImages: false,
      outputs: [{ name: outName, blob: new Blob([r.out], { type: r.mime }), size: r.out.byteLength, fmt: r.outFmt, w: r.w1, h: r.h1 }],
    };
  }
  function finishItem(it, res) {
    [it.thumbUrlOwn, it.outUrl].forEach((u) => u && URL.revokeObjectURL(u));
    it.res = res;
    it.outSize = res.outputs.reduce((a, o) => a + o.size, 0);
    if (res.thumb) { it.thumbUrlOwn = URL.createObjectURL(new Blob([res.thumb], { type: 'image/webp' })); it.thumbUrl = it.thumbUrlOwn; }
    if (it.kind === 'svg') { it.outUrl = URL.createObjectURL(res.outputs[0].blob); }
    it.status = 'done';
    it.error = null;
    it.progress = null;
    renderCard(it);
  }

  /* ---------------- pdf.js (رسم صفحات الـ PDF) ---------------- */
  let pdfjsP = null;
  function pdfjs() {
    if (!pdfjsP) pdfjsP = import(CDN + PKG.pdfjs + '/build/pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = CDN + PKG.pdfjs + '/build/pdf.worker.min.mjs';
      return m;
    }).catch((e) => { pdfjsP = null; throw e; });
    return pdfjsP;
  }
  async function openPdf(bytes) {
    const lib = await pdfjs();
    const task = lib.getDocument({
      data: bytes.slice(), isEvalSupported: false,
      cMapUrl: CDN + PKG.pdfjs + '/cmaps/', cMapPacked: true,
      standardFontDataUrl: CDN + PKG.pdfjs + '/standard_fonts/',
    });
    try { return await task.promise; }
    catch (e) { if (e && e.name === 'PasswordException') throw new Error('الـ PDF محمي بباسورد'); throw new Error('الـ PDF ده مش بيتفتح'); }
  }
  // رسم صفحة واحدة في المرة (الذاكرة على الأجهزة القديمة)
  let renderLock = Promise.resolve();
  function renderPage(doc, pageNo, scale, maxArea = 16e6) {
    const job = renderLock.then(async () => {
      const page = await doc.getPage(pageNo);
      let vp = page.getViewport({ scale });
      const area = vp.width * vp.height;
      let clamped = false;
      if (area > maxArea) { vp = page.getViewport({ scale: scale * Math.sqrt(maxArea / area) }); clamped = true; }
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(vp.width)); c.height = Math.max(1, Math.floor(vp.height));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      return { canvas: c, clamped };
    });
    renderLock = job.catch(() => {});
    return job;
  }
  const canvasBlob = (c, type = 'image/png', q) => new Promise((res) => c.toBlob(res, type, q));

  async function pdfThumb(it) {
    try {
      const doc = await openPdf(new Uint8Array(await it.file.arrayBuffer()));
      it.pageCount = doc.numPages;
      const page1 = await doc.getPage(1);
      const vp = page1.getViewport({ scale: 1 });
      const { canvas } = await renderPage(doc, 1, 420 / Math.max(vp.width, vp.height));
      const b = await canvasBlob(canvas, 'image/webp', 0.8);
      canvas.width = 0;
      doc.destroy();
      if (!state.items.includes(it)) return;
      it.thumbUrlPdf = URL.createObjectURL(b);
      if (!it.thumbUrl) it.thumbUrl = it.thumbUrlPdf;
      renderCard(it);
    } catch (_) { /* thumbnail مش أساسي */ }
  }

  async function pdfToImages(it, gen, s) {
    const doc = await openPdf(new Uint8Array(await it.file.arrayBuffer()));
    try {
      const n = doc.numPages;
      it.pageCount = n;
      const pad = Math.max(2, String(n).length);
      const fmt = s.format === 'same' ? 'jpeg' : s.format;
      const base = splitName(it.name).base;
      const outputs = [];
      let clampedAny = false, missed = false, mode = '';
      for (let p = 1; p <= n; p++) {
        if (it.gen !== gen) throw new Error('stale');
        it.progress = `صفحة ${p}/${n}`; renderCard(it);
        const { canvas, clamped } = await renderPage(doc, p, s.pageDpi / 72);
        clampedAny ||= clamped;
        const w = canvas.width, h = canvas.height;
        const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
        canvas.width = 0;
        const buf = data.buffer;
        const r = await runJob({ type: 'raw', buf, w, h, settings: { ...s, format: fmt } }, [buf]);
        outputs.push({ name: `${base}-${String(p).padStart(pad, '0')}.${EXT[r.outFmt]}`, blob: new Blob([r.out], { type: r.mime }), size: r.out.byteLength, fmt: r.outFmt, w: r.w1, h: r.h1, page: p });
        missed ||= r.targetMissed; mode = r.mode;
      }
      return {
        kind: 'pdf', pdfImages: true, pages: n, outputs, outFmt: fmt, mode: `${LABEL[fmt]} · ${mode} · ${s.pageDpi} DPI`,
        w1: outputs[0] && outputs[0].w, h1: outputs[0] && outputs[0].h, targetMissed: missed, note: clampedAny ? 'clamped' : null,
      };
    } finally { doc.destroy(); }
  }

  /* ---------------- cards ---------------- */
  const fmtSize = (b) => b < 1000 ? b + ' B' : b < 1e6 ? (b / 1000).toFixed(b < 1e4 ? 1 : 0) + ' KB' : (b / 1e6).toFixed(2) + ' MB';
  const pagesTxt = (n) => `${n} ${n === 1 ? 'صفحة' : n <= 10 ? 'صفحات' : 'صفحة'}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function createCard(it) {
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <button type="button" class="thumb" aria-label="قارن قبل وبعد"><div class="spinner"></div></button>
      <button type="button" class="x-btn" aria-label="شيل الملف">✕</button>
      <div class="body">
        <div class="name" title="${esc(it.name)}">${esc(it.name)}</div>
        <div class="meta-row m-dim"></div>
        <div class="meta-row m-size"></div>
        <div class="meta-row m-mode"></div>
        <span class="saving wait">في الطابور…</span>
        <div class="card-note" style="display:none"></div>
        <div class="card-actions">
          <button type="button" class="btn dl" disabled>تحميل</button>
          <button type="button" class="icon-btn cfg" aria-label="إعدادات الملف ده" title="إعدادات الملف ده">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
          </button>
        </div>
      </div>`;
    el.querySelector('.thumb').addEventListener('click', () => { if (it.status === 'done') openCompare(it); });
    el.querySelector('.dl').addEventListener('click', () => downloadItem(it));
    el.querySelector('.cfg').addEventListener('click', () => openItemSettings(it));
    el.querySelector('.x-btn').addEventListener('click', () => removeItem(it));
    return el;
  }

  const NOTES = {
    gifAnim: 'GIF متحرك — اتساب زي ما هو (اختار صيغة لو عاوز تحوّله)',
    gifSame: 'GIF بيفضل زي ما هو — اختار صيغة لو عاوز تحوّله',
    gifFirst: 'GIF متحرك — اتاخد أول فريم بس',
    locked: 'PDF محمي بباسورد — اتساب زي ما هو',
    signed: 'PDF عليه توقيع رقمي — اتساب زي ما هو عشان التوقيع ما يبوظش',
    clamped: 'الصفحة كبيرة جدًا — اترسمت بأقصى دقة الجهاز يستحملها',
  };

  function renderCard(it) {
    const el = it.el; if (!el) return;
    el.classList.toggle('override', !!it.override);
    const thumb = el.querySelector('.thumb');
    const r = it.res;
    const busy = it.status === 'queued' || it.status === 'working';
    let html = '';
    if (it.thumbUrl) html += `<img src="${it.thumbUrl}" alt="">`;
    if (busy) html += '<div class="spinner"></div>';
    const badge = r && it.status === 'done' ? (r.pdfImages ? `${r.outputs.length} × ${LABEL[r.outFmt]}` : LABEL[r.outFmt]) : LABEL[it.fmt];
    if (badge) html += `<span class="badge">${esc(badge)}</span>`;
    if (it.override) html += '<span class="badge ov">مخصصة</span>';
    thumb.innerHTML = html;
    thumb.disabled = it.status !== 'done';

    const sav = el.querySelector('.saving');
    const note = el.querySelector('.card-note');
    const mDim = el.querySelector('.m-dim'), mSize = el.querySelector('.m-size'), mMode = el.querySelector('.m-mode');
    const dl = el.querySelector('.dl');
    const notes = [];

    if (r && it.status === 'done') {
      if (it.kind === 'pdf') {
        const pg = r.pages || it.pageCount || 0;
        mDim.innerHTML = !pg ? '<span>PDF</span>' : r.pdfImages
          ? `<span><bdi>${pagesTxt(pg)}</bdi></span><span class="arrow">→</span><b>${r.w1}×${r.h1}</b>`
          : `<span><bdi>${pagesTxt(pg)}</bdi></span>`;
      } else if (it.kind === 'svg') mDim.innerHTML = '<span>SVG</span>';
      else mDim.innerHTML = `<span>${r.w0}×${r.h0}</span><span class="arrow">→</span><b>${r.w1}×${r.h1}</b>`;
      mSize.innerHTML = `<span>${fmtSize(it.size)}</span><span class="arrow">→</span><b>${fmtSize(it.outSize)}</b>`;
      mMode.innerHTML = `<span>${r.kept ? 'الأصل' : esc(r.pdfImages ? r.mode : LABEL[r.outFmt] + ' · ' + r.mode)}</span>`;
    } else {
      mDim.innerHTML = it.kind === 'pdf' && it.pageCount ? `<span><bdi>${pagesTxt(it.pageCount)}</bdi></span>` : '';
      mSize.innerHTML = `<span>${fmtSize(it.size)}</span>`; mMode.innerHTML = '';
    }

    if (it.status === 'queued') { sav.className = 'saving wait'; sav.textContent = 'في الطابور…'; }
    else if (it.status === 'working') { sav.className = 'saving wait'; sav.textContent = it.progress || 'بيتضغط…'; }
    else if (it.status === 'error') { sav.className = 'saving err'; sav.textContent = 'حصلت مشكلة'; notes.push(esc(it.error || '')); }
    else if (r.kept) { sav.className = 'saving kept'; sav.textContent = r.note === 'locked' || r.note === 'signed' || r.note === 'gifAnim' || r.note === 'gifSame' ? 'اتساب زي ما هو' : 'الأصل أخف — اتساب'; }
    else {
      const pct = Math.round((1 - it.outSize / it.size) * 100);
      sav.className = 'saving' + (pct < 0 ? ' up' : '');
      sav.textContent = pct < 0 ? 'أكبر من الأصل' : '−' + pct + '%';
    }
    if (it.status === 'done' && r) {
      if (r.note && NOTES[r.note]) notes.push(NOTES[r.note]);
      if (r.fmtChanged) notes.push(`الامتداد اتغير: <bdi dir="ltr">${esc(r.outputs[0].name)}</bdi>`);
      if (r.flattened) notes.push('الشفافية اتملت أبيض (JPG)');
      if (r.pdfStats && r.pdfStats.pieceInfo) notes.push('اتشالت بيانات تعديل Illustrator (الشكل زي ما هو)');
      if (r.pdfImages) notes.push(`الأسامي: <bdi dir="ltr">${esc(r.outputs[0].name)}</bdi> …`);
      if (r.pdfImages && it.outSize > it.size) notes.push('الصور أكبر من الـ PDF — طبيعي لأن الصفحة بقت بيكسلز');
      if (r.targetMissed) {
        const s = settingsOf(it);
        notes.push(`ما وصلش لـ <bdi dir="ltr">${s.targetKB}KB</bdi> — ده أقل حجم من غير ما الشكل يبوظ.` + (it.kind === 'pdf' ? ' جرّب دقة 150 DPI.' : ' جرّب «أقصى مقاس» أو WebP.'));
      }
      if (it.zipName && !r.pdfImages && it.zipName !== r.outputs[0].name) notes.push(`في الـ ZIP: <bdi dir="ltr">${esc(it.zipName)}</bdi>`);
      if (it.kind === 'svg' && settingsOf(it).format !== 'same') notes.push('SVG بيفضل SVG (ملف vector)');
    }
    note.style.display = notes.length ? 'block' : 'none';
    note.innerHTML = notes.map((n) => `<span>${n}</span>`).join('');
    dl.disabled = it.status !== 'done';
    dl.textContent = r && r.pdfImages && it.status === 'done' ? 'تحميل ZIP' : 'تحميل';
  }

  async function downloadItem(it) {
    if (it.status !== 'done') return;
    const outs = it.res.outputs;
    if (outs.length === 1) return downloadBlob(outs[0].blob, outs[0].name);
    if (typeof JSZip === 'undefined') return toast('مكتبة الـ ZIP ما اتحملتش — اعمل refresh.');
    const zip = new JSZip();
    for (const o of outs) zip.file(o.name, o.blob, { binary: true, compression: 'STORE' });
    downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), splitName(it.name).base + '.zip');
  }

  function removeItem(it) {
    it.gen++;
    const i = state.items.indexOf(it);
    if (i >= 0) state.items.splice(i, 1);
    [it.outUrl, it.thumbUrlOwn, it.thumbUrlPdf, it.kind === 'svg' ? it.thumbUrl : null].forEach((u) => u && URL.revokeObjectURL(u));
    it.el && it.el.remove();
    document.querySelector('.work').classList.toggle('has-items', state.items.length > 0);
    globalForm.sync();
    renderSummary();
  }
  $('#clearAll').addEventListener('click', () => { [...state.items].forEach(removeItem); });

  /* ---------------- summary + ZIP ---------------- */
  function computeZipNames() {
    const used = new Set();
    const uniq = (n) => {
      if (used.has(n.toLowerCase())) {
        const { base, ext } = splitName(n);
        let k = 2;
        while (used.has(`${base}-${k}${ext}`.toLowerCase())) k++;
        n = `${base}-${k}${ext}`;
      }
      used.add(n.toLowerCase());
      return n;
    };
    for (const it of state.items) {
      if (it.status !== 'done') { it.zipName = null; continue; }
      it.res.outputs.forEach((o, i) => { o.zipName = uniq(o.name); if (i === 0) it.zipName = o.zipName; });
    }
  }
  function renderSummary() {
    const items = state.items;
    $('#summary').style.display = items.length ? '' : 'none';
    const done = items.filter((x) => x.status === 'done');
    const busy = items.filter((x) => x.status === 'queued' || x.status === 'working').length;
    const before = done.reduce((a, x) => a + x.size, 0);
    const after = done.reduce((a, x) => a + x.outSize, 0);
    $('#sumCount').textContent = busy ? `${items.length - busy}/${items.length}` : String(items.length);
    $('#sumBefore').textContent = fmtSize(before);
    $('#sumAfter').textContent = fmtSize(after);
    $('#sumSaved').textContent = before ? Math.round((1 - after / before) * 100) + '%' : '0%';
    const pw = $('#sumProgressWrap');
    pw.style.display = busy ? '' : 'none';
    $('#sumProgress').style.width = items.length ? ((items.length - busy) / items.length * 100) + '%' : '0';
    $('#zipAll').disabled = busy > 0 || done.length === 0;
    $('#makePdf').disabled = !items.some((x) => x.kind === 'image');
    const prev = new Map(items.map((x) => [x, x.zipName]));
    computeZipNames();
    for (const it of items) if (prev.get(it) !== it.zipName) renderCard(it);
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  $('#zipAll').addEventListener('click', async () => {
    const btn = $('#zipAll');
    if (typeof JSZip === 'undefined') { toast('مكتبة الـ ZIP ما اتحملتش — اتأكد من النت واعمل refresh.'); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'بيتجهز…';
    try {
      computeZipNames();
      const zip = new JSZip();
      for (const it of state.items) if (it.status === 'done') for (const o of it.res.outputs) zip.file(o.zipName, o.blob, { binary: true, compression: 'STORE' });
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      downloadBlob(blob, `2mriky-squeeze-bulk-${today()}.zip`);
    } finally { btn.textContent = old; renderSummary(); }
  });
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    const u = URL.createObjectURL(blob);
    a.href = u; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 30000);
  }

  /* ---------------- modals ---------------- */
  function openModal(m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
  function closeModal(m) { m.style.display = 'none'; document.body.style.overflow = ''; m.dispatchEvent(new Event('closed')); }
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(m); });
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal').forEach((m) => { if (m.style.display !== 'none') closeModal(m); });
    if (cmp && cmp.pages > 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) stepPage(e.key === 'ArrowLeft' ? 1 : -1);
  });

  /* per-file settings */
  const itemModal = $('#itemModal');
  let editing = null;
  const itemForm = buildForm($('#itemForm'), () => (editing ? editing.override || state.global : state.global), (patch) => {
    if (!editing) return;
    editing.override = { ...(editing.override || state.global), ...patch };
    itemForm.sync();
    renderCard(editing);
    const target = editing;
    scheduleReprocess(() => [target]);
  }, () => !!editing && editing.kind === 'pdf');
  function openItemSettings(it) {
    editing = it;
    $('#itemName').textContent = it.name;
    itemForm.sync();
    openModal(itemModal);
  }
  $('#itemReset').addEventListener('click', () => {
    if (!editing) return;
    editing.override = null;
    itemForm.sync(); renderCard(editing);
    const target = editing;
    scheduleReprocess(() => [target]);
  });
  itemModal.addEventListener('closed', () => { editing = null; });

  /* ---------------- صور → PDF ---------------- */
  const pdfModal = $('#pdfModal');
  const mk = { order: 'name', page: 'image', src: 'original' };
  try { Object.assign(mk, JSON.parse(localStorage.getItem('squeeze.makepdf') || '{}')); } catch (_) {}
  function mkSync() {
    pdfModal.querySelectorAll('.seg[data-k] button').forEach((b) => b.classList.toggle('on', mk[b.parentElement.dataset.k] === b.dataset.v));
    const imgs = state.items.filter((x) => x.kind === 'image');
    const pending = imgs.filter((x) => x.status !== 'done').length;
    $('#mkCount').textContent = `${imgs.length} صورة`;
    $('#mkSrcHint').textContent = mk.src === 'original'
      ? 'JPG بيدخل زي ما هو بالبايت، وباقي الصيغ lossless — صفر فقد، والحجم أكبر.'
      : (pending ? `مستني ${pending} صورة تخلص ضغط…` : 'الصور بعد الضغط بالإعدادات اللي فوق (الـ JPG أخف حاجة).');
  }
  pdfModal.addEventListener('click', (e) => {
    const b = e.target.closest('.seg[data-k] button');
    if (!b) return;
    mk[b.parentElement.dataset.k] = b.dataset.v;
    try { localStorage.setItem('squeeze.makepdf', JSON.stringify(mk)); } catch (_) {}
    mkSync();
  });
  $('#makePdf').addEventListener('click', () => {
    const first = state.items.find((x) => x.kind === 'image');
    const nm = $('#mkName');
    if (!nm.dataset.touched) {
      // «slide-01.png» → «slide» · الأسامي العامة (IMG_5001 / 1.png) → اسم بالتاريخ
      const b = first ? splitName(first.name).base.replace(/[-_ ]?\d+$/, '').trim() : '';
      nm.value = b.length >= 3 && !/^(img|dsc|dscn|image|photo|screenshot|scan|pxl)$/i.test(b) ? b : `2mriky-pdf-${today()}`;
    }
    mkSync();
    openModal(pdfModal);
  });
  $('#mkName').addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
  const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  $('#mkGo').addEventListener('click', async () => {
    const btn = $('#mkGo');
    let imgs = state.items.filter((x) => x.kind === 'image');
    if (mk.order === 'name') imgs = [...imgs].sort((a, b) => natural.compare(a.name, b.name));
    if (!imgs.length) return;
    if (mk.src === 'compressed' && imgs.some((x) => x.status !== 'done')) { toast('استنى الصور تخلص ضغط الأول.'); return; }
    const name = ($('#mkName').value || 'images').replace(/[\\/:*?"<>|]+/g, '-').replace(/\.pdf$/i, '').trim() || 'images';
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'بيتعمل…';
    try {
      const files = [];
      const transfer = [];
      for (const it of imgs) {
        const b = mk.src === 'original' ? it.file : it.res.outputs[0].blob;
        const buf = await b.arrayBuffer();
        files.push({ buf, name: it.name }); transfer.push(buf);
      }
      const r = await runJob({ type: 'buildpdf', files, pageMode: mk.page, title: name }, transfer);
      downloadBlob(new Blob([r.out], { type: MIME.pdf }), name + '.pdf');
      closeModal(pdfModal);
      toast(`اتعمل ${name}.pdf — ${r.pages} صفحة · ${fmtSize(r.out.byteLength)}`, 6000);
    } catch (err) {
      toast('ما عرفتش أعمل الـ PDF: ' + ((err && err.message) || err));
    } finally { btn.disabled = false; btn.textContent = old; }
  });

  /* ---------------- before/after compare ---------------- */
  const cm = $('#compareModal'), stage = $('#cmpStage'), inner = $('#cmpInner');
  const imgB = $('#cmpBefore'), imgA = $('#cmpAfter'), afterWrap = $('#cmpAfterWrap'), handle = $('#cmpHandle');
  const pager = $('#cmpPager');
  let cmp = null; // {it, urls:[], zoom, pct, page, pages, w, h}
  let cmpSeq = 0;
  async function openCompare(it) {
    cmp = { it, urls: [], zoom: 'fit', pct: 50, page: 1, pages: 1, w: 1, h: 1 };
    $('#cmpName').textContent = it.res.outputs[0].name;
    setZoom('fit');
    openModal(cm);
    if (it.kind === 'pdf') { cmp.pages = it.res.pages || it.pageCount || 1; }
    pager.style.display = cmp.pages > 1 ? '' : 'none';
    await loadCompare();
  }
  async function loadCompare() {
    if (!cmp) return;
    const seq = ++cmpSeq;
    const it = cmp.it, r = it.res;
    cmp.urls.forEach((u) => URL.revokeObjectURL(u)); cmp.urls = [];
    imgB.removeAttribute('src'); imgA.removeAttribute('src');
    stage.classList.add('loading');
    const url = (b) => { const u = URL.createObjectURL(b); cmp.urls.push(u); return u; };
    try {
      let before, after, w, h, meta;
      if (it.kind === 'pdf') {
        const p = cmp.page;
        $('#cmpPage').textContent = `${p} / ${cmp.pages}`;
        // نفتح الملفات مرة واحدة طول ما المقارنة مفتوحة (التقليب بين الصفحات أسرع)
        cmp.docs ||= {};
        const orig = cmp.docs.orig ||= await openPdf(new Uint8Array(await it.file.arrayBuffer()));
        if (seq !== cmpSeq || !cmp) return;
        if (r.pdfImages) {
          const o = r.outputs[p - 1];
          const pg = await orig.getPage(p);
          const vp = pg.getViewport({ scale: 1 });
          const { canvas } = await renderPage(orig, p, o.w / vp.width);
          before = await canvasBlob(canvas); canvas.width = 0;
          after = o.blob; w = o.w; h = o.h;
          meta = `صفحة ${p} · ${o.w}×${o.h} · ${fmtSize(o.size)}`;
          $('#cmpName').textContent = o.name;
        } else {
          const pg = await orig.getPage(p);
          const vp = pg.getViewport({ scale: 1 });
          const scale = Math.min(4, 2400 / Math.max(vp.width, vp.height));
          const a = await renderPage(orig, p, scale);
          before = await canvasBlob(a.canvas); w = a.canvas.width; h = a.canvas.height; a.canvas.width = 0;
          const outDoc = cmp.docs.out ||= await openPdf(new Uint8Array(await r.outputs[0].blob.arrayBuffer()));
          const b2 = await renderPage(outDoc, p, scale);
          after = await canvasBlob(b2.canvas); b2.canvas.width = 0;
          meta = `${fmtSize(it.size)} → ${fmtSize(it.outSize)} · صفحة ${p} مرسومة ${w}×${h}`;
        }
      } else if (it.kind === 'svg') {
        before = it.file; after = r.outputs[0].blob;
        const probe = await new Promise((res) => { const im = new Image(); im.onload = () => res([im.naturalWidth || 800, im.naturalHeight || 800]); im.onerror = () => res([800, 800]); im.src = url(it.file); });
        const sc = Math.max(1, 1200 / Math.max(probe[0], probe[1]));
        w = Math.round(probe[0] * sc); h = Math.round(probe[1] * sc);
        meta = `${fmtSize(it.size)} → ${fmtSize(it.outSize)}`;
      } else {
        if (BROWSER_OK.has(it.fmt)) before = it.file;
        else {
          const buf = await it.file.arrayBuffer();
          const pr = await runJob({ type: 'preview', buf, name: it.name }, [buf]);
          before = new Blob([pr.out], { type: pr.mime });
        }
        after = r.outputs[0].blob; w = r.w1; h = r.h1;
        meta = `${r.w0}×${r.h0} · ${fmtSize(it.size)}  →  ${r.w1}×${r.h1} · ${fmtSize(it.outSize)}`;
      }
      if (seq !== cmpSeq || !cmp) return;
      cmp.w = w; cmp.h = h;
      $('#cmpMeta').textContent = meta;
      imgB.src = url(before); imgA.src = url(after);
      layoutCompare();
    } catch (err) {
      if (seq === cmpSeq) $('#cmpMeta').textContent = 'ما عرفتش أعرض المقارنة: ' + ((err && err.message) || err);
    } finally { if (seq === cmpSeq) stage.classList.remove('loading'); }
  }
  function stepPage(d) {
    if (!cmp) return;
    const p = Math.min(cmp.pages, Math.max(1, cmp.page + d));
    if (p === cmp.page) return;
    cmp.page = p; loadCompare();
  }
  $('#cmpPrev').addEventListener('click', () => stepPage(-1));
  $('#cmpNext').addEventListener('click', () => stepPage(1));
  cm.addEventListener('closed', () => {
    if (cmp) {
      cmp.urls.forEach((u) => URL.revokeObjectURL(u));
      if (cmp.docs) Object.values(cmp.docs).forEach((d) => d && d.destroy && d.destroy());
    }
    cmp = null; cmpSeq++; imgB.removeAttribute('src'); imgA.removeAttribute('src');
  });
  function setZoom(z) {
    if (!cmp) return;
    cmp.zoom = z;
    stage.classList.toggle('z100', z === '100');
    document.querySelectorAll('#zoomSeg button').forEach((b) => b.classList.toggle('on', b.dataset.zoom === z));
    layoutCompare();
    if (z === '100') {
      stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
      stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
    }
  }
  $('#zoomSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setZoom(b.dataset.zoom); });
  function layoutCompare() {
    if (!cmp) return;
    const { w: w1, h: h1 } = cmp;
    let w, h;
    if (cmp.zoom === '100') {
      const dpr = window.devicePixelRatio || 1;
      w = w1 / dpr; h = h1 / dpr;
    } else {
      const sw = stage.clientWidth - 16, sh = stage.clientHeight - 16;
      const sc = Math.min(sw / w1, sh / h1);
      w = Math.max(1, w1 * sc); h = Math.max(1, h1 * sc);
    }
    inner.style.width = w + 'px'; inner.style.height = h + 'px';
    setPct(cmp.pct);
  }
  function setPct(p) {
    if (!cmp) return;
    cmp.pct = Math.max(0, Math.min(100, p));
    afterWrap.style.clipPath = `inset(0 0 0 ${cmp.pct}%)`;
    handle.style.left = cmp.pct + '%';
  }
  function pctFromEvent(e) {
    const r = inner.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * 100;
  }
  let dragging = false;
  handle.addEventListener('pointerdown', (e) => { dragging = true; handle.setPointerCapture(e.pointerId); e.preventDefault(); });
  handle.addEventListener('pointermove', (e) => { if (dragging) setPct(pctFromEvent(e)); });
  handle.addEventListener('pointerup', () => { dragging = false; });
  handle.addEventListener('pointercancel', () => { dragging = false; });
  stage.addEventListener('pointerdown', (e) => {
    if (!cmp || cmp.zoom !== 'fit' || e.target.closest('.cmp-handle')) return;
    dragging = true; stage.setPointerCapture(e.pointerId); setPct(pctFromEvent(e));
  });
  stage.addEventListener('pointermove', (e) => { if (dragging && cmp && cmp.zoom === 'fit') setPct(pctFromEvent(e)); });
  stage.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('resize', () => { if (cmp) layoutCompare(); });

  // للاختبار الأوتوماتيكي بس
  window.__squeeze = { state, addFiles, computeZipNames };
}
