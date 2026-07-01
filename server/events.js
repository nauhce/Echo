const { routeDocId } = require("./http-utils");

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

module.exports = {
  broadcast,
  handleSse,
};
