/* 战术分享码 (WTMAP://) 编解码：零后端存储，纯前端压缩 + 校验
 *
 * 格式:  WTMAP://1.<z|j>.<base64url 载荷>.<crc32 8位hex>
 *   1      格式版本
 *   z / j  z = deflate-raw 压缩（CompressionStream），j = 未压缩 JSON（旧浏览器兜底）
 *   crc32  对原始 JSON UTF-8 字节计算，用于发现微信/QQ 转发时被截断或改动的码
 *
 * 载荷 JSON:
 *   { v:1, app:"wt-tactical-map", t:<ms>,
 *     map:{ id, name, sig:[底图指纹...] },
 *     layers:[ { id, name, color, category, elements:[polyline|marker|zone] } ] }
 * 所有坐标均为当前项目统一的 [0,1] 归一化比例，跨分辨率/跨设备通用。
 */
(function (global) {
  "use strict";

  const PREFIX = "WTMAP://";
  const VERSION = 1;
  const MAX_CODE_CHARS = 400000;
  const MAX_LAYERS = 64;
  const MAX_ELEMENTS = 5000;
  const MAX_POINTS = 2000;
  const MAX_LABEL = 40;
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

  // ---------- CRC32 ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32Hex(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
  }

  // ---------- base64url ----------
  function bytesToB64url(bytes) {
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64urlToBytes(str) {
    let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---------- deflate-raw (optional) ----------
  const canCompress =
    typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

  async function pipeBytes(bytes, stream) {
    const piped = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(piped).arrayBuffer());
  }

  // ---------- sanitizing ----------
  function num01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
  }

  function cleanPoint(p) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = num01(p[0]);
    const y = num01(p[1]);
    return x === null || y === null ? null : [x, y];
  }

  function cleanColor(c, fallback) {
    return typeof c === "string" && COLOR_RE.test(c) ? c.toLowerCase() : fallback;
  }

  function cleanLabel(s) {
    return typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_LABEL) : "";
  }

  function cleanElement(el) {
    if (!el || typeof el !== "object") return null;
    if (el.kind === "polyline" || el.kind === "curve") {
      const pts = (Array.isArray(el.points) ? el.points : []).slice(0, MAX_POINTS).map(cleanPoint).filter(Boolean);
      if (pts.length < 2) return null;
      const out = { kind: el.kind, points: pts, arrow: el.arrow !== false, dashed: !!el.dashed };
      const w = Number(el.width);
      if (Number.isFinite(w)) out.width = Math.min(8, Math.max(1.5, w));
      const color = cleanColor(el.color, null);
      if (color) out.color = color;
      const label = cleanLabel(el.label);
      if (label) out.label = label;
      return out;
    }
    if (el.kind === "marker" || el.kind === "zone") {
      const point = cleanPoint(el.point);
      if (!point) return null;
      const out = { kind: el.kind, point };
      if (el.kind === "zone") {
        const r = Number(el.radius);
        out.radius = Number.isFinite(r) ? Math.round(Math.min(0.5, Math.max(0.005, r)) * 10000) / 10000 : 0.06;
      } else {
        out.icon = typeof el.icon === "string" ? el.icon.slice(0, 16) : "sniper";
      }
      const color = cleanColor(el.color, null);
      if (color) out.color = color;
      const label = cleanLabel(el.label);
      if (label) out.label = label;
      return out;
    }
    return null;
  }

  function cleanLayerId(s) {
    return String(s || "").replace(/[^A-Za-z0-9_\-]/g, "").slice(0, 48) || "layer";
  }

  /** Validate + normalize a decoded payload. Throws Error with a Chinese message on failure. */
  function sanitizePayload(raw) {
    if (!raw || typeof raw !== "object") throw new Error("战术码内容不是有效对象");
    if (raw.v !== VERSION) throw new Error(`不支持的战术码版本: ${raw.v}`);
    const map = raw.map && typeof raw.map === "object" ? raw.map : {};
    const layersIn = Array.isArray(raw.layers) ? raw.layers.slice(0, MAX_LAYERS) : [];
    let total = 0;
    const layers = [];
    for (const l of layersIn) {
      if (!l || typeof l !== "object") continue;
      const elements = [];
      for (const el of Array.isArray(l.elements) ? l.elements : []) {
        if (total >= MAX_ELEMENTS) break;
        const c = cleanElement(el);
        if (c) {
          elements.push(c);
          total += 1;
        }
      }
      if (!elements.length) continue;
      layers.push({
        id: cleanLayerId(l.id),
        name: cleanLabel(l.name) || "分享走线",
        color: cleanColor(l.color, "#38bdf8"),
        category: cleanLabel(l.category) || "shared",
        elements,
      });
    }
    if (!layers.length) throw new Error("战术码中没有可导入的走线或标记");
    return {
      v: VERSION,
      t: Number(raw.t) || 0,
      map: {
        id: cleanLayerId(map.id),
        name: cleanLabel(map.name),
        sig: (Array.isArray(map.sig) ? map.sig : [])
          .filter((s) => typeof s === "string" && /^[0-9a-f]{8,64}$/i.test(s))
          .slice(0, 8),
      },
      layers,
      elementCount: total,
    };
  }

  // ---------- public API ----------
  async function encode(payload) {
    const clean = sanitizePayload({ ...payload, v: VERSION });
    const json = JSON.stringify({
      v: VERSION,
      app: "wt-tactical-map",
      t: Date.now(),
      map: clean.map,
      layers: clean.layers,
    });
    const raw = new TextEncoder().encode(json);
    const crc = crc32Hex(raw);
    let mode = "j";
    let body = raw;
    if (canCompress) {
      try {
        const z = await pipeBytes(raw, new CompressionStream("deflate-raw"));
        if (z.length < raw.length) {
          mode = "z";
          body = z;
        }
      } catch (_) {
        /* fall back to plain JSON */
      }
    }
    return `${PREFIX}${VERSION}.${mode}.${bytesToB64url(body)}.${crc}`;
  }

  /** Pull the code out of arbitrary pasted text (chat apps add spaces/line breaks/prose). */
  function extractCode(text) {
    const s = String(text || "");
    const idx = s.toUpperCase().indexOf(PREFIX);
    if (idx < 0) return null;
    const tail = s.slice(idx + PREFIX.length).replace(/\s+/g, "");
    const m = tail.match(/^[0-9]+\.[a-z]\.[A-Za-z0-9_\-]+\.[0-9a-fA-F]{8}/);
    return m ? m[0] : null;
  }

  async function decode(text) {
    if (typeof text !== "string" || !text.trim()) throw new Error("请先粘贴战术码");
    if (text.length > MAX_CODE_CHARS) throw new Error("战术码过长，已拒绝导入");
    const code = extractCode(text);
    if (!code) throw new Error("未找到有效的 WTMAP:// 战术码（可能复制不完整）");
    const [ver, mode, body, crc] = code.split(".");
    if (Number(ver) !== VERSION) throw new Error(`不支持的战术码版本: ${ver}`);
    let bytes;
    try {
      bytes = b64urlToBytes(body);
    } catch (_) {
      throw new Error("战术码编码损坏（base64 解码失败）");
    }
    if (mode === "z") {
      if (!canCompress) throw new Error("当前浏览器不支持解压战术码，请升级浏览器");
      try {
        bytes = await pipeBytes(bytes, new DecompressionStream("deflate-raw"));
      } catch (_) {
        throw new Error("战术码数据损坏（解压失败，可能被截断）");
      }
    } else if (mode !== "j") {
      throw new Error(`未知的战术码压缩方式: ${mode}`);
    }
    if (crc32Hex(bytes).toLowerCase() !== crc.toLowerCase()) {
      throw new Error("战术码校验失败（内容被截断或修改）");
    }
    let raw;
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
      throw new Error("战术码内容不是有效 JSON");
    }
    return sanitizePayload(raw);
  }

  global.WTShareCode = { PREFIX, VERSION, encode, decode, extractCode, sanitizePayload, canCompress };
})(window);
