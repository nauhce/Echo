const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DOCS_DIR = path.join(DATA_DIR, "docs");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const PORT = Number(process.env.PORT || 5177);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_REMOTE_HTML_BYTES = 10 * 1024 * 1024;

fs.mkdirSync(DOCS_DIR, { recursive: true });

function defaultStore() {
  return {
    docs: [],
    annotations: [],
    replies: [],
    requirements: [],
    settings: {
      allowedEditors: ["张三", "李四", "产品经理"],
      ai: {
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
      },
    },
  };
}

function normalizeStore(store) {
  const next = { ...defaultStore(), ...(store || {}) };
  next.docs = Array.isArray(next.docs) ? next.docs : [];
  next.annotations = Array.isArray(next.annotations) ? next.annotations : [];
  next.replies = Array.isArray(next.replies) ? next.replies : [];
  next.requirements = Array.isArray(next.requirements) ? next.requirements : [];
  next.settings = { ...defaultStore().settings, ...(next.settings || {}) };
  next.settings.allowedEditors = Array.isArray(next.settings.allowedEditors) ? next.settings.allowedEditors : [];
  next.settings.ai = { ...defaultStore().settings.ai, ...(next.settings.ai || {}) };
  return next;
}

function readStore() {
  if (!fs.existsSync(STORE_FILE)) {
    return defaultStore();
  }
  try {
    return normalizeStore(JSON.parse(fs.readFileSync(STORE_FILE, "utf8")));
  } catch {
    return defaultStore();
  }
}

function writeStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

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

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
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

function routeDocId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getLocalIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  Object.values(nets).forEach((items) => {
    (items || []).forEach((item) => {
      if (item.family === "IPv4" && !item.internal) ips.push(item.address);
    });
  });
  return ips;
}

const clients = new Map();

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(docId, event, payload) {
  const set = clients.get(docId);
  if (!set) return;
  for (const res of set) sendSse(res, event, payload);
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

function publicSettings(settings) {
  const ai = settings.ai || {};
  return {
    allowedEditors: settings.allowedEditors || [],
    ai: {
      baseUrl: ai.baseUrl || defaultStore().settings.ai.baseUrl,
      model: ai.model || defaultStore().settings.ai.model,
      hasApiKey: Boolean(ai.apiKey),
    },
  };
}

function splitNames(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function canEditRequirements(store, author) {
  const allowed = store.settings.allowedEditors || [];
  if (!allowed.length) return true;
  return allowed.includes(String(author || "").trim());
}

function requireRequirementEditor(store, author) {
  if (!canEditRequirements(store, author)) {
    throw new Error("当前姓名没有编辑需求文档的权限");
  }
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function requestJson(targetUrl, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    let remoteUrl;
    try {
      remoteUrl = new URL(targetUrl);
    } catch {
      reject(new Error("AI 服务地址无效"));
      return;
    }
    const body = JSON.stringify(payload);
    const client = remoteUrl.protocol === "https:" ? https : http;
    const req = client.request(
      remoteUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
        timeout: 30000,
      },
      (remoteRes) => {
        const chunks = [];
        remoteRes.on("data", (chunk) => chunks.push(chunk));
        remoteRes.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((remoteRes.statusCode || 0) < 200 || (remoteRes.statusCode || 0) >= 300) {
            reject(new Error(`AI 服务请求失败：HTTP ${remoteRes.statusCode} ${text.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error("AI 服务返回内容不是有效 JSON"));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("AI 服务请求超时")));
    req.on("error", reject);
    req.end(body);
  });
}

async function generateRequirement(settings, body) {
  const ai = settings.ai || {};
  if (!ai.apiKey) throw new Error("请先在首页配置 AI API Key");
  const baseUrl = String(ai.baseUrl || defaultStore().settings.ai.baseUrl).replace(/\/+$/, "");
  const model = String(ai.model || defaultStore().settings.ai.model).trim();
  const payload = {
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "你是一名资深产品经理。请根据用户选择的页面区域代码、可见文本和上下文，按照行业惯例输出清晰、可执行的中文需求描述。聚焦功能目标、用户交互、状态规则、异常边界和验收要点。不要编造页面中不存在的业务事实。",
      },
      {
        role: "user",
        content: [
          `页面标题：${truncateText(body.pageTitle, 200)}`,
          `选中元素：${truncateText(body.elementLabel, 200)}`,
          `可见文本：${truncateText(body.elementText, 1200)}`,
          `HTML：${truncateText(body.elementHtml, 5000)}`,
          "请输出 4-8 条精炼需求描述，适合直接放入需求文档。",
        ].join("\n\n"),
      },
    ],
  };
  const data = await requestJson(`${baseUrl}/chat/completions`, payload, {
    Authorization: `Bearer ${ai.apiKey}`,
  });
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error("AI 服务没有返回需求描述");
  return String(content).trim();
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
    createdAt: new Date().toISOString(),
  };
  store.docs.unshift(doc);
  writeStore(store);
  return doc;
}

function serveFile(res, filePath, type) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, url) {
  const store = readStore();

  if (req.method === "GET" && url.pathname === "/api/config") {
    const host = req.headers.host || `localhost:${PORT}`;
    return json(res, 200, {
      port: PORT,
      host,
      localIps: getLocalIps(),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/docs") {
    return json(res, 200, { docs: store.docs });
  }

  if (req.method === "GET" && url.pathname === "/api/settings") {
    return json(res, 200, { settings: publicSettings(store.settings) });
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      store.settings.allowedEditors = splitNames(body.allowedEditors);
      store.settings.ai = {
        ...store.settings.ai,
        baseUrl: String((body.ai && body.ai.baseUrl) || store.settings.ai.baseUrl || defaultStore().settings.ai.baseUrl).trim(),
        model: String((body.ai && body.ai.model) || store.settings.ai.model || defaultStore().settings.ai.model).trim(),
      };
      if (body.ai && Object.prototype.hasOwnProperty.call(body.ai, "apiKey")) {
        const apiKey = String(body.ai.apiKey || "").trim();
        if (apiKey) store.settings.ai.apiKey = apiKey;
      }
      writeStore(store);
      return json(res, 200, { settings: publicSettings(store.settings) });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/docs/import-path") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const doc = importHtmlFile(body.path, body.title);
      return json(res, 201, { doc });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/docs/upload") {
    try {
      const parsed = parseMultipart(await readBody(req), req.headers["content-type"]);
      const file = parsed && parsed.files.file;
      if (!file || !file.content.length) throw new Error("请选择 HTML 文件");
      const title = String(parsed.fields.title || titleFromFilename(file.filename)).trim();
      const docId = uniqueDocId(title, store);
      fs.writeFileSync(safeDocFile(docId), file.content);
      const doc = {
        id: docId,
        title,
        filename: file.filename,
        sourcePath: "",
        createdAt: new Date().toISOString(),
      };
      store.docs.unshift(doc);
      writeStore(store);
      return json(res, 201, { doc });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/docs/import-url") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const sourceUrl = String(body.url || "").trim();
      if (!sourceUrl) throw new Error("请输入页面链接");
      const snapshot = await fetchRemoteHtml(sourceUrl);
      const fallbackTitle = titleFromUrl(snapshot.finalUrl);
      const title = String(body.title || titleFromHtml(snapshot.html, fallbackTitle)).trim();
      const docId = uniqueDocId(title, store);
      fs.writeFileSync(safeDocFile(docId), snapshot.html, "utf8");
      const doc = {
        id: docId,
        title,
        filename: `${docId}.html`,
        sourcePath: "",
        sourceUrl: snapshot.finalUrl,
        createdAt: new Date().toISOString(),
      };
      store.docs.unshift(doc);
      writeStore(store);
      return json(res, 201, { doc });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const annotationsMatch = /^\/api\/docs\/([^/]+)\/annotations$/.exec(url.pathname);
  if (annotationsMatch && req.method === "GET") {
    return json(res, 200, { annotations: listAnnotations(store, routeDocId(annotationsMatch[1])) });
  }
  if (annotationsMatch && req.method === "POST") {
    const docId = routeDocId(annotationsMatch[1]);
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const item = {
      id: crypto.randomUUID(),
      docId,
      selector: String(body.selector || ""),
      elementLabel: String(body.elementLabel || ""),
      note: String(body.note || "").trim(),
      author: String(body.author || "匿名"),
      status: "open",
      viewport: body.viewport || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!item.note) return json(res, 400, { error: "批注内容不能为空" });
    store.annotations.push(item);
    writeStore(store);
    const payload = listAnnotations(store, docId);
    broadcast(docId, "annotations", payload);
    return json(res, 201, { annotation: item });
  }

  const replyMatch = /^\/api\/annotations\/([^/]+)\/replies$/.exec(url.pathname);
  if (replyMatch && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const annotation = store.annotations.find((item) => item.id === replyMatch[1]);
    if (!annotation) return json(res, 404, { error: "批注不存在" });
    const reply = {
      id: crypto.randomUUID(),
      annotationId: annotation.id,
      author: String(body.author || "匿名"),
      note: String(body.note || "").trim(),
      createdAt: new Date().toISOString(),
    };
    if (!reply.note) return json(res, 400, { error: "回复内容不能为空" });
    store.replies.push(reply);
    annotation.updatedAt = new Date().toISOString();
    writeStore(store);
    const payload = listAnnotations(store, annotation.docId);
    broadcast(annotation.docId, "annotations", payload);
    return json(res, 201, { reply });
  }

  const statusMatch = /^\/api\/annotations\/([^/]+)\/status$/.exec(url.pathname);
  if (statusMatch && req.method === "POST") {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const annotation = store.annotations.find((item) => item.id === statusMatch[1]);
    if (!annotation) return json(res, 404, { error: "批注不存在" });
    annotation.status = body.status === "resolved" ? "resolved" : "open";
    annotation.updatedAt = new Date().toISOString();
    writeStore(store);
    const payload = listAnnotations(store, annotation.docId);
    broadcast(annotation.docId, "annotations", payload);
    return json(res, 200, { annotation });
  }

  const annotationMatch = /^\/api\/annotations\/([^/]+)$/.exec(url.pathname);
  if (annotationMatch && req.method === "DELETE") {
    const annotation = store.annotations.find((item) => item.id === annotationMatch[1]);
    if (!annotation) return json(res, 404, { error: "批注不存在" });
    store.annotations = store.annotations.filter((item) => item.id !== annotation.id);
    store.replies = store.replies.filter((reply) => reply.annotationId !== annotation.id);
    writeStore(store);
    const payload = listAnnotations(store, annotation.docId);
    broadcast(annotation.docId, "annotations", payload);
    return json(res, 200, { ok: true });
  }

  const requirementsMatch = /^\/api\/docs\/([^/]+)\/requirements$/.exec(url.pathname);
  if (requirementsMatch && req.method === "GET") {
    return json(res, 200, {
      requirements: listRequirements(store, routeDocId(requirementsMatch[1])),
      canEdit: canEditRequirements(store, url.searchParams.get("author")),
    });
  }
  if (requirementsMatch && req.method === "POST") {
    try {
      const docId = routeDocId(requirementsMatch[1]);
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      requireRequirementEditor(store, body.author);
      const item = {
        id: crypto.randomUUID(),
        docId,
        selector: String(body.selector || ""),
        elementLabel: String(body.elementLabel || ""),
        requirement: String(body.requirement || "").trim(),
        author: String(body.author || "匿名"),
        viewport: body.viewport || null,
        elementHtml: String(body.elementHtml || "").slice(0, 20000),
        elementText: String(body.elementText || "").slice(0, 8000),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (!item.requirement) return json(res, 400, { error: "需求描述不能为空" });
      store.requirements.push(item);
      writeStore(store);
      const payload = listRequirements(store, docId);
      broadcast(docId, "requirements", payload);
      return json(res, 201, { requirement: item });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const requirementMatch = /^\/api\/requirements\/([^/]+)$/.exec(url.pathname);
  if (requirementMatch && req.method === "POST") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      requireRequirementEditor(store, body.author);
      const item = store.requirements.find((row) => row.id === requirementMatch[1]);
      if (!item) return json(res, 404, { error: "需求记录不存在" });
      item.requirement = String(body.requirement || "").trim();
      item.author = String(body.author || item.author || "匿名");
      item.updatedAt = new Date().toISOString();
      if (!item.requirement) return json(res, 400, { error: "需求描述不能为空" });
      writeStore(store);
      const payload = listRequirements(store, item.docId);
      broadcast(item.docId, "requirements", payload);
      return json(res, 200, { requirement: item });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }
  if (requirementMatch && req.method === "DELETE") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      requireRequirementEditor(store, body.author);
      const item = store.requirements.find((row) => row.id === requirementMatch[1]);
      if (!item) return json(res, 404, { error: "需求记录不存在" });
      store.requirements = store.requirements.filter((row) => row.id !== item.id);
      writeStore(store);
      const payload = listRequirements(store, item.docId);
      broadcast(item.docId, "requirements", payload);
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/requirements/generate") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      requireRequirementEditor(store, body.author);
      const requirement = await generateRequirement(store.settings, body);
      return json(res, 200, { requirement });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const exportMatch = /^\/api\/docs\/([^/]+)\/export$/.exec(url.pathname);
  if (exportMatch && req.method === "GET") {
    const docId = routeDocId(exportMatch[1]);
    const doc = store.docs.find((item) => item.id === docId);
    const rows = listAnnotations(store, docId);
    const csv = [
      ["状态", "元素", "批注", "评论人", "回复数", "创建时间"].join(","),
      ...rows.map((item) =>
        [
          item.status === "resolved" ? "已解决" : "未解决",
          item.elementLabel,
          item.note,
          item.author,
          item.replies.length,
          item.createdAt,
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",")
      ),
    ].join("\n");
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${(doc && doc.id) || "annotations"}.csv"`,
    });
    res.end(`\uFEFF${csv}`);
    return;
  }

  json(res, 404, { error: "API not found" });
}

function handleSse(req, res, docId) {
  docId = routeDocId(docId);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  if (!clients.has(docId)) clients.set(docId, new Set());
  clients.get(docId).add(res);
  sendSse(res, "hello", { ok: true });
  req.on("close", () => clients.get(docId)?.delete(res));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);

    const sseMatch = /^\/events\/docs\/([^/]+)$/.exec(url.pathname);
    if (sseMatch) return handleSse(req, res, sseMatch[1]);

    const docContentMatch = /^\/docs\/([^/]+)\/content$/.exec(url.pathname);
    if (docContentMatch) {
      return serveFile(res, safeDocFile(routeDocId(docContentMatch[1])), "text/html; charset=utf-8");
    }

    if (/^\/review\/[^/]+$/.test(url.pathname)) {
      return serveFile(res, path.join(PUBLIC_DIR, "review.html"), "text/html; charset=utf-8");
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serveFile(res, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
    }

    const publicPath = path.normalize(path.join(PUBLIC_DIR, url.pathname));
    if (!publicPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    const ext = path.extname(publicPath).toLowerCase();
    const type = ext === ".css" ? "text/css; charset=utf-8" : ext === ".js" ? "text/javascript; charset=utf-8" : "application/octet-stream";
    serveFile(res, publicPath, type);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`HTML 需求评审助手已启动`);
  console.log(`本机地址: http://localhost:${PORT}`);
  getLocalIps().forEach((ip) => console.log(`内网地址: http://${ip}:${PORT}`));
});
