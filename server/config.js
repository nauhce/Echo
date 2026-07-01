const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DOCS_DIR = path.join(DATA_DIR, "docs");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const PORT = Number(process.env.PORT || 5177);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_REMOTE_HTML_BYTES = 10 * 1024 * 1024;

fs.mkdirSync(DOCS_DIR, { recursive: true });

module.exports = {
  ROOT,
  PUBLIC_DIR,
  DATA_DIR,
  DOCS_DIR,
  STORE_FILE,
  PORT,
  HOST,
  MAX_REMOTE_HTML_BYTES,
};
