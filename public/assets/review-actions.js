    function enterCommentView() {
      annotationMode = false;
      requirementMode = "";
      updateToolbar();
      hoverBox.style.display = "none";
      activeId = "";
      renderList();
      toast("查看模式：评论和需求都可查看");
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
      toast("评论：点击页面元素添加评论");
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
        toast("当前姓名没有编辑权限，已进入查看模式");
      } else {
        toast("需求：点击页面区域添加需求说明");
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
        toast("请输入身份信息");
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
        toast("已刷新");
      } catch (error) {
        await minSpin;
        toast(error.message);
      } finally {
        button.classList.remove("spinning");
        button.disabled = false;
      }
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
        if (!selectedRequirementTarget) throw new Error("请先选择页面区域");
        const button = document.getElementById("generateRequirement");
        button.disabled = true;
        button.textContent = "补足中...";
        const data = await api("/api/requirements/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...selectedRequirementTarget,
            docId,
            author: author(),
            draftRequirement: requirementText.value,
          }),
        });
        requirementText.value = data.requirement;
        resizeRequirementText();
      } catch (error) {
        toast(error.message);
      } finally {
        const button = document.getElementById("generateRequirement");
        button.disabled = false;
        button.textContent = "AI补足";
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
        toast("批注已提交");
      } catch (error) {
        toast(error.message);
      }
    });

    requirementForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        if (!selectedRequirementTarget) throw new Error("请先选择页面区域");
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
        toast("需求已保存");
      } catch (error) {
        toast(error.message);
      }
    });

    frame.addEventListener("load", installFrameHandlers);
    const savedIdentity = cachedAuthor();
    if (savedIdentity) {
      enterReview(savedIdentity);
    } else {
      identityDialog.showModal();
      setTimeout(() => identityNameInput.focus(), 40);
    }
