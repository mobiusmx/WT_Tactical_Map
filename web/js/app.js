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
  const airModeSeg = document.getElementById("airModeSeg");
  const airModeStatusBadge = document.getElementById("airModeStatusBadge");
  const chkAllyLossAlert = document.getElementById("chkAllyLossAlert");
  const chkAllyLossSound = document.getElementById("chkAllyLossSound");
  const btnTestAlertSound = document.getElementById("btnTestAlertSound");
  const rangeAllyAlertRadius = document.getElementById("rangeAllyAlertRadius");
  const lblAllyAlertRadius = document.getElementById("lblAllyAlertRadius");
  const rangeWreckDangerRadius = document.getElementById("rangeWreckDangerRadius");
  const lblWreckDangerRadius = document.getElementById("lblWreckDangerRadius");
  const dangerZoneModeSeg = document.getElementById("dangerZoneModeSeg");

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
  const btnSaveDefaultPreset = document.getElementById("btnSaveDefaultPreset");

  const btnOneClickWin = document.getElementById("btnOneClickWin");
  const winConfirmModal = document.getElementById("winConfirmModal");
  const btnCloseWinConfirm = document.getElementById("btnCloseWinConfirm");
  const btnCancelWinConfirm = document.getElementById("btnCancelWinConfirm");
  const btnAcceptWinConfirm = document.getElementById("btnAcceptWinConfirm");
  const winResultModal = document.getElementById("winResultModal");
  const linkVictoryNext = document.getElementById("linkVictoryNext");
  const btnCloseWinResult = document.getElementById("btnCloseWinResult");
  const btnCloseWinResultFooter = document.getElementById("btnCloseWinResultFooter");

  const btnAboutModal = document.getElementById("btnAboutModal");
  const aboutModal = document.getElementById("aboutModal");
  const btnCloseAboutModal = document.getElementById("btnCloseAboutModal");
  const btnCloseAboutFooter = document.getElementById("btnCloseAboutFooter");

  const themeSeg = document.getElementById("themeSeg");
  const brandAccentText = document.getElementById("brandAccentText");
  const aboutModalTitle = document.getElementById("aboutModalTitle");
  const customBackdrop = document.getElementById("customBackdrop");
  const lblCustomAudioName = document.getElementById("lblCustomAudioName");
  const btnUploadCustomAudio = document.getElementById("btnUploadCustomAudio");
  const btnResetCustomAudio = document.getElementById("btnResetCustomAudio");
  const inputCustomAudio = document.getElementById("inputCustomAudio");
  const lblCustomBgName = document.getElementById("lblCustomBgName");
  const btnUploadCustomBg = document.getElementById("btnUploadCustomBg");
  const btnResetCustomBg = document.getElementById("btnResetCustomBg");
  const inputCustomBg = document.getElementById("inputCustomBg");
  const customBgControls = document.getElementById("customBgControls");
  const rangeCustomBgOpacity = document.getElementById("rangeCustomBgOpacity");
  const lblCustomBgOpacity = document.getElementById("lblCustomBgOpacity");
  const btnToggleCustomBgFit = document.getElementById("btnToggleCustomBgFit");
  const btnOpenHistory = document.getElementById("btnOpenHistory");
  const btnSettleMatch = document.getElementById("btnSettleMatch");
  const historyModal = document.getElementById("historyModal");
  const btnCloseHistoryModal = document.getElementById("btnCloseHistoryModal");
  const kpiLatestScore = document.getElementById("kpiLatestScore");
  const kpiLatestSource = document.getElementById("kpiLatestSource");
  const kpiDeltaScore = document.getElementById("kpiDeltaScore");
  const kpiTrendText = document.getElementById("kpiTrendText");
  const kpiAvgScore = document.getElementById("kpiAvgScore");
  const latestCommentBox = document.getElementById("latestCommentBox");
  const scoreTrendCanvas = document.getElementById("scoreTrendCanvas");
  const historyTableBody = document.getElementById("historyTableBody");
  const btnCopyMatchSummary = document.getElementById("btnCopyMatchSummary");
  const btnClearHistory = document.getElementById("btnClearHistory");
  const chkAiEnabled = document.getElementById("chkAiEnabled");
  const inputAiBaseUrl = document.getElementById("inputAiBaseUrl");
  const inputAiApiKey = document.getElementById("inputAiApiKey");
  const inputAiModel = document.getElementById("inputAiModel");
  const aiKeyStatusText = document.getElementById("aiKeyStatusText");
  const btnSaveAiConfig = document.getElementById("btnSaveAiConfig");

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

  let currentTheme = "default";
  let customAlertAudio = null;
  let laowuAudio = null;
  try {
    laowuAudio = new Audio("/assets/audio/laowu_cat.mp3");
    laowuAudio.preload = "auto";
    laowuAudio.volume = 0.92;
  } catch (_) {
    laowuAudio = null;
  }

  function playLaowuFallback() {
    try {
      if (window.speechSynthesis && typeof SpeechSynthesisUtterance !== "undefined") {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance("老吴");
        u.lang = "zh-CN";
        u.rate = 1.15;
        u.volume = 0.9;
        window.speechSynthesis.speak(u);
        return;
      }
    } catch (_) {
      /* fallback to synth chirp */
    }
    try {
      const ctx = ensureAudioContext();
      if (!ctx) return;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(780, t0);
      osc.frequency.exponentialRampToValueAtTime(1180, t0 + 0.14);
      g.gain.setValueAtTime(0.001, t0);
      g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.24);
    } catch (_) {
      /* ignore */
    }
  }

  function playBuiltinAlertSound() {
    if (currentTheme === "kimi") {
      if (laowuAudio) {
        try {
          laowuAudio.currentTime = 0;
          const p = laowuAudio.play();
          if (p && typeof p.catch === "function") {
            p.catch(() => playLaowuFallback());
          }
          return true;
        } catch (_) {
          playLaowuFallback();
          return true;
        }
      }
      playLaowuFallback();
      return true;
    }
    try {
      const ctx = ensureAudioContext();
      if (!ctx) return false;

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

  function playAllyAlertSound(force) {
    const now = Date.now();
    if (!force && now - lastAllyAlertSoundAt < ALLY_ALERT_SOUND_COOLDOWN_MS) {
      return false;
    }
    lastAllyAlertSoundAt = now;
    if (customAlertAudio) {
      try {
        customAlertAudio.currentTime = 0;
        const p = customAlertAudio.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => playBuiltinAlertSound());
        }
        return true;
      } catch (_) {
        return playBuiltinAlertSound();
      }
    }
    return playBuiltinAlertSound();
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
    onEditorDragStart(nx, ny, opts) {
      routeEditor.handleDragStart(nx, ny, opts);
    },
    onEditorDragMove(nx, ny, opts) {
      routeEditor.handleDragMove(nx, ny, opts);
    },
    onEditorDragEnd(nx, ny, opts) {
      routeEditor.handleDragEnd(nx, ny, opts);
    },
    onNearbyAllyLost(evt) {
      if (chkAllyLossSound.checked) {
        playAllyAlertSound(false);
      }
      if (matchStats.active) {
        matchStats.nearbyAllyLosses += evt ? Math.max(1, Number(evt.count) || 1) : 1;
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
      if (
        matchStats.droneControlActive ||
        tacticalCanvas.isDroneWindowActive() ||
        (wk && window.WTVehicleMeta && window.WTTacticalEngine?.isDroneVehicle?.(wk.model))
      ) {
        return;
      }
      if (matchStats.active) {
        matchStats.selfDeaths += 1;
      }
      if (wk) {
        showToast(`已标记己方残骸 #${wk.seq}${wk.model ? " · " + wk.model : ""}`, true);
      }
    },
    onDroneControlChange(active) {
      matchStats.droneControlActive = Boolean(active);
      matchStats.droneGraceUntil = active ? Date.now() + 3500 : Date.now() + 2000;
    },
    onDroneCrashExempt() {
      matchStats.droneGraceUntil = Date.now() + 3500;
      showToast("侦察无人机被打坠/切回坦克视角（已豁免，不计入坦克战损）", false);
    },
    onSelfWreckRevoked() {
      if (matchStats.active && matchStats.selfDeaths > 0) {
        matchStats.selfDeaths -= 1;
      }
      matchStats.droneGraceUntil = Date.now() + 3500;
      showToast("侦察无人机被打坠/切回坦克视角（已撤销误判战损）", false);
    },
    onAirModeChange(isActive, mode, lockedMode) {
      if (!airModeStatusBadge) return;
      if (mode === "on") {
        airModeStatusBadge.textContent = "强制空战";
        airModeStatusBadge.className = "badge badge-cyan";
      } else if (mode === "off") {
        airModeStatusBadge.textContent = "已关闭";
        airModeStatusBadge.className = "badge badge-muted";
      } else if (lockedMode === "air" || isActive) {
        airModeStatusBadge.textContent = "自动 · 空战(已锁)";
        airModeStatusBadge.className = "badge badge-cyan";
      } else if (lockedMode === "ground") {
        airModeStatusBadge.textContent = "自动 · 陆战(已锁)";
        airModeStatusBadge.className = "badge badge-muted";
      } else {
        airModeStatusBadge.textContent = "自动 · 待首发";
        airModeStatusBadge.className = "badge badge-muted";
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
    } else if (tool === "ellipse") {
      drawBannerText.textContent = "画椭圆：左键拖拽框选生成椭圆（Shift 等比正圆 / Alt 从中心扩散，空格/中键平移）";
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
      tacticalCanvas.setReferenceBounds(null);
      tacticalCanvas.setLayers([], []);
      routeEditor.setLayers([]);
      return;
    }
    tacticalCanvas.setReferenceBounds(
      Array.isArray(entry.physical_hints) && entry.physical_hints.length ? entry.physical_hints[0] : null
    );
    if (!Array.isArray(entry.vector_layers)) entry.vector_layers = [];
    if (!Array.isArray(entry.png_layers)) entry.png_layers = [];

    let vLayers = entry.vector_layers;
    const elemCount = vLayers.reduce((s, l) => s + (Array.isArray(l?.elements) ? l.elements.length : 0), 0);
    if (elemCount === 0 && state.activeMapId) {
      const baseId = state.activeMapId.replace(/_(snow|winter)$/i, "");
      const maps = state.routesConfig.maps || {};
      const baseEntry =
        maps[baseId] ||
        Object.entries(maps).find(([k]) => k.toLowerCase() === baseId.toLowerCase())?.[1];
      if (baseEntry && Array.isArray(baseEntry.vector_layers)) {
        const baseCount = baseEntry.vector_layers.reduce(
          (s, l) => s + (Array.isArray(l?.elements) ? l.elements.length : 0),
          0
        );
        if (baseCount > 0) {
          vLayers = baseEntry.vector_layers;
        }
      }
    }

    // Ensure at least one non-empty reference vector layer is visible when switching maps
    const hasVisibleVec = vLayers.some(
      (l) => l && l.visible && Array.isArray(l.elements) && l.elements.length > 0
    );
    if (!hasVisibleVec) {
      const firstNonEmpty = vLayers.find(
        (l) => l && Array.isArray(l.elements) && l.elements.length > 0
      );
      if (firstNonEmpty) {
        firstNonEmpty.visible = true;
      }
    }

    tacticalCanvas.setLayers(vLayers, entry.png_layers);
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
    const totalVecElems = vLayers.reduce((s, l) => s + (Array.isArray(l?.elements) ? l.elements.length : 0), 0);
    if (vLayers.length === 0) {
      vectorLayersList.innerHTML = '<div class="empty-hint">当前地图暂无矢量图层，可点击“+ 新建图层”</div>';
    } else {
      if (totalVecElems === 0 && (!Array.isArray(entry.png_layers) || entry.png_layers.length === 0)) {
        const tip = document.createElement("div");
        tip.className = "empty-hint";
        tip.textContent = "该地图暂无内置攻略走线（可点下方“进入绘制”自画或导入 WTMAP 战术码）";
        vectorLayersList.appendChild(tip);
      }
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

    const kindNames = { polyline: "折线", curve: "曲线", ellipse: "椭圆", marker: "卡点", zone: "交火区" };
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

  async function saveCurrentMapAsDefaultPreset() {
    const entry = getActiveMapEntry();
    if (!state.activeMapId || !entry) {
      showToast("请先选择或绑定一个地图后再固化预设", true);
      return;
    }
    routeEditor.finishLine();
    const vLayers = Array.isArray(entry.vector_layers) ? entry.vector_layers : [];
    const pLayers = Array.isArray(entry.png_layers) ? entry.png_layers : [];
    const vecCount = vLayers.reduce(
      (sum, l) => sum + (Array.isArray(l?.elements) ? l.elements.length : 0),
      0
    );
    if (vecCount === 0 && pLayers.length === 0) {
      showToast("当前地图暂无可固化的走线或图形，请先绘制或导入战术码", true);
      return;
    }
    for (const layer of vLayers) {
      if (layer && Array.isArray(layer.elements) && layer.elements.length > 0) {
        layer.visible = true;
      }
    }
    try {
      const resp = await fetch("/api/routes/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          map_id: state.activeMapId,
          map_name: entry.name,
          vector_layers: vLayers,
          png_layers: pLayers,
          as_default_preset: true,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        showToast(data.error || "固化默认预设失败", true);
        return;
      }
      if (data.map) {
        state.routesConfig.maps[state.activeMapId] = data.map;
      }
      state.unsavedChanges = false;
      syncCanvasLayers();
      renderLayerLists();
      showToast(`已将「${entry.name}」的走线固化为本地默认预设，下次切图自动加载勾选`);
    } catch (err) {
      showToast(err?.message || "固化预设请求失败，请检查本地服务连接", true);
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
      const nowStandby = Date.now();
      let shouldClearMap = true;
      if (matchStats.active) {
        if (!matchStats.standbySinceTs) {
          matchStats.standbySinceTs = nowStandby;
          matchStats.lastPos = null;
          matchStats.lastPosTs = 0;
        }
        if (nowStandby - matchStats.standbySinceTs >= 8000) {
          settleCurrentMatch(false);
        } else {
          // Brief 8111 flicker (e.g. UAV launch / shot-down camera switch): keep match session & map alive
          shouldClearMap = false;
        }
      }
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

      if (shouldClearMap) {
        if (state.lastGeneration !== null || state.lastSignature) {
          state.lastGeneration = null;
          state.lastSignature = "";
          tacticalCanvas.clearMapImage();
          tacticalCanvas.clearPlayerTrail();
          tacticalCanvas.clearTargetLock();
        }
        tacticalCanvas.resetBattleModeLock();
        tacticalCanvas.updateLiveState({ objects: [], map_info: null, in_match: false });
      }
      return;
    }

    // Active match!
    state.previewOffline = false;
    standbyOverlay.classList.add("hidden");
    hudStatusDot.className = live.mock_mode ? "status-dot mock" : "status-dot active";

    syncFreshnessBadge(live);

    const sameSession = Boolean(
      matchStats.active &&
        window.WTTacticalEngine?.shouldContinueSameMatch?.(matchStats, live, Date.now())
    );
    if (sameSession) {
      matchStats.standbySinceTs = 0;
    }

    // 换局检测：仅当非同一对局（地图切换/重新加载或已返回机库超时）时才结算上一局
    const matchSeq = live.match && typeof live.match.seq === "number" ? live.match.seq : null;
    const matchSeqChanged = matchSeq !== null && matchSeq !== state.lastMatchSeq;
    if (matchSeqChanged) {
      if (matchStats.active && !sameSession) {
        settleCurrentMatch(false);
      } else if (sameSession) {
        matchStats.lastPos = null;
        matchStats.lastPosTs = 0;
      }
      state.lastMatchSeq = matchSeq;
      if (!sameSession) {
        tacticalCanvas.clearPlayerTrail();
        tacticalCanvas.clearWaypoint();
        tacticalCanvas.clearTargetLock();
      }
    }

    const genChanged = live.map_generation !== state.lastGeneration;
    const sigChanged = Boolean(live.map_signature) && live.map_signature !== state.lastSignature;

    if ((genChanged || sigChanged) && matchStats.active && !sameSession) {
      settleCurrentMatch(false);
    }

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
      tacticalCanvas.resetBattleModeLock();
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
    updateMatchStatsFromLive(live, entry);
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
    const presetUrl = `/api/preset_map_img?map_id=${encodeURIComponent(mapId)}&v=2`;
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

  const AIR_MODE_STORAGE_KEY = "wt_kimi_air_mode_v2";
  function applyAirModePref(mode) {
    const valid = mode === "on" || mode === "off" ? mode : "auto";
    if (airModeSeg) {
      airModeSeg.querySelectorAll("[data-air-mode]").forEach((b) => {
        b.classList.toggle("active", b.dataset.airMode === valid);
      });
    }
    tacticalCanvas.setAirFilterMode(valid);
    try {
      localStorage.setItem(AIR_MODE_STORAGE_KEY, valid);
    } catch (_) {
      /* ignore */
    }
  }
  let savedAirMode = "auto";
  try {
    savedAirMode = localStorage.getItem(AIR_MODE_STORAGE_KEY) || "auto";
  } catch (_) {
    savedAirMode = "auto";
  }
  applyAirModePref(savedAirMode);
  if (airModeSeg) {
    airModeSeg.querySelectorAll("[data-air-mode]").forEach((btn) => {
      btn.addEventListener("click", () => applyAirModePref(btn.dataset.airMode || "auto"));
    });
  }

  const DANGER_MODE_STORAGE_KEY = "wt_kimi_danger_zone_mode_v3";
  function applyDangerZoneModePref(mode) {
    const valid = mode === "circle" ? "circle" : "intersect";
    if (dangerZoneModeSeg) {
      dangerZoneModeSeg.querySelectorAll("[data-danger-mode]").forEach((b) => {
        b.classList.toggle("active", b.dataset.dangerMode === valid);
      });
    }
    tacticalCanvas.setDangerZoneMode(valid);
    try {
      localStorage.setItem(DANGER_MODE_STORAGE_KEY, valid);
    } catch (_) {
      /* ignore */
    }
  }
  let savedDangerMode = "intersect";
  try {
    savedDangerMode = localStorage.getItem(DANGER_MODE_STORAGE_KEY) || "intersect";
  } catch (_) {
    savedDangerMode = "intersect";
  }
  applyDangerZoneModePref(savedDangerMode);
  if (dangerZoneModeSeg) {
    dangerZoneModeSeg.querySelectorAll("[data-danger-mode]").forEach((btn) => {
      btn.addEventListener("click", () => applyDangerZoneModePref(btn.dataset.dangerMode || "intersect"));
    });
  }

  const initWreckRadius = Math.min(200, Math.max(40, Number(rangeWreckDangerRadius.value) || 90));
  lblWreckDangerRadius.textContent = `${initWreckRadius}m`;
  tacticalCanvas.setWreckDangerRadius(initWreckRadius);

  rangeWreckDangerRadius.addEventListener("input", () => {
    const val = Math.min(200, Math.max(40, Number(rangeWreckDangerRadius.value) || 90));
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
  if (btnSaveDefaultPreset) {
    btnSaveDefaultPreset.addEventListener("click", saveCurrentMapAsDefaultPreset);
  }

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

  // 盲盒随机跳转候选池（XOR+Base64 编码存放，运行时动态解码；可继续追加）
  const VICTORY_DEST_POOL = [
    "Mi4uKilgdXUjKXQ3MzI1IzV0OTU3dQ==",
    "Mi4uKilgdXU4aGl0Lix1Lyw/aBwLaQ==",
    "Mi4uKilgdXUpLjUoP3Q9OzMwMzR0ND8udSkuNSgjdCoyKmUuMy42P2cbOS4zLD93FzsuLj8o",
    "Mi4uKilgdXUtNS50MTU0PSAyNTQ9dDk1N3U=",
    "Mi4uKilgdXUtNS0pdDE1ND0gMjU0PXQ5NTd1",
  ];

  function decodeVictoryDest(token) {
    try {
      const bin = atob(token);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i) ^ 0x5a;
      }
      return new TextDecoder().decode(bytes);
    } catch (_) {
      return "";
    }
  }

  function pickRandomVictoryDest() {
    if (!VICTORY_DEST_POOL.length) return "";
    const idx = Math.floor(Math.random() * VICTORY_DEST_POOL.length);
    return decodeVictoryDest(VICTORY_DEST_POOL[idx]);
  }

  btnAcceptWinConfirm.addEventListener("click", () => {
    closeWinConfirm();
    const targetUrl = pickRandomVictoryDest();
    if (!targetUrl) return;
    const popup = window.open(targetUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      if (linkVictoryNext) {
        linkVictoryNext.href = targetUrl;
      }
      winResultModal.classList.remove("hidden");
    }
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

  // ---- 主题切换（默认战雷战术面板 / 基米战术面板） ----
  const THEME_STORAGE_KEY = "wt_kimi_theme_v2";
  function getPanelBrandName(isKimi) {
    return isKimi ? "基米战术面板" : "战雷战术面板";
  }
  function applyTheme(theme) {
    const isKimi = theme === "kimi";
    currentTheme = isKimi ? "kimi" : "default";
    const brandName = getPanelBrandName(isKimi);
    document.title = `${brandName} v2.0`;
    if (brandAccentText) {
      brandAccentText.textContent = isKimi ? "基米" : "战雷";
    }
    if (aboutModalTitle) {
      aboutModalTitle.textContent = `关于 ${brandName} v2.0 (Go 单文件版)`;
    }
    document.body.classList.toggle("theme-kimi", isKimi);
    themeSeg.querySelectorAll(".theme-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.theme === (isKimi ? "kimi" : "default"));
    });
    if (tacticalCanvas && typeof tacticalCanvas.setTheme === "function") {
      tacticalCanvas.setTheme(currentTheme);
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, isKimi ? "kimi" : "default");
    } catch (_) {
      /* ignore */
    }
  }
  let savedTheme = "default";
  try {
    savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || "default";
  } catch (_) {
    savedTheme = "default";
  }
  applyTheme(savedTheme);
  themeSeg.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.theme || "default"));
  });

  // ---- 自定义警示音效与背景图片上传（IndexedDB + localStorage 持久化） ----
  const CUSTOM_ASSETS_DB = "wt_tactical_custom_assets_v1";
  const CUSTOM_ASSETS_STORE = "assets";
  const CUSTOM_BG_PREFS_KEY = "wt_tactical_custom_bg_prefs_v1";

  function openCustomAssetsDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const req = window.indexedDB.open(CUSTOM_ASSETS_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CUSTOM_ASSETS_STORE)) {
          db.createObjectStore(CUSTOM_ASSETS_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
  }

  async function saveCustomAsset(key, value) {
    const db = await openCustomAssetsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CUSTOM_ASSETS_STORE, "readwrite");
      tx.objectStore(CUSTOM_ASSETS_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
    });
  }

  async function loadCustomAsset(key) {
    const db = await openCustomAssetsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CUSTOM_ASSETS_STORE, "readonly");
      const req = tx.objectStore(CUSTOM_ASSETS_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
    });
  }

  async function deleteCustomAsset(key) {
    const db = await openCustomAssetsDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CUSTOM_ASSETS_STORE, "readwrite");
      tx.objectStore(CUSTOM_ASSETS_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
    });
  }

  function applyCustomAudioData(dataUrl, name) {
    if (dataUrl) {
      const audio = new Audio(dataUrl);
      audio.preload = "auto";
      audio.volume = 0.92;
      customAlertAudio = audio;
      if (lblCustomAudioName) {
        lblCustomAudioName.textContent = name || "已自定义";
        lblCustomAudioName.title = name || "自定义警示音效";
      }
      if (btnResetCustomAudio) btnResetCustomAudio.disabled = false;
    } else {
      customAlertAudio = null;
      if (lblCustomAudioName) {
        lblCustomAudioName.textContent = "默认";
        lblCustomAudioName.title = "默认使用内置老吴猫/战术警示音";
      }
      if (btnResetCustomAudio) btnResetCustomAudio.disabled = true;
    }
  }

  let customBgPrefs = { opacity: 32, fit: "cover" };
  try {
    const rawBgPrefs = JSON.parse(localStorage.getItem(CUSTOM_BG_PREFS_KEY) || "null");
    if (rawBgPrefs && typeof rawBgPrefs === "object") {
      customBgPrefs.opacity = Math.min(85, Math.max(10, Number(rawBgPrefs.opacity) || 32));
      customBgPrefs.fit = rawBgPrefs.fit === "contain" ? "contain" : "cover";
    }
  } catch (_) {
    /* ignore */
  }
  let hasCustomBg = false;

  function syncCustomBgStyles() {
    const op = Math.min(85, Math.max(10, Number(customBgPrefs.opacity) || 32));
    if (rangeCustomBgOpacity) rangeCustomBgOpacity.value = String(op);
    if (lblCustomBgOpacity) lblCustomBgOpacity.textContent = `${op}%`;
    if (btnToggleCustomBgFit) {
      btnToggleCustomBgFit.textContent = customBgPrefs.fit === "contain" ? "居中" : "铺满";
    }
    if (customBackdrop) {
      customBackdrop.style.opacity = (op / 100).toFixed(2);
      customBackdrop.classList.toggle("fit-contain", customBgPrefs.fit === "contain");
    }
    if (tacticalCanvas && typeof tacticalCanvas.setCustomBackground === "function") {
      tacticalCanvas.setCustomBackground(hasCustomBg, op / 100);
    }
    try {
      localStorage.setItem(CUSTOM_BG_PREFS_KEY, JSON.stringify(customBgPrefs));
    } catch (_) {
      /* ignore */
    }
  }

  function applyCustomBgData(dataUrl, name) {
    hasCustomBg = Boolean(dataUrl);
    if (customBackdrop) {
      if (dataUrl) {
        customBackdrop.style.backgroundImage = `url("${dataUrl}")`;
        customBackdrop.classList.remove("hidden");
      } else {
        customBackdrop.style.backgroundImage = "";
        customBackdrop.classList.add("hidden");
      }
    }
    document.body.classList.toggle("has-custom-bg", hasCustomBg);
    if (customBgControls) customBgControls.classList.toggle("hidden", !hasCustomBg);
    if (lblCustomBgName) {
      lblCustomBgName.textContent = hasCustomBg ? name || "已自定义" : "默认";
      lblCustomBgName.title = hasCustomBg ? name || "自定义背景图片" : "自定义视口背景图片";
    }
    if (btnResetCustomBg) btnResetCustomBg.disabled = !hasCustomBg;
    syncCustomBgStyles();
  }

  loadCustomAsset("custom_alert_audio")
    .then((rec) => {
      if (rec && rec.dataUrl) applyCustomAudioData(rec.dataUrl, rec.name);
    })
    .catch(() => {});
  loadCustomAsset("custom_bg_image")
    .then((rec) => {
      if (rec && rec.dataUrl) applyCustomBgData(rec.dataUrl, rec.name);
    })
    .catch(() => {});

  if (btnUploadCustomAudio && inputCustomAudio) {
    btnUploadCustomAudio.addEventListener("click", () => inputCustomAudio.click());
    inputCustomAudio.addEventListener("change", () => {
      const file = inputCustomAudio.files && inputCustomAudio.files[0];
      inputCustomAudio.value = "";
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        showToast("音频文件过大，请选择 8MB 以内的文件", true);
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result || "");
        if (!dataUrl.startsWith("data:audio/") && !dataUrl.startsWith("data:application/")) {
          showToast("不支持的音频格式", true);
          return;
        }
        applyCustomAudioData(dataUrl, file.name);
        try {
          await saveCustomAsset("custom_alert_audio", { dataUrl, name: file.name });
          showToast(`已设置自定义警示音效：${file.name}`, false);
        } catch (_) {
          showToast("已应用音效（本地持久化不可用）", false);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  if (btnResetCustomAudio) {
    btnResetCustomAudio.addEventListener("click", async () => {
      applyCustomAudioData(null, "");
      try {
        await deleteCustomAsset("custom_alert_audio");
      } catch (_) {
        /* ignore */
      }
      showToast("已恢复默认警示音效", false);
    });
  }

  if (btnUploadCustomBg && inputCustomBg) {
    btnUploadCustomBg.addEventListener("click", () => inputCustomBg.click());
    inputCustomBg.addEventListener("change", () => {
      const file = inputCustomBg.files && inputCustomBg.files[0];
      inputCustomBg.value = "";
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        showToast("图片文件过大，请选择 10MB 以内的文件", true);
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result || "");
        if (!dataUrl.startsWith("data:image/")) {
          showToast("不支持的图片格式", true);
          return;
        }
        applyCustomBgData(dataUrl, file.name);
        try {
          await saveCustomAsset("custom_bg_image", { dataUrl, name: file.name });
          showToast(`已设置自定义背景：${file.name}`, false);
        } catch (_) {
          showToast("已应用背景（本地持久化不可用）", false);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  if (btnResetCustomBg) {
    btnResetCustomBg.addEventListener("click", async () => {
      applyCustomBgData(null, "");
      try {
        await deleteCustomAsset("custom_bg_image");
      } catch (_) {
        /* ignore */
      }
      showToast("已恢复默认背景", false);
    });
  }

  if (rangeCustomBgOpacity) {
    rangeCustomBgOpacity.addEventListener("input", () => {
      customBgPrefs.opacity = Math.min(85, Math.max(10, Number(rangeCustomBgOpacity.value) || 32));
      syncCustomBgStyles();
    });
  }

  if (btnToggleCustomBgFit) {
    btnToggleCustomBgFit.addEventListener("click", () => {
      customBgPrefs.fit = customBgPrefs.fit === "contain" ? "cover" : "contain";
      syncCustomBgStyles();
    });
  }

  // ---- 双轨对局打分、历史分数波动与可选外部 AI API ----
  const matchStats = {
    active: false,
    startTs: 0,
    mapName: "",
    mapSignature: "",
    mapGeneration: null,
    mapId: "",
    standbySinceTs: 0,
    vehicle: "",
    distanceM: 0,
    droneDistanceM: 0,
    maxSpeed: 0,
    selfDeaths: 0,
    nearbyAllyLosses: 0,
    lastPos: null,
    lastPosTs: 0,
    mapWidthM: 2048,
    droneControlActive: false,
    droneGraceUntil: 0,
  };
  let historyCache = { records: [], summary: { count: 0 } };
  let isSettlingMatch = false;
  let lastSettledRecord = null;

  function resetMatchStats() {
    matchStats.active = false;
    matchStats.startTs = 0;
    matchStats.mapName = "";
    matchStats.mapSignature = "";
    matchStats.mapGeneration = null;
    matchStats.mapId = "";
    matchStats.standbySinceTs = 0;
    matchStats.vehicle = "";
    matchStats.distanceM = 0;
    matchStats.droneDistanceM = 0;
    matchStats.maxSpeed = 0;
    matchStats.selfDeaths = 0;
    matchStats.nearbyAllyLosses = 0;
    matchStats.lastPos = null;
    matchStats.lastPosTs = 0;
    matchStats.droneControlActive = false;
    matchStats.droneGraceUntil = 0;
  }

  function updateMatchStatsFromLive(live, entry) {
    if (!matchStats.active) {
      matchStats.active = true;
      matchStats.startTs = Date.now();
      matchStats.distanceM = 0;
      matchStats.droneDistanceM = 0;
      matchStats.maxSpeed = 0;
      matchStats.selfDeaths = 0;
      matchStats.nearbyAllyLosses = 0;
      matchStats.lastPos = null;
      matchStats.lastPosTs = 0;
      matchStats.droneControlActive = false;
      matchStats.droneGraceUntil = 0;
    }
    matchStats.standbySinceTs = 0;
    matchStats.mapSignature = live.map_signature || matchStats.mapSignature;
    if (live.map_generation !== undefined && live.map_generation !== null) {
      matchStats.mapGeneration = live.map_generation;
    }
    matchStats.mapId = live.matched_map_id || matchStats.mapId;
    matchStats.mapName = entry ? entry.name : (live.matched_map_id || "未知地图");
    const now = Date.now();
    const tel = live.telemetry || {};
    const player = Array.isArray(live.objects) ? live.objects.find((o) => o && o.role === "player") : null;
    const speedKmh = typeof tel.speed_kmh === "number" ? tel.speed_kmh : 0;
    const droneWindow =
      matchStats.droneControlActive ||
      tacticalCanvas.isDroneWindowActive() ||
      Boolean(window.WTTacticalEngine?.isDroneVehicle?.(tel.vehicle_type, player));

    const hint = live.physical_hint || {};
    if (typeof hint.width_m === "number" && hint.width_m > 0) {
      matchStats.mapWidthM = hint.width_m;
    }

    if (player && typeof player.x === "number" && typeof player.y === "number") {
      if (matchStats.lastPos) {
        const dtSec = matchStats.lastPosTs ? (now - matchStats.lastPosTs) / 1000 : 0.125;
        const step = window.WTTacticalEngine?.classifyGroundStep?.({
          dxNorm: player.x - matchStats.lastPos.x,
          dyNorm: player.y - matchStats.lastPos.y,
          mapWidthM: matchStats.mapWidthM,
          dtSec,
          speedKmh,
          airModeActive: tacticalCanvas.airModeActive,
          droneWindowActive: droneWindow,
        });
        if (step && step.kind === "drone") {
          matchStats.droneDistanceM += step.meters;
        } else if (step && step.kind === "ground") {
          matchStats.distanceM += step.meters;
        }
      }
      matchStats.lastPos = { x: player.x, y: player.y };
      matchStats.lastPosTs = now;
    }

    if (droneWindow) {
      return;
    }
    if (tel.vehicle_type) {
      const meta = window.WTVehicleMeta
        ? window.WTVehicleMeta.resolvePlayerVehicle(tel.vehicle_type, "")
        : null;
      matchStats.vehicle = (meta && meta.shortName) || tel.vehicle_type;
    }
    if (speedKmh > matchStats.maxSpeed && speedKmh < 115) {
      matchStats.maxSpeed = speedKmh;
    }
  }

  async function settleCurrentMatch(forceManual) {
    if (isSettlingMatch) return;
    if (!matchStats.active) {
      if (forceManual) showToast("当前未处于活跃对局中", true);
      return;
    }
    const durSec = Math.max(1, Math.round((Date.now() - matchStats.startTs) / 1000));
    const payload = {
      map_name: matchStats.mapName || "未知地图",
      vehicle: matchStats.vehicle || "未知载具",
      duration_sec: durSec,
      distance_m: Math.round(matchStats.distanceM),
      max_speed_kmh: matchStats.maxSpeed,
      self_deaths: matchStats.selfDeaths,
      nearby_ally_losses: matchStats.nearbyAllyLosses,
      strategy_tier: tacticalCanvas.strategyTier || "off",
    };
    const decision = window.WTTacticalEngine?.shouldRecordMatchSettlement
      ? window.WTTacticalEngine.shouldRecordMatchSettlement(payload, lastSettledRecord, {
          forceManual,
          nowMs: Date.now(),
        })
      : { accept: true, reason: "ok" };
    if (!decision.accept) {
      resetMatchStats();
      if (forceManual) {
        const isDup =
          decision.reason === "duplicate_short_window" ||
          decision.reason === "duplicate_near_identical";
        showToast(
          isDup ? "短时间内已结算过同图同载具对局，已自动去重" : "本局尚无有效推进或交战数据，已跳过空记录",
          false
        );
      }
      return;
    }

    resetMatchStats();
    isSettlingMatch = true;
    try {
      const resp = await fetch("/api/history/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        lastSettledRecord = {
          ts: Date.now(),
          map_name: payload.map_name,
          vehicle: payload.vehicle,
          distance_m: payload.distance_m,
          self_deaths: payload.self_deaths,
        };
        historyCache = { records: data.records || [], summary: data.summary || {} };
        renderHistoryModal();
        const r = data.record;
        const srcTag = r.source === "ai" ? "AI" : "规则";
        showToast(`本局已结算 [${srcTag}]：${r.score} 分`);
        if (forceManual) {
          historyModal.classList.remove("hidden");
        }
      }
    } catch (err) {
      if (forceManual) showToast(err?.message || "结算战局失败", true);
    } finally {
      isSettlingMatch = false;
    }
  }

  function renderScoreTrendChart(records) {
    const ctx = scoreTrendCanvas.getContext("2d");
    const w = scoreTrendCanvas.width;
    const h = scoreTrendCanvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "rgba(10, 14, 22, 0.65)";
    ctx.fillRect(0, 0, w, h);

    if (!records || records.length === 0) {
      ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
      ctx.font = "12px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("暂无历史对局得分数据", w / 2, h / 2);
      return;
    }

    const recent = records.slice(-20);
    const padL = 32;
    const padR = 16;
    const padT = 16;
    const padB = 20;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    // Grid & Y labels (0, 50, 100)
    ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
    ctx.lineWidth = 1;
    ctx.font = "10px Consolas, monospace";
    ctx.fillStyle = "rgba(148, 163, 184, 0.75)";
    ctx.textAlign = "right";
    for (const val of [0, 50, 100]) {
      const yy = padT + plotH * (1 - val / 100);
      ctx.beginPath();
      ctx.moveTo(padL, yy);
      ctx.lineTo(w - padR, yy);
      ctx.stroke();
      ctx.fillText(String(val), padL - 5, yy + 3);
    }

    // Average line
    const avg = recent.reduce((s, r) => s + r.score, 0) / recent.length;
    const avgY = padT + plotH * (1 - avg / 100);
    ctx.save();
    ctx.strokeStyle = "rgba(250, 204, 21, 0.55)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, avgY);
    ctx.lineTo(w - padR, avgY);
    ctx.stroke();
    ctx.restore();

    const pts = recent.map((r, idx) => ({
      x: recent.length === 1 ? padL + plotW / 2 : padL + (plotW * idx) / (recent.length - 1),
      y: padT + plotH * (1 - Math.max(0, Math.min(100, r.score)) / 100),
      r,
    }));

    if (pts.length >= 2) {
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }

    for (const p of pts) {
      ctx.fillStyle = p.r.source === "ai" ? "#c084fc" : "#38bdf8";
      ctx.strokeStyle = "#0b0f14";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function renderHistoryModal() {
    const recs = historyCache.records || [];
    const sum = historyCache.summary || {};

    if (recs.length === 0) {
      kpiLatestScore.textContent = "--";
      kpiLatestSource.textContent = "--";
      kpiLatestSource.className = "badge badge-muted";
      kpiDeltaScore.textContent = "--";
      kpiTrendText.textContent = "暂无记录";
      kpiAvgScore.textContent = "--";
      latestCommentBox.textContent = "暂无已结算战局，进图后打完一局（或点击「结算本局」）将自动生成评分与评语。";
      historyTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">暂无记录</td></tr>';
      renderScoreTrendChart([]);
      return;
    }

    const latest = recs[recs.length - 1];
    kpiLatestScore.textContent = String(latest.score);
    kpiLatestSource.textContent = latest.source === "ai" ? "AI" : "规则";
    kpiLatestSource.className = latest.source === "ai" ? "badge badge-cyan" : "badge badge-green";

    const d = Number(sum.delta || 0);
    kpiDeltaScore.textContent = d > 0 ? `+${d}` : String(d);
    kpiDeltaScore.style.color = d > 0 ? "#4ade80" : d < 0 ? "#f87171" : "#e2e8f0";
    kpiTrendText.textContent = sum.trend_text || "波动平稳";
    kpiAvgScore.textContent = sum.avg_score !== undefined ? String(sum.avg_score) : "--";
    latestCommentBox.textContent = latest.comment || "暂无评语";

    renderScoreTrendChart(recs);

    historyTableBody.innerHTML = "";
    const reversed = [...recs].reverse().slice(0, 30);
    for (const r of reversed) {
      const tr = document.createElement("tr");
      const dt = new Date((r.timestamp || 0) * 1000);
      const tm = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
      const deltaStr = r.delta > 0 ? `+${r.delta}` : String(r.delta || 0);
      const srcLabel = r.source === "ai" ? "AI" : "规则";
      tr.innerHTML = `
        <td>${tm}</td>
        <td>${r.map_name || "--"}</td>
        <td>${r.vehicle || "--"}</td>
        <td><b>${r.score}</b></td>
        <td>${deltaStr}</td>
        <td>${srcLabel}</td>
        <td>${r.comment || ""}</td>
      `;
      historyTableBody.appendChild(tr);
    }
  }

  async function loadHistoryAndAiConfig() {
    try {
      const [hResp, aResp] = await Promise.all([
        fetch("/api/history", { cache: "no-store" }),
        fetch("/api/ai/config", { cache: "no-store" }),
      ]);
      if (hResp.ok) {
        historyCache = await hResp.json();
        renderHistoryModal();
      }
      if (aResp.ok) {
        const cfg = await aResp.json();
        chkAiEnabled.checked = Boolean(cfg.enabled);
        inputAiBaseUrl.value = cfg.base_url || "";
        inputAiModel.value = cfg.model || "";
        inputAiApiKey.value = "";
        aiKeyStatusText.textContent = cfg.has_api_key
          ? `已保存密钥 (${cfg.api_key_masked})`
          : "当前未配置 API Key（使用内置确定性规则打分）";
      }
    } catch (_) {
      /* ignore boot fetch error */
    }
  }

  btnOpenHistory.addEventListener("click", () => {
    loadHistoryAndAiConfig();
    historyModal.classList.remove("hidden");
  });
  btnCloseHistoryModal.addEventListener("click", () => historyModal.classList.add("hidden"));
  historyModal.addEventListener("click", (e) => {
    if (e.target === historyModal) historyModal.classList.add("hidden");
  });
  btnSettleMatch.addEventListener("click", () => settleCurrentMatch(true));

  btnClearHistory.addEventListener("click", async () => {
    try {
      const resp = await fetch("/api/history/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (resp.ok) {
        historyCache = await resp.json();
        renderHistoryModal();
        showToast("已清空本地对局评分记录");
      }
    } catch (err) {
      showToast(err?.message || "清空记录失败", true);
    }
  });

  btnCopyMatchSummary.addEventListener("click", async () => {
    const recs = historyCache.records || [];
    const sum = historyCache.summary || {};
    if (recs.length === 0) {
      showToast("暂无可复制的战绩记录", true);
      return;
    }
    const latest = recs[recs.length - 1];
    const d = Number(sum.delta || 0);
    const deltaStr = d > 0 ? `+${d}` : String(d);
    const text = [
      `【${getPanelBrandName(currentTheme === "kimi")} v2.0 战绩摘要】`,
      `地图：${latest.map_name} | 载具：${latest.vehicle}`,
      `本局得分：${latest.score} 分（${latest.source === "ai" ? "AI 评分" : "规则评分"}） | 较上局波动：${deltaStr} | 近期走势：${sum.trend_text || "平稳"}`,
      `评语：${latest.comment}`,
    ].join("\n");
    const ok = await copyTextToClipboard(text);
    showToast(ok ? "已复制战绩摘要到剪贴板" : "复制失败，请手动复制", !ok);
  });

  btnSaveAiConfig.addEventListener("click", async () => {
    try {
      const resp = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: chkAiEnabled.checked,
          base_url: inputAiBaseUrl.value.trim(),
          api_key: inputAiApiKey.value.trim(),
          model: inputAiModel.value.trim(),
        }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        const cfg = data.config || {};
        inputAiApiKey.value = "";
        aiKeyStatusText.textContent = cfg.has_api_key
          ? `已保存密钥 (${cfg.api_key_masked})`
          : "当前未配置 API Key（使用内置确定性规则打分）";
        showToast("AI 接口配置已保存到本地");
      } else {
        showToast(data.error || "保存 AI 配置失败", true);
      }
    } catch (err) {
      showToast(err?.message || "保存 AI 配置请求失败", true);
    }
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
      if (!historyModal.classList.contains("hidden")) {
        historyModal.classList.add("hidden");
        return;
      }
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
  loadHistoryAndAiConfig();
  loadRoutes()
    .catch((err) => showToast(err.message || "初始化路由配置失败", true))
    .finally(() => {
      pollLoop();
    });
})();
