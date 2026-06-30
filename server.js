const http = require("http");
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

fs.mkdirSync(DOCS_DIR, { recursive: true });

function readStore() {
  if (!fs.existsSync(STORE_FILE)) {
    return { docs: [], annotations: [], replies: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
  } catch {
    return { docs: [], annotations: [], replies: [] };
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
