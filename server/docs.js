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

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function safeJsonScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function exportFilename(doc) {
  const base = String((doc && (doc.title || doc.filename || doc.id)) || "review-snapshot")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${base || "review-snapshot"}-annotated.html`;
}

function buildAnnotatedExportHtml(html, doc, annotations, requirements) {
  const rows = [
    ...annotations.map((item) => ({
      kind: "comment",
      id: item.id,
      selector: item.selector,
      elementLabel: item.elementLabel,
      note: item.note,
      author: item.author,
      status: item.status,
      viewport: item.viewport,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      replies: item.replies || [],
    })),
    ...requirements.map((item) => ({
      kind: "requirement",
      id: item.id,
      selector: item.selector,
      elementLabel: item.elementLabel,
      note: item.requirement,
      author: item.author,
      status: "",
      viewport: item.viewport,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      replies: [],
    })),
  ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const payload = {
    title: (doc && doc.title) || "Review snapshot",
    exportedAt: new Date().toISOString(),
    rows,
  };

  const style = `<style id="echo-export-style">
html.echo-export-ready body { padding-right: 380px !important; }
.echo-export-pin-layer { position: absolute; left: 0; top: 0; z-index: 2147483000; pointer-events: none; }
.echo-export-pin { position: absolute; width: 28px; height: 28px; border-radius: 999px; border: 2px solid #fff; box-shadow: 0 10px 30px rgba(15, 23, 42, .22); display: grid; place-items: center; transform: translate(-50%, -50%); background: #f59e0b; color: #111827; font: 800 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; pointer-events: auto; cursor: pointer; }
.echo-export-pin.is-resolved { background: #12b76a; color: #fff; }
.echo-export-pin.is-requirement { background: #2563eb; color: #fff; }
.echo-export-pin.is-active { box-shadow: 0 0 0 7px rgba(37, 99, 235, .18), 0 10px 30px rgba(15, 23, 42, .22); }
.echo-export-focus { position: absolute; border: 3px solid #2563eb; border-radius: 8px; background: rgba(37, 99, 235, .1); box-shadow: 0 0 0 8px rgba(37, 99, 235, .12); z-index: 2147482999; pointer-events: none; animation: echoExportPulse 1.1s ease-in-out 2; }
@keyframes echoExportPulse { 0%,100% { opacity: .35; transform: scale(.98); } 45% { opacity: 1; transform: scale(1.02); } }
.echo-export-panel { position: fixed; right: 0; top: 0; bottom: 0; z-index: 2147483001; width: 380px; max-width: calc(100vw - 28px); display: grid; grid-template-rows: auto auto minmax(0, 1fr); background: #fff; color: #17191f; border-left: 1px solid #e4e7ec; box-shadow: -18px 0 50px rgba(16, 24, 40, .16); font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", Arial, sans-serif; }
.echo-export-head { padding: 16px; border-bottom: 1px solid #e4e7ec; display: grid; gap: 8px; }
.echo-export-head h1 { margin: 0; font-size: 17px; line-height: 1.35; }
.echo-export-meta { color: #667085; font-size: 12px; line-height: 1.5; }
.echo-export-filters { padding: 10px 12px; border-bottom: 1px solid #e4e7ec; display: flex; gap: 8px; flex-wrap: wrap; }
.echo-export-toggle { min-height: 30px; display: inline-flex; align-items: center; gap: 6px; border: 1px solid #e4e7ec; border-radius: 999px; padding: 5px 9px; font-size: 12px; font-weight: 650; background: #f8fafc; color: #344054; cursor: pointer; user-select: none; }
.echo-export-toggle input { width: 14px; height: 14px; margin: 0; accent-color: #f59e0b; cursor: pointer; }
.echo-export-toggle.is-requirement input { accent-color: #2563eb; }
.echo-export-toggle:has(input:checked) { background: #fffbeb; border-color: #fde68a; color: #17191f; }
.echo-export-toggle.is-requirement:has(input:checked) { background: #eff6ff; border-color: #bfdbfe; }
.echo-export-toggle:has(input:not(:checked)) { opacity: .62; }
.echo-export-list { overflow: auto; padding: 12px; display: grid; gap: 10px; align-content: start; }
.echo-export-card { border: 1px solid #e4e7ec; border-radius: 8px; background: #fff; padding: 12px; display: grid; gap: 9px; cursor: pointer; }
.echo-export-card.is-active { border-color: #93c5fd; box-shadow: 0 0 0 3px #eff6ff; }
.echo-export-card-top { display: flex; align-items: flex-start; gap: 8px; }
.echo-export-index { width: 24px; height: 24px; border-radius: 999px; background: #fef3c7; display: grid; place-items: center; font-size: 12px; font-weight: 800; flex: 0 0 auto; }
.echo-export-card.is-resolved .echo-export-index { background: #dcfce7; color: #166534; }
.echo-export-card.is-requirement .echo-export-index { background: #dbeafe; color: #1d4ed8; }
.echo-export-element { color: #667085; font-size: 12px; line-height: 1.45; word-break: break-word; }
.echo-export-note { color: #17191f; font-size: 14px; line-height: 1.55; word-break: break-word; }
.echo-export-note h3, .echo-export-note h4, .echo-export-note h5 { margin: 2px 0 0; font-size: 14px; line-height: 1.45; }
.echo-export-note p { margin: 0; }
.echo-export-note ul, .echo-export-note ol { margin: 0; padding-left: 20px; display: grid; gap: 5px; }
.echo-export-note li { padding-left: 2px; }
.echo-export-note code { padding: 2px 5px; border-radius: 5px; background: #f1f5f9; color: #0f172a; font-family: Consolas, "SFMono-Regular", monospace; font-size: 12px; }
.echo-export-note a { color: #2563eb; text-decoration: none; border-bottom: 1px solid rgba(37, 99, 235, .28); }
.echo-export-note a:hover { border-bottom-color: #2563eb; }
.echo-export-replies { border-top: 1px solid #e4e7ec; padding-top: 8px; display: grid; gap: 8px; }
.echo-export-reply { border-left: 3px solid #dbeafe; padding-left: 8px; display: grid; gap: 3px; }
@media (max-width: 760px) {
  html.echo-export-ready body { padding-right: 0 !important; padding-bottom: 45vh !important; }
  .echo-export-panel { top: auto; width: 100%; max-width: 100vw; height: 45vh; border-left: 0; border-top: 1px solid #e4e7ec; }
}
</style>`;

  const script = `<script id="echo-export-script">
(function () {
  var data = ${safeJsonScript(payload)};
  document.documentElement.classList.add("echo-export-ready");
  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (ch) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[ch];
    });
  }
  function renderMarkdownInline(value) {
    return escapeHtml(value)
      .replace(/\`([^\`]+)\`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/_([^_]+)_/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  }
  function renderMarkdown(value) {
    var lines = String(value || "").replace(/\r\n?/g, "\\n").split("\\n");
    var html = [];
    var listType = "";
    function closeList() {
      if (!listType) return;
      html.push("</" + listType + ">");
      listType = "";
    }
    lines.forEach(function (line) {
      var text = line.trim();
      var heading;
      var unordered;
      var ordered;
      if (!text) {
        closeList();
        return;
      }
      heading = /^(#{1,3})\s+(.+)$/.exec(text);
      if (heading) {
        closeList();
        html.push("<h" + (heading[1].length + 2) + ">" + renderMarkdownInline(heading[2]) + "</h" + (heading[1].length + 2) + ">");
        return;
      }
      unordered = /^[-*]\s+(.+)$/.exec(text);
      if (unordered) {
        if (listType !== "ul") {
          closeList();
          html.push("<ul>");
          listType = "ul";
        }
        html.push("<li>" + renderMarkdownInline(unordered[1]) + "</li>");
        return;
      }
      ordered = /^\d+[.)]\s+(.+)$/.exec(text);
      if (ordered) {
        if (listType !== "ol") {
          closeList();
          html.push("<ol>");
          listType = "ol";
        }
        html.push("<li>" + renderMarkdownInline(ordered[1]) + "</li>");
        return;
      }
      closeList();
      html.push("<p>" + renderMarkdownInline(text) + "</p>");
    });
    closeList();
    return html.join("");
  }
  function formatDate(value) {
    if (!value) return "";
    try { return new Date(value).toLocaleString(); } catch (error) { return value; }
  }
  function point(item) {
    var viewport = item.viewport || {};
    if (Number.isFinite(viewport.docX) && Number.isFinite(viewport.docY)) return { x: viewport.docX, y: viewport.docY };
    return null;
  }
  function findElement(item) {
    var selector = String((item && item.selector) || "").trim();
    if (!selector || selector === "body" || selector === "body >") return null;
    try {
      return document.querySelector(selector);
    } catch (error) {
      return null;
    }
  }
  function targetRect(item) {
    var el = findElement(item);
    var rect;
    var pos;
    if (el) {
      rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return {
          left: rect.left + window.scrollX,
          top: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height,
        };
      }
    }
    pos = point(item);
    if (!pos) return null;
    return {
      left: pos.x - ((item.viewport && item.viewport.width) || 72) / 2,
      top: pos.y - ((item.viewport && item.viewport.height) || 72) / 2,
      width: (item.viewport && item.viewport.width) || 72,
      height: (item.viewport && item.viewport.height) || 72,
    };
  }
  function pinPoint(item) {
    var rect = targetRect(item);
    var pos = point(item);
    if (rect) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return pos;
  }
  var layer = document.createElement("div");
  layer.className = "echo-export-pin-layer";
  document.body.appendChild(layer);
  var panel = document.createElement("aside");
  panel.className = "echo-export-panel";
  panel.innerHTML = '<div class="echo-export-head"><h1>' + escapeHtml(data.title) + '</h1><div class="echo-export-meta">Exported ' + escapeHtml(formatDate(data.exportedAt)) + '</div></div>' +
    '<div class="echo-export-filters"><label class="echo-export-toggle"><input id="echoExportShowComments" type="checkbox" checked>Comments ' + data.rows.filter(function (row) { return row.kind === "comment"; }).length + '</label><label class="echo-export-toggle is-requirement"><input id="echoExportShowRequirements" type="checkbox" checked>Requirements ' + data.rows.filter(function (row) { return row.kind === "requirement"; }).length + '</label></div>' +
    '<div class="echo-export-list"></div>';
  document.body.appendChild(panel);
  var list = panel.querySelector(".echo-export-list");
  var showCommentsInput = panel.querySelector("#echoExportShowComments");
  var showRequirementsInput = panel.querySelector("#echoExportShowRequirements");
  var activeIndex = -1;
  function visibleRows() {
    return data.rows.map(function (item, index) {
      return { item: item, index: index };
    }).filter(function (entry) {
      return (entry.item.kind === "comment" && showCommentsInput.checked) || (entry.item.kind === "requirement" && showRequirementsInput.checked);
    });
  }
  function renderList() {
    var rows = visibleRows();
    if (!data.rows.length) {
      list.innerHTML = '<div class="echo-export-meta">No comments or requirements were exported.</div>';
      return;
    }
    if (!rows.length) {
      list.innerHTML = '<div class="echo-export-meta">Comments and requirements are hidden.</div>';
      return;
    }
    list.innerHTML = rows.map(function (entry, visibleIndex) {
      var item = entry.item;
      var index = entry.index;
      var replies = (item.replies || []).map(function (reply) {
        return '<div class="echo-export-reply"><div class="echo-export-note">' + renderMarkdown(reply.note) + '</div><div class="echo-export-meta">' + escapeHtml(reply.author) + ' · ' + escapeHtml(formatDate(reply.createdAt)) + '</div></div>';
      }).join("");
      var kindLabel = item.kind === "requirement" ? "Requirement" : (item.status === "resolved" ? "Resolved comment" : "Comment");
      return '<article class="echo-export-card ' + (item.kind === "requirement" ? "is-requirement " : "") + (item.status === "resolved" ? "is-resolved " : "") + (index === activeIndex ? "is-active" : "") + '" data-echo-index="' + index + '">' +
        '<div class="echo-export-card-top"><div class="echo-export-index">' + (visibleIndex + 1) + '</div><div><div class="echo-export-element">' + escapeHtml(kindLabel + " · " + (item.elementLabel || item.selector || "Page")) + '</div><div class="echo-export-meta">' + escapeHtml(item.author) + ' · ' + escapeHtml(formatDate(item.updatedAt || item.createdAt)) + '</div></div></div>' +
        '<div class="echo-export-note">' + renderMarkdown(item.note) + '</div>' +
        (replies ? '<div class="echo-export-replies">' + replies + '</div>' : '') +
        '</article>';
    }).join("");
  }
  function clearFocus() {
    document.querySelectorAll(".echo-export-focus").forEach(function (node) { node.remove(); });
    document.querySelectorAll(".echo-export-pin").forEach(function (node) { node.classList.remove("is-active"); });
  }
  function focusItem(index) {
    activeIndex = index;
    renderList();
    clearFocus();
    var item = data.rows[index];
    var rect = targetRect(item);
    if (!rect) return;
    window.scrollTo({ left: Math.max(0, rect.left + rect.width / 2 - window.innerWidth / 2), top: Math.max(0, rect.top + rect.height / 2 - window.innerHeight / 2), behavior: "smooth" });
    var focus = document.createElement("div");
    focus.className = "echo-export-focus";
    focus.style.left = Math.max(4, rect.left) + "px";
    focus.style.top = Math.max(4, rect.top) + "px";
    focus.style.width = Math.max(28, rect.width) + "px";
    focus.style.height = Math.max(28, rect.height) + "px";
    document.body.appendChild(focus);
    var pin = layer.querySelector('[data-echo-pin="' + index + '"]');
    if (pin) pin.classList.add("is-active");
    setTimeout(function () { focus.remove(); }, 2400);
    setTimeout(function () {
      var card = list.querySelector('[data-echo-index="' + index + '"]');
      if (card) card.scrollIntoView({ block: "nearest" });
    }, 120);
  }
  data.rows.forEach(function (item, index) {
    var pos = pinPoint(item);
    if (!pos) return;
    var pin = document.createElement("button");
    pin.type = "button";
    pin.className = "echo-export-pin" + (item.kind === "requirement" ? " is-requirement" : "") + (item.status === "resolved" ? " is-resolved" : "");
    pin.textContent = index + 1;
    pin.style.left = pos.x + "px";
    pin.style.top = pos.y + "px";
    pin.setAttribute("data-echo-pin", index);
    pin.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      focusItem(index);
    });
    layer.appendChild(pin);
  });
  list.addEventListener("click", function (event) {
    var card = event.target.closest("[data-echo-index]");
    if (card) focusItem(Number(card.getAttribute("data-echo-index")));
  });
  function syncPinVisibility() {
    var visibleOrder = {};
    visibleRows().forEach(function (entry, visibleIndex) {
      visibleOrder[entry.index] = visibleIndex + 1;
    });
    document.querySelectorAll(".echo-export-pin").forEach(function (pin) {
      var index = Number(pin.getAttribute("data-echo-pin"));
      var item = data.rows[index];
      var hidden = !item || (item.kind === "comment" && !showCommentsInput.checked) || (item.kind === "requirement" && !showRequirementsInput.checked);
      pin.style.display = hidden ? "none" : "";
      if (!hidden) pin.textContent = visibleOrder[index] || "";
    });
  }
  function updateFilters() {
    if (activeIndex >= 0) {
      var activeItem = data.rows[activeIndex];
      if ((activeItem.kind === "comment" && !showCommentsInput.checked) || (activeItem.kind === "requirement" && !showRequirementsInput.checked)) {
        activeIndex = -1;
        clearFocus();
      }
    }
    syncPinVisibility();
    renderList();
  }
  showCommentsInput.addEventListener("change", updateFilters);
  showRequirementsInput.addEventListener("change", updateFilters);
  syncPinVisibility();
  renderList();
}());
</script>`;

  const injection = `\n${style}\n${script}\n`;
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${injection}</body>`);
  }
  return `${html}${injection}`;
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
  exportFilename,
  buildAnnotatedExportHtml,
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
