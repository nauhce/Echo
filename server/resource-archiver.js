const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { DOCS_DIR } = require("./config");

const MAX_ASSETS = 180;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 90 * 1024 * 1024;

const ATTRIBUTE_NAMES = ["href", "src", "poster"];
const SKIP_PROTOCOLS = new Set(["data:", "javascript:", "mailto:", "tel:", "blob:", "about:"]);
const FRAMEWORK_RESOURCE_RE = /\/_(?:nuxt|next)\//i;
const BUNDLED_RESOURCE_RE = /\/(?:assets|static|build)\/[^"')\s]+\.(?:css|js|mjs)(?:[?#][^"')\s]*)?$/i;
const HASHED_CHUNK_RE = /[-.][a-z0-9_-]{6,}\.(?:css|js|mjs)(?:[?#][^"')\s]*)?$/i;
const UTILITY_CLASS_RE = /\b(?:sm|md|lg|xl|2xl):|(?:^|\s)(?:grid|flex|gap-\[|grid-cols-|rounded-\[|text-\[|w-\[|h-\[|bg-\[|from-|to-|via-|items-center|justify-center)(?:\s|$)/;
const MAX_EXPORT_INLINE_BYTES = 120 * 1024 * 1024;

function assetDirForDoc(docId) {
  return path.join(DOCS_DIR, `${docId}_assets`);
}

function publicAssetPath(docId, relativePath) {
  return `/docs/${encodeURIComponent(docId)}/assets/${relativePath.split(path.sep).join("/")}`;
}

function contentTypeForAsset(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".css") return "text/css;charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript;charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".woff") return "font/woff";
  if (ext === ".woff2") return "font/woff2";
  if (ext === ".ttf") return "font/ttf";
  if (ext === ".otf") return "font/otf";
  return "application/octet-stream";
}

function isTextAsset(filePath) {
  return /\.(?:css|js|mjs|svg)$/i.test(filePath);
}

function safeAssetFile(docId, assetName) {
  const assetRoot = path.resolve(assetDirForDoc(docId));
  const decoded = decodeURIComponent(String(assetName || "")).replace(/\\/g, "/");
  const assetPath = path.resolve(assetRoot, decoded);
  if (!assetPath.startsWith(`${assetRoot}${path.sep}`)) return null;
  return assetPath;
}

function isSkippableUrl(value) {
  const text = String(value || "").trim();
  if (!text || text.startsWith("#")) return true;
  const protocolMatch = /^([a-z][a-z0-9+.-]*):/i.exec(text);
  return Boolean(protocolMatch && SKIP_PROTOCOLS.has(protocolMatch[1].toLowerCase()));
}

function resolveUrl(value, baseUrl) {
  if (isSkippableUrl(value)) return null;
  try {
    const resolved = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(resolved.protocol)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function extensionFromUrl(remoteUrl, contentType) {
  const pathname = (() => {
    try {
      return new URL(remoteUrl).pathname;
    } catch {
      return "";
    }
  })();
  const ext = path.extname(pathname).replace(/[^a-z0-9.]/gi, "").toLowerCase();
  if (ext && ext.length <= 12) return ext;
  const type = String(contentType || "").toLowerCase();
  if (type.includes("text/css")) return ".css";
  if (type.includes("javascript")) return ".js";
  if (type.includes("svg")) return ".svg";
  if (type.includes("png")) return ".png";
  if (type.includes("jpeg") || type.includes("jpg")) return ".jpg";
  if (type.includes("webp")) return ".webp";
  if (type.includes("woff2")) return ".woff2";
  if (type.includes("woff")) return ".woff";
  return ".bin";
}

function filenameForUrl(remoteUrl, contentType) {
  const hash = crypto.createHash("sha1").update(remoteUrl).digest("hex").slice(0, 14);
  let name = "asset";
  try {
    name = decodeURIComponent(path.basename(new URL(remoteUrl).pathname) || "asset");
  } catch {
    name = "asset";
  }
  name = name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${hash}-${(name || "asset").slice(0, 48)}${extensionFromUrl(remoteUrl, contentType)}`;
}

function fetchBuffer(remoteUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(remoteUrl);
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.get(
      parsed,
      {
        headers: {
          "User-Agent": "EchoReviewAssistant/1.0",
          Accept: "*/*",
        },
        timeout: 15000,
      },
      (remoteRes) => {
        const status = remoteRes.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && remoteRes.headers.location) {
          remoteRes.resume();
          if (redirectCount >= 5) {
            reject(new Error("Resource redirect limit exceeded"));
            return;
          }
          resolve(fetchBuffer(new URL(remoteRes.headers.location, parsed).toString(), redirectCount + 1));
          return;
        }
        if (status < 200 || status >= 300) {
          remoteRes.resume();
          reject(new Error(`Resource request failed: HTTP ${status}`));
          return;
        }

        const chunks = [];
        let size = 0;
        remoteRes.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_ASSET_BYTES) {
            req.destroy(new Error("Resource too large"));
            return;
          }
          chunks.push(chunk);
        });
        remoteRes.on("end", () => {
          resolve({
            buffer: Buffer.concat(chunks),
            contentType: String(remoteRes.headers["content-type"] || ""),
            finalUrl: parsed.toString(),
          });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Resource request timed out")));
    req.on("error", reject);
  });
}

function replaceAsync(text, pattern, replacer) {
  const matches = [];
  text.replace(pattern, (...args) => {
    matches.push(args);
    return args[0];
  });
  return matches.reduce(
    (promise, args) => promise.then((next) => replacer(...args).then((replacement) => next.replace(args[0], replacement))),
    Promise.resolve(text)
  );
}

function createExportInlineContext(docId) {
  return {
    docId,
    cache: new Map(),
    processing: new Set(),
    totalBytes: 0,
  };
}

function dataUrlForBuffer(buffer, contentType) {
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function localAssetPattern(docId) {
  const encodedDocId = encodeURIComponent(docId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:https?:\\/\\/[^"'\\s)]+)?\\/docs\\/${encodedDocId}\\/assets\\/([^"'\\s)]+)`, "gi");
}

function inlineLocalAssetRefs(text, context) {
  return String(text || "").replace(localAssetPattern(context.docId), (full, assetName) => {
    return inlineAsset(context, assetName) || full;
  });
}

function inlineAsset(context, assetName) {
  const filePath = safeAssetFile(context.docId, assetName);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  if (context.cache.has(filePath)) return context.cache.get(filePath);

  const size = fs.statSync(filePath).size;
  if (context.totalBytes + size > MAX_EXPORT_INLINE_BYTES) {
    throw new Error("Exported HTML resources are too large to inline");
  }
  if (context.processing.has(filePath)) return null;
  context.processing.add(filePath);
  try {
    let buffer = fs.readFileSync(filePath);
    if (isTextAsset(filePath)) {
      buffer = Buffer.from(inlineLocalAssetRefs(buffer.toString("utf8"), context), "utf8");
    }
    context.totalBytes += buffer.length;
    const dataUrl = dataUrlForBuffer(buffer, contentTypeForAsset(filePath));
    context.cache.set(filePath, dataUrl);
    return dataUrl;
  } finally {
    context.processing.delete(filePath);
  }
}

function inlineArchivedResourcesForExport(html, docId) {
  const context = createExportInlineContext(docId);
  const inlinedHtml = inlineLocalAssetRefs(html, context);
  return {
    html: inlinedHtml,
    assetCount: context.cache.size,
    totalBytes: context.totalBytes,
  };
}

function createArchiveContext(docId) {
  const assetDir = assetDirForDoc(docId);
  fs.rmSync(assetDir, { recursive: true, force: true });
  fs.mkdirSync(assetDir, { recursive: true });

  return {
    docId,
    assetDir,
    totalBytes: 0,
    entries: new Map(),
    failures: [],
  };
}

async function archiveResource(context, remoteUrl) {
  if (!remoteUrl) return null;
  if (context.entries.has(remoteUrl)) return context.entries.get(remoteUrl).publicPath;
  if (context.entries.size >= MAX_ASSETS || context.totalBytes >= MAX_TOTAL_BYTES) return null;

  context.entries.set(remoteUrl, { publicPath: null });
  try {
    const fetched = await fetchBuffer(remoteUrl);
    const filename = filenameForUrl(fetched.finalUrl || remoteUrl, fetched.contentType);
    const filePath = path.join(context.assetDir, filename);
    let buffer = fetched.buffer;
    if (/text\/css/i.test(fetched.contentType) || /\.css(?:[?#]|$)/i.test(remoteUrl)) {
      const rewrittenCss = await rewriteCssUrls(buffer.toString("utf8"), fetched.finalUrl || remoteUrl, context);
      buffer = Buffer.from(rewrittenCss, "utf8");
    }
    if (context.totalBytes + buffer.length > MAX_TOTAL_BYTES) {
      context.entries.set(remoteUrl, { publicPath: null });
      return null;
    }
    fs.writeFileSync(filePath, buffer);
    context.totalBytes += buffer.length;
    const publicPath = publicAssetPath(context.docId, filename);
    context.entries.set(remoteUrl, { publicPath, filePath, bytes: buffer.length });
    return publicPath;
  } catch (error) {
    context.failures.push({ url: remoteUrl, error: error.message });
    context.entries.set(remoteUrl, { publicPath: null, error: error.message });
    return null;
  }
}

async function rewriteCssUrls(css, cssUrl, context) {
  let next = await replaceAsync(css, /url\(\s*(["']?)([^"')]+)\1\s*\)/gi, async (full, quote, rawUrl) => {
    const absolute = resolveUrl(rawUrl, cssUrl);
    if (!absolute) return full;
    const local = await archiveResource(context, absolute);
    return `url(${quote || ""}${local || absolute}${quote || ""})`;
  });

  next = await replaceAsync(next, /@import\s+(?:url\(\s*)?(["'])([^"']+)\1\s*\)?/gi, async (full, quote, rawUrl) => {
    const absolute = resolveUrl(rawUrl, cssUrl);
    if (!absolute) return full;
    const local = await archiveResource(context, absolute);
    return full.replace(rawUrl, local || absolute);
  });

  return next;
}

function collectAttributeUrls(html) {
  const urls = [];
  const attrPattern = new RegExp(`\\s(${ATTRIBUTE_NAMES.join("|")})\\s*=\\s*(["'])([^"']+)\\2`, "gi");
  html.replace(attrPattern, (full, name, quote, value) => {
    urls.push(value);
    return full;
  });
  html.replace(/\s(srcset)\s*=\s*(["'])([^"']+)\2/gi, (full, name, quote, value) => {
    value.split(",").forEach((part) => {
      const candidate = part.trim().split(/\s+/)[0];
      if (candidate) urls.push(candidate);
    });
    return full;
  });
  html.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (full, quote, value) => {
    urls.push(value);
    return full;
  });
  return Array.from(new Set(urls));
}

function countMatches(text, pattern) {
  const matches = String(text || "").match(pattern);
  return matches ? matches.length : 0;
}

function shouldArchiveSnapshotResources(html, finalUrl) {
  const source = String(html || "");
  const urls = collectAttributeUrls(source).filter((value) => resolveUrl(value, finalUrl));
  const uniqueUrls = Array.from(new Set(urls));
  const stylesheetCount = countMatches(source, /<link\b[^>]*rel\s*=\s*(["'])?stylesheet\1?[^>]*>/gi);
  const scriptCount = countMatches(source, /<script\b[^>]*\bsrc\s*=/gi);
  const modulePreloadCount = countMatches(source, /<link\b[^>]*rel\s*=\s*(["'])?(?:modulepreload|preload|prefetch)\1?[^>]*>/gi);
  const protectedResourceCount = countMatches(source, /\s(?:crossorigin|integrity)(?:\s*=|\s|>)/gi);
  const cspCount = countMatches(source, /http-equiv\s*=\s*(["'])content-security-policy\1/i);
  const utilityClassCount = countMatches(source, /class\s*=\s*(["'])[^"']*(?:sm|md|lg|xl|2xl):[^"']*\1/gi)
    + countMatches(source, /class\s*=\s*(["'])[^"']*(?:rounded-\[|text-\[|w-\[|h-\[|gap-\[|bg-\[)[^"']*\1/gi);
  const frameworkResourceCount = uniqueUrls.filter((value) => FRAMEWORK_RESOURCE_RE.test(value)).length;
  const bundledResourceCount = uniqueUrls.filter((value) => BUNDLED_RESOURCE_RE.test(value) || HASHED_CHUNK_RE.test(value)).length;
  const hasUtilityLayout = UTILITY_CLASS_RE.test(source);

  const signals = [];
  if (frameworkResourceCount) signals.push(`framework-resources:${frameworkResourceCount}`);
  if (bundledResourceCount >= 2) signals.push(`bundled-resources:${bundledResourceCount}`);
  if (modulePreloadCount) signals.push(`module-preload:${modulePreloadCount}`);
  if (protectedResourceCount >= 2) signals.push(`protected-resources:${protectedResourceCount}`);
  if (cspCount) signals.push("content-security-policy");
  if (stylesheetCount >= 2 && (hasUtilityLayout || utilityClassCount >= 2)) signals.push("utility-css-layout");
  if (uniqueUrls.length >= 24 && stylesheetCount) signals.push(`many-resources:${uniqueUrls.length}`);
  if (scriptCount >= 8 && stylesheetCount) signals.push(`script-heavy:${scriptCount}`);

  return {
    needed: signals.length > 0,
    reason: signals.length ? signals.join(",") : "simple-snapshot",
    resourceCount: uniqueUrls.length,
    stylesheetCount,
    scriptCount,
    signals,
  };
}

async function rewriteHtml(html, baseUrl, context) {
  const attrPattern = new RegExp(`\\s(${ATTRIBUTE_NAMES.join("|")})\\s*=\\s*(["'])([^"']+)\\2`, "gi");
  let next = await replaceAsync(html, attrPattern, async (full, name, quote, value) => {
    const absolute = resolveUrl(value, baseUrl);
    if (!absolute) return full;
    const local = await archiveResource(context, absolute);
    return ` ${name}=${quote}${local || absolute}${quote}`;
  });

  next = await replaceAsync(next, /\s(srcset)\s*=\s*(["'])([^"']+)\2/gi, async (full, name, quote, value) => {
    const parts = await Promise.all(value.split(",").map(async (part) => {
      const trimmed = part.trim();
      const match = /^(\S+)([\s\S]*)$/.exec(trimmed);
      if (!match) return part;
      const absolute = resolveUrl(match[1], baseUrl);
      if (!absolute) return part;
      const local = await archiveResource(context, absolute);
      return `${local || absolute}${match[2] || ""}`;
    }));
    return ` ${name}=${quote}${parts.join(", ")}${quote}`;
  });

  next = await replaceAsync(next, /url\(\s*(["']?)([^"')]+)\1\s*\)/gi, async (full, quote, value) => {
    const absolute = resolveUrl(value, baseUrl);
    if (!absolute) return full;
    const local = await archiveResource(context, absolute);
    return `url(${quote || ""}${local || absolute}${quote || ""})`;
  });

  return next
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/\s(?:crossorigin|integrity)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, "")
    .replace(/<meta[^>]+http-equiv\s*=\s*(["'])content-security-policy\1[^>]*>/gi, "");
}

async function archiveSnapshotResources(html, finalUrl, docId) {
  const context = createArchiveContext(docId);
  const sourceHtml = String(html || "").replace(/<base\b[^>]*>/gi, "");
  const discovered = collectAttributeUrls(sourceHtml);
  for (const value of discovered) {
    await archiveResource(context, resolveUrl(value, finalUrl));
  }
  const archivedHtml = await rewriteHtml(sourceHtml, finalUrl, context);
  return {
    html: archivedHtml,
    assetsDir: context.assetDir,
    assetCount: Array.from(context.entries.values()).filter((entry) => entry.publicPath).length,
    failedAssetCount: context.failures.length,
    totalBytes: context.totalBytes,
  };
}

module.exports = {
  archiveSnapshotResources,
  inlineArchivedResourcesForExport,
  shouldArchiveSnapshotResources,
  assetDirForDoc,
};
