    function enterCommentView() {
      annotationMode = false;
      requirementMode = "";
      updateToolbar();
      hoverBox.style.display = "none";
      activeId = "";
      renderList();
      toast(t("viewModeToast"));
    }

    commentViewBtn.addEventListener("click", enterCommentView);

    modeBtn.addEventListener("click", () => {
      if (annotationMode) {
        enterCommentView();
        return;
      }
      annotationMode = true;
      requirementMode = "";
      updateToolbar();
      hoverBox.style.display = "none";
      activeId = "";
      renderList();
      toast(t("commentModeToast"));
    });

    async function enterRequirementMode() {
      if (isRequirementEditMode()) {
        enterCommentView();
        return;
      }
      requirementMode = "edit";
      annotationMode = false;
      await loadRequirements();
      if (!canEditRequirements) {
        requirementMode = "";
        toast(t("viewOnlyRequirementToast"));
      } else {
        toast(t("requirementModeToast"));
      }
      updateToolbar();
      hoverBox.style.display = "none";
      activeId = "";
      renderList();
    }

    requirementEditBtn.addEventListener("click", enterRequirementMode);

    identityDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
    });

    identityForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const identity = identityNameInput.value.trim();
      if (!identity) {
        toast(t("enterIdentity"));
        identityNameInput.focus();
        return;
      }
      enterReview(identity);
    });

    document.getElementById("refreshBtn").addEventListener("click", async () => {
      const button = document.getElementById("refreshBtn");
      button.classList.remove("spinning");
      void button.offsetWidth;
      button.classList.add("spinning");
      button.disabled = true;
      const minSpin = new Promise(resolve => setTimeout(resolve, 620));
      try {
        await Promise.all([loadAnnotations(), loadRequirements(), minSpin]);
        toast(t("refreshed"));
      } catch (error) {
        await minSpin;
        toast(error.message);
      } finally {
        button.classList.remove("spinning");
        button.disabled = false;
      }
    });
    const exportMenuWrap = document.querySelector(".export-menu-wrap");
    const exportMenuBtn = document.getElementById("exportMenuBtn");
    exportMenuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = exportMenuWrap.classList.toggle("open");
      exportMenuBtn.setAttribute("aria-expanded", String(isOpen));
    });
    document.addEventListener("click", (event) => {
      if (!exportMenuWrap.contains(event.target)) {
        exportMenuWrap.classList.remove("open");
        exportMenuBtn.setAttribute("aria-expanded", "false");
      }
    });
    document.getElementById("exportMenu").addEventListener("click", () => {
      exportMenuWrap.classList.remove("open");
      exportMenuBtn.setAttribute("aria-expanded", "false");
    });
    document.getElementById("cancelComment").addEventListener("click", () => dialog.close());
    document.getElementById("cancelRequirement").addEventListener("click", () => requirementDialog.close());
    showCommentsInput.addEventListener("change", () => {
      activeId = "";
      renderList();
    });
    showRequirementsInput.addEventListener("change", () => {
      activeId = "";
      renderList();
    });
    requirementText.addEventListener("input", resizeRequirementText);
    document.getElementById("generateRequirement").addEventListener("click", async () => {
      try {
        if (!selectedRequirementTarget) throw new Error(t("selectAreaFirst"));
        const button = document.getElementById("generateRequirement");
        button.disabled = true;
        button.textContent = t("generating");
        const data = await api("/api/requirements/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...selectedRequirementTarget,
            docId,
            author: author(),
            draftRequirement: requirementText.value,
            language: i18n.currentLanguage(),
          }),
        });
        requirementText.value = data.requirement;
        resizeRequirementText();
      } catch (error) {
        toast(error.message);
      } finally {
        const button = document.getElementById("generateRequirement");
        button.disabled = false;
        button.textContent = t("aiComplete");
      }
    });
    commentForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api(`/api/docs/${encodeURIComponent(docId)}/annotations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...selectedTarget,
            note: commentText.value,
            author: author(),
          }),
        });
        dialog.close();
        toast(t("commentSubmitted"));
      } catch (error) {
        toast(error.message);
      }
    });

    requirementForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        if (!selectedRequirementTarget) throw new Error(t("selectAreaFirst"));
        const path = editingRequirementId
          ? `/api/requirements/${editingRequirementId}`
          : `/api/docs/${encodeURIComponent(docId)}/requirements`;
        await api(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...selectedRequirementTarget,
            requirement: requirementText.value,
            author: author(),
          }),
        });
        requirementDialog.close();
        toast(t("requirementSaved"));
      } catch (error) {
        toast(error.message);
      }
    });

    frame.addEventListener("load", installFrameHandlers);
    window.addEventListener("echo:languagechange", () => {
      document.title = t("collaboration");
      updateToolbar();
      renderList();
      if (selectedTarget) selectedElement.textContent = selectedTarget.elementLabel || selectedTarget.selector;
      if (selectedRequirementTarget) selectedRequirementElement.textContent = selectedRequirementTarget.elementLabel || selectedRequirementTarget.selector;
      const generateButton = document.getElementById("generateRequirement");
      if (!generateButton.disabled) generateButton.textContent = t("aiComplete");
    });
    document.title = t("collaboration");
    const savedIdentity = cachedAuthor();
    if (savedIdentity) {
      enterReview(savedIdentity);
    } else {
      identityDialog.showModal();
      setTimeout(() => identityNameInput.focus(), 40);
    }
