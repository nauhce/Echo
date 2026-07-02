const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { PUBLIC_DIR, PORT, HOST } = require("./server/config");
const { handleApi } = require("./server/api");
const { handleSse } = require("./server/events");
const { safeDocFile } = require("./server/docs");
const { assetDirForDoc } = require("./server/resource-archiver");
const { cookies, identityRequired, json, localOnly, routeDocId, serveFile, getLocalIps } = require("./server/http-utils");

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".woff") return "font/woff";
  if (ext === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);

    const sseMatch = /^\/events\/docs\/([^/]+)$/.exec(url.pathname);
    if (sseMatch) return handleSse(req, res, sseMatch[1]);

    const docContentMatch = /^\/docs\/([^/]+)\/content$/.exec(url.pathname);
    if (docContentMatch) {
      if (!String(cookies(req)["review-author"] || "").trim()) return identityRequired(res);
      return serveFile(res, safeDocFile(routeDocId(docContentMatch[1])), "text/html; charset=utf-8");
    }

    const docAssetMatch = /^\/docs\/([^/]+)\/assets\/(.+)$/.exec(url.pathname);
    if (docAssetMatch) {
      if (!String(cookies(req)["review-author"] || "").trim()) return identityRequired(res);
      const docId = routeDocId(docAssetMatch[1]);
      if (/[\\/]/.test(docId) || docId.includes("..")) {
        res.writeHead(404);
        return res.end("Not found");
      }
      const assetRoot = assetDirForDoc(docId);
      let assetName;
      try {
        assetName = decodeURIComponent(docAssetMatch[2]);
      } catch {
        assetName = docAssetMatch[2];
      }
      const assetPath = path.resolve(assetRoot, assetName);
      const assetRootResolved = path.resolve(assetRoot);
      if (!assetPath.startsWith(`${assetRootResolved}${path.sep}`) || !fs.existsSync(assetPath)) {
        res.writeHead(404);
        return res.end("Not found");
      }
      return serveFile(res, assetPath, contentTypeFor(assetPath));
    }

    if (/^\/review\/[^/]+$/.test(url.pathname)) {
      return serveFile(res, path.join(PUBLIC_DIR, "review.html"), "text/html; charset=utf-8");
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (!localOnly(req, res)) return;
      return serveFile(res, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
    }

    const publicPath = path.normalize(path.join(PUBLIC_DIR, url.pathname));
    if (!publicPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    serveFile(res, publicPath, contentTypeFor(publicPath));
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log("HTML 需求评审助手已启动");
  console.log(`本机地址: http://localhost:${PORT}`);
  getLocalIps().forEach((ip) => console.log(`内网地址: http://${ip}:${PORT}`));
  
  if (process.platform === 'win32') {
    exec(`start http://localhost:${PORT}`);
  } else if (process.platform === 'darwin') {
    exec(`open http://localhost:${PORT}`);
  }
});
