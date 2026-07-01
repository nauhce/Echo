const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { DOCS_DIR, MAX_REMOTE_HTML_BYTES } = require("./config");
const { readStore, writeStore, splitNames } = require("./store");

function slugify(name) {
  const base = String(name || "document")
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `doc-${Date.now()}`;
}

function uniqueDocId(base, store) {
  let id = slugify(base);
  let i = 2;
  while (store.docs.some((doc) => doc.id === id)) {
    id = `${slugify(base)}-${i}`;
    i += 1;
  }
  return id;
}

function titleFromFilename(filename) {
  return String(filename || "Untitled review").replace(/\.html?$/i, "") || "Untitled review";
}

function titleFromUrl(value) {
  try {
    const remoteUrl = new URL(value);
    const name = path.basename(remoteUrl.pathname) || remoteUrl.hostname;
    return titleFromFilename(decodeURIComponent(name));
  } catch {
    return "URL snapshot";
  }
}

function titleFromHtml(html, fallback) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return fallback;
  const title = match[1].replace(/\s+/g, " ").trim();
  return title || fallback;
}

function safeDocFile(docId) {
  return path.join(DOCS_DIR, `${docId}.html`);
}

function injectBaseHref(html, href) {
  const base = `<base href="${String(href).replace(/"/g, "&quot;")}">`;
  if (/<base\s/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n  ${base}`);
  }
  return `${base}\n${html}`;
}

function listAnnotations(store, docId) {
  return store.annotations
    .filter((item) => item.docId === docId)
    .map((item) => ({
      ...item,
      replies: store.replies.filter((reply) => reply.annotationId === item.id),
    }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function listRequirements(store, docId) {
  return store.requirements
    .filter((item) => item.docId === docId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function findDoc(store, docId) {
  return store.docs.find((item) => item.id === docId);
}

function canEditRequirements(store, docId, author) {
  const doc = findDoc(store, docId);
  const collaborators = doc && Array.isArray(doc.collaborators) ? doc.collaborators : [];
  if (!collaborators.length) return true;
  return collaborators.includes(String(author || "").trim());
}

function requireRequirementEditor(store, docId, author) {
  if (!canEditRequirements(store, docId, author)) {
    throw new Error("当前姓名没有编辑需求文档的权限");
  }
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!match) return null;
  const boundary = `--${match[1] || match[2]}`;
  const body = buffer.toString("binary");
  const parts = body.split(boundary).slice(1, -1);
  const fields = {};
  const files = {};
  for (const part of parts) {
    const clean = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const splitAt = clean.indexOf("\r\n\r\n");
    if (splitAt < 0) continue;
    const rawHeaders = clean.slice(0, splitAt);
    const rawContent = clean.slice(splitAt + 4);
    const nameMatch = /name="([^"]+)"/.exec(rawHeaders);
    if (!nameMatch) continue;
    const filenameMatch = /filename="([^"]*)"/.exec(rawHeaders);
    const filenameStarMatch = /filename\*=UTF-8''([^;\r\n]*)/i.exec(rawHeaders);
    const name = nameMatch[1];
    const content = Buffer.from(rawContent, "binary");
    if (filenameMatch) {
      const rawFilename = filenameStarMatch
        ? decodeURIComponent(filenameStarMatch[1])
        : Buffer.from(filenameMatch[1], "binary").toString("utf8");
      files[name] = { filename: path.basename(rawFilename.replace(/\\/g, "/")), content };
    } else {
      fields[name] = content.toString("utf8");
    }
  }
  return { fields, files };
}

function fetchRemoteHtml(target, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let remoteUrl;
    try {
      remoteUrl = new URL(target);
    } catch {
      reject(new Error("请输入有效的链接"));
      return;
    }
    if (!["http:", "https:"].includes(remoteUrl.protocol)) {
      reject(new Error("只支持 http 或 https 链接"));
      return;
    }

    const client = remoteUrl.protocol === "https:" ? https : http;
    const req = client.get(
      remoteUrl,
      {
        headers: {
          "User-Agent": "EchoReviewAssistant/1.0",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: 15000,
      },
      (remoteRes) => {
        const status = remoteRes.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && remoteRes.headers.location) {
          remoteRes.resume();
          if (redirectCount >= 5) {
            reject(new Error("链接重定向次数过多"));
            return;
          }
          resolve(fetchRemoteHtml(new URL(remoteRes.headers.location, remoteUrl).toString(), redirectCount + 1));
          return;
        }
        if (status < 200 || status >= 300) {
          remoteRes.resume();
          reject(new Error(`链接访问失败：HTTP ${status}`));
          return;
        }

        const contentType = String(remoteRes.headers["content-type"] || "");
        if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          remoteRes.resume();
          reject(new Error("链接返回的不是 HTML 页面"));
          return;
        }

        const chunks = [];
        let size = 0;
        remoteRes.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_REMOTE_HTML_BYTES) {
            req.destroy(new Error("页面太大，无法保存快照"));
            return;
          }
          chunks.push(chunk);
        });
        remoteRes.on("end", () => {
          const html = Buffer.concat(chunks).toString("utf8");
          resolve({ html: injectBaseHref(html, remoteUrl.toString()), finalUrl: remoteUrl.toString() });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("链接访问超时")));
    req.on("error", reject);
  });
}

function importHtmlFile(sourcePath, title) {
  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved)) throw new Error("HTML 文件不存在");
  const html = fs.readFileSync(resolved);
  const store = readStore();
  const docId = uniqueDocId(title || path.basename(resolved), store);
  fs.writeFileSync(safeDocFile(docId), html);
  const doc = {
    id: docId,
    title: title || path.basename(resolved),
    filename: path.basename(resolved),
    sourcePath: resolved,
    folderId: "",
    collaborators: [],
    createdAt: new Date().toISOString(),
  };
  store.docs.unshift(doc);
  writeStore(store);
  return doc;
}

module.exports = {
  slugify,
  uniqueDocId,
  titleFromFilename,
  titleFromUrl,
  titleFromHtml,
  safeDocFile,
  injectBaseHref,
  listAnnotations,
  listRequirements,
  findDoc,
  canEditRequirements,
  requireRequirementEditor,
  parseMultipart,
  fetchRemoteHtml,
  importHtmlFile,
};
