const crypto = require("crypto");
const fs = require("fs");
const childProcess = require("child_process");
const { DOCS_DIR, PORT } = require("./config");
const { defaultStore, readStore, writeStore, publicSettings, splitNames } = require("./store");
const { json, localOnly, readBody, routeDocId, getLocalIps } = require("./http-utils");
const {
  safeDocFile,
  uniqueDocId,
  titleFromFilename,
  titleFromUrl,
  titleFromHtml,
  exportFilename,
  buildAnnotatedExportHtml,
  parseMultipart,
  fetchRemoteHtml,
  importHtmlFile,
  listAnnotations,
  listRequirements,
  findDoc,
  canEditRequirements,
  requireRequirementEditor,
} = require("./docs");
const {
  archiveSnapshotResources,
  inlineArchivedResourcesForExport,
  shouldArchiveSnapshotResources,
  assetDirForDoc,
} = require("./resource-archiver");
const { generateRequirement } = require("./ai");
const { broadcast } = require("./events");

async function handleApi(req, res, url) {
  const store = readStore();
  const localOnlyPaths = [
    /^\/api\/config$/,
    /^\/api\/docs$/,
    /^\/api\/folders$/,
    /^\/api\/settings$/,
    /^\/api\/docs\/import-path$/,
    /^\/api\/docs\/upload$/,
    /^\/api\/docs\/import-url$/,
    /^\/api\/docs\/[^/]+\/collaborators$/,
    /^\/api\/docs\/[^/]+\/folder$/,
    /^\/api\/docs\/[^/]+\/reveal$/,
  ];
  const isLocalOnlyDelete = req.method === "DELETE" && /^\/api\/docs\/[^/]+$/.test(url.pathname);
  if ((localOnlyPaths.some((pattern) => pattern.test(url.pathname)) || isLocalOnlyDelete) && !localOnly(req, res)) return;

  if (req.method === "GET" && url.pathname === "/api/config") {
    const host = req.headers.host || `localhost:${PORT}`;
    return json(res, 200, {
      port: PORT,
      host,
      localIps: getLocalIps(),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/docs") {
    return json(res, 200, { docs: store.docs, folders: store.folders });
  }

  if (req.method === "POST" && url.pathname === "/api/folders") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const name = String(body.name || "").trim();
      if (!name) return json(res, 400, { error: "文件夹名称不能为空" });
      const folder = {
        id: crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
      };
      store.folders.unshift(folder);
      writeStore(store);
      return json(res, 201, { folder });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/settings") {
    return json(res, 200, { settings: publicSettings(store.settings) });
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
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
        folderId: "",
        collaborators: [],
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
      let html = snapshot.html;
      const archiveDecision = shouldArchiveSnapshotResources(snapshot.html, snapshot.finalUrl);
      let archive = {
        enabled: false,
        skipped: true,
        reason: archiveDecision.reason,
        resourceCount: archiveDecision.resourceCount,
      };
      if (archiveDecision.needed) {
        try {
          const archived = await archiveSnapshotResources(snapshot.html, snapshot.finalUrl, docId);
          html = archived.html;
          archive = {
            enabled: true,
            skipped: false,
            reason: archiveDecision.reason,
            assetCount: archived.assetCount,
            failedAssetCount: archived.failedAssetCount,
            totalBytes: archived.totalBytes,
            resourceCount: archiveDecision.resourceCount,
          };
        } catch (archiveError) {
          fs.rmSync(assetDirForDoc(docId), { recursive: true, force: true });
          archive = {
            enabled: false,
            skipped: false,
            reason: archiveDecision.reason,
            error: archiveError.message,
            resourceCount: archiveDecision.resourceCount,
          };
        }
      }
      fs.writeFileSync(safeDocFile(docId), html, "utf8");
      const doc = {
        id: docId,
        title,
        filename: `${docId}.html`,
        sourcePath: "",
        sourceUrl: snapshot.finalUrl,
        archive,
        folderId: "",
        collaborators: [],
        createdAt: new Date().toISOString(),
      };
      store.docs.unshift(doc);
      writeStore(store);
      return json(res, 201, { doc });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const collaboratorsMatch = /^\/api\/docs\/([^/]+)\/collaborators$/.exec(url.pathname);
  if (collaboratorsMatch && req.method === "POST") {
    try {
      const docId = routeDocId(collaboratorsMatch[1]);
      const doc = findDoc(store, docId);
      if (!doc) return json(res, 404, { error: "文档不存在" });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      doc.collaborators = splitNames(body.collaborators);
      doc.updatedAt = new Date().toISOString();
      writeStore(store);
      return json(res, 200, { doc });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const folderMatch = /^\/api\/docs\/([^/]+)\/folder$/.exec(url.pathname);
  if (folderMatch && req.method === "POST") {
    try {
      const docId = routeDocId(folderMatch[1]);
      const doc = findDoc(store, docId);
      if (!doc) return json(res, 404, { error: "文档不存在" });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const folderId = String(body.folderId || "").trim();
      if (folderId && !store.folders.some((folder) => folder.id === folderId)) {
        return json(res, 404, { error: "文件夹不存在" });
      }
      doc.folderId = folderId;
      doc.updatedAt = new Date().toISOString();
      writeStore(store);
      return json(res, 200, { doc });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const revealMatch = /^\/api\/docs\/([^/]+)\/reveal$/.exec(url.pathname);
  if (revealMatch && req.method === "POST") {
    try {
      const docId = routeDocId(revealMatch[1]);
      const doc = findDoc(store, docId);
      if (!doc) return json(res, 404, { error: "文档不存在" });
      const filePath = safeDocFile(docId);
      const target = fs.existsSync(filePath) ? filePath : DOCS_DIR;
      childProcess.spawn("explorer.exe", ["/select,", target], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const docMatch = /^\/api\/docs\/([^/]+)$/.exec(url.pathname);
  if (docMatch && req.method === "DELETE") {
    try {
      const docId = routeDocId(docMatch[1]);
      const doc = findDoc(store, docId);
      if (!doc) return json(res, 404, { error: "文档不存在" });
      const annotationIds = new Set(store.annotations.filter((item) => item.docId === docId).map((item) => item.id));
      store.docs = store.docs.filter((item) => item.id !== docId);
      store.annotations = store.annotations.filter((item) => item.docId !== docId);
      store.replies = store.replies.filter((reply) => !annotationIds.has(reply.annotationId));
      store.requirements = store.requirements.filter((item) => item.docId !== docId);
      const filePath = safeDocFile(docId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      fs.rmSync(assetDirForDoc(docId), { recursive: true, force: true });
      writeStore(store);
      return json(res, 200, { ok: true });
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
    const docId = routeDocId(requirementsMatch[1]);
    return json(res, 200, {
      requirements: listRequirements(store, docId),
      canEdit: canEditRequirements(store, docId, url.searchParams.get("author")),
    });
  }
  if (requirementsMatch && req.method === "POST") {
    try {
      const docId = routeDocId(requirementsMatch[1]);
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      requireRequirementEditor(store, docId, body.author);
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

if (req.method === "POST" && url.pathname === "/api/requirements/generate") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const docId = String(body.docId || "").trim();
      if (!docId) throw new Error("缺少文档 ID");
      requireRequirementEditor(store, docId, body.author);
      const requirement = await generateRequirement(store.settings, body);
      return json(res, 200, { requirement });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const requirementMatch = /^\/api\/requirements\/([^/]+)$/.exec(url.pathname);
  if (requirementMatch && req.method === "POST") {
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const item = store.requirements.find((row) => row.id === requirementMatch[1]);
      if (!item) return json(res, 404, { error: "需求记录不存在" });
      requireRequirementEditor(store, item.docId, body.author);
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
      const item = store.requirements.find((row) => row.id === requirementMatch[1]);
      if (!item) return json(res, 404, { error: "需求记录不存在" });
      requireRequirementEditor(store, item.docId, body.author);
      store.requirements = store.requirements.filter((row) => row.id !== item.id);
      writeStore(store);
      const payload = listRequirements(store, item.docId);
      broadcast(item.docId, "requirements", payload);
      return json(res, 200, { ok: true });
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

  const htmlExportMatch = /^\/api\/docs\/([^/]+)\/export-html$/.exec(url.pathname);
  if (htmlExportMatch && req.method === "GET") {
    const docId = routeDocId(htmlExportMatch[1]);
    const doc = store.docs.find((item) => item.id === docId);
    if (!doc) return json(res, 404, { error: "æ–‡æ¡£ä¸å­˜åœ¨" });
    const filePath = safeDocFile(docId);
    if (!fs.existsSync(filePath)) return json(res, 404, { error: "HTML æ–‡ä»¶ä¸å­˜åœ¨" });
    let sourceHtml = fs.readFileSync(filePath, "utf8");
    let exportArchive = null;
    if (doc.archive && doc.archive.enabled) {
      try {
        exportArchive = inlineArchivedResourcesForExport(sourceHtml, docId);
        sourceHtml = exportArchive.html;
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }
    const annotatedHtml = buildAnnotatedExportHtml(
      sourceHtml,
      doc,
      listAnnotations(store, docId),
      listRequirements(store, docId)
    );
    const filename = encodeURIComponent(exportFilename(doc));
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="annotated-review.html"; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store",
      "X-Echo-Inlined-Assets": String(exportArchive ? exportArchive.assetCount : 0),
    });
    res.end(annotatedHtml);
    return;
  }

  json(res, 404, { error: "API not found" });
}

module.exports = {
  handleApi,
};
