const docsEl = document.getElementById("docs");
    const createFolderBtn = document.getElementById("createFolderBtn");
    const docSearchInput = document.getElementById("docSearchInput");
    const toastEl = document.getElementById("toast");
    const appTitleEl = document.getElementById("appTitle");
    const appTitleBackdrop = document.getElementById("appTitleBackdrop");
    const appTitleInput = document.getElementById("appTitleInput");
    const editAppTitleBtn = document.getElementById("editAppTitleBtn");
    const closeAppTitleButton = document.getElementById("closeAppTitleButton");
    const heroTitleEl = document.getElementById("heroTitle");
    const heroDescEl = document.getElementById("heroDesc");
    const heroEditor = document.getElementById("heroEditor");
    const heroTitleInput = document.getElementById("heroTitleInput");
    const heroDescInput = document.getElementById("heroDescInput");
    const aiBaseUrlInput = document.getElementById("aiBaseUrl");
    const aiModelInput = document.getElementById("aiModel");
    const aiApiKeyInput = document.getElementById("aiApiKey");
    const aiKeyStatus = document.getElementById("aiKeyStatus");
    const settingsButton = document.getElementById("settingsButton");
    const settingsBackdrop = document.getElementById("settingsBackdrop");
    const closeSettingsButton = document.getElementById("closeSettingsButton");
    const collaboratorsBackdrop = document.getElementById("collaboratorsBackdrop");
    const closeCollaboratorsButton = document.getElementById("closeCollaboratorsButton");
    const collaboratorsInput = document.getElementById("collaboratorsInput");
    const defaultHeroCopy = {
      title: heroTitleEl.textContent,
      desc: heroDescEl.textContent,
    };
    const defaultAppTitle = appTitleEl.textContent;
    const defaultFileHint = "导入html格式的文件，可以是文档、demo或者设计图。";
    let config = null;
    let shareOrigin = location.origin;
    let shareOrigins = [location.origin];
    let currentCollaboratorDocId = "";
    let latestDocs = [];
    let latestFolders = [];

    function toast(message) {
      toastEl.textContent = message;
      toastEl.classList.add("show");
      setTimeout(() => toastEl.classList.remove("show"), 1800);
    }

    async function api(path, options) {
      const res = await fetch(path, options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }

    function reviewUrl(doc) {
      return `${location.origin}/review/${doc.id}`;
    }

    async function copy(text) {
      await navigator.clipboard.writeText(text);
      toast("链接已复制");
    }

    async function loadConfig() {
      config = await api("/api/config");
      const origins = [location.origin].concat((config.localIps || []).map(ip => `http://${ip}:${config.port}`));
      shareOrigins = Array.from(new Set(origins));
      const savedOrigin = localStorage.getItem("echo-share-origin");
      shareOrigin = shareOrigins.includes(savedOrigin) ? savedOrigin : shareOrigins[0];
    }

    function shareUrl(doc, origin = shareOrigin) {
      return `${origin}/review/${doc.id}`;
    }

    function shareOptions(doc) {
      return shareOrigins.map((origin, index) => {
        const label = index === 0 ? `本机：${origin}` : `可选地址 ${index}：${origin}`;
        return `<button class="share-option" type="button" data-share-origin="${escapeHtml(origin)}" data-share-doc="${escapeHtml(doc.id)}">${escapeHtml(label)}</button>`;
      }).join("");
    }

    async function loadSettings() {
      const { settings } = await api("/api/settings");
      aiBaseUrlInput.value = settings.ai.baseUrl || "https://api.openai.com/v1";
      aiModelInput.value = settings.ai.model || "gpt-4o-mini";
      aiKeyStatus.textContent = settings.ai.hasApiKey ? "已保存 API Key；留空提交会继续沿用。" : "尚未配置 API Key。";
    }

    function docCard(doc) {
      return `
        <article class="doc" draggable="true" data-doc-id="${escapeHtml(doc.id)}">
          <div>
            <h3>${escapeHtml(doc.title)}</h3>
            <div class="meta">ID：${escapeHtml(doc.id)} · 文件：${escapeHtml(doc.filename || "")}</div>
            ${doc.sourceUrl ? `<div class="meta">来源：${escapeHtml(doc.sourceUrl)}</div>` : ""}
            <div class="meta collaborator-preview">协作者：${collaboratorLabel(doc)}</div>
            <div class="meta">评审链接：${escapeHtml(shareUrl(doc))}</div>
          </div>
          <div class="actions">
            <a class="button" href="/review/${encodeURIComponent(doc.id)}" target="_blank">开始</a>
            <button class="icon-button collaborator-button" type="button" data-collaborators-doc="${escapeHtml(doc.id)}" aria-label="设置协作者" title="设置协作者">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </button>
            <div class="share-action">
              <button class="secondary share-button" type="button" data-share-toggle="${escapeHtml(doc.id)}">复制分享链接 <span class="chevron">⌄</span></button>
              <div class="share-menu">${shareOptions(doc)}</div>
            </div>
            <div class="menu-action">
              <button class="icon-button" type="button" data-doc-menu="${escapeHtml(doc.id)}" aria-label="更多操作" title="更多操作">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <circle cx="12" cy="12" r="1"></circle>
                  <circle cx="19" cy="12" r="1"></circle>
                  <circle cx="5" cy="12" r="1"></circle>
                </svg>
              </button>
              <div class="share-menu">
                <a class="share-option" href="/api/docs/${encodeURIComponent(doc.id)}/export">导出批注</a>
                <button class="share-option" type="button" data-reveal-doc="${escapeHtml(doc.id)}">浏览所在位置</button>
                <button class="share-option" type="button" data-delete-doc="${escapeHtml(doc.id)}">删除</button>
              </div>
            </div>
          </div>
        </article>
      `;
    }

    function folderIcon() {
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v6.5A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z"></path>
        </svg>
      `;
    }

    function folderSection(folder, folderDocs) {
      return `
        <section class="folder-group" data-folder-drop="${escapeHtml(folder.id)}">
          <div class="folder-head">
            <div class="folder-title">${folderIcon()}<span>${escapeHtml(folder.name)}</span></div>
            <span class="folder-count">${folderDocs.length} 个文档</span>
          </div>
          ${folderDocs.length ? folderDocs.map(docCard).join("") : `<div class="folder-empty">拖动文档到这里</div>`}
        </section>
      `;
    }

    async function moveDocToFolder(docId, folderId) {
      await api(`/api/docs/${encodeURIComponent(docId)}/folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      toast(folderId ? "文档已移动到文件夹" : "文档已移出文件夹");
      loadDocs();
    }

    function bindDocDrag() {
      docsEl.querySelectorAll(".doc[draggable='true']").forEach(card => {
        card.addEventListener("dragstart", (event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", card.dataset.docId);
          card.classList.add("dragging");
        });
        card.addEventListener("dragend", () => {
          card.classList.remove("dragging");
          docsEl.querySelectorAll(".drop-active").forEach(item => item.classList.remove("drop-active"));
        });
      });
      docsEl.querySelectorAll("[data-folder-drop]").forEach(zone => {
        zone.addEventListener("dragover", (event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          zone.classList.add("drop-active");
        });
        zone.addEventListener("dragleave", (event) => {
          if (!zone.contains(event.relatedTarget)) zone.classList.remove("drop-active");
        });
        zone.addEventListener("drop", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          zone.classList.remove("drop-active");
          const docId = event.dataTransfer.getData("text/plain");
          if (!docId) return;
          try {
            await moveDocToFolder(docId, zone.dataset.folderDrop || "");
          } catch (error) {
            toast(error.message);
          }
        });
      });
    }

    function renderDocs(docs, folders) {
      const query = docSearchInput.value.trim().toLowerCase();
      const filteredDocs = query
        ? docs.filter(doc => String(doc.title || "").toLowerCase().includes(query))
        : docs;
      if (!filteredDocs.length && query) {
        docsEl.innerHTML = `<div class="folder-empty">没有找到匹配的文档</div>`;
        return;
      }
      if (!docs.length && !folders.length) {
        docsEl.innerHTML = `<div class="meta">还没有导入文档。</div>`;
        return;
      }
      const folderIds = new Set(folders.map(folder => folder.id));
      const rootDocs = filteredDocs.filter(doc => !doc.folderId || !folderIds.has(doc.folderId));
      const visibleFolders = query
        ? folders.filter(folder => filteredDocs.some(doc => doc.folderId === folder.id))
        : folders;
      const shouldShowRoot = !query || rootDocs.length || !visibleFolders.length;
      const rootMarkup = shouldShowRoot ? `
        <section class="folder-drop-root ${visibleFolders.length ? "folder-group" : ""}" data-folder-drop="">
          ${visibleFolders.length && !query ? `
            <div class="folder-head">
              <div class="folder-title">${folderIcon()}<span>未归档</span></div>
              <span class="folder-count">${rootDocs.length} 个文档</span>
            </div>
          ` : ""}
          ${rootDocs.length ? rootDocs.map(docCard).join("") : ""}
          ${!rootDocs.length && visibleFolders.length && !query ? `<div class="folder-empty">拖动文档到这里移出文件夹</div>` : ""}
        </section>
      ` : "";
      docsEl.innerHTML = `
        ${rootMarkup}
        ${visibleFolders.map(folder => folderSection(folder, filteredDocs.filter(doc => doc.folderId === folder.id))).join("")}
      `;
      bindDocDrag();
      docsEl.querySelectorAll("[data-share-origin]").forEach(btn => {
        btn.addEventListener("click", async (event) => {
          event.stopPropagation();
          const doc = latestDocs.find(item => item.id === btn.dataset.shareDoc);
          if (!doc) return;
          shareOrigin = btn.dataset.shareOrigin;
          localStorage.setItem("echo-share-origin", shareOrigin);
          await copy(shareUrl(doc, shareOrigin));
          btn.closest(".share-action").classList.remove("open");
          loadDocs();
        });
      });
      docsEl.querySelectorAll("[data-collaborators-doc]").forEach(btn => {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          const doc = latestDocs.find(item => item.id === btn.dataset.collaboratorsDoc);
          if (doc) openCollaborators(doc);
        });
      });
      docsEl.querySelectorAll("[data-reveal-doc]").forEach(btn => {
        btn.addEventListener("click", async (event) => {
          event.stopPropagation();
          try {
            await api(`/api/docs/${encodeURIComponent(btn.dataset.revealDoc)}/reveal`, { method: "POST" });
            toast("已打开文档所在位置");
          } catch (error) {
            toast(error.message);
          }
        });
      });
      docsEl.querySelectorAll("[data-delete-doc]").forEach(btn => {
        btn.addEventListener("click", async (event) => {
          event.stopPropagation();
          const doc = latestDocs.find(item => item.id === btn.dataset.deleteDoc);
          if (!doc) return;
          if (!confirm(`确定删除「${doc.title}」吗？相关批注和需求也会一并删除。`)) return;
          try {
            await api(`/api/docs/${encodeURIComponent(doc.id)}`, { method: "DELETE" });
            toast("文档已删除");
            loadDocs();
          } catch (error) {
            toast(error.message);
          }
        });
      });
    }

    async function loadDocs() {
      const { docs, folders = [] } = await api("/api/docs");
      latestDocs = docs;
      latestFolders = folders;
      renderDocs(latestDocs, latestFolders);
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[ch]));
    }

    function collaboratorLabel(doc) {
      const collaborators = Array.isArray(doc.collaborators) ? doc.collaborators : [];
      return collaborators.length ? escapeHtml(collaborators.join("、")) : "所有人可协作";
    }

    function applyHeroCopy(copy) {
      heroTitleEl.textContent = copy.title || defaultHeroCopy.title;
      heroDescEl.textContent = copy.desc || defaultHeroCopy.desc;
    }

    function loadAppTitle() {
      appTitleEl.textContent = localStorage.getItem("echo-app-title") || defaultAppTitle;
    }

    function openAppTitleEditor() {
      appTitleInput.value = appTitleEl.textContent;
      appTitleBackdrop.classList.add("open");
      appTitleBackdrop.setAttribute("aria-hidden", "false");
      setTimeout(() => appTitleInput.focus(), 40);
    }

    function closeAppTitleEditor() {
      appTitleBackdrop.classList.remove("open");
      appTitleBackdrop.setAttribute("aria-hidden", "true");
      editAppTitleBtn.focus();
    }

    function loadHeroCopy() {
      try {
        const saved = JSON.parse(localStorage.getItem("echo-hero-copy") || "null");
        if (saved && (saved.title || saved.desc)) applyHeroCopy(saved);
      } catch {
        applyHeroCopy(defaultHeroCopy);
      }
    }

    function openHeroEditor() {
      heroTitleInput.value = heroTitleEl.textContent;
      heroDescInput.value = heroDescEl.textContent;
      heroEditor.classList.add("open");
      setTimeout(() => heroTitleInput.focus(), 40);
    }

    function closeHeroEditor() {
      heroEditor.classList.remove("open");
    }

    function openSettings() {
      settingsBackdrop.classList.add("open");
      settingsBackdrop.setAttribute("aria-hidden", "false");
      setTimeout(() => aiBaseUrlInput.focus(), 40);
    }

    function closeSettings() {
      settingsBackdrop.classList.remove("open");
      settingsBackdrop.setAttribute("aria-hidden", "true");
      settingsButton.focus();
    }

    function openCollaborators(doc) {
      currentCollaboratorDocId = doc.id;
      collaboratorsInput.value = (doc.collaborators || []).join("、");
      collaboratorsBackdrop.classList.add("open");
      collaboratorsBackdrop.setAttribute("aria-hidden", "false");
      setTimeout(() => collaboratorsInput.focus(), 40);
    }

    function closeCollaborators() {
      collaboratorsBackdrop.classList.remove("open");
      collaboratorsBackdrop.setAttribute("aria-hidden", "true");
      currentCollaboratorDocId = "";
    }

    document.getElementById("editHeroBtn").addEventListener("click", openHeroEditor);
    document.getElementById("cancelHeroEdit").addEventListener("click", closeHeroEditor);
    editAppTitleBtn.addEventListener("click", openAppTitleEditor);
    closeAppTitleButton.addEventListener("click", closeAppTitleEditor);
    settingsButton.addEventListener("click", openSettings);
    closeSettingsButton.addEventListener("click", closeSettings);
    closeCollaboratorsButton.addEventListener("click", closeCollaborators);
    docSearchInput.addEventListener("input", () => {
      renderDocs(latestDocs, latestFolders);
    });
    createFolderBtn.addEventListener("click", async () => {
      const name = prompt("请输入文件夹名称");
      if (name === null) return;
      const folderName = name.trim();
      if (!folderName) {
        toast("文件夹名称不能为空");
        return;
      }
      try {
        await api("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: folderName }),
        });
        toast("文件夹已创建");
        loadDocs();
      } catch (error) {
        toast(error.message);
      }
    });
    appTitleBackdrop.addEventListener("click", (event) => {
      if (event.target === appTitleBackdrop) closeAppTitleEditor();
    });
    settingsBackdrop.addEventListener("click", (event) => {
      if (event.target === settingsBackdrop) closeSettings();
    });
    collaboratorsBackdrop.addEventListener("click", (event) => {
      if (event.target === collaboratorsBackdrop) closeCollaborators();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && appTitleBackdrop.classList.contains("open")) closeAppTitleEditor();
      if (event.key === "Escape" && settingsBackdrop.classList.contains("open")) closeSettings();
      if (event.key === "Escape" && collaboratorsBackdrop.classList.contains("open")) closeCollaborators();
    });
    document.addEventListener("click", () => {
      docsEl.querySelectorAll(".share-action.open").forEach(item => item.classList.remove("open"));
    });
    heroEditor.addEventListener("submit", (event) => {
      event.preventDefault();
      const copy = {
        title: heroTitleInput.value.trim() || defaultHeroCopy.title,
        desc: heroDescInput.value.trim() || defaultHeroCopy.desc,
      };
      localStorage.setItem("echo-hero-copy", JSON.stringify(copy));
      applyHeroCopy(copy);
      closeHeroEditor();
      toast("文案已保存");
    });
    document.getElementById("appTitleForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const title = appTitleInput.value.trim() || defaultAppTitle;
      localStorage.setItem("echo-app-title", title);
      appTitleEl.textContent = title;
      closeAppTitleEditor();
      toast("标题已保存");
    });

    document.getElementById("file").addEventListener("change", (event) => {
      const file = event.currentTarget.files && event.currentTarget.files[0];
      document.getElementById("fileNamePreview").textContent = file
        ? `文档名称：${file.name.replace(/\.html?$/i, "")}`
        : defaultFileHint;
    });

    document.getElementById("uploadForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const file = document.getElementById("file").files[0];
        if (!file) throw new Error("请选择 HTML 文件");
        const data = new FormData(form);
        data.set("title", file.name.replace(/\.html?$/i, ""));
        await fetch("/api/docs/upload", { method: "POST", body: data }).then(async res => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error || "上传失败");
          return body;
        });
        toast("已上传 HTML");
        form.reset();
        document.getElementById("fileNamePreview").textContent = defaultFileHint;
        loadDocs();
      } catch (error) {
        toast(error.message);
      }
    });

    document.getElementById("urlForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const pageUrl = document.getElementById("pageUrl").value.trim();
        if (!pageUrl) throw new Error("请输入页面链接");
        await api("/api/docs/import-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: pageUrl }),
        });
        toast("已保存页面快照");
        form.reset();
        loadDocs();
      } catch (error) {
        toast(error.message);
      }
    });

    document.getElementById("settingsForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ai: {
              baseUrl: aiBaseUrlInput.value,
              model: aiModelInput.value,
              apiKey: aiApiKeyInput.value,
            },
          }),
        });
        aiApiKeyInput.value = "";
        await loadSettings();
        toast("设置已保存");
        closeSettings();
      } catch (error) {
        toast(error.message);
      }
    });

    document.getElementById("collaboratorsForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        if (!currentCollaboratorDocId) throw new Error("请先选择文档");
        await api(`/api/docs/${encodeURIComponent(currentCollaboratorDocId)}/collaborators`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collaborators: collaboratorsInput.value }),
        });
        toast("协作者已保存");
        closeCollaborators();
        loadDocs();
      } catch (error) {
        toast(error.message);
      }
    });

    loadAppTitle();
    loadHeroCopy();
    loadConfig().then(loadDocs);
    loadSettings().catch((error) => toast(error.message));
