function installFrameHandlers() {
      const doc = frame.contentDocument;
      const scheduleRenderPins = () => {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(renderPins, 80);
      };
      doc.addEventListener("mousemove", (event) => showHover(event.target), true);
      doc.addEventListener("click", (event) => {
        if (!annotationMode && !isRequirementEditMode()) return;
        event.preventDefault();
        event.stopPropagation();
        if (annotationMode) openComment(event.target, event);
        if (isRequirementEditMode()) openRequirement(event.target, event);
      }, true);
      doc.addEventListener("scroll", scheduleRenderPins, true);
      frame.contentWindow.addEventListener("resize", scheduleRenderPins);
      new MutationObserver(scheduleRenderPins).observe(doc.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      renderPins();
    }

    function findElement(selector) {
      try {
        if (String(selector || "").trim() === "body >") {
          return frame.contentDocument.body;
        }
        return frame.contentDocument.querySelector(selector);
      } catch {
        return null;
      }
    }

    function labelStillMatches(item, el) {
      if (!el) return false;
      if (item.selector === "body") return true;
      const saved = normalizeText(item.elementLabel);
      const current = normalizeText(elementLabel(el));
      if (!saved || !current) return true;
      if (saved === current) return true;
      const savedText = saved.split("·").slice(1).join("·").trim();
      const currentText = current.split("·").slice(1).join("·").trim();
      if (!savedText || !currentText) return true;
      return currentText.includes(savedText.slice(0, 24)) || savedText.includes(currentText.slice(0, 24));
    }

    function pointFromStoredViewport(item) {
      const viewport = item.viewport || {};
      const win = frame.contentWindow;
      if (Number.isFinite(viewport.docX) && Number.isFinite(viewport.docY)) {
        return {
          x: viewport.docX - win.scrollX,
          y: viewport.docY - win.scrollY,
          scrollX: win.scrollX,
          scrollY: win.scrollY,
          docX: viewport.docX,
          docY: viewport.docY,
          width: viewport.width || 0,
          height: viewport.height || 0,
        };
      }
      return null;
    }

    function isPointInViewport(point) {
      const win = frame.contentWindow;
      return point.x >= 0 && point.y >= 0 && point.x <= win.innerWidth && point.y <= win.innerHeight;
    }

    function isElementVisible(el) {
      if (isPageTarget(el)) return true;
      const rect = el.getBoundingClientRect();
      const win = frame.contentWindow;
      return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.left <= win.innerWidth && rect.top <= win.innerHeight;
    }

    function resolveAnnotationTarget(item) {
      const el = findElement(item.selector);
      if (el && labelStillMatches(item, el)) {
        const point = pointFromStoredViewport(item) || viewportFor(el);
        return { el, point, visible: isElementVisible(el) && isPointInViewport(point) };
      }
      return { el: null, point: null, visible: false };
    }

    function flashTarget(target) {
      overlay.querySelectorAll(".focus-box").forEach(box => box.remove());
      if (!target || !target.point) return;
      const point = target.point;
      let rect = null;
      if (target.el) {
        rect = target.el.getBoundingClientRect();
      } else {
        const size = 72;
        rect = { left: point.x - size / 2, top: point.y - size / 2, width: size, height: size };
      }
      const box = document.createElement("div");
      box.className = "focus-box";
      box.style.left = `${Math.max(4, rect.left)}px`;
      box.style.top = `${Math.max(4, rect.top)}px`;
      box.style.width = `${Math.max(26, rect.width)}px`;
      box.style.height = `${Math.max(26, rect.height)}px`;
      overlay.appendChild(box);
      setTimeout(() => box.remove(), 2500);
    }

    function focusAnnotation(item, index) {
      let target = resolveAnnotationTarget(item);
      if (target.el) {
        const point = pointFromStoredViewport(item);
        if (point) {
          frame.contentWindow.scrollTo({
            left: Math.max(0, point.docX - frame.contentWindow.innerWidth / 2),
            top: Math.max(0, point.docY - frame.contentWindow.innerHeight / 2),
            behavior: "smooth",
          });
        } else {
          target.el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        }
      } else {
        activeId = item.id;
        renderList();
        hidePinPopover();
        toast(t("missingAnnotationTarget"));
        return;
      }
      setTimeout(() => {
        target = resolveAnnotationTarget(item);
        activeId = item.id;
        renderList();
        renderPins();
        if (target.visible && target.point) {
          renderPinPopover(item, index, target.point);
          flashTarget(target);
        }
      }, 380);
    }

    function hidePinPopover() {
      overlay.querySelectorAll(".pin-popover").forEach(popover => popover.remove());
    }

    function renderPinPopover(item, index, point) {
      hidePinPopover();
      const popover = document.createElement("div");
      popover.className = "pin-popover";
      if (item.kind === "requirement" || (item.requirement && !item.note)) {
        popover.innerHTML = `
          <div class="pin-popover-head">
            <div style="min-width:0;">
              <div class="pin-popover-title">
                <span class="index">${index + 1}</span>
                <span>${t("requirementPopoverTitle")}</span>
              </div>
              <div class="element" style="margin-top:6px;">${escapeHtml(item.elementLabel || item.selector)}</div>
            </div>
            <button class="pin-popover-close" type="button" aria-label="${t("close")}">×</button>
          </div>
          <div class="note markdown-note">${renderMarkdown(item.requirement)}</div>
          <div class="meta">${escapeHtml(item.author)} · ${new Date(item.updatedAt || item.createdAt).toLocaleString()}</div>
        `;
        overlay.appendChild(popover);
        positionPopover(popover, point);
        popover.querySelector(".pin-popover-close").addEventListener("click", (event) => {
          event.stopPropagation();
          activeId = "";
          hidePinPopover();
          renderList();
        });
        return;
      }
      const replies = item.replies || [];
      popover.innerHTML = `
        <div class="pin-popover-head">
          <div style="min-width:0;">
            <div class="pin-popover-title">
              <span class="index">${index + 1}</span>
              <span>${item.status === "resolved" ? t("resolvedComment") : t("openComment")}</span>
            </div>
            <div class="element" style="margin-top:6px;">${escapeHtml(item.elementLabel || item.selector)}</div>
          </div>
          <button class="pin-popover-close" type="button" aria-label="${t("close")}">×</button>
        </div>
        <div class="note">${escapeHtml(item.note)}</div>
        <div class="meta">${escapeHtml(item.author)} · ${new Date(item.createdAt).toLocaleString()}</div>
        <div class="pin-popover-replies">
          <div class="meta">${t("replyHistory", { count: replies.length })}</div>
          ${replies.length ? replies.map(reply => `
            <div class="reply">
              <div class="note">${escapeHtml(reply.note)}</div>
              <div class="meta">${escapeHtml(reply.author)} · ${new Date(reply.createdAt).toLocaleString()}</div>
            </div>
          `).join("") : `<div class="meta">${t("noReplies")}</div>`}
        </div>
      `;
      overlay.appendChild(popover);

      positionPopover(popover, point);
      popover.querySelector(".pin-popover-close").addEventListener("click", (event) => {
        event.stopPropagation();
        activeId = "";
        hidePinPopover();
        renderList();
      });
    }

    function positionPopover(popover, point) {
      const margin = 12;
      const gap = 14;
      const overlayRect = overlay.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      let left = point.x + gap;
      let top = point.y + gap;
      if (left + popoverRect.width > overlayRect.width - margin) {
        left = point.x - popoverRect.width - gap;
      }
      if (top + popoverRect.height > overlayRect.height - margin) {
        top = overlayRect.height - popoverRect.height - margin;
      }
      popover.style.left = `${Math.max(margin, left)}px`;
      popover.style.top = `${Math.max(margin, top)}px`;
    }

    function renderPins() {
      overlay.querySelectorAll(".pin").forEach(pin => pin.remove());
      hidePinPopover();
      const showComments = showCommentsInput.checked;
      const showRequirements = showRequirementsInput.checked;
      const rows = isRequirementEditMode()
        ? requirements.map((item) => ({ ...item, kind: "requirement" }))
        : annotationMode
          ? annotations.map((item) => ({ ...item, kind: "comment" }))
          : [
              ...(showComments ? annotations.map((item) => ({ ...item, kind: "comment" })) : []),
              ...(showRequirements ? requirements.map((item) => ({ ...item, kind: "requirement" })) : []),
            ];
      rows.forEach((item, index) => {
        const target = resolveAnnotationTarget(item);
        const point = target.point;
        if (!target.visible || !point) return;
        const pin = document.createElement("button");
        pin.className = `pin ${item.kind === "requirement" ? "requirement-pin" : ""} ${item.status === "resolved" ? "resolved" : ""}`;
        pin.textContent = index + 1;
        pin.title = item.note || item.requirement || "";
        pin.style.left = `${point.x}px`;
        pin.style.top = `${point.y}px`;
        pin.addEventListener("click", (event) => {
          event.stopPropagation();
          activeId = item.id;
          renderList();
          renderPinPopover(item, index, point);
          flashTarget(target);
        });
        overlay.appendChild(pin);
        if (item.id === activeId) {
          renderPinPopover(item, index, point);
        }
      });
    }

    function renderRequirementList() {
      document.getElementById("openCount").textContent = t("requirementsCount", { count: requirements.length });
      document.getElementById("resolvedCount").textContent = t("requirement");
      if (!requirements.length) {
        list.innerHTML = `<div class="empty">${isRequirementEditMode() && canEditRequirements ? t("noRequirementsEdit") : t("noRequirements")}</div>`;
        renderPins();
        return;
      }
      list.innerHTML = requirements.map((item, index) => `
        <article class="card ${item.id === activeId ? "active" : ""}" data-requirement-card="${item.id}">
          <div class="card-top">
            <div class="card-title-row">
              <div class="index">${index + 1}</div>
              <div style="min-width:0;">
                <div class="element">${escapeHtml(item.elementLabel || item.selector)}</div>
                <div class="meta">${escapeHtml(item.author)} · ${new Date(item.updatedAt || item.createdAt).toLocaleString()}</div>
              </div>
            </div>
            ${isRequirementEditMode() && canEditRequirements ? `<div class="card-tools">
              <button class="icon-button" type="button" title="${t("editRequirement")}" aria-label="${t("editRequirement")}" data-edit-requirement="${item.id}">✎</button>
              <button class="icon-button" type="button" title="${t("deleteRequirement")}" aria-label="${t("deleteRequirement")}" data-delete-requirement="${item.id}">×</button>
            </div>` : ""}
          </div>
          <div class="note markdown-note">${renderMarkdown(item.requirement)}</div>
        </article>
      `).join("");
      list.querySelectorAll("[data-edit-requirement]").forEach(button => {
        button.addEventListener("click", () => {
          const item = requirements.find(row => row.id === button.dataset.editRequirement);
          if (item) openRequirement(null, null, item);
        });
      });
      list.querySelectorAll("[data-delete-requirement]").forEach(button => {
        button.addEventListener("click", async () => {
          const item = requirements.find(row => row.id === button.dataset.deleteRequirement);
          if (!item) return;
          if (!confirm(t("deleteRequirementConfirm"))) return;
          await api(`/api/requirements/${item.id}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ author: author() }),
          });
        });
      });
      list.querySelectorAll("[data-requirement-card]").forEach(card => {
        card.addEventListener("click", (event) => {
          if (event.target.closest("button, input, textarea, form")) return;
          const item = requirements.find(row => row.id === card.dataset.requirementCard);
          const index = requirements.findIndex(row => row.id === card.dataset.requirementCard);
          if (item) focusAnnotation(item, index);
        });
      });
      renderPins();
    }

    function renderOverviewList() {
      document.getElementById("openCount").textContent = t("commentsCount", { count: annotations.length });
      document.getElementById("resolvedCount").textContent = t("requirementsCount", { count: requirements.length });
      const showComments = showCommentsInput.checked;
      const showRequirements = showRequirementsInput.checked;
      const rows = [
        ...(showComments ? annotations.map((item) => ({ ...item, kind: "comment" })) : []),
        ...(showRequirements ? requirements.map((item) => ({ ...item, kind: "requirement" })) : []),
      ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      if (!rows.length) {
        list.innerHTML = `<div class="empty">${showComments || showRequirements ? t("noVisibleContent") : t("hiddenContent")}</div>`;
        renderPins();
        return;
      }
      list.innerHTML = rows.map((item, index) => `
        <article class="card ${item.status === "resolved" ? "resolved" : ""} ${item.id === activeId ? "active" : ""}" data-overview-card="${item.id}" data-overview-kind="${item.kind}">
          <div class="card-top">
            <div class="card-title-row">
              <div class="index ${item.kind === "requirement" ? "requirement-index" : ""}">${index + 1}</div>
              <div style="min-width:0;">
                <div class="element">${escapeHtml(item.elementLabel || item.selector)}</div>
                <div class="meta">${item.kind === "requirement" ? t("kindRequirement") : t("kindComment")} · ${escapeHtml(item.author)} · ${new Date(item.updatedAt || item.createdAt).toLocaleString()}</div>
              </div>
            </div>
          </div>
          <div class="note ${item.kind === "requirement" ? "markdown-note" : ""}">${item.kind === "requirement" ? renderMarkdown(item.requirement) : escapeHtml(item.note)}</div>
        </article>
      `).join("");
      list.querySelectorAll("[data-overview-card]").forEach(card => {
        card.addEventListener("click", (event) => {
          if (event.target.closest("button, input, textarea, form")) return;
          const source = card.dataset.overviewKind === "requirement" ? requirements : annotations;
          const item = source.find(row => row.id === card.dataset.overviewCard);
          const pinRows = [
            ...(showCommentsInput.checked ? annotations.map((row) => ({ ...row, kind: "comment" })) : []),
            ...(showRequirementsInput.checked ? requirements.map((row) => ({ ...row, kind: "requirement" })) : []),
          ];
          const index = pinRows.findIndex(row => row.id === card.dataset.overviewCard);
          if (item) focusAnnotation({ ...item, kind: card.dataset.overviewKind }, Math.max(0, index));
        });
      });
      renderPins();
    }
    function renderList() {
      if (isRequirementEditMode()) {
        renderRequirementList();
        return;
      }
      if (!annotationMode) {
        renderOverviewList();
        return;
      }
      const open = annotations.filter(item => item.status !== "resolved").length;
      const resolved = annotations.length - open;
      document.getElementById("openCount").textContent = t("unresolvedComments", { count: open });
      document.getElementById("resolvedCount").textContent = t("resolvedComments", { count: resolved });
      if (!annotations.length) {
        list.innerHTML = `<div class="empty">${t("noComments")}</div>`;
        renderPins();
        return;
      }
      list.innerHTML = annotations.map((item, index) => `
        <article class="card ${item.status === "resolved" ? "resolved" : ""} ${item.id === activeId ? "active" : ""}" data-card="${item.id}">
          <div class="card-top">
            <div class="card-title-row">
              <div class="index">${index + 1}</div>
              <div style="min-width:0;">
                <div class="element">${escapeHtml(item.elementLabel || item.selector)}</div>
                <div class="meta">${escapeHtml(item.author)} · ${new Date(item.createdAt).toLocaleString()}</div>
              </div>
            </div>
            <div class="card-tools">
              <button class="icon-button" type="button" title="${t("deleteComment")}" aria-label="${t("deleteComment")}" data-delete="${item.id}">×</button>
            </div>
          </div>
          <div class="note">${escapeHtml(item.note)}</div>
          ${(item.replies || []).map(reply => `
            <div class="reply">
              <div class="note">${escapeHtml(reply.note)}</div>
              <div class="meta">${escapeHtml(reply.author)} · ${new Date(reply.createdAt).toLocaleString()}</div>
            </div>
          `).join("")}
          <div class="card-actions">
            <button class="status-button" type="button" data-status="${item.id}">${item.status === "resolved" ? t("reopenComment") : t("markResolved")}</button>
          </div>
          <form class="reply-form" data-reply="${item.id}">
            <input name="note" placeholder="${t("replyPlaceholder")}" />
            <button type="submit">${t("reply")}</button>
          </form>
        </article>
      `).join("");
      list.querySelectorAll("[data-status]").forEach(button => {
        button.addEventListener("click", async () => {
          const item = annotations.find(row => row.id === button.dataset.status);
          await api(`/api/annotations/${item.id}/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: item.status === "resolved" ? "open" : "resolved" }),
          });
        });
      });
      list.querySelectorAll("[data-delete]").forEach(button => {
        button.addEventListener("click", async () => {
          const item = annotations.find(row => row.id === button.dataset.delete);
          if (!item) return;
          if (!confirm(t("deleteCommentConfirm"))) return;
          await api(`/api/annotations/${item.id}`, { method: "DELETE" });
        });
      });
      list.querySelectorAll("[data-card]").forEach(card => {
        card.addEventListener("click", (event) => {
          if (event.target.closest("button, input, textarea, form")) return;
          const item = annotations.find(row => row.id === card.dataset.card);
          const index = annotations.findIndex(row => row.id === card.dataset.card);
          if (item) focusAnnotation(item, index);
        });
      });
      list.querySelectorAll("[data-reply]").forEach(form => {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const input = form.elements.note;
          try {
            await api(`/api/annotations/${form.dataset.reply}/replies`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ author: author(), note: input.value }),
            });
            input.value = "";
          } catch (error) {
            toast(error.message);
          }
        });
      });
      renderPins();
    }

    async function loadAnnotations() {
      const data = await api(`/api/docs/${encodeURIComponent(docId)}/annotations`);
      annotations = data.annotations;
      renderList();
    }

    async function loadRequirements() {
      const data = await api(`/api/docs/${encodeURIComponent(docId)}/requirements?author=${encodeURIComponent(author())}`);
      requirements = data.requirements;
      canEditRequirements = data.canEdit;
      updateToolbar();
      renderList();
    }
