/* Main controller: 8Hz polling, standby/active switching, route persistence & shortcuts */

(function () {
  "use strict";

  const appShell = document.getElementById("appRoot");
  const canvasEl = document.getElementById("mapCanvas");
  const standbyOverlay = document.getElementById("standbyOverlay");
  const standbySubtitle = document.getElementById("standbySubtitle");

  const hudStatusDot = document.getElementById("hudStatusDot");
  const hudMapName = document.getElementById("hudMapName");
  const hudMatchBadge = document.getElementById("hudMatchBadge");
  const hudZoomLabel = document.getElementById("hudZoomLabel");
  const hudWaypointWrap = document.getElementById("hudWaypointWrap");
  const hudWaypointDist = document.getElementById("hudWaypointDist");
  const btnClearWaypointHud = document.getElementById("btnClearWaypointHud");
  const btnRestoreSidebar = document.getElementById("btnRestoreSidebar");

  const hudSpeedValue = document.getElementById("hudSpeedValue");
  const hudGearBadge = document.getElementById("hudGearBadge");

  const targetRangeHud = document.getElementById("targetRangeHud");
  const targetRangeDot = document.getElementById("targetRangeDot");
  const targetRangeName = document.getElementById("targetRangeName");
  const targetRangeIndex = document.getElementById("targetRangeIndex");
  const targetRangeDist = document.getElementById("targetRangeDist");
  const targetRangeBearing = document.getElementById("targetRangeBearing");
  const btnTargetPrev = document.getElementById("btnTargetPrev");
  const btnTargetNext = document.getElementById("btnTargetNext");
  const btnTargetClear = document.getElementById("btnTargetClear");

  const drawBanner = document.getElementById("drawBanner");
  const drawBannerText = document.getElementById("drawBannerText");
  const btnFinishLineBanner = document.getElementById("btnFinishLineBanner");
  const btnExitDrawBanner = document.getElementById("btnExitDrawBanner");
  const toastContainer = document.getElementById("toastContainer");

  const pollRateBadge = document.getElementById("pollRateBadge");
  const freshnessBadge = document.getElementById("freshnessBadge");
  const btnHideSidebar = document.getElementById("btnHideSidebar");
  const btnPreviewMaps = document.getElementById("btnPreviewMaps");
  const btnFullscreen = document.getElementById("btnFullscreen");
  const btnResetView = document.getElementById("btnResetView");
  const chkFollowPlayer = document.getElementById("chkFollowPlayer");
  const chkHeadingUp = document.getElementById("chkHeadingUp");
  const headingUpHint = document.getElementById("headingUpHint");
  const btnClearWaypoint = document.getElementById("btnClearWaypoint");

  const sidebarMatchState = document.getElementById("sidebarMatchState");
  const mapMetaInfo = document.getElementById("mapMetaInfo");
  const mapSelect = document.getElementById("mapSelect");
  const btnBindCurrentMap = document.getElementById("btnBindCurrentMap");
  const btnToggleNewMap = document.getElementById("btnToggleNewMap");
  const newMapForm = document.getElementById("newMapForm");
  const inputNewMapName = document.getElementById("inputNewMapName");
  const inputNewMapId = document.getElementById("inputNewMapId");
  const btnConfirmNewMap = document.getElementById("btnConfirmNewMap");
  const btnCancelNewMap = document.getElementById("btnCancelNewMap");

  const chkShowAllies = document.getElementById("chkShowAllies");
  const chkShowEnemies = document.getElementById("chkShowEnemies");
  const chkShowCaps = document.getElementById("chkShowCaps");
  const chkShowSpawns = document.getElementById("chkShowSpawns");
  const chkShowTrail = document.getElementById("chkShowTrail");
  const chkShowFrontline = document.getElementById("chkShowFrontline");
  const strategySeg = document.getElementById("strategySeg");
  const strategyStatusBadge = document.getElementById("strategyStatusBadge");
  const strategyTipBanner = document.getElementById("strategyTipBanner");
  const chkAllyLossAlert = document.getElementById("chkAllyLossAlert");
  const chkAllyLossSound = document.getElementById("chkAllyLossSound");
  const btnTestAlertSound = document.getElementById("btnTestAlertSound");
  const rangeAllyAlertRadius = document.getElementById("rangeAllyAlertRadius");
  const lblAllyAlertRadius = document.getElementById("lblAllyAlertRadius");
  const rangeWreckDangerRadius = document.getElementById("rangeWreckDangerRadius");
  const lblWreckDangerRadius = document.getElementById("lblWreckDangerRadius");

  const btnToggleNewLayer = document.getElementById("btnToggleNewLayer");
  const newLayerForm = document.getElementById("newLayerForm");
  const inputNewLayerName = document.getElementById("inputNewLayerName");
  const inputNewLayerColor = document.getElementById("inputNewLayerColor");
  const btnConfirmNewLayer = document.getElementById("btnConfirmNewLayer");
  const btnCancelNewLayer = document.getElementById("btnCancelNewLayer");
  const vectorLayersList = document.getElementById("vectorLayersList");
  const pngLayersList = document.getElementById("pngLayersList");

  const btnToggleDrawMode = document.getElementById("btnToggleDrawMode");
  const editorPanel = document.getElementById("editorPanel");
  const editLayerSelect = document.getElementById("editLayerSelect");
  const editLabelInput = document.getElementById("editLabelInput");
  const chkEditDashed = document.getElementById("chkEditDashed");
  const btnEditorUndo = document.getElementById("btnEditorUndo");
  const btnEditorFinishLine = document.getElementById("btnEditorFinishLine");
  const btnEditorClearLayer = document.getElementById("btnEditorClearLayer");
  const layerElementsList = document.getElementById("layerElementsList");
  const btnSaveRoutes = document.getElementById("btnSaveRoutes");

  const btnOneClickWin = document.getElementById("btnOneClickWin");
  const winConfirmModal = document.getElementById("winConfirmModal");
  const btnCloseWinConfirm = document.getElementById("btnCloseWinConfirm");
  const btnCancelWinConfirm = document.getElementById("btnCancelWinConfirm");
  const btnAcceptWinConfirm = document.getElementById("btnAcceptWinConfirm");
  const winResultModal = document.getElementById("winResultModal");
  const btnCloseWinResult = document.getElementById("btnCloseWinResult");
  const btnCloseWinResultFooter = document.getElementById("btnCloseWinResultFooter");

  const btnAboutModal = document.getElementById("btnAboutModal");
  const aboutModal = document.getElementById("aboutModal");
  const btnCloseAboutModal = document.getElementById("btnCloseAboutModal");
  const btnCloseAboutFooter = document.getElementById("btnCloseAboutFooter");

  const btnCopyShareCode = document.getElementById("btnCopyShareCode");
  const btnImportShareCode = document.getElementById("btnImportShareCode");
  const shareModal = document.getElementById("shareModal");
  const shareModalTitle = document.getElementById("shareModalTitle");
  const shareModalDesc = document.getElementById("shareModalDesc");
  const shareCodeInput = document.getElementById("shareCodeInput");
  const shareModalError = document.getElementById("shareModalError");
  const btnCloseShareModal = document.getElementById("btnCloseShareModal");
  const btnCancelShareModal = document.getElementById("btnCancelShareModal");
  const btnConfirmShareImport = document.getElementById("btnConfirmShareImport");

  const state = {
    pollMs: 125,
    defaultsApplied: false,
    routesConfig: { maps: {} },
    availableOverlays: [],
    latestLive: null,
    lastGeneration: null,
    lastSignature: "",
    lastMatchSeq: null,
    lastControlSeq: null,
    lastLocalTargetAction: { action: "", ts: 0 },
    activeMapId: "",
    manualMapOverride: false,
    previewOffline: false,
    unsavedChanges: false,
    wasNarrow: null,
    sidebarAutoHidden: false,
  };

  let headingUpSuspended = false;

  const ALLY_ALERT_STORAGE_KEY = "wt_tactical_ally_alert_v1";
  const ALLY_ALERT_SOUND_COOLDOWN_MS = 2500;
  let audioCtx = null;
  let lastAllyAlertSoundAt = 0;
  let lastAllyAlertToastAt = 0;

  function loadAllyAlertPrefs() {
    const defaults = { enabled: true, sound: true, radiusM: 100 };
    try {
      const raw = localStorage.getItem(ALLY_ALERT_STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      return {
        enabled: parsed.enabled !== false,
        sound: parsed.sound !== false,
        radiusM: Math.min(300, Math.max(40, Number(parsed.radiusM) || 100)),
      };
    } catch (_) {
      return defaults;
    }
  }

  function saveAllyAlertPrefs() {
    try {
      localStorage.setItem(
        ALLY_ALERT_STORAGE_KEY,
        JSON.stringify({
          enabled: chkAllyLossAlert.checked,
          sound: chkAllyLossSound.checked,
          radiusM: Number(rangeAllyAlertRadius.value) || 100,
        })
      );
    } catch (_) {
      /* ignore storage errors */
    }
  }

  function ensureAudioContext() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) {
      audioCtx = new Ctor();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playAllyAlertSound(force) {
    const now = Date.now();
    if (!force && now - lastAllyAlertSoundAt < ALLY_ALERT_SOUND_COOLDOWN_MS) {
      return false;
    }
    try {
      const ctx = ensureAudioContext();
      if (!ctx) return false;
      lastAllyAlertSoundAt = now;

      const t0 = ctx.currentTime;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-14, t0);
      compressor.knee.setValueAtTime(6, t0);
      compressor.ratio.setValueAtTime(10, t0);
      compressor.attack.setValueAtTime(0.002, t0);
      compressor.release.setValueAtTime(0.08, t0);

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.72, t0);
      compressor.connect(masterGain);
      masterGain.connect(ctx.destination);

      const schedulePulse = (freq, startOffset, duration, sqPeak, sawPeak) => {
        const startAt = t0 + startOffset;
        const layers = [
          { type: "square", freq, peak: sqPeak },
          { type: "sawtooth", freq: freq + 14, peak: sawPeak },
        ];
        for (const layer of layers) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = layer.type;
          osc.frequency.setValueAtTime(layer.freq, startAt);
          gain.gain.setValueAtTime(0.0001, startAt);
          gain.gain.exponentialRampToValueAtTime(layer.peak, startAt + 0.003);
          gain.gain.setValueAtTime(layer.peak, startAt + Math.max(0.008, duration - 0.01));
          gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
          osc.connect(gain);
          gain.connect(compressor);
          osc.start(startAt);
          osc.stop(startAt + duration + 0.012);
        }
      };

      // RWR radar-lock style urgent 4-pulse burst ("嘀-嘀-嘀-嘀！") ~0.34s total
      schedulePulse(2450, 0.0, 0.052, 0.55, 0.28);
      schedulePulse(2450, 0.092, 0.052, 0.55, 0.28);
      schedulePulse(2650, 0.184, 0.052, 0.6, 0.3);
      schedulePulse(2650, 0.276, 0.064, 0.6, 0.3);
      return true;
    } catch (_) {
      return false;
    }
  }

  const unlockAudioOnce = () => {
    ensureAudioContext();
  };
  window.addEventListener("pointerdown", unlockAudioOnce, { once: true, passive: true });
  window.addEventListener("keydown", unlockAudioOnce, { once: true, passive: true });

  function showToast(msg, isError) {
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " error" : "");
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 3000);
  }

  function getActiveMapEntry() {
    if (!state.activeMapId || !state.routesConfig.maps) return null;
    return state.routesConfig.maps[state.activeMapId] || null;
  }

  const tacticalCanvas = new TacticalCanvas(canvasEl, {
    onZoomChange(pct) {
      hudZoomLabel.textContent = pct + "%";
    },
    onFollowBreak() {
      chkFollowPlayer.checked = false;
      if (chkHeadingUp.checked) {
        chkHeadingUp.checked = false;
        headingUpSuspended = false;
        tacticalCanvas.setHeadingUp(false);
        syncHeadingUpHint();
      }
    },
    onWaypointChange(wp, distMeters) {
      if (!wp) {
        hudWaypointWrap.classList.add("hidden");
        btnClearWaypoint.disabled = true;
      } else {
        hudWaypointWrap.classList.remove("hidden");
        hudWaypointDist.textContent = distMeters !== null ? `路标 ${distMeters}m` : "路标已标记";
        btnClearWaypoint.disabled = false;
      }
    },
    onTargetChange(info) {
      if (!info || !info.target) {
        targetRangeHud.classList.add("hidden");
        return;
      }
      targetRangeHud.classList.remove("hidden");
      targetRangeDot.style.background = info.target.color || "#38bdf8";
      targetRangeName.textContent = info.target.label || "目标";
      targetRangeIndex.textContent = `${info.index}/${info.total}`;
      targetRangeDist.textContent = info.distM !== null ? `${info.distM}m` : "--m";
      targetRangeBearing.textContent = info.bearing ? info.bearing.text : "等待玩家位置";
    },
    onEditorClick(nx, ny) {
      routeEditor.handleClick(nx, ny);
    },
    onEditorMove(nx, ny) {
      routeEditor.handleMove(nx, ny);
    },
    onEditorFinish() {
      routeEditor.finishLine();
    },
    onNearbyAllyLost(evt) {
      if (chkAllyLossSound.checked) {
        playAllyAlertSound(false);
      }
      const now = Date.now();
      if (now - lastAllyAlertToastAt >= ALLY_ALERT_SOUND_COOLDOWN_MS && evt && evt.nearest) {
        lastAllyAlertToastAt = now;
        const n = evt.nearest;
        const dir = n.bearingText ? ` (${n.bearingText})` : "";
        const extra = evt.count > 1 ? ` 等${evt.count}处` : "";
        showToast(`近距友军消失：${n.distM}m${dir}${extra}`, true);
      }
    },
    onRecommendationChange(tip, tier) {
      if (!tier || tier === "off" || !tip) {
        strategyTipBanner.classList.add("hidden");
        strategyTipBanner.textContent = "";
      } else {
        strategyTipBanner.textContent = tip;
        strategyTipBanner.classList.remove("hidden");
      }
    },
    onSelfWreck(wk) {
      if (wk) {
        showToast(`已标记己方残骸 #${wk.seq}${wk.model ? " · " + wk.model : ""}`, true);
      }
    },
  });

  const routeEditor = new RouteEditor({
    onChange() {
      state.unsavedChanges = true;
      syncCanvasLayers();
      renderLayerLists();
      renderElementsList();
    },
    onDraftChange(draft) {
      tacticalCanvas.setEditorDraft(draft);
      updateDrawBanner();
    },
    onToolChange(tool) {
      tacticalCanvas.setDrawMode(tool);
      document.querySelectorAll(".tool-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tool === tool);
      });
      updateDrawBanner();
    },
    onToast(msg) {
      showToast(msg, false);
    },
  });

  function updateDrawBanner() {
    if (!routeEditor.enabled) {
      drawBanner.classList.add("hidden");
      return;
    }
    drawBanner.classList.remove("hidden");
    const tool = routeEditor.tool;
    const hasDraftLine =
      routeEditor.draft &&
      (routeEditor.draft.kind === "polyline" || routeEditor.draft.kind === "curve") &&
      routeEditor.draft.points.length >= 2;
    btnFinishLineBanner.classList.toggle("hidden", !hasDraftLine);

    if (tool === "browse") {
      drawBannerText.textContent = "浏览模式：左键拖拽平移、滚轮缩放，点击右侧工具开始绘制";
    } else if (tool === "polyline") {
      drawBannerText.textContent = "画折线：左键点击地图落点画线，右键 / Enter / 双击结束当前线段（按住空格或中键拖动平移）";
    } else if (tool === "curve") {
      drawBannerText.textContent = "画曲线：左键连续添加控制点自动平滑插值，右键 / Enter / 双击结束（按住空格或中键拖动平移）";
    } else if (tool === "marker") {
      drawBannerText.textContent = "插卡点：左键点击地图放置架枪/卡点标记（按住空格或中键拖动平移）";
    } else if (tool === "zone") {
      drawBannerText.textContent = routeEditor.draft
        ? "交火区：移动鼠标确定范围，再次左键点击完成圆圈（按住空格或中键拖动平移）"
        : "交火区：左键点击确定圆心位置（按住空格或中键拖动平移）";
    }
  }

  function syncCanvasLayers() {
    const entry = getActiveMapEntry();
    if (!entry) {
      tacticalCanvas.setLayers([], []);
      routeEditor.setLayers([]);
      return;
    }
    if (!Array.isArray(entry.vector_layers)) entry.vector_layers = [];
    if (!Array.isArray(entry.png_layers)) entry.png_layers = [];
    tacticalCanvas.setLayers(entry.vector_layers, entry.png_layers);
    routeEditor.setLayers(entry.vector_layers);
  }

  function populateMapSelect() {
    const maps = state.routesConfig.maps || {};
    const entries = Object.entries(maps);
    mapSelect.innerHTML = "";

    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = "-- 未选择 / 未识别地图 --";
    mapSelect.appendChild(emptyOpt);

    entries.sort((a, b) => String(a[1].name || a[0]).localeCompare(String(b[1].name || b[0]), "zh-CN"));
    for (const [mapId, entry] of entries) {
      const opt = document.createElement("option");
      opt.value = mapId;
      opt.textContent = entry.name || mapId;
      mapSelect.appendChild(opt);
    }
    mapSelect.value = state.activeMapId || "";
  }

  function renderLayerLists() {
    const entry = getActiveMapEntry();
    vectorLayersList.innerHTML = "";
    pngLayersList.innerHTML = "";
    editLayerSelect.innerHTML = "";

    if (!entry) {
      vectorLayersList.innerHTML = '<div class="empty-hint">请先识别或选择一个预设地图</div>';
      pngLayersList.innerHTML = '<div class="empty-hint">暂无关联地图</div>';
      renderElementsList();
      return;
    }

    const vLayers = entry.vector_layers || [];
    if (vLayers.length === 0) {
      vectorLayersList.innerHTML = '<div class="empty-hint">当前地图暂无矢量图层，可点击“+ 新建图层”</div>';
    } else {
      for (const layer of vLayers) {
        const opt = document.createElement("option");
        opt.value = layer.id;
        opt.textContent = layer.name || layer.id;
        editLayerSelect.appendChild(opt);

        const row = document.createElement("div");
        row.className = "layer-item" + (routeEditor.targetLayerId === layer.id ? " editing-target" : "");

        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = !!layer.visible;
        chk.title = "显示/隐藏图层";
        chk.addEventListener("change", () => {
          layer.visible = chk.checked;
          syncCanvasLayers();
        });

        const dot = document.createElement("span");
        dot.className = "layer-color-dot";
        dot.style.background = layer.color || "#00e5ff";

        const nameSpan = document.createElement("span");
        nameSpan.className = "layer-name";
        nameSpan.textContent = layer.name || layer.id;
        nameSpan.title = layer.name || layer.id;

        const countSpan = document.createElement("span");
        countSpan.className = "layer-count";
        countSpan.textContent = String((layer.elements || []).length);

        const editBtn = document.createElement("button");
        editBtn.className = "btn-mini";
        editBtn.textContent = "选中";
        editBtn.title = "设为当前绘制目标图层";
        editBtn.addEventListener("click", () => {
          routeEditor.setTargetLayerId(layer.id);
          editLayerSelect.value = layer.id;
          renderLayerLists();
          renderElementsList();
        });

        const delBtn = document.createElement("button");
        delBtn.className = "btn-mini";
        delBtn.textContent = "×";
        delBtn.title = "删除该图层";
        delBtn.addEventListener("click", () => {
          const idx = entry.vector_layers.indexOf(layer);
          if (idx >= 0) {
            entry.vector_layers.splice(idx, 1);
            state.unsavedChanges = true;
            syncCanvasLayers();
            renderLayerLists();
          }
        });

        row.append(chk, dot, nameSpan, countSpan, editBtn, delBtn);
        vectorLayersList.appendChild(row);
      }
      editLayerSelect.value = routeEditor.targetLayerId || (vLayers[0] ? vLayers[0].id : "");
    }

    // Merge configured png_layers with disk-discovered overlays/*.png
    const configuredPngs = Array.isArray(entry.png_layers) ? entry.png_layers : [];
    const seenFiles = new Set(configuredPngs.map((p) => p.file));
    const displayPngs = [...configuredPngs];
    for (const file of state.availableOverlays) {
      if (!seenFiles.has(file)) {
        displayPngs.push({
          id: file,
          name: file.replace(/^overlays\//, ""),
          file,
          opacity: 0.75,
          visible: false,
          _unregistered: true,
        });
      }
    }

    if (displayPngs.length === 0) {
      pngLayersList.innerHTML = '<div class="empty-hint">将透明 PNG 放入 routes/overlays/ 即可在此加载</div>';
    } else {
      for (const pLayer of displayPngs) {
        const card = document.createElement("div");
        card.className = "png-layer-item";

        const top = document.createElement("div");
        top.className = "png-layer-top";

        const lbl = document.createElement("label");
        lbl.className = "switch-label";
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = !!pLayer.visible;

        const ensureRegistered = () => {
          if (pLayer._unregistered) {
            delete pLayer._unregistered;
            entry.png_layers.push(pLayer);
          }
        };

        chk.addEventListener("change", () => {
          ensureRegistered();
          pLayer.visible = chk.checked;
          state.unsavedChanges = true;
          syncCanvasLayers();
        });

        const text = document.createElement("span");
        text.textContent = pLayer.name || pLayer.file;
        lbl.append(chk, text);
        top.appendChild(lbl);

        const opRow = document.createElement("div");
        opRow.className = "png-opacity-row";
        const opLbl = document.createElement("span");
        const opVal = Math.round((pLayer.opacity ?? 0.75) * 100);
        opLbl.textContent = `透明度 ${opVal}%`;
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "10";
        slider.max = "100";
        slider.value = String(opVal);
        slider.addEventListener("input", () => {
          ensureRegistered();
          const v = Number(slider.value) / 100;
          pLayer.opacity = v;
          opLbl.textContent = `透明度 ${slider.value}%`;
          state.unsavedChanges = true;
          syncCanvasLayers();
        });

        opRow.append(opLbl, slider);
        card.append(top, opRow);
        pngLayersList.appendChild(card);
      }
    }

    renderElementsList();
  }

  function renderElementsList() {
    layerElementsList.innerHTML = "";
    const entry = getActiveMapEntry();
    if (!entry) return;
    const layer = (entry.vector_layers || []).find((l) => l.id === routeEditor.targetLayerId);
    if (!layer || !Array.isArray(layer.elements) || layer.elements.length === 0) {
      layerElementsList.innerHTML = '<div class="empty-hint">该图层暂无绘制元素</div>';
      return;
    }

    const kindNames = { polyline: "折线", curve: "曲线", marker: "卡点", zone: "交火区" };
    layer.elements.forEach((el, idx) => {
      const row = document.createElement("div");
      row.className = "element-row";
      const lbl = document.createElement("span");
      lbl.className = "element-row-label";
      const kindTxt = kindNames[el.kind] || el.kind;
      lbl.textContent = `[${kindTxt}] ${el.label || "未命名"}`;

      const delBtn = document.createElement("button");
      delBtn.className = "btn-mini";
      delBtn.textContent = "删";
      delBtn.addEventListener("click", () => {
        routeEditor.deleteElement(idx);
      });

      row.append(lbl, delBtn);
      layerElementsList.appendChild(row);
    });
  }

  async function loadRoutes() {
    const resp = await fetch("/api/routes", { cache: "no-store" });
    if (!resp.ok) throw new Error("无法加载走线配置");
    const data = await resp.json();
    state.routesConfig = data.config || { maps: {} };
    state.availableOverlays = data.available_overlays || [];
    populateMapSelect();
    syncCanvasLayers();
    renderLayerLists();
  }

  async function saveCurrentMapRoutes() {
    const entry = getActiveMapEntry();
    if (!state.activeMapId || !entry) {
      showToast("请先选择或绑定一个地图后再保存", true);
      return;
    }
    routeEditor.finishLine();
    try {
      const resp = await fetch("/api/routes/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          map_id: state.activeMapId,
          map_name: entry.name,
          vector_layers: entry.vector_layers || [],
          png_layers: entry.png_layers || [],
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        showToast(data.error || "保存失败", true);
        return;
      }
      state.unsavedChanges = false;
      showToast(`已保存「${entry.name}」的战术走线到本地`);
    } catch (err) {
      showToast(err?.message || "保存请求失败，请检查本地服务连接", true);
    }
  }

  async function bindSignatureToMap(mapId) {
    const live = state.latestLive;
    if (!live || live.status !== "active" || !live.map_signature) {
      showToast("当前未处于对局中，无法采集底图指纹", true);
      return;
    }
    try {
      const resp = await fetch("/api/maps/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          map_id: mapId,
          signature: live.map_signature,
          physical_hint: live.physical_hint || {},
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        showToast(data.error || "绑定失败", true);
        return;
      }
      state.routesConfig = data.config || state.routesConfig;
      state.availableOverlays = data.available_overlays || state.availableOverlays;
      state.activeMapId = mapId;
      state.manualMapOverride = false;
      populateMapSelect();
      syncCanvasLayers();
      renderLayerLists();
      showToast("已绑定当前地图指纹，下次进图将自动秒切");
    } catch (err) {
      showToast(err?.message || "绑定请求失败，请检查本地服务连接", true);
    }
  }

  /**
   * map_obj 数据陈旧时，在 "8 Hz" 徽章旁显示低调的「延迟」提示；恢复即隐藏。
   */
  function syncFreshnessBadge(live) {
    const mapObj = live && live.freshness ? live.freshness.map_obj : null;
    if (!mapObj || mapObj.stale !== true) {
      freshnessBadge.classList.add("hidden");
      return;
    }
    const ageSec =
      typeof mapObj.age_ms === "number" ? Math.max(1, Math.round(mapObj.age_ms / 1000)) : null;
    freshnessBadge.title = ageSec !== null ? `8111 地图对象数据已 ${ageSec}s 未更新` : "8111 地图对象数据延迟";
    freshnessBadge.classList.remove("hidden");
  }

  function executeTargetAction(action, isLocal) {
    if (action === "next") {
      tacticalCanvas.cycleTarget(1);
    } else if (action === "prev") {
      tacticalCanvas.cycleTarget(-1);
    } else if (action === "clear") {
      tacticalCanvas.clearTargetLock();
    } else {
      return;
    }
    if (isLocal) {
      state.lastLocalTargetAction = { action, ts: Date.now() };
    }
  }

  function consumeTargetControl(live) {
    const tc = live && live.target_control;
    if (!tc || typeof tc.seq !== "number") return;
    if (state.lastControlSeq === null) {
      state.lastControlSeq = tc.seq;
      return;
    }
    if (tc.seq <= state.lastControlSeq) return;
    const actions = Array.isArray(tc.actions) ? tc.actions : [];
    const now = Date.now();
    for (const item of actions) {
      if (!item || typeof item.seq !== "number" || item.seq <= state.lastControlSeq) continue;
      if (
        typeof document.hasFocus === "function" &&
        document.hasFocus() &&
        state.lastLocalTargetAction.action === item.action &&
        now - state.lastLocalTargetAction.ts < 400
      ) {
        continue;
      }
      executeTargetAction(item.action, false);
    }
    state.lastControlSeq = tc.seq;
  }

  function updateUIWithState(live) {
    state.latestLive = live;
    consumeTargetControl(live);

    if (!state.defaultsApplied && live.ui_defaults) {
      state.defaultsApplied = true;
      const d = live.ui_defaults;
      state.pollMs = Math.max(80, Math.round(1000 / (Number(d.poll_hz) || 8)));
      pollRateBadge.textContent = `${d.poll_hz || 8} Hz`;
      chkShowAllies.checked = d.show_allies !== false;
      chkShowEnemies.checked = d.show_enemies !== false;
      chkShowCaps.checked = d.show_caps !== false;
      chkShowSpawns.checked = d.show_spawns !== false;
      tacticalCanvas.showAllies = chkShowAllies.checked;
      tacticalCanvas.showEnemies = chkShowEnemies.checked;
      tacticalCanvas.showCaps = chkShowCaps.checked;
      tacticalCanvas.showSpawns = chkShowSpawns.checked;
      tacticalCanvas.setTrailMaxLength(d.player_trail_length || 45);
    }

    const isActive = live.status === "active";

    if (!isActive) {
      freshnessBadge.classList.add("hidden");
      hudStatusDot.className = "status-dot standby";
      hudMatchBadge.className = "badge badge-amber";
      hudMatchBadge.textContent = state.previewOffline ? "离线预览" : "待机";
      sidebarMatchState.className = "badge badge-amber";
      sidebarMatchState.textContent = "未在对局";
      btnBindCurrentMap.disabled = true;
      mapMetaInfo.textContent = "底图指纹: -- | 物理尺寸: --";
      hudSpeedValue.textContent = "--";
      hudGearBadge.classList.add("hidden");

      if (!state.previewOffline) {
        standbyOverlay.classList.remove("hidden");
        hudMapName.textContent = "等待对局...";
        standbySubtitle.innerHTML = "正在监听 <code>http://localhost:8111/</code>，进入战局后将自动识别地图并切换战术走线。";
      } else {
        standbyOverlay.classList.add("hidden");
        const entry = getActiveMapEntry();
        hudMapName.textContent = entry ? entry.name : "离线走线预览";
      }

      if (state.lastGeneration !== null || state.lastSignature) {
        state.lastGeneration = null;
        state.lastSignature = "";
        tacticalCanvas.clearMapImage();
        tacticalCanvas.clearPlayerTrail();
        tacticalCanvas.clearTargetLock();
      }
      tacticalCanvas.updateLiveState({ objects: [], map_info: null });
      return;
    }

    // Active match!
    state.previewOffline = false;
    standbyOverlay.classList.add("hidden");
    hudStatusDot.className = live.mock_mode ? "status-dot mock" : "status-dot active";

    syncFreshnessBadge(live);

    // 换局检测：match.seq 变化即新对局，清掉上一局残留的尾迹与临时战术路标
    const matchSeq = live.match && typeof live.match.seq === "number" ? live.match.seq : null;
    const matchSeqChanged = matchSeq !== null && matchSeq !== state.lastMatchSeq;
    if (matchSeqChanged) {
      state.lastMatchSeq = matchSeq;
      tacticalCanvas.clearPlayerTrail();
      tacticalCanvas.clearWaypoint();
      tacticalCanvas.clearTargetLock();
    }

    const genChanged = live.map_generation !== state.lastGeneration;
    const sigChanged = Boolean(live.map_signature) && live.map_signature !== state.lastSignature;

    if (genChanged || matchSeqChanged) {
      state.manualMapOverride = false;
      if (!live.matched_map_id) {
        state.activeMapId = "";
        mapSelect.value = "";
        syncCanvasLayers();
        renderLayerLists();
      }
    }

    // Reload live 8111 map image whenever generation, match, or image signature changes
    if (genChanged || sigChanged || matchSeqChanged) {
      state.lastGeneration = live.map_generation;
      state.lastSignature = live.map_signature || "";
      tacticalCanvas.clearPlayerTrail();
      tacticalCanvas.clearWaypoint();
      tacticalCanvas.clearTargetLock();
      if (!state.manualMapOverride) {
        loadLiveMapImage(live);
      }
    }

    // Auto-select matched map unless user manually picked another map for this match
    if (!state.manualMapOverride) {
      const targetId = live.matched_map_id || "";
      if (targetId && state.routesConfig.maps?.[targetId] && state.activeMapId !== targetId) {
        state.activeMapId = targetId;
        mapSelect.value = targetId;
        syncCanvasLayers();
        renderLayerLists();
      } else if (!targetId && !state.activeMapId) {
        // Unrecognized map with no selection
        syncCanvasLayers();
      }
    }

    const entry = getActiveMapEntry();
    hudMapName.textContent = entry ? entry.name : "未识别地图（可在右侧绑定）";

    if (live.mock_mode) {
      hudMatchBadge.className = "badge badge-cyan";
      hudMatchBadge.textContent = "演习模拟";
    } else if (state.manualMapOverride) {
      hudMatchBadge.className = "badge badge-cyan";
      hudMatchBadge.textContent = "手动切换";
    } else if (live.match_type === "exact") {
      hudMatchBadge.className = "badge badge-green";
      hudMatchBadge.textContent = "自动识别";
    } else if (live.match_type === "physical") {
      hudMatchBadge.className = "badge badge-cyan";
      hudMatchBadge.textContent = "尺寸匹配";
    } else {
      hudMatchBadge.className = "badge badge-amber";
      hudMatchBadge.textContent = "未绑定";
    }

    sidebarMatchState.className = hudMatchBadge.className;
    sidebarMatchState.textContent = hudMatchBadge.textContent;
    btnBindCurrentMap.disabled = !live.map_signature;

    const hint = live.physical_hint || {};
    const sizeText = hint.width_m ? `${Math.round(hint.width_m)}×${Math.round(hint.height_m)}m` : "--";
    const sigText = live.map_signature ? `#${live.map_signature.slice(0, 10)}` : "--";
    mapMetaInfo.textContent = `底图指纹: ${sigText} | 尺寸: ${sizeText}`;

    // Telemetry speed & gear
    const tel = live.telemetry || {};
    if (typeof tel.speed_kmh === "number" && !Number.isNaN(tel.speed_kmh)) {
      hudSpeedValue.textContent = String(tel.speed_kmh);
    } else {
      hudSpeedValue.textContent = "--";
    }
    if (tel.gear !== null && tel.gear !== undefined && tel.gear !== "") {
      hudGearBadge.textContent = `G${tel.gear}`;
      hudGearBadge.classList.remove("hidden");
    } else {
      hudGearBadge.classList.add("hidden");
    }

    tacticalCanvas.updateLiveState(live);
  }

  async function pollLoop() {
    try {
      const resp = await fetch("/api/state", { cache: "no-store" });
      if (resp.ok) {
        const live = await resp.json();
        updateUIWithState(live);
      } else {
        hudStatusDot.className = "status-dot offline";
        freshnessBadge.classList.add("hidden");
      }
    } catch (_) {
      hudStatusDot.className = "status-dot offline";
      freshnessBadge.classList.add("hidden");
      standbySubtitle.textContent = "与本地后端服务 (127.0.0.1:8123) 断开连接，正在重连...";
    } finally {
      setTimeout(pollLoop, state.pollMs);
    }
  }

  function toggleSidebarHidden() {
    const hidden = appShell.classList.toggle("sidebar-hidden");
    btnRestoreSidebar.classList.toggle("hidden", !hidden);
    state.sidebarAutoHidden = false;
    setTimeout(() => tacticalCanvas.resize(), 200);
  }

  // Narrow screens (phone portrait/landscape, small windows) start with the
  // sidebar collapsed so the map owns the full viewport; the floating pill reopens it.
  const MOBILE_MAX_WIDTH = 900;

  function applyResponsiveLayout() {
    const narrow = window.innerWidth <= MOBILE_MAX_WIDTH;
    const wasNarrow = state.wasNarrow;
    state.wasNarrow = narrow;
    const hidden = appShell.classList.contains("sidebar-hidden");

    if (narrow && wasNarrow !== true) {
      if (!hidden) {
        appShell.classList.add("sidebar-hidden");
        btnRestoreSidebar.classList.remove("hidden");
        state.sidebarAutoHidden = true;
        setTimeout(() => tacticalCanvas.resize(), 200);
      }
      return;
    }

    if (!narrow && wasNarrow === true && hidden && state.sidebarAutoHidden) {
      appShell.classList.remove("sidebar-hidden");
      btnRestoreSidebar.classList.add("hidden");
      state.sidebarAutoHidden = false;
      setTimeout(() => tacticalCanvas.resize(), 200);
    }
  }

  let layoutTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(applyResponsiveLayout, 120);
  });
  applyResponsiveLayout();

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  // ---- Heading-up (车头朝上) helpers ----
  function syncHeadingUpHint() {
    const on = chkHeadingUp.checked && !headingUpSuspended;
    headingUpHint.textContent = on ? "车头 ↑" : "正北 ↑";
    headingUpHint.className = on ? "badge badge-cyan" : "badge badge-muted";
  }

  function applyHeadingUp() {
    tacticalCanvas.setHeadingUp(chkHeadingUp.checked && !headingUpSuspended);
    syncHeadingUpHint();
  }

  function suspendHeadingUpForEditor() {
    if (!chkHeadingUp.checked) return;
    headingUpSuspended = true;
    tacticalCanvas.setHeadingUp(false, true); // snap north: drawing must stay pixel-accurate
    syncHeadingUpHint();
  }

  function resumeHeadingUpAfterEditor() {
    if (!headingUpSuspended) return;
    headingUpSuspended = false;
    applyHeadingUp();
  }

  // Event bindings
  btnHideSidebar.addEventListener("click", toggleSidebarHidden);
  btnRestoreSidebar.addEventListener("click", toggleSidebarHidden);
  btnFullscreen.addEventListener("click", toggleFullscreen);
  btnResetView.addEventListener("click", () => tacticalCanvas.resetView());

  chkFollowPlayer.addEventListener("change", () => {
    tacticalCanvas.setFollowPlayer(chkFollowPlayer.checked);
    if (!chkFollowPlayer.checked && chkHeadingUp.checked) {
      chkHeadingUp.checked = false;
      headingUpSuspended = false;
      tacticalCanvas.setHeadingUp(false);
      syncHeadingUpHint();
      showToast("车头朝上需要跟随玩家，已自动关闭");
    }
  });

  chkHeadingUp.addEventListener("change", () => {
    if (chkHeadingUp.checked) {
      if (!chkFollowPlayer.checked) {
        chkFollowPlayer.checked = true;
        tacticalCanvas.setFollowPlayer(true);
      }
      // Entering the editor while heading-up stays suspended until drawing ends.
      if (routeEditor.enabled) headingUpSuspended = true;
    } else {
      headingUpSuspended = false;
    }
    applyHeadingUp();
  });

  btnClearWaypoint.addEventListener("click", () => tacticalCanvas.clearWaypoint());
  btnClearWaypointHud.addEventListener("click", () => tacticalCanvas.clearWaypoint());
  btnTargetPrev.addEventListener("click", () => tacticalCanvas.cycleTarget(-1));
  btnTargetNext.addEventListener("click", () => tacticalCanvas.cycleTarget(1));
  btnTargetClear.addEventListener("click", () => tacticalCanvas.clearTargetLock());

  function buildLiveMapUrl(live) {
    const gen = encodeURIComponent(live?.map_generation ?? 0);
    const sig = encodeURIComponent(live?.map_signature || "");
    return `/api/map.img?gen=${gen}&sig=${sig}&t=${Date.now()}`;
  }

  function loadLiveMapImage(live) {
    tacticalCanvas.loadMapImage(buildLiveMapUrl(live));
  }

  function loadPresetMapImage(mapId) {
    const live = state.latestLive;
    const isLiveActive = live && live.status === "active";
    if (!mapId) {
      if (isLiveActive) {
        loadLiveMapImage(live);
      } else {
        tacticalCanvas.clearMapImage();
      }
      return;
    }
    if (isLiveActive && mapId === live.matched_map_id) {
      loadLiveMapImage(live);
      return;
    }
    const presetUrl = `/api/preset_map_img?map_id=${encodeURIComponent(mapId)}&t=${Date.now()}`;
    const fallbackUrl = isLiveActive ? buildLiveMapUrl(live) : null;
    tacticalCanvas.loadMapImage(presetUrl, fallbackUrl);
  }

  btnPreviewMaps.addEventListener("click", () => {
    state.previewOffline = true;
    if (!state.activeMapId) {
      const firstId = Object.keys(state.routesConfig.maps || {})[0] || "";
      state.activeMapId = firstId;
      mapSelect.value = firstId;
      syncCanvasLayers();
      renderLayerLists();
    }
    standbyOverlay.classList.add("hidden");
    const entry = getActiveMapEntry();
    hudMapName.textContent = entry ? entry.name : "离线走线预览";
    hudMatchBadge.className = "badge badge-amber";
    hudMatchBadge.textContent = "离线预览";
    tacticalCanvas.armAutoFit();
    loadPresetMapImage(state.activeMapId);
  });

  mapSelect.addEventListener("change", () => {
    state.activeMapId = mapSelect.value;
    state.manualMapOverride = Boolean(mapSelect.value);
    routeEditor.cancelDraft();
    syncCanvasLayers();
    renderLayerLists();
    tacticalCanvas.armAutoFit();
    loadPresetMapImage(state.activeMapId);
  });

  btnBindCurrentMap.addEventListener("click", () => {
    if (!state.activeMapId) {
      showToast("请先从下拉框选择要绑定的地图（或新建地图）", true);
      return;
    }
    bindSignatureToMap(state.activeMapId);
  });

  btnToggleNewMap.addEventListener("click", () => {
    newMapForm.classList.toggle("hidden");
    if (!newMapForm.classList.contains("hidden")) {
      inputNewMapName.focus();
    }
  });

  btnCancelNewMap.addEventListener("click", () => {
    newMapForm.classList.add("hidden");
  });

  btnConfirmNewMap.addEventListener("click", async () => {
    const name = inputNewMapName.value.trim();
    if (!name) {
      showToast("请输入地图名称", true);
      return;
    }
    let mapId = inputNewMapId.value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
    if (!mapId) {
      mapId = "map_" + Date.now();
    }
    const live = state.latestLive;
    try {
      const resp = await fetch("/api/maps/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          map_id: mapId,
          name,
          signature: live && live.status === "active" ? live.map_signature : "",
          physical_hint: live && live.status === "active" ? live.physical_hint : null,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        showToast(data.error || "新建地图失败", true);
        return;
      }
      state.routesConfig = data.config || state.routesConfig;
      state.activeMapId = mapId;
      state.manualMapOverride = false;
      inputNewMapName.value = "";
      inputNewMapId.value = "";
      newMapForm.classList.add("hidden");
      populateMapSelect();
      syncCanvasLayers();
      renderLayerLists();
      showToast(`已创建地图「${name}」`);
    } catch (err) {
      showToast(err?.message || "创建地图请求失败", true);
    }
  });

  // Live unit toggles
  chkShowAllies.addEventListener("change", () => { tacticalCanvas.showAllies = chkShowAllies.checked; });
  chkShowEnemies.addEventListener("change", () => { tacticalCanvas.showEnemies = chkShowEnemies.checked; });
  chkShowCaps.addEventListener("change", () => { tacticalCanvas.showCaps = chkShowCaps.checked; });
  chkShowSpawns.addEventListener("change", () => { tacticalCanvas.showSpawns = chkShowSpawns.checked; });
  chkShowTrail.addEventListener("change", () => { tacticalCanvas.showTrail = chkShowTrail.checked; });
  chkShowFrontline.addEventListener("change", () => { tacticalCanvas.setShowFrontline(chkShowFrontline.checked); });

  const tierLabels = { off: "关闭", conservative: "保守", balanced: "平衡", aggressive: "激进" };
  strategySeg.querySelectorAll(".strategy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tier = btn.dataset.tier || "off";
      strategySeg.querySelectorAll(".strategy-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      strategyStatusBadge.textContent = tierLabels[tier] || "关闭";
      strategyStatusBadge.className = tier === "off" ? "badge badge-muted" : "badge badge-green";
      tacticalCanvas.setStrategyTier(tier);
    });
  });

  rangeWreckDangerRadius.addEventListener("input", () => {
    const val = Math.min(200, Math.max(40, Number(rangeWreckDangerRadius.value) || 80));
    lblWreckDangerRadius.textContent = `${val}m`;
    tacticalCanvas.setWreckDangerRadius(val);
  });

  // Nearby ally loss alert prefs & controls
  const initialAllyPrefs = loadAllyAlertPrefs();
  chkAllyLossAlert.checked = initialAllyPrefs.enabled;
  chkAllyLossSound.checked = initialAllyPrefs.sound;
  rangeAllyAlertRadius.value = String(initialAllyPrefs.radiusM);
  lblAllyAlertRadius.textContent = `${initialAllyPrefs.radiusM}m`;
  tacticalCanvas.setAllyAlertEnabled(initialAllyPrefs.enabled);
  tacticalCanvas.setAllyAlertRadius(initialAllyPrefs.radiusM);

  chkAllyLossAlert.addEventListener("change", () => {
    tacticalCanvas.setAllyAlertEnabled(chkAllyLossAlert.checked);
    saveAllyAlertPrefs();
  });

  chkAllyLossSound.addEventListener("change", () => {
    if (chkAllyLossSound.checked) {
      ensureAudioContext();
    }
    saveAllyAlertPrefs();
  });

  rangeAllyAlertRadius.addEventListener("input", () => {
    const val = Math.min(300, Math.max(40, Number(rangeAllyAlertRadius.value) || 100));
    lblAllyAlertRadius.textContent = `${val}m`;
    tacticalCanvas.setAllyAlertRadius(val);
    saveAllyAlertPrefs();
  });

  btnTestAlertSound.addEventListener("click", () => {
    const ok = playAllyAlertSound(true);
    showToast(ok ? "已触发近距警示试听音" : "当前浏览器环境不支持 Web Audio", !ok);
  });

  // New vector layer
  btnToggleNewLayer.addEventListener("click", () => {
    newLayerForm.classList.toggle("hidden");
    if (!newLayerForm.classList.contains("hidden")) {
      inputNewLayerName.focus();
    }
  });
  btnCancelNewLayer.addEventListener("click", () => newLayerForm.classList.add("hidden"));
  btnConfirmNewLayer.addEventListener("click", () => {
    const entry = getActiveMapEntry();
    if (!entry) {
      showToast("请先选择一个地图", true);
      return;
    }
    const name = inputNewLayerName.value.trim();
    if (!name) {
      showToast("请输入图层名称", true);
      return;
    }
    const newLayer = {
      id: "layer_" + Date.now(),
      name,
      category: "custom",
      color: inputNewLayerColor.value || "#00e5ff",
      visible: true,
      elements: [],
    };
    entry.vector_layers.push(newLayer);
    routeEditor.setTargetLayerId(newLayer.id);
    inputNewLayerName.value = "";
    newLayerForm.classList.add("hidden");
    state.unsavedChanges = true;
    syncCanvasLayers();
    renderLayerLists();
  });

  // Route editor controls
  btnToggleDrawMode.addEventListener("click", () => {
    const next = !routeEditor.enabled;
    routeEditor.setEnabled(next);
    if (next) {
      routeEditor.setTool("polyline");
    }
    editorPanel.classList.toggle("hidden", !next);
    btnToggleDrawMode.textContent = next ? "退出绘制" : "进入绘制";
    updateDrawBanner();
    if (next) {
      suspendHeadingUpForEditor();
    } else {
      resumeHeadingUpAfterEditor();
    }
  });

  btnExitDrawBanner.addEventListener("click", () => {
    routeEditor.setEnabled(false);
    editorPanel.classList.add("hidden");
    btnToggleDrawMode.textContent = "进入绘制";
    updateDrawBanner();
    resumeHeadingUpAfterEditor();
  });

  btnFinishLineBanner.addEventListener("click", () => routeEditor.finishLine());
  btnEditorFinishLine.addEventListener("click", () => routeEditor.finishLine());
  btnEditorUndo.addEventListener("click", () => routeEditor.undo());
  btnEditorClearLayer.addEventListener("click", () => routeEditor.clearLayer());
  btnSaveRoutes.addEventListener("click", saveCurrentMapRoutes);

  // ---- 一键获胜彩蛋 & 关于弹窗（纯前端绿色安全，不执行任何本地卸载/删除） ----
  const closeWinConfirm = () => winConfirmModal.classList.add("hidden");
  const closeWinResult = () => winResultModal.classList.add("hidden");
  const closeAboutModal = () => aboutModal.classList.add("hidden");

  btnOneClickWin.addEventListener("click", () => {
    winConfirmModal.classList.remove("hidden");
  });
  btnCloseWinConfirm.addEventListener("click", closeWinConfirm);
  btnCancelWinConfirm.addEventListener("click", () => {
    closeWinConfirm();
    showToast("祝你下把分房不壮丁！");
  });
  winConfirmModal.addEventListener("click", (e) => {
    if (e.target === winConfirmModal) closeWinConfirm();
  });

  btnAcceptWinConfirm.addEventListener("click", () => {
    closeWinConfirm();
    winResultModal.classList.remove("hidden");
  });
  btnCloseWinResult.addEventListener("click", closeWinResult);
  btnCloseWinResultFooter.addEventListener("click", closeWinResult);
  winResultModal.addEventListener("click", (e) => {
    if (e.target === winResultModal) closeWinResult();
  });

  btnAboutModal.addEventListener("click", () => aboutModal.classList.remove("hidden"));
  btnCloseAboutModal.addEventListener("click", closeAboutModal);
  btnCloseAboutFooter.addEventListener("click", closeAboutModal);
  aboutModal.addEventListener("click", (e) => {
    if (e.target === aboutModal) closeAboutModal();
  });

  // ---- 战术分享码 (WTMAP://) 导入 / 导出（零后端存储） ----
  let shareModalMode = "import"; // "import" | "export"

  function openShareModal(mode, initialText) {
    shareModalMode = mode;
    shareModalError.classList.add("hidden");
    shareModalError.textContent = "";
    if (mode === "export") {
      shareModalTitle.textContent = "复制战术分享码";
      shareModalDesc.innerHTML = "当前浏览器限制自动写入剪贴板，请手动全选复制下方 <code>WTMAP://</code> 战术码：";
      shareCodeInput.readOnly = true;
      shareCodeInput.value = initialText || "";
      btnConfirmShareImport.classList.add("hidden");
      btnCancelShareModal.textContent = "关闭";
    } else {
      shareModalTitle.textContent = "导入战术分享码";
      shareModalDesc.innerHTML = "粘贴以 <code>WTMAP://</code> 开头的战术分享码，校验通过后将自动加载走线与标记图层。";
      shareCodeInput.readOnly = false;
      shareCodeInput.value = initialText || "";
      btnConfirmShareImport.classList.remove("hidden");
      btnCancelShareModal.textContent = "取消";
    }
    shareModal.classList.remove("hidden");
    setTimeout(() => {
      shareCodeInput.focus();
      if (mode === "export") shareCodeInput.select();
    }, 30);
  }

  function closeShareModal() {
    shareModal.classList.add("hidden");
    shareModalError.classList.add("hidden");
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        /* fallback below */
      }
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_) {
      ok = false;
    }
    ta.remove();
    return ok;
  }

  btnCopyShareCode.addEventListener("click", async () => {
    const entry = getActiveMapEntry();
    if (!state.activeMapId || !entry) {
      showToast("请先选择或识别一张地图后再复制战术码", true);
      return;
    }
    if (!window.WTShareCode) {
      showToast("战术码模块未加载", true);
      return;
    }
    routeEditor.finishLine();

    const sigSet = new Set(Array.isArray(entry.signatures) ? entry.signatures : []);
    const live = state.latestLive;
    if (
      live &&
      live.status === "active" &&
      live.map_signature &&
      (!live.matched_map_id || live.matched_map_id === state.activeMapId)
    ) {
      sigSet.add(live.map_signature);
    }

    try {
      const code = await window.WTShareCode.encode({
        map: {
          id: state.activeMapId,
          name: entry.name || state.activeMapId,
          sig: Array.from(sigSet),
        },
        layers: entry.vector_layers || [],
      });
      const copied = await copyTextToClipboard(code);
      const nonEmptyLayers = (entry.vector_layers || []).filter(
        (l) => Array.isArray(l?.elements) && l.elements.length > 0
      );
      const elemCount = nonEmptyLayers.reduce((acc, l) => acc + l.elements.length, 0);
      if (copied) {
        showToast(`已复制战术码（${nonEmptyLayers.length} 个图层，${elemCount} 项，${code.length} 字符）`);
      } else {
        openShareModal("export", code);
      }
    } catch (err) {
      showToast(err?.message || "生成战术码失败", true);
    }
  });

  btnImportShareCode.addEventListener("click", () => openShareModal("import", ""));
  btnCloseShareModal.addEventListener("click", closeShareModal);
  btnCancelShareModal.addEventListener("click", closeShareModal);
  shareModal.addEventListener("click", (e) => {
    if (e.target === shareModal) closeShareModal();
  });

  btnConfirmShareImport.addEventListener("click", async () => {
    if (!window.WTShareCode) return;
    shareModalError.classList.add("hidden");
    try {
      const decoded = await window.WTShareCode.decode(shareCodeInput.value);
      const maps = state.routesConfig.maps || (state.routesConfig.maps = {});

      // Resolve target map: 1) exact map.id  2) matching signature  3) current active map  4) new map entry
      let targetMapId = "";
      if (decoded.map.id && maps[decoded.map.id]) {
        targetMapId = decoded.map.id;
      } else if (decoded.map.sig.length > 0) {
        for (const [mid, mEntry] of Object.entries(maps)) {
          const sigs = Array.isArray(mEntry?.signatures) ? mEntry.signatures : [];
          if (decoded.map.sig.some((s) => sigs.includes(s))) {
            targetMapId = mid;
            break;
          }
        }
      }
      if (!targetMapId && state.activeMapId && maps[state.activeMapId]) {
        targetMapId = state.activeMapId;
      }
      if (!targetMapId) {
        targetMapId = decoded.map.id || `shared_${Date.now()}`;
        maps[targetMapId] = {
          name: decoded.map.name || "分享战术地图",
          signatures: [...decoded.map.sig],
          physical_hints: [],
          png_layers: [],
          vector_layers: [],
        };
      }

      const targetEntry = maps[targetMapId];
      if (!Array.isArray(targetEntry.vector_layers)) targetEntry.vector_layers = [];
      if (!Array.isArray(targetEntry.signatures)) targetEntry.signatures = [];

      // Merge any unbound signatures from share code into targetEntry
      const allBoundElsewhere = new Set();
      for (const [mid, mEntry] of Object.entries(maps)) {
        if (mid === targetMapId) continue;
        for (const s of mEntry?.signatures || []) allBoundElsewhere.add(s);
      }
      for (const s of decoded.map.sig) {
        if (!allBoundElsewhere.has(s) && !targetEntry.signatures.includes(s)) {
          targetEntry.signatures.push(s);
        }
      }

      // Merge imported layers (replace matching layer id, otherwise append)
      for (const impLayer of decoded.layers) {
        const layerObj = {
          id: impLayer.id,
          name: impLayer.name,
          category: impLayer.category || "shared",
          color: impLayer.color || "#38bdf8",
          visible: true,
          elements: impLayer.elements,
        };
        const idx = targetEntry.vector_layers.findIndex((l) => l && l.id === layerObj.id);
        if (idx >= 0) {
          targetEntry.vector_layers[idx] = layerObj;
        } else {
          targetEntry.vector_layers.push(layerObj);
        }
      }

      state.activeMapId = targetMapId;
      state.manualMapOverride = true;
      state.unsavedChanges = true;
      routeEditor.cancelDraft();

      // If currently in standby, enter preview so imported routes show immediately on screen
      if (!state.latestLive || state.latestLive.status !== "active") {
        state.previewOffline = true;
        standbyOverlay.classList.add("hidden");
        hudMapName.textContent = targetEntry.name || targetMapId;
        hudMatchBadge.className = "badge badge-amber";
        hudMatchBadge.textContent = "离线预览";
      }

      populateMapSelect();
      syncCanvasLayers();
      renderLayerLists();
      closeShareModal();
      showToast(`已导入 ${decoded.layers.length} 个图层、${decoded.elementCount} 条走线/标记（点击“保存到本地”可永久保存）`);
    } catch (err) {
      shareModalError.textContent = err?.message || "战术码解析失败";
      shareModalError.classList.remove("hidden");
    }
  });

  document.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      routeEditor.setTool(btn.dataset.tool);
    });
  });

  editLayerSelect.addEventListener("change", () => {
    routeEditor.setTargetLayerId(editLayerSelect.value);
    renderLayerLists();
  });

  editLabelInput.addEventListener("input", () => {
    routeEditor.setLabel(editLabelInput.value);
  });

  chkEditDashed.addEventListener("change", () => {
    routeEditor.setDashed(chkEditDashed.checked);
  });

  document.querySelectorAll(".swatch").forEach((sw) => {
    sw.addEventListener("click", () => {
      document.querySelectorAll(".swatch").forEach((el) => el.classList.remove("active"));
      sw.classList.add("active");
      routeEditor.setColor(sw.dataset.color);
    });
  });

  // Global keyboard shortcuts (ignore when typing in inputs)
  window.addEventListener("keydown", (e) => {
    const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      return;
    }

    const key = e.key.toLowerCase();
    if (key === "h") {
      e.preventDefault();
      toggleSidebarHidden();
    } else if (key === "r") {
      e.preventDefault();
      tacticalCanvas.resetView();
    } else if (key === "c") {
      e.preventDefault();
      tacticalCanvas.clearWaypoint();
    } else if (key === "f") {
      e.preventDefault();
      toggleFullscreen();
    } else if (key === "n") {
      e.preventDefault();
      chkHeadingUp.checked = !chkHeadingUp.checked;
      chkHeadingUp.dispatchEvent(new Event("change"));
    } else if (e.key === "Tab") {
      e.preventDefault();
      executeTargetAction(e.shiftKey ? "prev" : "next", true);
    } else if (
      e.code === "NumpadAdd" ||
      e.code === "Numpad4" ||
      (e.location === 3 && (e.key === "+" || e.key === "4"))
    ) {
      e.preventDefault();
      executeTargetAction("next", true);
    } else if (
      e.code === "NumpadSubtract" ||
      e.code === "Numpad1" ||
      (e.location === 3 && (e.key === "-" || e.key === "1"))
    ) {
      e.preventDefault();
      executeTargetAction("prev", true);
    } else if (
      e.code === "NumpadDivide" ||
      e.code === "Numpad0" ||
      (e.location === 3 && (e.key === "/" || e.key === "0"))
    ) {
      e.preventDefault();
      executeTargetAction("clear", true);
    } else if (e.key === "Enter") {
      if (
        routeEditor.enabled &&
        routeEditor.draft &&
        (routeEditor.draft.kind === "polyline" || routeEditor.draft.kind === "curve")
      ) {
        e.preventDefault();
        routeEditor.finishLine();
      }
    } else if (e.key === "Escape") {
      if (!winConfirmModal.classList.contains("hidden")) {
        closeWinConfirm();
        return;
      }
      if (!winResultModal.classList.contains("hidden")) {
        closeWinResult();
        return;
      }
      if (!aboutModal.classList.contains("hidden")) {
        closeAboutModal();
        return;
      }
      if (!shareModal.classList.contains("hidden")) {
        closeShareModal();
        return;
      }
      if (routeEditor.draft) {
        routeEditor.cancelDraft();
        updateDrawBanner();
      } else if (routeEditor.enabled) {
        routeEditor.setEnabled(false);
        editorPanel.classList.add("hidden");
        btnToggleDrawMode.textContent = "进入绘制";
        updateDrawBanner();
        resumeHeadingUpAfterEditor();
      } else if (tacticalCanvas.lockedTarget) {
        tacticalCanvas.clearTargetLock();
      }
    }
  });

  // Boot
  loadRoutes()
    .catch((err) => showToast(err.message || "初始化路由配置失败", true))
    .finally(() => {
      pollLoop();
    });
})();
