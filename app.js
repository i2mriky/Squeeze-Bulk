/* 2mriky Squeeze Bulk — v1
 * نفس الملف بيشتغل كـ UI في الصفحة وكـ Web Worker للمعالجة.
 * كل المعالجة جوه المتصفح. مفيش أي رفع لأي سيرفر.
 */
const CDN = 'https://cdn.jsdelivr.net/npm/';
const PKG = {
  jpeg: '@jsquash/jpeg@1.6.0',
  png: '@jsquash/png@3.1.1',
  webp: '@jsquash/webp@1.5.0',
  oxipng: '@jsquash/oxipng@2.3.0',
  resize: '@jsquash/resize@2.1.1',
  imageq: 'image-q@4.0.0',
};
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const LABEL = { jpeg: 'JPG', png: 'PNG', webp: 'WebP' };

const IS_WORKER = typeof window === 'undefined' && typeof self !== 'undefined';
if (IS_WORKER) initWorker(); else initApp();

/* ================================================================
 * Shared helpers
 * ================================================================ */
function extToFmt(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  if (!m) return null;
  const e = m[1].toLowerCase();
  if (e === 'jpg' || e === 'jpeg' || e === 'jfif') return 'jpeg';
  if (e === 'png') return 'png';
  if (e === 'webp') return 'webp';
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
  const once = (k, fn) => (cache[k] ||= fn());

  const L = {
    jpegEnc: () => once('jpegEnc', async () => (await import(CDN + PKG.jpeg + '/encode.js')).default),
    jpegDec: () => once('jpegDec', async () => (await import(CDN + PKG.jpeg + '/decode.js')).default),
    pngDec: () => once('pngDec', async () => (await import(CDN + PKG.png + '/decode.js')).decode),
    webpDec: () => once('webpDec', async () => (await import(CDN + PKG.webp + '/decode.js')).default),
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
  };

  self.onmessage = async (e) => {
    const { id, gen, buf, name, settings } = e.data;
    try {
      const r = await processImage(new Uint8Array(buf), name, settings);
      const transfer = [r.out.buffer];
      if (r.thumb) transfer.push(r.thumb.buffer);
      self.postMessage({ id, gen, ok: true, ...r }, transfer);
    } catch (err) {
      self.postMessage({ id, gen, ok: false, error: (err && err.message) || String(err) });
    }
  };

  /* ---------------- pipeline ---------------- */
  async function processImage(src, name, s) {
    const srcFmt = sniff(src);
    if (!srcFmt) throw new Error('صيغة مش مدعومة');
    const nameFmt = extToFmt(name) || srcFmt;
    const outFmt = s.format === 'same' ? nameFmt : s.format;
    const meta = await readMeta(src, srcFmt);

    let img = await decode(src, srcFmt);
    if (meta.orientation > 1 && !img.__oriented) img = applyOrientation(img, meta.orientation);
    const w0 = img.width, h0 = img.height;

    const [w1, h1] = fitDims(w0, h0, s);
    const resized = w1 !== w0 || h1 !== h0;
    if (resized) img = await resizeTo(img, w1, h1, 'lanczos3');

    const hasAlpha = checkAlpha(img);
    const target = s.targetOn ? Math.max(1, s.targetKB) * 1000 : 0;
    const enc = await encodeSmart(img, outFmt, s, hasAlpha, target);

    let out = await addMeta(enc.bytes, outFmt, meta, s.strip, hasAlpha, img.width, img.height);
    let kept = false;
    let finalFmt = outFmt;
    let mode = enc.mode;
    // الناتج أكبر من الأصل ومفيش تغيير مقاس؟ نحتفظ بالأصل
    if (!resized && out.length >= src.length) {
      kept = true;
      finalFmt = srcFmt;
      out = s.strip ? await stripOriginal(src, srcFmt, meta) : src;
      if (out.length > src.length) out = src;
      mode = 'original';
    }
    // نسخة مستقلة من البافر عشان الـ transfer
    out = out.byteOffset === 0 && out.byteLength === out.buffer.byteLength ? out : out.slice();
    if (out === src) out = src.slice();

    let thumb = null;
    try {
      const tw = Math.max(img.width, img.height) > 420 ? fitLong(img.width, img.height, 420) : [img.width, img.height];
      const t = (tw[0] !== img.width || tw[1] !== img.height) ? await resizeTo(img, tw[0], tw[1], 'triangle') : img;
      thumb = (await L.webpEnc())(t, { quality: 72, method: 2 });
    } catch (_) { thumb = null; }

    return {
      out, thumb,
      outFmt: finalFmt,
      fmtChanged: !kept && finalFmt !== nameFmt,
      mime: MIME[finalFmt],
      w0, h0,
      w1: kept ? w0 : img.width,
      h1: kept ? h0 : img.height,
      kept,
      mode,
      targetMissed: !kept && enc.missed,
      flattened: finalFmt === 'jpeg' && hasAlpha && !kept,
      hadOrientation: meta.orientation > 1,
    };
  }

  function sniff(b) {
    if (b.length < 12) return null;
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (str(b, 0, 4) === 'RIFF' && str(b, 8, 4) === 'WEBP') return 'webp';
    return null;
  }
  function str(b, o, n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]); return s; }

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

  /* ---------------- decode ---------------- */
  async function decode(src, fmt) {
    try {
      let img;
      if (fmt === 'jpeg') img = await (await L.jpegDec())(src.buffer.byteLength === src.length ? src.buffer : src.slice().buffer);
      else if (fmt === 'png') img = await (await L.pngDec())(src);
      else img = await (await L.webpDec())(src.buffer.byteLength === src.length ? src.buffer : src.slice().buffer);
      if (img && img.width) return img;
      throw new Error('empty');
    } catch (err) {
      // fallback: decoder بتاع المتصفح (مثلاً JPEG CMYK)
      const bmp = await createImageBitmap(new Blob([src], { type: MIME[fmt] }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
      bmp.close && bmp.close();
      d.__oriented = true; // المتصفح بيطبق الـ EXIF orientation لوحده
      return d;
    }
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

  /* ---------------- encode ---------------- */
  async function encodeSmart(img, fmt, s, hasAlpha, target) {
    const qMax = clampInt(s.quality, 1, 100);
    if (fmt === 'jpeg') {
      const enc = await L.jpegEnc();
      const src = hasAlpha ? flattenWhite(img) : img;
      const at = async (q) => new Uint8Array(await enc(src, {
        quality: q, progressive: true, optimize_coding: true,
        ...(q >= 90 ? { auto_subsample: false, chroma_subsample: 1 } : {}),
      }));
      return lossySearch(at, qMax, target, 'Q');
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
    // target على PNG: binary search على عدد الألوان
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

  /* ---------------- metadata ---------------- */
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
      const drop = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
      const parts = [b.subarray(0, 8)];
      const cs = pngChunks(b);
      for (const c of cs) if (!drop.has(c.type)) parts.push(b.subarray(c.start, c.end));
      let out = concat(parts);
      if (o > 1) out = await pngInsert(out, minimalExif(o), null);
      return out;
    }
    // webp
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

  /* ---------------- bytes utils ---------------- */
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
  const DEFAULTS = { quality: 82, maxOn: false, maxMode: 'long', maxPx: 1080, targetOn: false, targetKB: 200, format: 'same', strip: true, quantize: false };
  const PRESETS = [
    { id: 'web', t: 'Website', d: '1080 / 82%', s: { quality: 82, maxOn: true, maxMode: 'long', maxPx: 1080, targetOn: false } },
    { id: 'ig', t: 'Instagram', d: '1080w / 85%', s: { quality: 85, maxOn: true, maxMode: 'width', maxPx: 1080, targetOn: false } },
    { id: 'same', t: 'Same size', d: 'compress only', s: { quality: 82, maxOn: false, targetOn: false } },
    { id: 'u200', t: 'Under 200KB', d: 'target 200KB', s: { quality: 90, maxOn: false, targetOn: true, targetKB: 200 } },
  ];

  const state = { global: { ...DEFAULTS }, items: [], seq: 1 };
  const grid = $('#grid');

  /* ---------------- settings form ---------------- */
  function buildForm(root, get, set) {
    root.innerHTML = `
      <div class="f-sec">
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
          <div class="num-input"><input type="number" class="t-kb" min="5" max="50000" step="1" inputmode="numeric"><em>KB</em></div>
        </div>
      </div>
      <div class="f-sec">
        <div class="f-label">الصيغة</div>
        <div class="seg accent fmt"><button type="button" data-v="same">زي الأصل</button><button type="button" data-v="jpeg">JPG</button><button type="button" data-v="png">PNG</button><button type="button" data-v="webp">WebP</button></div>
        <div class="note fmt-note" style="display:none"></div>
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

    function sync() {
      const s = get();
      q.value = s.quality; qv.textContent = s.quality + '%';
      ql.textContent = s.targetOn ? 'أقصى كواليتي' : 'الكواليتي';
      maxOn.checked = s.maxOn; maxF.style.display = s.maxOn ? '' : 'none';
      if (document.activeElement !== maxPx) maxPx.value = s.maxPx;
      tOn.checked = s.targetOn; tF.style.display = s.targetOn ? '' : 'none';
      if (document.activeElement !== tKb) tKb.value = s.targetKB;
      strip.checked = s.strip; quant.checked = s.quantize;
      root.querySelectorAll('.max-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.maxMode));
      root.querySelectorAll('.fmt button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.format));
      root.querySelectorAll('.preset').forEach((b) => {
        const p = PRESETS.find((x) => x.id === b.dataset.p);
        b.classList.toggle('on', Object.keys(p.s).every((k) => s[k] === p.s[k] || (k === 'maxPx' && !s.maxOn) || (k === 'targetKB' && !s.targetOn)));
      });
      if (s.format === 'same') { fmtNote.style.display = 'none'; }
      else {
        fmtNote.style.display = '';
        fmtNote.innerHTML = `الامتداد بس اللي هيتغير: <bdi dir="ltr">photo.jpg → photo.${EXT[s.format]}</bdi>` + (s.format === 'jpeg' ? '<br>الشفافية هتتملّى أبيض' : '');
      }
    }
    root.addEventListener('click', (e) => {
      const p = e.target.closest('.preset');
      if (p) return set({ ...PRESETS.find((x) => x.id === p.dataset.p).s });
      const mm = e.target.closest('.max-mode button');
      if (mm) return set({ maxMode: mm.dataset.v });
      const f = e.target.closest('.fmt button');
      if (f) return set({ format: f.dataset.v });
    });
    q.addEventListener('input', () => set({ quality: +q.value }));
    maxOn.addEventListener('change', () => set({ maxOn: maxOn.checked }));
    tOn.addEventListener('change', () => set({ targetOn: tOn.checked }));
    strip.addEventListener('change', () => set({ strip: strip.checked }));
    quant.addEventListener('change', () => set({ quantize: quant.checked }));
    const num = (el, key, min, max) => {
      el.addEventListener('input', () => { const v = Math.round(+el.value); if (v >= min && v <= max) set({ [key]: v }); });
      el.addEventListener('blur', () => { el.value = get()[key]; });
    };
    num(maxPx, 'maxPx', 16, 20000);
    num(tKb, 'targetKB', 5, 50000);
    sync();
    return { sync };
  }

  const panel = $('#globalPanel');
  const mobileQ = window.matchMedia('(max-width:900px)');
  function panelHint() {
    const s = state.global;
    const parts = [s.quality + '%'];
    if (s.maxOn) parts.push(s.maxPx + (s.maxMode === 'width' ? 'w' : 'px'));
    if (s.targetOn) parts.push('≤' + s.targetKB + 'KB');
    parts.push(s.format === 'same' ? 'same format' : LABEL[s.format]);
    $('#panelHint').textContent = mobileQ.matches ? parts.join(' · ') : 'بتتطبق على كل الصور';
  }
  $('#panelToggle').addEventListener('click', () => {
    if (!mobileQ.matches) return;
    const c = panel.classList.toggle('collapsed');
    $('#panelToggle').setAttribute('aria-expanded', String(!c));
  });
  mobileQ.addEventListener('change', panelHint);
  const globalForm = buildForm($('#globalForm'), () => state.global, (patch) => {
    Object.assign(state.global, patch);
    globalForm.sync();
    panelHint();
    scheduleReprocess(() => state.items.filter((it) => !it.override));
  });

  panelHint();
  if (mobileQ.matches) { panel.classList.add('collapsed'); $('#panelToggle').setAttribute('aria-expanded', 'false'); }

  /* ---------------- reprocess (debounced) ---------------- */
  let rpTimer = null, rpPick = null;
  function scheduleReprocess(pick) {
    const prev = rpPick;
    rpPick = prev ? () => [...new Set([...prev(), ...pick()])] : pick;
    clearTimeout(rpTimer);
    rpTimer = setTimeout(() => { const list = rpPick(); rpPick = null; list.forEach(requeue); pump(); renderSummary(); }, 450);
  }
  function requeue(it) {
    if (!state.items.includes(it)) return;
    it.gen++;
    it.status = 'queued';
    renderCard(it);
  }

  /* ---------------- files in ---------------- */
  const OK_TYPES = /^image\/(jpeg|png|webp)$/;
  function accept(f) { return OK_TYPES.test(f.type) || !!extToFmt(f.name); }
  function addFiles(files) {
    let skipped = 0;
    for (const f of files) {
      if (!accept(f)) { skipped++; continue; }
      const it = { id: state.seq++, file: f, name: f.name, size: f.size, status: 'queued', gen: 0, override: null, res: null };
      state.items.push(it);
      it.el = createCard(it);
      grid.appendChild(it.el);
      renderCard(it);
    }
    if (skipped) toast(`اتساب ${skipped} ملف — التوول بتقبل JPG و PNG و WebP بس.`);
    document.querySelector('.work').classList.toggle('has-items', state.items.length > 0);
    pump();
    renderSummary();
  }
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.style.display = 'block';
    clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, 5000);
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

  /* ---------------- worker pool ---------------- */
  const POOL = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
  const workers = [];
  function makeWorker() {
    const w = { w: new Worker(import.meta.url, { type: 'module' }), job: null };
    w.w.onmessage = (e) => onResult(w, e.data);
    w.w.onerror = (e) => {
      e.preventDefault && e.preventDefault();
      const job = w.job;
      w.w.terminate();
      const i = workers.indexOf(w);
      if (i >= 0) workers.splice(i, 1);
      if (job) {
        const it = state.items.find((x) => x.id === job.id);
        if (it && it.gen === job.gen) { it.status = 'error'; it.error = 'المعالجة وقعت — جرّب تاني أو قلل المقاس'; renderCard(it); }
      }
      pump(); renderSummary();
    };
    workers.push(w);
    return w;
  }
  function pump() {
    while (workers.length < POOL) makeWorker();
    for (const w of workers) {
      if (w.job) continue;
      const it = state.items.find((x) => x.status === 'queued');
      if (!it) break;
      startJob(w, it);
    }
  }
  async function startJob(w, it) {
    it.status = 'working';
    w.job = { id: it.id, gen: it.gen };
    renderCard(it);
    try {
      const buf = await it.file.arrayBuffer();
      const settings = { ...(it.override || state.global) };
      w.w.postMessage({ id: it.id, gen: it.gen, buf, name: it.name, settings }, [buf]);
    } catch (err) {
      w.job = null;
      it.status = 'error'; it.error = 'مش قادر أقرا الملف';
      renderCard(it); pump(); renderSummary();
    }
  }
  function onResult(w, msg) {
    w.job = null;
    const it = state.items.find((x) => x.id === msg.id);
    if (it && it.gen === msg.gen) {
      if (msg.ok) {
        if (it.outUrl) URL.revokeObjectURL(it.outUrl);
        if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
        it.res = msg;
        it.blob = new Blob([msg.out], { type: msg.mime });
        it.outName = msg.fmtChanged ? splitName(it.name).base + '.' + EXT[msg.outFmt] : it.name;
        it.outUrl = URL.createObjectURL(it.blob);
        it.thumbUrl = msg.thumb ? URL.createObjectURL(new Blob([msg.thumb], { type: 'image/webp' })) : it.outUrl;
        it.status = 'done';
        it.error = null;
      } else {
        it.status = 'error';
        it.error = msg.error;
      }
      renderCard(it);
    }
    pump();
    renderSummary();
  }

  /* ---------------- cards ---------------- */
  const fmtSize = (b) => b < 1000 ? b + ' B' : b < 1e6 ? (b / 1000).toFixed(b < 1e4 ? 1 : 0) + ' KB' : (b / 1e6).toFixed(2) + ' MB';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function createCard(it) {
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <button type="button" class="thumb" aria-label="قارن قبل وبعد"><div class="spinner"></div></button>
      <button type="button" class="x-btn" aria-label="شيل الصورة">✕</button>
      <div class="body">
        <div class="name" title="${esc(it.name)}">${esc(it.name)}</div>
        <div class="meta-row m-dim"></div>
        <div class="meta-row m-size"></div>
        <div class="meta-row m-mode"></div>
        <span class="saving wait">في الطابور…</span>
        <div class="card-note" style="display:none"></div>
        <div class="card-actions">
          <button type="button" class="btn dl" disabled>تحميل</button>
          <button type="button" class="icon-btn cfg" aria-label="إعدادات الصورة دي" title="إعدادات الصورة دي">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
          </button>
        </div>
      </div>`;
    el.querySelector('.thumb').addEventListener('click', () => { if (it.status === 'done') openCompare(it); });
    el.querySelector('.dl').addEventListener('click', () => { if (it.blob) downloadBlob(it.blob, it.outName); });
    el.querySelector('.cfg').addEventListener('click', () => openItemSettings(it));
    el.querySelector('.x-btn').addEventListener('click', () => removeItem(it));
    return el;
  }

  function renderCard(it) {
    const el = it.el; if (!el) return;
    el.classList.toggle('override', !!it.override);
    const thumb = el.querySelector('.thumb');
    const r = it.res;
    const busy = it.status === 'queued' || it.status === 'working';
    let html = '';
    if (it.thumbUrl) html += `<img src="${it.thumbUrl}" alt="">`;
    if (busy) html += '<div class="spinner"></div>';
    if (r && it.status === 'done') html += `<span class="badge">${LABEL[r.outFmt]}</span>`;
    if (it.override) html += '<span class="badge ov">مخصصة</span>';
    thumb.innerHTML = html;
    thumb.disabled = it.status !== 'done';

    const sav = el.querySelector('.saving');
    const note = el.querySelector('.card-note');
    const mDim = el.querySelector('.m-dim'), mSize = el.querySelector('.m-size'), mMode = el.querySelector('.m-mode');
    const dl = el.querySelector('.dl');
    const notes = [];

    if (r) {
      mDim.innerHTML = `<span>${r.w0}×${r.h0}</span><span class="arrow">→</span><b>${r.w1}×${r.h1}</b>`;
      mSize.innerHTML = `<span>${fmtSize(it.size)}</span><span class="arrow">→</span><b>${fmtSize(r.out.byteLength)}</b>`;
      mMode.innerHTML = `<span>${r.kept ? 'الأصل' : LABEL[r.outFmt] + ' · ' + r.mode}</span>`;
    } else {
      mDim.innerHTML = ''; mSize.innerHTML = `<span>${fmtSize(it.size)}</span>`; mMode.innerHTML = '';
    }

    if (it.status === 'queued') { sav.className = 'saving wait'; sav.textContent = 'في الطابور…'; }
    else if (it.status === 'working') { sav.className = 'saving wait'; sav.textContent = 'بيتضغط…'; }
    else if (it.status === 'error') { sav.className = 'saving err'; sav.textContent = 'حصلت مشكلة'; notes.push(esc(it.error || '')); }
    else if (r.kept) { sav.className = 'saving kept'; sav.textContent = 'الأصل أخف — اتساب'; }
    else {
      const pct = Math.round((1 - r.out.byteLength / it.size) * 100);
      sav.className = 'saving'; sav.textContent = (pct > 0 ? '−' : '') + Math.abs(pct) + '%';
    }
    if (it.status === 'done' && r) {
      if (r.fmtChanged) notes.push(`الامتداد اتغير: <bdi dir="ltr">${esc(it.outName)}</bdi>`);
      if (r.flattened) notes.push('الشفافية اتملت أبيض (JPG)');
      if (r.targetMissed) {
        const s = it.override || state.global;
        notes.push(`ما وصلش لـ <bdi dir="ltr">${s.targetKB}KB</bdi> — ده أقل حجم من غير ما الشكل يبوظ. جرّب «أقصى مقاس» أو WebP.`);
      }
      if (it.zipName && it.zipName !== it.outName) notes.push(`في الـ ZIP: <bdi dir="ltr">${esc(it.zipName)}</bdi>`);
    }
    note.style.display = notes.length ? 'block' : 'none';
    note.innerHTML = notes.map((n) => `<span>${n}</span>`).join('');
    dl.disabled = it.status !== 'done';
  }

  function removeItem(it) {
    it.gen++;
    const i = state.items.indexOf(it);
    if (i >= 0) state.items.splice(i, 1);
    [it.outUrl, it.thumbUrl].forEach((u) => u && URL.revokeObjectURL(u));
    it.el && it.el.remove();
    document.querySelector('.work').classList.toggle('has-items', state.items.length > 0);
    renderSummary();
  }
  $('#clearAll').addEventListener('click', () => { [...state.items].forEach(removeItem); });

  /* ---------------- summary + ZIP ---------------- */
  function computeZipNames() {
    const used = new Set();
    for (const it of state.items) {
      if (it.status !== 'done') { it.zipName = null; continue; }
      let n = it.outName;
      if (used.has(n.toLowerCase())) {
        const { base, ext } = splitName(n);
        let k = 2;
        while (used.has(`${base}-${k}${ext}`.toLowerCase())) k++;
        n = `${base}-${k}${ext}`;
      }
      used.add(n.toLowerCase());
      it.zipName = n;
    }
  }
  function renderSummary() {
    const items = state.items;
    $('#summary').style.display = items.length ? '' : 'none';
    const done = items.filter((x) => x.status === 'done');
    const busy = items.filter((x) => x.status === 'queued' || x.status === 'working').length;
    const before = done.reduce((a, x) => a + x.size, 0);
    const after = done.reduce((a, x) => a + x.res.out.byteLength, 0);
    $('#sumCount').textContent = busy ? `${items.length - busy}/${items.length}` : String(items.length);
    $('#sumBefore').textContent = fmtSize(before);
    $('#sumAfter').textContent = fmtSize(after);
    $('#sumSaved').textContent = before ? Math.round((1 - after / before) * 100) + '%' : '0%';
    const pw = $('#sumProgressWrap');
    pw.style.display = busy ? '' : 'none';
    $('#sumProgress').style.width = items.length ? ((items.length - busy) / items.length * 100) + '%' : '0';
    $('#zipAll').disabled = busy > 0 || done.length === 0;
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
      for (const it of state.items) if (it.status === 'done') zip.file(it.zipName, it.blob, { binary: true, compression: 'STORE' });
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
  });

  /* per-image settings */
  const itemModal = $('#itemModal');
  let editing = null;
  const itemForm = buildForm($('#itemForm'), () => (editing ? editing.override || state.global : state.global), (patch) => {
    if (!editing) return;
    editing.override = { ...(editing.override || state.global), ...patch };
    itemForm.sync();
    renderCard(editing);
    const target = editing;
    scheduleReprocess(() => [target]);
  });
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

  /* before/after compare */
  const cm = $('#compareModal'), stage = $('#cmpStage'), inner = $('#cmpInner');
  const imgB = $('#cmpBefore'), imgA = $('#cmpAfter'), afterWrap = $('#cmpAfterWrap'), handle = $('#cmpHandle');
  let cmp = null; // {it, beforeUrl, zoom, pct}
  function openCompare(it) {
    const r = it.res;
    cmp = { it, beforeUrl: URL.createObjectURL(it.file), zoom: 'fit', pct: 50 };
    imgB.src = cmp.beforeUrl;
    imgA.src = it.outUrl;
    $('#cmpName').textContent = it.outName;
    $('#cmpMeta').textContent = `${r.w0}×${r.h0} · ${fmtSize(it.size)}  →  ${r.w1}×${r.h1} · ${fmtSize(r.out.byteLength)}`;
    setZoom('fit');
    openModal(cm);
    requestAnimationFrame(layoutCompare);
  }
  cm.addEventListener('closed', () => {
    if (cmp) URL.revokeObjectURL(cmp.beforeUrl);
    cmp = null; imgB.removeAttribute('src'); imgA.removeAttribute('src');
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
    const { w1, h1 } = cmp.it.res;
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
