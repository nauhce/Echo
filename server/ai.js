const http = require("http");
const https = require("https");
const { defaultStore } = require("./store");

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
  const draftRequirement = String(body.draftRequirement || "").trim();
  const language = body.language === "en" ? "English" : "中文";
  const noDraftText = body.language === "en" ? "None" : "无";
  const completionInstruction = body.language === "en"
    ? "Please preserve the user's existing meaning, then fill in missing details. Output a complete requirement description that can directly replace the input field. Prefer Markdown lists."
    : "请在保留用户已有描述含义的基础上，补齐遗漏信息，输出一版可直接替换输入框内容的完整需求说明。优先使用 Markdown 列表。";
  const newInstruction = body.language === "en"
    ? "Please output 4-8 concise requirements suitable for a requirements document. Prefer Markdown lists."
    : "请输出 4-8 条精炼需求描述，适合直接放入需求文档。优先使用 Markdown 列表。";
  const payload = {
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          `你是一名资深产品经理。请根据用户选择的页面区域代码、可见文本、上下文和用户已经写下的需求草稿，输出清晰、可执行的${language}需求描述。用户草稿是最高优先级：必须优先保留它表达的业务意图、限制和措辞重点，不能反向改写或删除用户已经明确描述的规则。用户没有描述清楚的部分，才按照行业惯例补齐功能目标、用户交互、状态规则、异常边界和验收要点。不要编造页面中不存在的业务事实。最终回答只能使用${language}。`,
      },
      {
        role: "user",
        content: [
          `页面标题：${truncateText(body.pageTitle, 200)}`,
          `选中元素：${truncateText(body.elementLabel, 200)}`,
          `用户已有需求草稿：${draftRequirement ? truncateText(draftRequirement, 2000) : noDraftText}`,
          `可见文本：${truncateText(body.elementText, 1200)}`,
          `HTML：${truncateText(body.elementHtml, 5000)}`,
          draftRequirement ? completionInstruction : newInstruction,
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

module.exports = {
  generateRequirement,
};
