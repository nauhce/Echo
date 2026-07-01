const fs = require("fs");
const { STORE_FILE } = require("./config");

function defaultStore() {
  return {
    folders: [],
    docs: [],
    annotations: [],
    replies: [],
    requirements: [],
    settings: {
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
  const legacyEditors = splitNames(next.settings && next.settings.allowedEditors);
  next.folders = Array.isArray(next.folders)
    ? next.folders.map((folder) => ({
        ...folder,
        id: String(folder.id || "").trim(),
        name: String(folder.name || "").trim(),
        createdAt: folder.createdAt || new Date().toISOString(),
      })).filter((folder) => folder.id && folder.name)
    : [];
  const folderIds = new Set(next.folders.map((folder) => folder.id));
  next.docs = Array.isArray(next.docs)
    ? next.docs.map((doc) => ({
        ...doc,
        folderId: folderIds.has(doc.folderId) ? doc.folderId : "",
        collaborators: Array.isArray(doc.collaborators) ? doc.collaborators : legacyEditors,
      }))
    : [];
  next.annotations = Array.isArray(next.annotations) ? next.annotations : [];
  next.replies = Array.isArray(next.replies) ? next.replies : [];
  next.requirements = Array.isArray(next.requirements) ? next.requirements : [];
  next.settings = { ...defaultStore().settings, ...(next.settings || {}) };
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

function publicSettings(settings) {
  const ai = settings.ai || {};
  return {
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
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  defaultStore,
  normalizeStore,
  readStore,
  writeStore,
  publicSettings,
  splitNames,
};
