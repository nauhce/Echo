const docId = decodeURIComponent(location.pathname.split("/").pop());
    const i18n = window.EchoI18n;
    const t = (key, vars) => i18n.t(key, vars);
    const frame = document.getElementById("demoFrame");
    const overlay = document.getElementById("overlay");
    const hoverBox = document.getElementById("hoverBox");
    const list = document.getElementById("list");
    const commentViewBtn = document.getElementById("commentViewBtn");
    const modeBtn = document.getElementById("modeBtn");
    const requirementEditWrap = document.getElementById("requirementEditWrap");
    const requirementEditBtn = document.getElementById("requirementEditBtn");
    const commentModeWrap = document.getElementById("commentModeWrap");
    const authorInput = document.getElementById("author");
    const authorDisplay = document.getElementById("authorDisplay");
    const dialog = document.getElementById("commentDialog");
    const commentForm = document.getElementById("commentForm");
    const commentText = document.getElementById("commentText");
    const selectedElement = document.getElementById("selectedElement");
    const requirementDialog = document.getElementById("requirementDialog");
    const requirementForm = document.getElementById("requirementForm");
    const requirementText = document.getElementById("requirementText");
    const selectedRequirementElement = document.getElementById("selectedRequirementElement");
    const identityDialog = document.getElementById("identityDialog");
    const identityForm = document.getElementById("identityForm");
    const identityNameInput = document.getElementById("identityName");
    const showCommentsInput = document.getElementById("showComments");
    const showRequirementsInput = document.getElementById("showRequirements");
    const toastEl = document.getElementById("toast");
    let annotationMode = false;
    let requirementMode = "";
    let selectedTarget = null;
    let selectedRequirementTarget = null;
    let editingRequirementId = "";
    let annotations = [];
    let requirements = [];
    let canEditRequirements = true;
    let activeId = "";
    let renderTimer = 0;
    let events = null;

    document.getElementById("exportLink").href = `/api/docs/${encodeURIComponent(docId)}/export`;
    document.getElementById("docStatus").textContent = docId;

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

    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[ch]));
    }

    function renderMarkdownInline(value) {
      return escapeHtml(value)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/__([^_]+)__/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(/_([^_]+)_/g, "<em>$1</em>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    }

    function renderMarkdown(value) {
      const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
      const html = [];
      let listType = "";

      function closeList() {
        if (!listType) return;
        html.push(`</${listType}>`);
        listType = "";
      }

      lines.forEach((line) => {
        const text = line.trim();
        if (!text) {
          closeList();
          return;
        }

        const heading = /^(#{1,3})\s+(.+)$/.exec(text);
        if (heading) {
          closeList();
          const level = heading[1].length + 2;
          html.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
          return;
        }

        const unordered = /^[-*]\s+(.+)$/.exec(text);
        if (unordered) {
          if (listType !== "ul") {
            closeList();
            html.push("<ul>");
            listType = "ul";
          }
          html.push(`<li>${renderMarkdownInline(unordered[1])}</li>`);
          return;
        }

        const ordered = /^\d+[.)]\s+(.+)$/.exec(text);
        if (ordered) {
          if (listType !== "ol") {
            closeList();
            html.push("<ol>");
            listType = "ol";
          }
          html.push(`<li>${renderMarkdownInline(ordered[1])}</li>`);
          return;
        }

        closeList();
        html.push(`<p>${renderMarkdownInline(text)}</p>`);
      });

      closeList();
      return html.join("");
    }

    function author() {
      return authorInput.value.trim() || t("anonymous");
    }

    function isRequirementMode() {
      return requirementMode === "edit";
    }

    function isRequirementEditMode() {
      return requirementMode === "edit";
    }

    function updateToolbar() {
      modeBtn.classList.toggle("active", annotationMode);
      commentViewBtn.classList.toggle("active", !annotationMode && !isRequirementMode());
      modeBtn.setAttribute("aria-label", t("comment"));
      commentModeWrap.dataset.tooltip = t("comment");
      requirementEditBtn.classList.toggle("active", requirementMode === "edit");
      requirementEditWrap.style.display = canEditRequirements ? "inline-flex" : "none";
    }

    function cachedAuthor() {
      const saved = localStorage.getItem("review-author");
      if (saved && saved.trim()) return saved.trim();
      const cookie = document.cookie
        .split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith("review-author="));
      if (!cookie) return "";
      try {
        return decodeURIComponent(cookie.split("=").slice(1).join("=")).trim();
      } catch {
        return "";
      }
    }

    function cacheAuthor(name) {
      localStorage.setItem("review-author", name);
      document.cookie = `review-author=${encodeURIComponent(name)}; path=/; max-age=31536000; SameSite=Lax`;
    }

    function enterReview(name) {
      const identity = String(name || "").trim();
      if (!identity) {
        identityDialog.showModal();
        setTimeout(() => identityNameInput.focus(), 40);
        return;
      }
      cacheAuthor(identity);
      authorInput.value = identity;
      authorDisplay.textContent = identity;
      document.body.classList.remove("identity-locked");
      if (identityDialog.open) identityDialog.close();
      if (!frame.getAttribute("src")) frame.src = `/docs/${encodeURIComponent(docId)}/content`;
      loadAnnotations();
      loadRequirements();
      updateToolbar();
      if (!events) {
        events = new EventSource(`/events/docs/${encodeURIComponent(docId)}`);
        events.addEventListener("annotations", (event) => {
          annotations = JSON.parse(event.data);
          renderList();
        });
        events.addEventListener("requirements", (event) => {
          requirements = JSON.parse(event.data);
          renderList();
        });
      }
    }

    function normalizeText(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }

    function isPageTarget(el) {
      const doc = frame.contentDocument;
      return !el || !doc || el === doc.body || el === doc.documentElement;
    }

    function elementLabel(el) {
      if (isPageTarget(el)) return t("wholePage");
      if (!el) return "";
      const text = normalizeText(el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "");
      const tag = el.tagName.toLowerCase();
      const classes = String(el.className || "").split(/\s+/).filter(Boolean).slice(0, 2).map(c => "." + c).join("");
      return `${tag}${classes}${text ? " · " + text.slice(0, 60) : ""}`;
    }

    function selectorFor(el) {
      if (isPageTarget(el)) return "body";
      const doc = frame.contentDocument;
      if (el.id) return `#${CSS.escape(el.id)}`;
      const annotId = el.getAttribute("data-annot-id") || el.getAttribute("data-review-id");
      if (annotId) return `[data-annot-id="${CSS.escape(annotId)}"],[data-review-id="${CSS.escape(annotId)}"]`;
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && node !== doc.body) {
        const tag = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (!parent) break;
        const siblings = Array.from(parent.children).filter(child => child.tagName === node.tagName);
        const index = siblings.indexOf(node) + 1;
        parts.unshift(`${tag}:nth-of-type(${index})`);
        node = parent;
      }
      return `body > ${parts.join(" > ")}`;
    }

    function elementSnapshot(el) {
      const target = isPageTarget(el) ? frame.contentDocument.body : el;
      return {
        elementHtml: target ? String(target.outerHTML || "").slice(0, 20000) : "",
        elementText: target ? normalizeText(target.innerText || target.textContent || "").slice(0, 8000) : "",
        pageTitle: frame.contentDocument.title || docId,
      };
    }

    function showHover(el) {
      if ((!annotationMode && !isRequirementEditMode()) || !el) {
        hoverBox.style.display = "none";
        return;
      }
      const rect = isPageTarget(el)
        ? { left: 0, top: 0, width: frame.contentWindow.innerWidth, height: frame.contentWindow.innerHeight }
        : el.getBoundingClientRect();
      hoverBox.style.display = "block";
      hoverBox.style.left = `${rect.left}px`;
      hoverBox.style.top = `${rect.top}px`;
      hoverBox.style.width = `${Math.max(rect.width, 1)}px`;
      hoverBox.style.height = `${Math.max(rect.height, 1)}px`;
    }

    function viewportFor(el, event) {
      const win = frame.contentWindow;
      const rect = isPageTarget(el)
        ? { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight }
        : el.getBoundingClientRect();
      const x = event ? event.clientX : rect.left + rect.width / 2;
      const y = event ? event.clientY : rect.top + rect.height / 2;
      return {
        x,
        y,
        scrollX: win.scrollX,
        scrollY: win.scrollY,
        docX: x + win.scrollX,
        docY: y + win.scrollY,
        width: rect.width,
        height: rect.height,
      };
    }

    function resizeRequirementText() {
      const minHeight = 120;
      const maxHeight = Math.min(420, Math.max(220, window.innerHeight - 300));
      requirementText.style.height = "auto";
      const height = Math.max(minHeight, Math.min(requirementText.scrollHeight, maxHeight));
      requirementText.style.height = `${height}px`;
      requirementText.style.overflowY = requirementText.scrollHeight > maxHeight ? "auto" : "hidden";
    }

    function openComment(el, event) {
      const target = isPageTarget(el) ? frame.contentDocument.body : el;
      selectedTarget = {
        selector: selectorFor(target),
        elementLabel: elementLabel(target),
        viewport: viewportFor(target, event),
      };
      selectedElement.textContent = selectedTarget.elementLabel || selectedTarget.selector;
      commentText.value = "";
      dialog.showModal();
      setTimeout(() => commentText.focus(), 40);
    }

    function openRequirement(el, event, existing) {
      if (!canEditRequirements) {
        toast(t("viewOnlyRequirement"));
        return;
      }
      const target = existing ? findElement(existing.selector) || frame.contentDocument.body : (isPageTarget(el) ? frame.contentDocument.body : el);
      selectedRequirementTarget = existing
        ? {
            selector: existing.selector,
            elementLabel: existing.elementLabel,
            viewport: existing.viewport,
            ...elementSnapshot(target),
          }
        : {
            selector: selectorFor(target),
            elementLabel: elementLabel(target),
            viewport: viewportFor(target, event),
            ...elementSnapshot(target),
          };
      editingRequirementId = existing ? existing.id : "";
      selectedRequirementElement.textContent = selectedRequirementTarget.elementLabel || selectedRequirementTarget.selector;
      requirementText.value = existing ? existing.requirement : "";
      resizeRequirementText();
      requirementDialog.showModal();
      setTimeout(() => {
        resizeRequirementText();
        requirementText.focus();
      }, 40);
    }
