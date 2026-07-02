const docsEl = document.getElementById("docs");
    const i18n = window.EchoI18n;
    const t = (key, vars) => i18n.t(key, vars);
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
    const fileInput = document.getElementById("file");
    const chooseFileBtn = document.getElementById("chooseFileBtn");
    const selectedFileName = document.getElementById("selectedFileName");
    const pageUrlInput = document.getElementById("pageUrl");
    const urlImportButton = document.getElementById("urlImportButton");
    const urlImportProgress = document.getElementById("urlImportProgress");
    const defaultHeroCopy = {
      title: () => t("heroTitle"),
      desc: () => t("heroDesc"),
    };
    const defaultAppTitle = () => t("appTitle");
    const defaultFileHint = () => t("fileHint");
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
      if (!res.ok) throw new Error(data.error ? i18n.translateError(data.error) : t("requestFailed"));
      return data;
    }

    function reviewUrl(doc) {
      return `${location.origin}/review/${doc.id}`;
    }

    async function copy(text) {
      await navigator.clipboard.writeText(text);
      toast(t("linkCopied"));
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
        const label = index === 0 ? t("localMachine", { origin }) : t("optionalAddress", { index, origin });
        return `<button class="share-option" type="button" data-share-origin="${escapeHtml(origin)}" data-share-doc="${escapeHtml(doc.id)}">${escapeHtml(label)}</button>`;
      }).join("");
    }

    async function loadSettings() {
      const { settings } = await api("/api/settings");
      aiBaseUrlInput.value = settings.ai.baseUrl || "https://api.openai.com/v1";
      aiModelInput.value = settings.ai.model || "gpt-4o-mini";
      aiKeyStatus.textContent = settings.ai.hasApiKey ? t("apiKeySaved") : t("apiKeyMissing");
    }

    function docCard(doc) {
      return `
        <article class="doc" draggable="true" data-doc-id="${escapeHtml(doc.id)}">
          <div>
            <h3>${escapeHtml(doc.title)}</h3>
            <div class="meta">${t("id")}：${escapeHtml(doc.id)} · ${t("file")}：${escapeHtml(doc.filename || "")}</div>
            ${doc.sourceUrl ? `<div class="meta">${t("source")}：${escapeHtml(doc.sourceUrl)}</div>` : ""}
            <div class="meta collaborator-preview">${t("collaboratorPreview")}：${collaboratorLabel(doc)}</div>
            <div class="meta">${t("reviewLink")}：${escapeHtml(shareUrl(doc))}</div>
          </div>
          <div class="actions">
            <a class="button" href="/review/${encodeURIComponent(doc.id)}" target="_blank">${t("start")}</a>
            <button class="icon-button collaborator-button" type="button" data-collaborators-doc="${escapeHtml(doc.id)}" aria-label="${t("setCollaborators")}" title="${t("setCollaborators")}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </button>
            <div class="share-action">
              <button class="secondary share-button" type="button" data-share-toggle="${escapeHtml(doc.id)}">${t("copyShareLink")} <span class="chevron">⌄</span></button>
              <div class="share-menu">${shareOptions(doc)}</div>
            </div>
            <div class="menu-action">
              <button class="icon-button" type="button" data-doc-menu="${escapeHtml(doc.id)}" aria-label="${t("moreActions")}" title="${t("moreActions")}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <circle cx="12" cy="12" r="1"></circle>
                  <circle cx="19" cy="12" r="1"></circle>
                  <circle cx="5" cy="12" r="1"></circle>
                </svg>
              </button>
              <div class="share-menu">
                <a class="share-option" href="/api/docs/${encodeURIComponent(doc.id)}/export">${t("exportComments")}</a>
                <button class="share-option" type="button" data-reveal-doc="${escapeHtml(doc.id)}">${t("revealInFolder")}</button>
                <button class="share-option" type="button" data-delete-doc="${escapeHtml(doc.id)}">${t("delete")}</button>
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
            <span class="folder-count">${folderDocs.length} ${t("documents")}</span>
          </div>
          ${folderDocs.length ? folderDocs.map(docCard).join("") : `<div class="folder-empty">${t("dragHere")}</div>`}
        </section>
      `;
    }

    async function moveDocToFolder(docId, folderId) {
      await api(`/api/docs/${encodeURIComponent(docId)}/folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      toast(folderId ? t("docMovedToFolder") : t("docMovedOutFolder"));
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
        docsEl.innerHTML = `<div class="folder-empty">${t("noMatchingDocs")}</div>`;
        return;
      }
      if (!docs.length && !folders.length) {
        docsEl.innerHTML = `<div class="meta">${t("noDocs")}</div>`;
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
              <div class="folder-title">${folderIcon()}<span>${t("unfiled")}</span></div>
              <span class="folder-count">${rootDocs.length} ${t("documents")}</span>
            </div>
          ` : ""}
          ${rootDocs.length ? rootDocs.map(docCard).join("") : ""}
          ${!rootDocs.length && visibleFolders.length && !query ? `<div class="folder-empty">${t("dragHereToUnfile")}</div>` : ""}
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
            toast(t("openedFolder"));
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
          if (!confirm(t("deleteDocConfirm", { title: doc.title }))) return;
          try {
            await api(`/api/docs/${encodeURIComponent(doc.id)}`, { method: "DELETE" });
            toast(t("docDeleted"));
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
      return collaborators.length ? escapeHtml(collaborators.join("、")) : t("everyoneCanCollaborate");
    }

    function applyHeroCopy(copy) {
      heroTitleEl.textContent = copy.title || defaultHeroCopy.title();
      heroDescEl.textContent = copy.desc || defaultHeroCopy.desc();
    }

    function loadAppTitle() {
      const title = localStorage.getItem("echo-app-title") || defaultAppTitle();
      appTitleEl.textContent = title;
      document.title = title;
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
        else applyHeroCopy({});
      } catch {
        applyHeroCopy({});
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
      const name = prompt(t("enterFolderName"));
      if (name === null) return;
      const folderName = name.trim();
      if (!folderName) {
        toast(t("folderNameRequired"));
        return;
      }
      try {
        await api("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: folderName }),
        });
        toast(t("folderCreated"));
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
        title: heroTitleInput.value.trim() || defaultHeroCopy.title(),
        desc: heroDescInput.value.trim() || defaultHeroCopy.desc(),
      };
      localStorage.setItem("echo-hero-copy", JSON.stringify(copy));
      applyHeroCopy(copy);
      closeHeroEditor();
      toast(t("copySaved"));
    });
    document.getElementById("appTitleForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const title = appTitleInput.value.trim() || defaultAppTitle();
      localStorage.setItem("echo-app-title", title);
      appTitleEl.textContent = title;
      closeAppTitleEditor();
      toast(t("titleSaved"));
    });

    function updateSelectedFile() {
      const file = fileInput.files && fileInput.files[0];
      selectedFileName.textContent = file ? file.name : t("noFileSelected");
      document.getElementById("fileNamePreview").textContent = file
        ? t("documentName", { name: file.name.replace(/\.html?$/i, "") })
        : defaultFileHint();
    }

    function setUrlImportLoading(isLoading) {
      pageUrlInput.disabled = isLoading;
      urlImportButton.disabled = isLoading;
      urlImportButton.textContent = isLoading ? t("importing") : t("saveSnapshot");
      urlImportProgress.hidden = !isLoading;
    }

    chooseFileBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", updateSelectedFile);

    document.getElementById("uploadForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const file = fileInput.files[0];
        if (!file) throw new Error(t("selectHtmlFile"));
        const data = new FormData(form);
        data.set("title", file.name.replace(/\.html?$/i, ""));
        await fetch("/api/docs/upload", { method: "POST", body: data }).then(async res => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error ? i18n.translateError(body.error) : t("uploadFailed"));
          return body;
        });
        toast(t("htmlUploaded"));
        form.reset();
        updateSelectedFile();
        loadDocs();
      } catch (error) {
        toast(error.message);
      }
    });

    document.getElementById("urlForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const pageUrl = pageUrlInput.value.trim();
        if (!pageUrl) throw new Error(t("enterPageUrl"));
        setUrlImportLoading(true);
        await api("/api/docs/import-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: pageUrl }),
        });
        toast(t("snapshotSaved"));
        form.reset();
        loadDocs();
      } catch (error) {
        toast(error.message);
      } finally {
        setUrlImportLoading(false);
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
        toast(t("settingsSaved"));
        closeSettings();
      } catch (error) {
        toast(error.message);
      }
    });

    document.getElementById("collaboratorsForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        if (!currentCollaboratorDocId) throw new Error(t("chooseDocFirst"));
        await api(`/api/docs/${encodeURIComponent(currentCollaboratorDocId)}/collaborators`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collaborators: collaboratorsInput.value }),
        });
        toast(t("collaboratorsSaved"));
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

    document.addEventListener("DOMContentLoaded", () => {
      loadAppTitle();
      loadHeroCopy();
    });

    window.addEventListener("echo:languagechange", () => {
      document.title = localStorage.getItem("echo-app-title") || defaultAppTitle();
      loadAppTitle();
      loadHeroCopy();
      renderDocs(latestDocs, latestFolders);
      loadSettings().catch((error) => toast(error.message));
      updateSelectedFile();
    });
