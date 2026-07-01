const fs = require("fs");
const os = require("os");
const { PORT } = require("./config");

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function isLocalRequest(req) {
  const address = req.socket && req.socket.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function localOnly(req, res) {
  if (isLocalRequest(req)) return true;
  json(res, 403, { error: "初始页和管理操作仅允许本机访问" });
  return false;
}

function cookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((map, item) => {
      const index = item.indexOf("=");
      if (index === -1) return map;
      const key = item.slice(0, index);
      const value = item.slice(index + 1);
      try {
        map[key] = decodeURIComponent(value);
      } catch {
        map[key] = value;
      }
      return map;
    }, {});
}

function identityRequired(res) {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>需要身份信息</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: "Microsoft YaHei", Arial, sans-serif; color: #17191f; background: #f4f5f7; }
    main { max-width: 420px; padding: 24px; border: 1px solid #e4e7ec; border-radius: 8px; background: #fff; box-shadow: 0 18px 50px rgba(16, 24, 40, 0.12); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0; color: #667085; line-height: 1.7; }
  </style>
</head>
<body>
  <main>
    <h1>需要先输入身份信息</h1>
    <p>请从评审链接进入页面并填写姓名后再访问文档内容。</p>
  </main>
</body>
</html>`;
  res.writeHead(401, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
    "Cache-Control": "no-store",
  });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
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

module.exports = {
  json,
  isLocalRequest,
  localOnly,
  cookies,
  identityRequired,
  readBody,
  routeDocId,
  getLocalIps,
  serveFile,
};
