/* High-DPI HTML5 Canvas tactical map renderer & interaction handler */

(function (global) {
  "use strict";

  const TRAIL_JUMP_THRESHOLD = 0.06;

  const ENEMY_ICON_NAMES = {
    HeavyTank: "重坦",
    MediumTank: "中坦",
    LightTank: "轻坦",
    TankDestroyer: "坦歼",
    SPAA: "防空",
    Fighter: "战机",
    Bomber: "轰炸机",
    Assault: "攻击机",
  };

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function normalizeAngle(rad) {
    return Math.atan2(Math.sin(rad), Math.cos(rad));
  }

  function hexToRgba(hex, alpha) {
    if (!hex || typeof hex !== "string") {
      return `rgba(56, 189, 248, ${alpha})`;
    }
    const clean = hex.trim().replace("#", "");
    if (clean.length === 6) {
      const r = parseInt(clean.slice(0, 2), 16);
      const g = parseInt(clean.slice(2, 4), 16);
      const b = parseInt(clean.slice(4, 6), 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }
    }
    return `rgba(56, 189, 248, ${alpha})`;
  }

  class TacticalCanvas {
    constructor(canvas, callbacks) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.callbacks = callbacks || {};

      this.zoom = 1.0;
      this.minZoom = 0.6;
      this.maxZoom = 8.0;
      this.panX = 0;
      this.panY = 0;

      this.followPlayer = false;
      this.headingUp = false;
      this._mapRotation = 0; // radians, applied around the canvas center
      this._lastFrameTs = 0;
      this.showAllies = true;
      this.showEnemies = true;
      this.showCaps = true;
      this.showSpawns = true;
      this.showTrail = true;
      this.drawMode = "browse";

      this.mapImg = null;
      this.mapImgLoaded = false;
      this._mapImgLoading = false;
      this._mapImgReqId = 0;
      this._mapImgError = false;
      this._mapImgTimeout = null;
      this._imgCache = new Map();
      this._autoFitPending = true;
      this._lastCombatFit = null;
      this.pngCache = new Map();

      this.vectorLayers = [];
      this.pngLayers = [];
      this.editorDraft = null;
      this.maxSightlineNormLen = 0.14;

      this.objects = [];
      this.mapInfo = null;
      this.refBounds = null;
      this.waypoint = null;
      this._recentPings = [];
      this._pingSeq = 0;
      this.lockedTarget = null;
      this._lastTargetNotifyKey = "";

      this.allyAlertEnabled = true;
      this.allyAlertRadiusM = 100;
      this._trackedAllies = [];
      this._allyTrackSeq = 0;
      this._allyTrackResetAt = Date.now();
      this._allyAlerts = [];
      this._allyAlertSeq = 0;

      // v2.0 tactical state: BWiki SVG icons, wrecks, yellow danger zones, frontline & 3-tier recommendations
      this.showFrontline = true;
      this.wreckDangerRadiusM = 90;
      this.dangerZoneMode = "intersect"; // "intersect" | "circle"
      this.dangerZoneTtlMs = 120000;
      this.strategyTier = "off"; // "off" | "conservative" | "balanced" | "aggressive"
      this.airFilterMode = "auto"; // "auto" | "on" | "off"
      this.airModeActive = false;
      this.theme = "default"; // "default" | "kimi"
      this._lastAirBadgeKey = "";
      this._lastState = null;
      this._allyWrecks = [];
      this._selfWrecks = [];
      this._selfWreckSeq = 0;
      this._dangerZones = [];
      this._frontlinePoints = null;
      this._recommendedIds = new Set();
      this._dynamicRoutes = [];
      this._activeSpawn = null;
      this._lastRecTip = "";
      this._playerMeta = { shortName: "", groundClass: "medium_tank", mobility: "medium" };
      this._wasPlayerAlive = false;
      this._playerAbsentFrames = 0;
      this._lastAlivePlayerPos = null;
      this._lastAliveModel = "";
      this._droneControlActive = false;
      this._droneGraceUntil = 0;
      this._wasGroundPlayer = false;
      this._lastGroundPlayerPos = null;
      this._classIconImgs = new Map();
      this._tintedIconCache = new Map();
      this._preloadClassIcons();

      this.playerTrail = []; // Array of segments: Array<Array<[x, y]>>
      this.trailMaxLen = 45;
      this.lastPlayerHeading = -Math.PI / 2;
      this.lastPlayerPos = null;
      this._playerWasAbsent = false;
      this._lastVehicleKey = null;
      this._activeSpawn = null;
      this._dynamicRoutes = [];

      this._isPanning = false;
      this._panStartX = 0;
      this._panStartY = 0;
      this._panOrigX = 0;
      this._panOrigY = 0;
      this._hasDragged = false;

      // Touch gesture state (mobile / tablet)
      this._touchMode = null; // "pan" | "pinch" | "longpress"
      this._touchStart = null;
      this._touchMoved = false;
      this._panOriginX = 0;
      this._panOriginY = 0;
      this._pinch = null;
      this._longPressTimer = null;
      this._lastTouchEnd = 0;
      this._multiTouchSession = false; // true from first 2-finger contact until all fingers lift
      this._touchLast = null;

      // While the user is dragging/pinching, the map rotation is frozen so the
      // content under the finger never swings (heading-up animation jitter fix).
      this._gestureActive = false;
      this._panLastX = 0;
      this._panLastY = 0;
      this._spacePressed = false;
      this._isEditorDragging = false;

      // Render-time smoothed player position: 8 Hz samples eased at display refresh rate.
      this._renderPlayer = null;

      this._width = 800;
      this._height = 600;
      this._dpr = window.devicePixelRatio || 1;
      this._rafId = null;

      this._bindEvents();
      this.resize();
      this._startLoop();
    }

    _bindEvents() {
      this._onResize = () => this.resize();
      window.addEventListener("resize", this._onResize);

      if (typeof ResizeObserver !== "undefined" && this.canvas.parentElement) {
        this._resizeObserver = new ResizeObserver(() => this.resize());
        this._resizeObserver.observe(this.canvas.parentElement);
      }

      this.canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        this._autoFitPending = false;
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
        const nextZoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
        if (Math.abs(nextZoom - this.zoom) < 1e-4) {
          return;
        }

        const norm = this.screenToMap(sx, sy);
        const anchor = this._unrotateScreen(sx, sy);
        const { baseW, baseH } = this._getBaseSize();
        const nextDrawW = baseW * nextZoom;
        const nextDrawH = baseH * nextZoom;

        this._autoFitPending = false;
        this.zoom = nextZoom;
        if (!this.followPlayer) {
          this.panX = anchor.x - norm.x * nextDrawW - this._width / 2 + nextDrawW / 2;
          this.panY = anchor.y - norm.y * nextDrawH - this._height / 2 + nextDrawH / 2;
        }
        this.callbacks.onZoomChange?.(Math.round(this.zoom * 100));
      }, { passive: false });

      this.canvas.addEventListener("mousedown", (e) => {
        if (Date.now() - this._lastTouchEnd < 700) return; // ignore synthetic mouse after touch
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        // In draw mode (polyline/curve/ellipse/marker/zone):
        // - Middle button OR Space + Left button (or Alt + Left for non-ellipse) => pan map
        // - Ellipse: Left drag draws ellipse (Alt = from center, Shift = equal circle)
        // - Plain Left click => plot point / marker / zone directly
        if (this.drawMode !== "browse") {
          const wantPan =
            e.button === 1 ||
            (e.button === 0 && (this._spacePressed || (this.drawMode !== "ellipse" && e.altKey)));
          if (wantPan) {
            e.preventDefault();
            this._isPanning = true;
            this._gestureActive = true;
            this._hasDragged = false;
            this._panStartX = e.clientX;
            this._panStartY = e.clientY;
            this._panLastX = e.clientX;
            this._panLastY = e.clientY;
            this._panOrigX = this.panX;
            this._panOrigY = this.panY;
            this.canvas.classList.add("dragging");
            return;
          }
          if (e.button === 0 && !e.ctrlKey) {
            e.preventDefault();
            const norm = this.screenToMap(sx, sy);
            const nx = clamp(norm.x, 0, 1);
            const ny = clamp(norm.y, 0, 1);
            if (this.drawMode === "ellipse") {
              this._isEditorDragging = true;
              this.callbacks.onEditorDragStart?.(nx, ny, {
                fromCenter: e.altKey,
                equalRatio: e.shiftKey,
              });
            } else {
              this.callbacks.onEditorClick?.(nx, ny, e);
            }
            return;
          }
        }

        // Ctrl + Left Click OR Middle Click => Place temporary tactical waypoint
        if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
          e.preventDefault();
          const norm = this.screenToMap(sx, sy);
          this.setWaypoint({
            x: clamp(norm.x, 0, 1),
            y: clamp(norm.y, 0, 1),
          });
          return;
        }

        if (e.button === 0) {
          this._isPanning = true;
          this._gestureActive = true;
          this._hasDragged = false;
          this._panStartX = e.clientX;
          this._panStartY = e.clientY;
          this._panLastX = e.clientX;
          this._panLastY = e.clientY;
          this._panOrigX = this.panX;
          this._panOrigY = this.panY;
          this.canvas.classList.add("dragging");
        }
      });

      window.addEventListener("mousemove", (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        if (this._isPanning) {
          this._autoFitPending = false;
          const dx = e.clientX - this._panStartX;
          const dy = e.clientY - this._panStartY;
          if (Math.hypot(dx, dy) > 4 && !this._hasDragged) {
            this._hasDragged = true;
            this._autoFitPending = false;
            if (this.followPlayer) {
              this.followPlayer = false;
              this.callbacks.onFollowBreak?.();
            }
          }
          // Incremental delta: each step is rotated by the angle in effect for that
          // step, so a rotation change mid-drag can never make the map jump.
          const step = this._rotateDelta(e.clientX - this._panLastX, e.clientY - this._panLastY);
          this._panLastX = e.clientX;
          this._panLastY = e.clientY;
          this.panX += step.x;
          this.panY += step.y;
          return;
        }

        if (this._isEditorDragging) {
          const norm = this.screenToMap(sx, sy);
          this.callbacks.onEditorDragMove?.(clamp(norm.x, 0, 1), clamp(norm.y, 0, 1), {
            fromCenter: e.altKey,
            equalRatio: e.shiftKey,
          });
          return;
        }

        if (this.drawMode !== "browse") {
          const norm = this.screenToMap(sx, sy);
          this.callbacks.onEditorMove?.(clamp(norm.x, 0, 1), clamp(norm.y, 0, 1));
        }
      });

      window.addEventListener("mouseup", (e) => {
        if (this._isEditorDragging) {
          this._isEditorDragging = false;
          const rect = this.canvas.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const norm = this.screenToMap(sx, sy);
          this.callbacks.onEditorDragEnd?.(clamp(norm.x, 0, 1), clamp(norm.y, 0, 1), {
            fromCenter: e.altKey,
            equalRatio: e.shiftKey,
          });
          return;
        }
        if (this._isPanning) {
          const wasClick = !this._hasDragged && e.button === 0 && !e.ctrlKey;
          this._isPanning = false;
          this._gestureActive = false;
          this.canvas.classList.remove("dragging");
          if (wasClick && this.drawMode === "browse" && Date.now() - this._lastTouchEnd >= 700) {
            const rect = this.canvas.getBoundingClientRect();
            const sx = e.clientX - rect.left;
            const sy = e.clientY - rect.top;
            if (sx >= 0 && sy >= 0 && sx <= rect.width && sy <= rect.height) {
              this._handleTargetClickAt(sx, sy, 22);
            }
          }
        }
      });

      this.canvas.addEventListener("auxclick", (e) => {
        if (e.button === 1) {
          e.preventDefault();
        }
      });

      this.canvas.addEventListener("contextmenu", (e) => {
        if (this._touchMode === "longpress" || Date.now() - this._lastTouchEnd < 1200) {
          e.preventDefault(); // suppress Android/iOS long-press menu
          return;
        }
        if (this.drawMode === "polyline" || this.drawMode === "curve") {
          e.preventDefault();
          this.callbacks.onEditorFinish?.();
        }
      });

      this.canvas.addEventListener("dblclick", (e) => {
        if (e.ctrlKey) return;
        if (Date.now() - this._lastTouchEnd < 700) return;
        if (this.drawMode === "polyline" || this.drawMode === "curve") {
          this.callbacks.onEditorFinish?.();
        } else if (this.drawMode === "browse") {
          this.resetView();
        }
      });

      // Touch gestures: drag = pan, pinch = zoom, 500ms hold = waypoint
      this.canvas.addEventListener("touchstart", (e) => this._handleTouchStart(e), { passive: false });
      this.canvas.addEventListener("touchmove", (e) => this._handleTouchMove(e), { passive: false });
      this.canvas.addEventListener("touchend", (e) => this._handleTouchEnd(e), { passive: false });
      this.canvas.addEventListener("touchcancel", (e) => this._handleTouchEnd(e), { passive: false });

      window.addEventListener("keydown", (e) => {
        if (e.code === "Space" && this.drawMode !== "browse") {
          const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : "";
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
          e.preventDefault();
          if (!this._spacePressed) {
            this._spacePressed = true;
            this.canvas.classList.add("pan-ready");
          }
        }
      });

      window.addEventListener("keyup", (e) => {
        if (e.code === "Space" && this._spacePressed) {
          this._spacePressed = false;
          this.canvas.classList.remove("pan-ready");
        }
      });

      window.addEventListener("blur", () => {
        if (this._spacePressed) {
          this._spacePressed = false;
          this.canvas.classList.remove("pan-ready");
        }
      });
    }

    // ---------------- touch gestures (mobile / tablet) ----------------
    _touchPoint(touch) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }

    _cancelLongPress() {
      if (this._longPressTimer) {
        clearTimeout(this._longPressTimer);
        this._longPressTimer = null;
      }
    }

    _breakFollowForTouch() {
      if (!this.followPlayer) return;
      this.followPlayer = false;
      this.callbacks.onFollowBreak?.();
    }

    /** Rotated screen position of a normalized map point (labels/hit-testing). */
    _screenPoint(nx, ny) {
      const base = this.mapToScreen(nx, ny);
      if (!this._mapRotation) return base;
      const cx = this._width / 2;
      const cy = this._height / 2;
      const dx = base.x - cx;
      const dy = base.y - cy;
      const cos = Math.cos(this._mapRotation);
      const sin = Math.sin(this._mapRotation);
      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
    }

    _toggleWaypointAt(sx, sy) {
      if (this.waypoint) {
        const wp = this._screenPoint(this.waypoint.x, this.waypoint.y);
        if (Math.hypot(wp.x - sx, wp.y - sy) <= 26) {
          this.clearWaypoint();
          return;
        }
      }
      const norm = this.screenToMap(sx, sy);
      this.setWaypoint({ x: clamp(norm.x, 0, 1), y: clamp(norm.y, 0, 1) });
    }

    _beginTouchPan(pt) {
      this._cancelLongPress();
      this._touchMode = "pan";
      this._touchStart = pt;
      this._touchLast = pt;
      this._touchMoved = false;
      this._panOriginX = this.panX;
      this._panOriginY = this.panY;
      // After a pinch, the finger left on the glass must never turn into a
      // long-press waypoint; only a fresh single-finger contact may.
      if (this._multiTouchSession) return;
      this._longPressTimer = setTimeout(() => {
        this._longPressTimer = null;
        if (this._touchMode !== "pan" || this._touchMoved || this._multiTouchSession) return;
        if (this.drawMode !== "browse") return; // drawing taps must stay taps
        this._touchMode = "longpress";
        // Same behaviour as PC Ctrl+Left click: set, or clear when tapping the marker.
        this._toggleWaypointAt(this._touchStart.x, this._touchStart.y);
        if (navigator.vibrate) {
          try {
            navigator.vibrate(25);
          } catch (_) {
            /* ignore */
          }
        }
      }, 500);
    }

    _beginPinch(touches) {
      this._cancelLongPress();
      this._touchMode = "pinch";
      this._multiTouchSession = true;
      this._autoFitPending = false;
      const a = this._touchPoint(touches[0]);
      const b = this._touchPoint(touches[1]);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this._pinch = {
        startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        startZoom: this.zoom,
        // In follow mode (incl. heading-up) the camera stays locked on the player:
        // pinch only changes zoom, so the rotation pivot never moves under the fingers.
        followLocked: this.followPlayer,
        norm: this.screenToMap(mid.x, mid.y),
      };
    }

    _handleTouchStart(e) {
      if (e.cancelable) e.preventDefault();
      this._lastTouchEnd = 0;
      this._gestureActive = true;
      const touches = Array.from(e.touches || []);
      if (touches.length >= 2) {
        this._beginPinch(touches);
      } else if (touches.length === 1) {
        this._multiTouchSession = false;
        this._beginTouchPan(this._touchPoint(touches[0]));
      }
    }

    _handleTouchMove(e) {
      if (e.cancelable) e.preventDefault();
      const touches = Array.from(e.touches || []);
      if (this._touchMode === "pinch" && this._pinch && touches.length >= 2) {
        const a = this._touchPoint(touches[0]);
        const b = this._touchPoint(touches[1]);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const nextZoom = clamp(
          this._pinch.startZoom * (dist / this._pinch.startDist),
          this.minZoom,
          this.maxZoom
        );
        this._autoFitPending = false;
        this.zoom = nextZoom;
        if (!(this._pinch.followLocked && this.followPlayer)) {
          const { baseW, baseH } = this._getBaseSize();
          const drawW = baseW * nextZoom;
          const drawH = baseH * nextZoom;
          const anchor = this._unrotateScreen(mid.x, mid.y);
          this.panX = anchor.x - this._pinch.norm.x * drawW - this._width / 2 + drawW / 2;
          this.panY = anchor.y - this._pinch.norm.y * drawH - this._height / 2 + drawH / 2;
        }
        this.callbacks.onZoomChange?.(Math.round(nextZoom * 100));
        return;
      }
      if (this._touchMode === "pan" && touches.length === 1 && this._touchStart) {
        const pt = this._touchPoint(touches[0]);
        const dx = pt.x - this._touchStart.x;
        const dy = pt.y - this._touchStart.y;
        if (!this._touchMoved && Math.hypot(dx, dy) > 6) {
          this._touchMoved = true;
          this._autoFitPending = false;
          this._cancelLongPress();
          this._breakFollowForTouch();
        }
        if (this._touchMoved) {
          const last = this._touchLast || pt;
          const step = this._rotateDelta(pt.x - last.x, pt.y - last.y);
          this.panX += step.x;
          this.panY += step.y;
        }
        this._touchLast = pt;
      }
    }

    _handleTouchEnd(e) {
      if (e.cancelable) e.preventDefault();
      this._cancelLongPress();
      const remaining = Array.from(e.touches || []);
      const wasTap =
        this._touchMode === "pan" && !this._touchMoved && !this._multiTouchSession && this._touchStart;

      if (remaining.length === 1 && this._touchMode !== "longpress") {
        this._beginTouchPan(this._touchPoint(remaining[0]));
        this._lastTouchEnd = 0;
        return;
      }

      // Touch drawing: a clean single-finger tap = one editor click; in browse mode = target lock toggle.
      if (remaining.length === 0 && wasTap) {
        if (this.drawMode !== "browse") {
          const norm = this.screenToMap(this._touchStart.x, this._touchStart.y);
          this.callbacks.onEditorClick?.(clamp(norm.x, 0, 1), clamp(norm.y, 0, 1), e);
          this.callbacks.onEditorMove?.(clamp(norm.x, 0, 1), clamp(norm.y, 0, 1));
        } else {
          this._handleTargetClickAt(this._touchStart.x, this._touchStart.y, 28);
        }
      }

      if (remaining.length === 0) {
        this._touchMode = null;
        this._pinch = null;
        this._touchStart = null;
        this._touchLast = null;
        this._multiTouchSession = false;
        this._gestureActive = false;
        this._lastTouchEnd = Date.now();
      }
    }

    resize() {
      const parent = this.canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const w = Math.max(100, Math.floor(rect.width));
      const h = Math.max(100, Math.floor(rect.height));
      const dpr = window.devicePixelRatio || 1;
      // Mobile URL-bar show/hide fires many resize events; skip no-op reallocations.
      if (
        w === this._width &&
        h === this._height &&
        dpr === this._dpr &&
        this.canvas.width === Math.floor(w * dpr) &&
        this.canvas.height === Math.floor(h * dpr)
      ) {
        return;
      }
      this._width = w;
      this._height = h;
      this._dpr = dpr;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
    }

    _getBaseSize() {
      const pad = 0.94;
      const maxW = this._width * pad;
      const maxH = this._height * pad;
      let aspect = 1.0;
      if (this.mapImgLoaded && this.mapImg && this.mapImg.naturalHeight > 0) {
        aspect = this.mapImg.naturalWidth / this.mapImg.naturalHeight;
      }
      let baseW = maxW;
      let baseH = baseW / aspect;
      if (baseH > maxH) {
        baseH = maxH;
        baseW = baseH * aspect;
      }
      return { baseW, baseH };
    }

    _getMapRect() {
      const { baseW, baseH } = this._getBaseSize();
      const drawW = baseW * this.zoom;
      const drawH = baseH * this.zoom;

      if (this.followPlayer) {
        const player = this._renderPlayer || this.objects.find((o) => o.role === "player");
        if (player && typeof player.x === "number" && typeof player.y === "number") {
          this.panX = (0.5 - player.x) * drawW;
          this.panY = (0.5 - player.y) * drawH;
        }
      }

      const x = this._width / 2 - drawW / 2 + this.panX;
      const y = this._height / 2 - drawH / 2 + this.panY;
      return { x, y, w: drawW, h: drawH };
    }

    mapToScreen(nx, ny, rect) {
      const r = rect || this._getMapRect();
      return {
        x: r.x + nx * r.w,
        y: r.y + ny * r.h,
      };
    }

    /** Rotate a screen point back into the unrotated (map) frame. */
    _unrotateScreen(sx, sy) {
      if (!this._mapRotation) return { x: sx, y: sy };
      const cx = this._width / 2;
      const cy = this._height / 2;
      const dx = sx - cx;
      const dy = sy - cy;
      const cos = Math.cos(this._mapRotation);
      const sin = Math.sin(this._mapRotation);
      return { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos };
    }

    /** Rotate a screen-space delta into the unrotated (pan) frame. */
    _rotateDelta(dx, dy) {
      if (!this._mapRotation) return { x: dx, y: dy };
      const cos = Math.cos(this._mapRotation);
      const sin = Math.sin(this._mapRotation);
      return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
    }

    /** Draw a label at (x,y) while cancelling the map rotation so text stays upright. */
    _withUpright(ctx, x, y, drawFn) {
      if (!this._mapRotation) {
        drawFn(ctx, x, y);
        return;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-this._mapRotation);
      drawFn(ctx, 0, 0);
      ctx.restore();
    }

    screenToMap(sx, sy) {
      const p = this._unrotateScreen(sx, sy);
      const r = this._getMapRect();
      return {
        x: (p.x - r.x) / (r.w || 1),
        y: (p.y - r.y) / (r.h || 1),
      };
    }

    fitToViewport() {
      this._autoFitPending = false;
      this.fitCombatZone();
    }

    armAutoFit() {
      this._autoFitPending = true;
      this.fitCombatZone();
    }

    _computeCombatZoneView() {
      const anchors = [];
      let hasBattleAnchors = false;

      for (const obj of this.objects) {
        if (!obj || typeof obj.x !== "number" || typeof obj.y !== "number") continue;
        if (obj.x < 0 || obj.x > 1 || obj.y < 0 || obj.y > 1) continue;
        const isTankSpawn =
          (obj.role === "spawn_ally" || obj.role === "spawn_enemy") &&
          !String(obj.type || "").includes("fighter") &&
          !String(obj.type || "").includes("bomber");
        if (obj.role === "capture_zone" || isTankSpawn) {
          anchors.push([obj.x, obj.y]);
          hasBattleAnchors = true;
        }
      }

      if (!hasBattleAnchors) {
        // Fallback when 8111 live spawns/caps are absent: frame visible preset vector routes
        for (const layer of this.vectorLayers) {
          if (!layer || !layer.visible || !Array.isArray(layer.elements)) continue;
          for (const el of layer.elements) {
            if (!el) continue;
            if ((el.kind === "polyline" || el.kind === "curve") && Array.isArray(el.points)) {
              for (const p of el.points) {
                if (Array.isArray(p) && p.length >= 2) {
                  anchors.push(this._refToDisplayNorm(p[0], p[1]));
                }
              }
            } else if ((el.kind === "marker" || el.kind === "zone" || el.kind === "ellipse") && Array.isArray(el.point)) {
              anchors.push(this._refToDisplayNorm(el.point[0], el.point[1]));
            }
          }
        }
      }

      if (anchors.length < 2) return null;

      let minX = 1, maxX = 0, minY = 1, maxY = 0;
      for (const [x, y] of anchors) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      const span = Math.max(maxX - minX, maxY - minY, 0.12);
      const pad = Math.max(0.05, span * 0.18);
      const pMinX = clamp(minX - pad, 0, 1);
      const pMaxX = clamp(maxX + pad, 0, 1);
      const pMinY = clamp(minY - pad, 0, 1);
      const pMaxY = clamp(maxY + pad, 0, 1);

      const boxW = Math.max(0.14, pMaxX - pMinX);
      const boxH = Math.max(0.14, pMaxY - pMinY);
      const { baseW, baseH } = this._getBaseSize();
      const viewW = this._width || baseW;
      const viewH = this._height || baseH;
      const targetZoom = clamp(Math.min(viewW / (boxW * baseW), viewH / (boxH * baseH)), 1.0, 4.0);
      if (targetZoom < 1.12) return null;

      const centerX = (pMinX + pMaxX) / 2;
      const centerY = (pMinY + pMaxY) / 2;
      return {
        zoom: targetZoom,
        panX: (0.5 - centerX) * baseW * targetZoom,
        panY: (0.5 - centerY) * baseH * targetZoom,
        centerX,
        centerY,
      };
    }

    fitCombatZone() {
      const view = this._computeCombatZoneView();
      if (view) {
        this.zoom = view.zoom;
        if (!this.followPlayer) {
          this.panX = view.panX;
          this.panY = view.panY;
        }
        this._lastCombatFit = view;
        this.callbacks.onZoomChange?.(Math.round(this.zoom * 100));
        return true;
      }
      this.zoom = 1.0;
      this.panX = 0;
      this.panY = 0;
      this._lastCombatFit = null;
      this.callbacks.onZoomChange?.(100);
      return false;
    }

    resetView() {
      this._autoFitPending = false;
      const combatView = this._computeCombatZoneView();
      if (combatView) {
        const atCombatFit =
          Math.abs(this.zoom - combatView.zoom) < 0.05 &&
          Math.hypot(this.panX - combatView.panX, this.panY - combatView.panY) < 12;
        if (!atCombatFit) {
          this.zoom = combatView.zoom;
          if (!this.followPlayer) {
            this.panX = combatView.panX;
            this.panY = combatView.panY;
          }
          this._lastCombatFit = combatView;
          this.callbacks.onZoomChange?.(Math.round(this.zoom * 100));
          return;
        }
      }
      this.zoom = 1.0;
      this.panX = 0;
      this.panY = 0;
      this._lastCombatFit = null;
      this.callbacks.onZoomChange?.(100);
    }

    setDrawMode(mode) {
      this.drawMode = mode || "browse";
      this.canvas.classList.toggle("drawing", this.drawMode !== "browse");
      if (this.drawMode === "browse") {
        this._spacePressed = false;
        this.canvas.classList.remove("pan-ready");
      }
    }

    setFollowPlayer(enabled) {
      this.followPlayer = !!enabled;
    }

    /**
     * Toggle "heading up" (player nose points to 12 o'clock).
     * snap=true jumps straight to the target angle (used when entering the editor,
     * where an animated map would make drawing inaccurate).
     */
    setHeadingUp(enabled, snap) {
      this.headingUp = !!enabled;
      if (snap && !this.headingUp) {
        this._mapRotation = 0;
      }
    }

    _headingUpTarget() {
      if (!this.headingUp) return 0;
      return normalizeAngle(-Math.PI / 2 - this.lastPlayerHeading);
    }

    _updateRotation(dt) {
      // Freeze rotation while a manual drag / anchored pinch is in progress:
      // otherwise the heading-up animation rotates the map under the finger.
      if (this._gestureActive && !this.followPlayer) {
        return;
      }

      const target = this._headingUpTarget();
      const diff = normalizeAngle(target - this._mapRotation);
      if (Math.abs(diff) < 0.0015) {
        this._mapRotation = target;
        return;
      }
      // Exponential smoothing: fast enough to follow turns, slow enough to
      // swallow the per-frame jitter of dx/dy while the hull creeps around.
      const alpha = 1 - Math.exp(-dt * 7);
      this._mapRotation = normalizeAngle(this._mapRotation + diff * alpha);
    }

    /**
     * Ease the drawn player position toward the latest 8 Hz sample so follow-camera,
     * arrow and heading-up rotation move continuously at 60/120 Hz instead of
     * stepping every 125 ms. Large jumps (respawn) snap instantly.
     */
    _updateRenderPlayer(dt) {
      const player = this.objects.find((o) => o.role === "player");
      if (!player || typeof player.x !== "number" || typeof player.y !== "number") {
        this._renderPlayer = null;
        return;
      }
      const rp = this._renderPlayer;
      if (!rp || Math.hypot(player.x - rp.x, player.y - rp.y) > TRAIL_JUMP_THRESHOLD) {
        this._renderPlayer = { x: player.x, y: player.y };
        return;
      }
      const alpha = 1 - Math.exp(-dt * 14);
      rp.x += (player.x - rp.x) * alpha;
      rp.y += (player.y - rp.y) * alpha;
    }

    _trimPlayerTrail() {
      let total = 0;
      for (const seg of this.playerTrail) total += seg.length;
      while (total > this.trailMaxLen && this.playerTrail.length > 0) {
        const oldest = this.playerTrail[0];
        if (oldest.length > 0) {
          oldest.shift();
          total -= 1;
        }
        if (oldest.length === 0) {
          this.playerTrail.shift();
        }
      }
    }

    setTrailMaxLength(len) {
      this.trailMaxLen = Math.max(5, Number(len) || 45);
      this._trimPlayerTrail();
    }

    clearPlayerTrail() {
      this.playerTrail = [];
      this.lastPlayerPos = null;
      this._renderPlayer = null;
      this._playerWasAbsent = false;
      this._lastVehicleKey = null;
      this._activeSpawn = null;
      this._dynamicRoutes = [];
      this._recentPings = [];
      this.resetAllyTracking();
      this.armAutoFit();
    }

    setAllyAlertEnabled(enabled) {
      this.allyAlertEnabled = !!enabled;
      if (!this.allyAlertEnabled) {
        this._allyAlerts = [];
      }
    }

    setAllyAlertRadius(meters) {
      const val = Number(meters);
      if (!Number.isNaN(val)) {
        this.allyAlertRadiusM = clamp(Math.round(val), 40, 300);
      }
    }

    resetAllyTracking() {
      this._trackedAllies = [];
      this._allyAlerts = [];
      this._allyWrecks = [];
      this._selfWrecks = [];
      this._selfWreckSeq = 0;
      this._dangerZones = [];
      this._frontlinePoints = null;
      this._wasPlayerAlive = false;
      this._playerAbsentFrames = 0;
      this._lastAlivePlayerPos = null;
      this._lastAliveModel = "";
      this._droneControlActive = false;
      this._droneGraceUntil = 0;
      this._wasGroundPlayer = false;
      this._lastGroundPlayerPos = null;
      this._allyTrackResetAt = Date.now();
    }

    setStrategyTier(tier) {
      this.strategyTier = tier || "off";
      this._recomputeRecommendations();
    }

    setShowFrontline(enabled) {
      this.showFrontline = !!enabled;
    }

    setTheme(theme) {
      this.theme = theme === "kimi" ? "kimi" : "default";
      this._render(performance.now());
    }

    setWreckDangerRadius(meters) {
      const val = Number(meters);
      if (!Number.isNaN(val)) {
        this.wreckDangerRadiusM = clamp(Math.round(val), 40, 200);
        this._recomputeDangerZones();
      }
    }

    setDangerZoneMode(mode) {
      this.dangerZoneMode = mode === "circle" ? "circle" : "intersect";
      if (!this.airModeActive) {
        this._recomputeDangerZones();
        this._recomputeRecommendations();
      }
      this._render(performance.now());
    }

    _preloadClassIcons() {
      const meta = global.WTVehicleMeta;
      if (!meta || !meta.CLASS_ICONS) return;
      for (const [cls, url] of Object.entries(meta.CLASS_ICONS)) {
        const img = new Image();
        const entry = { img, loaded: false };
        img.onload = () => {
          entry.loaded = true;
        };
        img.src = url;
        this._classIconImgs.set(cls, entry);
      }
    }

    _getTintedClassIcon(groundClass, tintColor) {
      const entry = this._classIconImgs.get(groundClass || "medium_tank");
      if (!entry || !entry.loaded) return null;
      const key = `${groundClass || "medium_tank"}|${tintColor}`;
      let cached = this._tintedIconCache.get(key);
      if (cached) return cached;

      const size = 28;
      const off = document.createElement("canvas");
      off.width = size;
      off.height = size;
      const octx = off.getContext("2d");
      octx.drawImage(entry.img, 2, 2, size - 4, size - 4);
      octx.globalCompositeOperation = "source-in";
      octx.fillStyle = tintColor;
      octx.fillRect(0, 0, size, size);
      this._tintedIconCache.set(key, off);
      return off;
    }

    _recomputeDangerZones() {
      const engine = global.WTTacticalEngine;
      if (!engine) return;
      const combined = [...this._allyWrecks, ...this._selfWrecks];
      this._dangerZones = engine.computeDangerZones(
        combined,
        this.mapInfo,
        this.wreckDangerRadiusM,
        Date.now(),
        { mode: this.dangerZoneMode, ttlMs: this.dangerZoneTtlMs }
      );
    }

    setAirFilterMode(mode) {
      this.airFilterMode = mode === "on" || mode === "off" ? mode : "auto";
      this._syncAirMode(this._lastState);
      if (this.airModeActive) {
        this._dangerZones = [];
      } else {
        this._recomputeDangerZones();
      }
      if (global.WTTacticalEngine && this._lastState) {
        this._frontlinePoints = global.WTTacticalEngine.computeFrontline(
          this.objects,
          this._frontlinePoints,
          0.24,
          this._dangerZones,
          { airMode: this.airModeActive, excludePlayer: this._droneControlActive }
        );
      }
      this._recomputeRecommendations();
      this._render(performance.now());
    }

    _syncAirMode(state) {
      const detected = global.WTTacticalEngine && state
        ? global.WTTacticalEngine.detectAirBattle(state)
        : false;
      const nextActive =
        this.airFilterMode === "on" ? true : this.airFilterMode === "off" ? false : detected;
      this.airModeActive = nextActive;
      const badgeKey = `${this.airFilterMode}:${nextActive ? 1 : 0}`;
      if (badgeKey !== this._lastAirBadgeKey) {
        this._lastAirBadgeKey = badgeKey;
        this.callbacks.onAirModeChange?.(nextActive, this.airFilterMode);
      }
    }

    _recomputeRecommendations() {
      const engine = global.WTTacticalEngine;
      if (!engine) return;
      const res = engine.recommendRoutes(
        this.strategyTier,
        this.vectorLayers,
        this.objects,
        this._dangerZones,
        this._playerMeta,
        this.mapInfo,
        this._activeSpawn,
        { airMode: this.airModeActive }
      );
      this._recommendedIds = res.ids || new Set();
      this._dynamicRoutes = Array.isArray(res.dynamicRoutes) ? res.dynamicRoutes : [];
      if (res.tip !== this._lastRecTip) {
        this._lastRecTip = res.tip;
        this.callbacks.onRecommendationChange?.(res.tip, this.strategyTier);
      }
    }

    loadMapImage(url, fallbackUrl) {
      const reqId = ++this._mapImgReqId;
      clearTimeout(this._mapImgTimeout);
      this._mapImgTimeout = null;
      this._mapImgError = false;
      this.mapImg = null;
      this.mapImgLoaded = false;
      this._mapImgLoading = Boolean(url);
      if (!url) {
        this._render(performance.now());
        return;
      }
      if (url.startsWith("/api/preset_map_img") && this._imgCache.has(url)) {
        const cached = this._imgCache.get(url);
        this._imgCache.delete(url);
        this._imgCache.set(url, cached);
        this.mapImg = cached;
        this.mapImgLoaded = true;
        this._mapImgLoading = false;
        this._mapImgError = false;
        this.fitToViewport();
        this._render(performance.now());
        return;
      }
      const img = new Image();
      this._mapImgTimeout = setTimeout(() => {
        if (reqId !== this._mapImgReqId || !this._mapImgLoading) return;
        if (fallbackUrl) {
          this.loadMapImage(fallbackUrl, null);
          return;
        }
        this.mapImg = null;
        this.mapImgLoaded = false;
        this._mapImgLoading = false;
        this._mapImgError = true;
        this._render(performance.now());
      }, 7000);
      img.onload = () => {
        if (reqId !== this._mapImgReqId) return;
        clearTimeout(this._mapImgTimeout);
        this._mapImgTimeout = null;
        this._mapImgError = false;
        if (url.startsWith("/api/preset_map_img")) {
          if (this._imgCache.has(url)) this._imgCache.delete(url);
          this._imgCache.set(url, img);
          if (this._imgCache.size > 32) {
            const oldestKey = this._imgCache.keys().next().value;
            this._imgCache.delete(oldestKey);
          }
        }
        this.mapImg = img;
        this.mapImgLoaded = true;
        this._mapImgLoading = false;
        this.fitToViewport();
        this._render(performance.now());
      };
      img.onerror = () => {
        if (reqId !== this._mapImgReqId) return;
        clearTimeout(this._mapImgTimeout);
        this._mapImgTimeout = null;
        if (fallbackUrl) {
          this.loadMapImage(fallbackUrl, null);
          return;
        }
        this.mapImg = null;
        this.mapImgLoaded = false;
        this._mapImgLoading = false;
        this._mapImgError = true;
        this._render(performance.now());
      };
      img.src = url;
    }

    clearMapImage() {
      this._mapImgReqId += 1;
      clearTimeout(this._mapImgTimeout);
      this._mapImgTimeout = null;
      this.mapImg = null;
      this.mapImgLoaded = false;
      this._mapImgLoading = false;
      this._mapImgError = false;
    }

    setLayers(vectorLayers, pngLayers) {
      this.vectorLayers = Array.isArray(vectorLayers) ? vectorLayers : [];
      this.pngLayers = Array.isArray(pngLayers) ? pngLayers : [];
      this._recomputeRecommendations();
      this._reconcileLockedTarget();
    }

    setEditorDraft(draft) {
      this.editorDraft = draft;
    }

    setWaypoint(wp) {
      this.waypoint = wp;
      this._notifyWaypointDistance();
      this._reconcileLockedTarget();
    }

    clearWaypoint() {
      this.waypoint = null;
      this.callbacks.onWaypointChange?.(null, null);
      this._reconcileLockedTarget();
    }

    _computeDistanceMeters(ax, ay, bx, by) {
      const info = this.mapInfo;
      if (info && Array.isArray(info.map_min) && Array.isArray(info.map_max)) {
        const wMeters = Math.abs(Number(info.map_max[0]) - Number(info.map_min[0]));
        const hMeters = Math.abs(Number(info.map_max[1]) - Number(info.map_min[1]));
        if (wMeters > 0 && hMeters > 0) {
          const dxM = (bx - ax) * wMeters;
          const dyM = (by - ay) * hMeters;
          return Math.round(Math.hypot(dxM, dyM));
        }
      }
      return null;
    }

    _computeRelativeBearing(px, py, tx, ty) {
      const targetAngle = Math.atan2(ty - py, tx - px);
      const relRad = normalizeAngle(targetAngle - this.lastPlayerHeading);
      const deg = Math.round((relRad * 180) / Math.PI);
      const clock = ((Math.round(deg / 30) % 12) + 12) % 12 || 12;
      let sector = "正前";
      if (Math.abs(deg) >= 165) sector = "正后";
      else if (deg > 120) sector = "右后";
      else if (deg < -120) sector = "左后";
      else if (deg > 60) sector = "右侧";
      else if (deg < -60) sector = "左侧";
      else if (deg > 15) sector = "右前";
      else if (deg < -15) sector = "左前";
      const signDeg = deg > 0 ? `+${deg}°` : `${deg}°`;
      return {
        deg,
        clock,
        sector,
        text: `${sector} ${clock}点 (${signDeg})`,
      };
    }

    _enemyDisplayName(obj) {
      const typeName = ENEMY_ICON_NAMES[obj.icon];
      return typeName ? `敌军·${typeName}` : "点亮敌军";
    }

    /**
     * Collect rangefinder targets (capture_zone A/B/C are intentionally excluded):
     * 1) Live 8111 spotted/scouted enemies (on-map);
     * 2) Live 8111 squad/team pings;
     * 3) User custom tactical markers & temporary waypoint.
     */
    getCandidateTargets() {
      const player = this._renderPlayer || this.objects.find((o) => o.role === "player");
      const hasPlayer = player && typeof player.x === "number" && typeof player.y === "number";
      const list = [];

      if (this.showEnemies) {
        this.objects.forEach((obj, idx) => {
          if (
            obj.role === "enemy" &&
            typeof obj.x === "number" &&
            typeof obj.y === "number" &&
            obj.x >= -0.25 &&
            obj.x <= 1.25 &&
            obj.y >= -0.25 &&
            obj.y <= 1.25
          ) {
            list.push({
              id: `enemy:${idx}`,
              kind: "enemy",
              label: this._enemyDisplayName(obj),
              color: "#ef4444",
              icon: obj.icon || "",
              x: obj.x,
              y: obj.y,
            });
          }
        });
      }

      for (const layer of this.vectorLayers) {
        if (!layer || !layer.visible) continue;
        const elements = Array.isArray(layer.elements) ? layer.elements : [];
        elements.forEach((el, elIdx) => {
          if (el && el.kind === "marker" && Array.isArray(el.point)) {
            if (layer.id === "workbench_reference_routes" && !el.label) {
              return;
            }
            list.push({
              id: `marker:${layer.id}:${elIdx}`,
              kind: "marker",
              label: el.label || "卡点标记",
              color: el.color || layer.color || "#38bdf8",
              icon: el.icon || "sniper",
              x: el.point[0],
              y: el.point[1],
            });
          }
        });
      }

      if (this.waypoint) {
        list.push({
          id: "waypoint",
          kind: "waypoint",
          label: "临时路标",
          color: "#f59e0b",
          icon: "waypoint",
          x: this.waypoint.x,
          y: this.waypoint.y,
        });
      }

      const pingNow = Date.now();
      this._recentPings = this._recentPings.filter((p) => p.expiresAt > pingNow);
      for (const ping of this._recentPings) {
        list.push({
          id: ping.id,
          kind: "ping",
          label: ping.label,
          color: ping.color || "#facc15",
          icon: "ping",
          x: ping.x,
          y: ping.y,
        });
      }

      for (const item of list) {
        if (hasPlayer) {
          item.normDist = Math.hypot(item.x - player.x, item.y - player.y);
          item.distM = this._computeDistanceMeters(player.x, player.y, item.x, item.y);
        } else {
          item.normDist = 0;
          item.distM = null;
        }
      }

      if (hasPlayer) {
        list.sort((a, b) => a.normDist - b.normDist);
      }
      return list;
    }

    _findLockedIndex(candidates, locked) {
      if (!locked || !candidates.length) return -1;
      if (locked.kind !== "enemy") {
        return candidates.findIndex((c) => c.id === locked.id);
      }
      // Track spotted enemy by nearest proximity (handles array index shifts across 8Hz polls)
      let bestIdx = -1;
      let bestScore = Infinity;
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (c.kind !== "enemy") continue;
        const d = Math.hypot(c.x - locked.x, c.y - locked.y);
        if (d > 0.045) continue;
        const score = d + (c.icon === locked.icon ? 0 : 0.01);
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      return bestIdx;
    }

    _reconcileLockedTarget() {
      if (!this.lockedTarget) {
        this._notifyTargetChange();
        return;
      }
      const candidates = this.getCandidateTargets();
      const idx = this._findLockedIndex(candidates, this.lockedTarget);
      if (idx >= 0) {
        this.lockedTarget = candidates[idx];
      } else {
        this.lockedTarget = candidates.length > 0 ? candidates[0] : null;
      }
      this._notifyTargetChange();
    }

    clearTargetLock() {
      if (!this.lockedTarget) return;
      this.lockedTarget = null;
      this._notifyTargetChange();
    }

    cycleTarget(step) {
      const candidates = this.getCandidateTargets();
      if (candidates.length === 0) {
        this.clearTargetLock();
        return null;
      }
      const idx = this._findLockedIndex(candidates, this.lockedTarget);
      let nextIdx = 0;
      if (idx < 0) {
        nextIdx = step >= 0 ? 0 : candidates.length - 1;
      } else {
        nextIdx = (idx + step + candidates.length) % candidates.length;
      }
      this.lockedTarget = candidates[nextIdx];
      this._notifyTargetChange();
      return this.lockedTarget;
    }

    _handleTargetClickAt(sx, sy, hitRadiusPx) {
      const candidates = this.getCandidateTargets();
      let best = null;
      let bestDist = hitRadiusPx;
      for (const c of candidates) {
        const pt = this._screenPoint(c.x, c.y);
        const d = Math.hypot(pt.x - sx, pt.y - sy);
        if (d <= bestDist) {
          bestDist = d;
          best = c;
        }
      }
      if (!best) {
        if (this.lockedTarget) this.clearTargetLock();
        return;
      }
      const sameTarget =
        this.lockedTarget &&
        (best.kind !== "enemy"
          ? this.lockedTarget.id === best.id
          : this.lockedTarget.kind === "enemy" &&
            Math.hypot(this.lockedTarget.x - best.x, this.lockedTarget.y - best.y) < 0.005);
      if (sameTarget) {
        this.clearTargetLock();
      } else {
        this.lockedTarget = best;
        this._notifyTargetChange();
      }
    }

    _notifyTargetChange() {
      if (!this.lockedTarget) {
        if (this._lastTargetNotifyKey !== "") {
          this._lastTargetNotifyKey = "";
          this.callbacks.onTargetChange?.(null);
        }
        return;
      }
      const candidates = this.getCandidateTargets();
      const idx = this._findLockedIndex(candidates, this.lockedTarget);
      const player = this._renderPlayer || this.objects.find((o) => o.role === "player");
      const hasPlayer = player && typeof player.x === "number" && typeof player.y === "number";
      const distM = hasPlayer
        ? this._computeDistanceMeters(player.x, player.y, this.lockedTarget.x, this.lockedTarget.y)
        : null;
      const bearing = hasPlayer
        ? this._computeRelativeBearing(player.x, player.y, this.lockedTarget.x, this.lockedTarget.y)
        : null;

      const key = `${this.lockedTarget.id}|${this.lockedTarget.label}|${distM}|${bearing ? bearing.deg : ""}|${idx}|${candidates.length}`;
      if (key === this._lastTargetNotifyKey) return;
      this._lastTargetNotifyKey = key;
      this.callbacks.onTargetChange?.({
        target: this.lockedTarget,
        distM,
        bearing,
        index: idx >= 0 ? idx + 1 : 1,
        total: candidates.length,
      });
    }

    getWaypointDistanceMeters() {
      if (!this.waypoint) return null;
      const player = this.objects.find((o) => o.role === "player");
      if (!player) return null;

      const info = this.mapInfo;
      if (info && Array.isArray(info.map_min) && Array.isArray(info.map_max)) {
        const wMeters = Math.abs(Number(info.map_max[0]) - Number(info.map_min[0]));
        const hMeters = Math.abs(Number(info.map_max[1]) - Number(info.map_min[1]));
        if (wMeters > 0 && hMeters > 0) {
          const dxM = (this.waypoint.x - player.x) * wMeters;
          const dyM = (this.waypoint.y - player.y) * hMeters;
          return Math.round(Math.hypot(dxM, dyM));
        }
      }
      return null;
    }

    _notifyWaypointDistance() {
      if (!this.waypoint) {
        this.callbacks.onWaypointChange?.(null, null);
        return;
      }
      this.callbacks.onWaypointChange?.(this.waypoint, this.getWaypointDistanceMeters());
    }

    _syncMapPings(objects) {
      const now = Date.now();
      for (const obj of objects) {
        if (obj.role !== "ping" || typeof obj.x !== "number" || typeof obj.y !== "number") {
          continue;
        }
        const existing = this._recentPings.find(
          (p) => Math.hypot(p.x - obj.x, p.y - obj.y) < 0.018
        );
        if (existing) {
          existing.x = obj.x;
          existing.y = obj.y;
          existing.lastSeenAt = now;
          existing.expiresAt = now + 5000;
        } else {
          this._recentPings.push({
            id: `ping:${++this._pingSeq}`,
            x: obj.x,
            y: obj.y,
            color: obj.color || "#facc15",
            label: obj.ping_kind === "squad" ? "小队标点" : "队友报点",
            createdAt: now,
            lastSeenAt: now,
            expiresAt: now + 5000,
          });
        }
      }
      this._recentPings = this._recentPings.filter((p) => p.expiresAt > now);
    }

    updateLiveState(state) {
      this._lastState = state;
      this.mapInfo = state.map_info || null;
      this.objects = Array.isArray(state.objects) ? state.objects : [];
      this._syncAirMode(state);
      this._syncMapPings(this.objects);

      if (this._autoFitPending && this.objects.some((o) => o && (o.role === "spawn_ally" || o.role === "spawn_enemy" || o.role === "capture_zone"))) {
        this.fitCombatZone();
        this._autoFitPending = false;
      }

      const player = this.objects.find((o) => o.role === "player");
      const metaApi = global.WTVehicleMeta;
      const tel = state.telemetry || {};
      this._playerMeta = metaApi
        ? metaApi.resolvePlayerVehicle(tel.vehicle_type, player ? player.icon : "")
        : { shortName: "", groundClass: "medium_tank", mobility: "medium" };

      const playerOnMap = Boolean(
        player &&
          typeof player.x === "number" &&
          typeof player.y === "number" &&
          player.x >= 0 &&
          player.x <= 1 &&
          player.y >= 0 &&
          player.y <= 1
      );
      const telemetryValid = tel.valid !== false;
      const playerAliveNow = playerOnMap && telemetryValid;

      const engine = global.WTTacticalEngine;
      const explicitDrone = Boolean(engine && engine.isDroneVehicle && engine.isDroneVehicle(tel.vehicle_type, player));
      const telArmyAir = /air|heli/i.test(String(tel.army || ""));
      const playerIsAir = Boolean(player && engine && engine.isAirUnit && engine.isAirUnit(player));
      const tempAirSubUnit = !this.airModeActive && this._wasGroundPlayer && (telArmyAir || playerIsAir);
      const isDroneNow = explicitDrone || tempAirSubUnit;

      if (playerAliveNow) {
        if (isDroneNow) {
          if (!this._droneControlActive) {
            this._droneControlActive = true;
            this.callbacks.onDroneControlChange?.(true, tel.vehicle_type || "");
          }
          this._droneGraceUntil = Date.now() + 6000;
          this._wasPlayerAlive = true;
          this._playerAbsentFrames = 0;
        } else {
          if (this._droneControlActive) {
            this._droneControlActive = false;
            this._droneGraceUntil = Date.now() + 4500;
            this.callbacks.onDroneControlChange?.(false, "");
          }
          if (!telArmyAir && !playerIsAir) {
            this._wasGroundPlayer = true;
            this._lastGroundPlayerPos = { x: player.x, y: player.y };
          }
          this._wasPlayerAlive = true;
          this._playerAbsentFrames = 0;
          this._lastAlivePlayerPos = { x: player.x, y: player.y };
          if (this._playerMeta.shortName) {
            this._lastAliveModel = this._playerMeta.shortName;
          }
        }
      } else if (this._wasPlayerAlive) {
        this._playerAbsentFrames += 1;
        if (tel.valid === false || this._playerAbsentFrames >= 2) {
          const droneExempt = this._droneControlActive || Date.now() < this._droneGraceUntil || isDroneNow;
          if (droneExempt) {
            this._droneGraceUntil = Date.now() + 4500;
            this.callbacks.onDroneCrashExempt?.();
          } else if (this._lastAlivePlayerPos) {
            this._selfWreckSeq += 1;
            this._selfWrecks.push({
              seq: this._selfWreckSeq,
              x: this._lastAlivePlayerPos.x,
              y: this._lastAlivePlayerPos.y,
              model: this._lastAliveModel || this._playerMeta.shortName || "载具",
              ts: Date.now(),
              isSelf: true,
            });
            this._recomputeDangerZones();
            this.callbacks.onSelfWreck?.(this._selfWrecks[this._selfWrecks.length - 1]);
          }
          this._wasPlayerAlive = false;
          this._playerAbsentFrames = 0;
        }
      }

      if (!player || typeof player.x !== "number" || typeof player.y !== "number") {
        this._playerWasAbsent = true;
        this._renderPlayer = null;
        if (this.waypoint) {
          this._notifyWaypointDistance();
        }
        return;
      }

      const vehicleKey = `${player.type || ""}|${state.telemetry?.vehicle_type || ""}|${state.telemetry?.army || ""}`;
      const currentSeg = this.playerTrail[this.playerTrail.length - 1];
      const lastTrail = currentSeg && currentSeg.length ? currentSeg[currentSeg.length - 1] : null;
      const distFromLastPos = this.lastPlayerPos
        ? Math.hypot(player.x - this.lastPlayerPos.x, player.y - this.lastPlayerPos.y)
        : 0;
      const distFromLastTrail = lastTrail
        ? Math.hypot(player.x - lastTrail[0], player.y - lastTrail[1])
        : 0;

      const teleported =
        (this.lastPlayerPos && distFromLastPos > TRAIL_JUMP_THRESHOLD) ||
        (lastTrail && distFromLastTrail > TRAIL_JUMP_THRESHOLD);
      const vehicleChanged = this._lastVehicleKey !== null && vehicleKey !== this._lastVehicleKey;
      const needNewSegment = !currentSeg || this._playerWasAbsent || teleported || vehicleChanged;

      // Heading from dx/dy, or movement delta only within the same continuous segment
      if (
        typeof player.dx === "number" &&
        typeof player.dy === "number" &&
        (Math.abs(player.dx) > 1e-4 || Math.abs(player.dy) > 1e-4)
      ) {
        this.lastPlayerHeading = Math.atan2(player.dy, player.dx);
      } else if (!needNewSegment && this.lastPlayerPos) {
        const mdx = player.x - this.lastPlayerPos.x;
        const mdy = player.y - this.lastPlayerPos.y;
        if (Math.hypot(mdx, mdy) > 0.0015) {
          this.lastPlayerHeading = Math.atan2(mdy, mdx);
        }
      }

      if (needNewSegment) {
        if (currentSeg && currentSeg.length < 2) {
          this.playerTrail.pop();
        }
        this.playerTrail.push([[player.x, player.y]]);
        // Snap render-time interpolation immediately on respawn/teleport/vehicle switch
        this._renderPlayer = { x: player.x, y: player.y };
      } else if (distFromLastTrail > 0.004) {
        currentSeg.push([player.x, player.y]);
      }

      if (!this._droneControlActive && (needNewSegment || !this._activeSpawn)) {
        let bestSpawn = null;
        let bestDist = Infinity;
        for (const obj of this.objects) {
          if (obj && obj.role === "spawn_ally" && typeof obj.x === "number" && typeof obj.y === "number") {
            const d = Math.hypot(obj.x - player.x, obj.y - player.y);
            if (d < bestDist) {
              bestDist = d;
              bestSpawn = { x: obj.x, y: obj.y };
            }
          }
        }
        this._activeSpawn = bestSpawn || { x: player.x, y: player.y };
      }

      this._trimPlayerTrail();
      this._playerWasAbsent = false;
      this._lastVehicleKey = vehicleKey;
      this.lastPlayerPos = { x: player.x, y: player.y };
      if (this.airModeActive) {
        this._dangerZones = [];
      } else {
        const groundPlayerRef =
          this._droneControlActive && this._lastGroundPlayerPos ? this._lastGroundPlayerPos : player;
        this._trackAllyDisappearances(this.objects, groundPlayerRef);
        this._recomputeDangerZones();
      }
      if (global.WTTacticalEngine) {
        this._frontlinePoints = global.WTTacticalEngine.computeFrontline(
          this.objects,
          this._frontlinePoints,
          0.24,
          this._dangerZones,
          { airMode: this.airModeActive, excludePlayer: this._droneControlActive }
        );
      }
      this._recomputeRecommendations();

      if (this.waypoint) {
        this._notifyWaypointDistance();
      }
      this._reconcileLockedTarget();
    }

    _trackAllyDisappearances(objects, player) {
      const now = Date.now();
      const groundAllies = [];
      for (const obj of objects) {
        if (!obj || obj.role !== "ally") continue;
        if (typeof obj.x !== "number" || typeof obj.y !== "number") continue;
        if (obj.x < -0.1 || obj.x > 1.1 || obj.y < -0.1 || obj.y > 1.1) continue;
        const typeLow = String(obj.type || "").toLowerCase();
        const iconStr = String(obj.icon || "");
        if (typeLow === "aircraft" || /fighter|bomber|assault|heli/i.test(iconStr)) {
          continue;
        }
        groundAllies.push(obj);
      }

      let matchThresh = 0.03;
      let moveThresh = 0.00055;
      const info = this.mapInfo;
      if (info && Array.isArray(info.map_min) && Array.isArray(info.map_max)) {
        const wMeters = Math.abs(Number(info.map_max[0]) - Number(info.map_min[0]));
        if (wMeters > 0) {
          matchThresh = clamp(55 / wMeters, 0.018, 0.045);
          moveThresh = clamp(1.8 / wMeters, 0.00035, 0.00085);
        }
      }

      const prevTrackCount = this._trackedAllies.length;
      const pairs = [];
      for (let ti = 0; ti < this._trackedAllies.length; ti++) {
        const tr = this._trackedAllies[ti];
        for (let ai = 0; ai < groundAllies.length; ai++) {
          const al = groundAllies[ai];
          const d = Math.hypot(tr.x - al.x, tr.y - al.y);
          if (d <= matchThresh) {
            const iconPenalty = tr.icon && al.icon && tr.icon !== al.icon ? 0.008 : 0;
            const typePenalty = tr.type && al.type && tr.type !== al.type ? 0.008 : 0;
            const colorPenalty = tr.color && al.color && tr.color !== al.color ? 0.006 : 0;
            pairs.push({ ti, ai, d, cost: d + iconPenalty + typePenalty + colorPenalty });
          }
        }
      }
      pairs.sort((a, b) => a.cost - b.cost);

      const matchedTracks = new Set();
      const matchedAllies = new Set();
      for (const p of pairs) {
        if (matchedTracks.has(p.ti) || matchedAllies.has(p.ai)) continue;
        matchedTracks.add(p.ti);
        matchedAllies.add(p.ai);
        const tr = this._trackedAllies[p.ti];
        const al = groundAllies[p.ai];
        if (typeof tr.anchorX !== "number" || typeof tr.anchorY !== "number") {
          tr.anchorX = tr.x;
          tr.anchorY = tr.y;
        }
        const cdx = al.x - tr.anchorX;
        const cdy = al.y - tr.anchorY;
        const cumDist = Math.hypot(cdx, cdy);
        if (cumDist >= moveThresh) {
          const ux = cdx / cumDist;
          const uy = cdy / cumDist;
          if (tr.hasHeading) {
            const bx = tr.dx * 0.55 + ux * 0.45;
            const by = tr.dy * 0.55 + uy * 0.45;
            const bl = Math.hypot(bx, by) || 1;
            tr.dx = bx / bl;
            tr.dy = by / bl;
          } else {
            tr.dx = ux;
            tr.dy = uy;
          }
          tr.hasHeading = true;
          tr.moving = true;
          tr.stillFrames = 0;
          tr.anchorX = al.x;
          tr.anchorY = al.y;
        } else {
          tr.stillFrames = (tr.stillFrames || 0) + 1;
          if (tr.stillFrames >= 8) {
            tr.moving = false;
            tr.anchorX = al.x;
            tr.anchorY = al.y;
          }
        }
        if (
          tr.moving &&
          tr.hasHeading &&
          (typeof al.dx !== "number" || typeof al.dy !== "number" || (Math.abs(al.dx) <= 1e-4 && Math.abs(al.dy) <= 1e-4))
        ) {
          al.dx = tr.dx;
          al.dy = tr.dy;
        }
        tr.x = al.x;
        tr.y = al.y;
        tr.icon = al.icon || "";
        tr.type = al.type || "";
        tr.color = al.color || "";
        tr.lastSeenAt = now;
        tr.missedFrames = 0;
        tr.seenFrames += 1;
      }

      const activeTracks = [];
      const expiredTracks = [];
      for (let ti = 0; ti < this._trackedAllies.length; ti++) {
        const tr = this._trackedAllies[ti];
        if (!matchedTracks.has(ti)) {
          tr.missedFrames += 1;
        }
        if (tr.missedFrames >= 3) {
          expiredTracks.push(tr);
        } else {
          activeTracks.push(tr);
        }
      }

      for (let ai = 0; ai < groundAllies.length; ai++) {
        if (matchedAllies.has(ai)) continue;
        const al = groundAllies[ai];
        activeTracks.push({
          id: ++this._allyTrackSeq,
          x: al.x,
          y: al.y,
          anchorX: al.x,
          anchorY: al.y,
          dx: 0,
          dy: 0,
          hasHeading: false,
          moving: false,
          stillFrames: 0,
          icon: al.icon || "",
          type: al.type || "",
          color: al.color || "",
          lastSeenAt: now,
          seenFrames: 1,
          missedFrames: 0,
        });
      }
      this._trackedAllies = activeTracks;

      const massVanish =
        prevTrackCount >= 4 &&
        expiredTracks.length >= Math.max(4, Math.ceil(prevTrackCount * 0.75));
      if (
        !this.allyAlertEnabled ||
        expiredTracks.length === 0 ||
        now - this._allyTrackResetAt < 1500 ||
        massVanish
      ) {
        return;
      }

      const triggered = [];
      for (const tr of expiredTracks) {
        if (tr.seenFrames < 4) continue;

        this._allyWrecks.push({
          x: tr.x,
          y: tr.y,
          ts: now,
          isSelf: false,
        });
        if (this._allyWrecks.length > 64) {
          this._allyWrecks.shift();
        }

        const distM = this._computeDistanceMeters(player.x, player.y, tr.x, tr.y);
        if (distM === null || distM > this.allyAlertRadiusM) continue;

        const bearing = this._computeRelativeBearing(player.x, player.y, tr.x, tr.y);
        const bearingText = bearing ? `${bearing.sector} ${bearing.clock}点` : "";

        const existing = this._allyAlerts.find(
          (a) => now - a.createdAt < 1800 && Math.hypot(a.x - tr.x, a.y - tr.y) < 0.015
        );
        if (existing) {
          existing.count += 1;
          existing.distM = Math.min(existing.distM, distM);
          if (bearingText) existing.bearingText = bearingText;
          existing.expiresAt = now + 6500;
          triggered.push(existing);
        } else {
          const alertObj = {
            id: `ally_loss:${++this._allyAlertSeq}`,
            x: tr.x,
            y: tr.y,
            distM,
            bearingText,
            count: 1,
            createdAt: now,
            expiresAt: now + 6500,
          };
          this._allyAlerts.push(alertObj);
          triggered.push(alertObj);
        }
      }

      if (triggered.length > 0) {
        let nearest = triggered[0];
        for (const item of triggered) {
          if (item.distM < nearest.distM) nearest = item;
        }
        this.callbacks.onNearbyAllyLost?.({
          alerts: triggered,
          nearest,
          count: triggered.length,
        });
      }
    }

    _getCachedOverlayImg(filePath) {
      let entry = this.pngCache.get(filePath);
      if (!entry) {
        const img = new Image();
        entry = { img, loaded: false, error: false };
        img.onload = () => { entry.loaded = true; };
        img.onerror = () => { entry.error = true; };
        img.src = "/" + String(filePath).replace(/^\/+/, "");
        this.pngCache.set(filePath, entry);
      }
      return entry;
    }

    _startLoop() {
      const frame = (now) => {
        this._render(now);
        this._rafId = requestAnimationFrame(frame);
      };
      this._rafId = requestAnimationFrame(frame);
    }

    _render(now) {
      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      ctx.clearRect(0, 0, this._width, this._height);

      const dt = this._lastFrameTs
        ? Math.min(0.1, Math.max(0.001, (now - this._lastFrameTs) / 1000))
        : 0.016;
      this._lastFrameTs = now;
      this._updateRenderPlayer(dt);
      this._updateRotation(dt);
      const rect = this._getMapRect();

      // Whole map layer (image, routes, units, trail) rotates around canvas center;
      // text labels cancel this rotation inside _withUpright().
      ctx.save();
      if (Math.abs(this._mapRotation) > 1e-6) {
        ctx.translate(this._width / 2, this._height / 2);
        ctx.rotate(this._mapRotation);
        ctx.translate(-this._width / 2, -this._height / 2);
      }

      // 1. Base map image or offline tactical grid
      if (this.mapImgLoaded && this.mapImg) {
        ctx.drawImage(this.mapImg, rect.x, rect.y, rect.w, rect.h);
      } else {
        this._drawOfflineGrid(ctx, rect);
      }

      // Subtle dark frame border around map
      ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      if (this._mapImgLoading) {
        this._drawPillLabel(ctx, rect.x + rect.w / 2, rect.y + rect.h / 2, "正在加载底图...", "#38bdf8");
      } else if (this._mapImgError) {
        this._drawPillLabel(ctx, rect.x + rect.w / 2, rect.y + rect.h / 2, "底图加载失败（网络较慢或离线，可重试）", "#ef4444");
      }

      // 2. Transparent PNG route layers (wait until base map finishes loading so routes never float alone)
      if (!this._mapImgLoading) {
        for (const layer of this.pngLayers) {
          if (!layer || !layer.visible || !layer.file) continue;
          const cached = this._getCachedOverlayImg(layer.file);
          if (cached.loaded) {
            ctx.save();
            ctx.globalAlpha = clamp(Number(layer.opacity ?? 0.8), 0, 1);
            ctx.drawImage(cached.img, rect.x, rect.y, rect.w, rect.h);
            ctx.restore();
          }
        }

        // 2b. Yellow overlapping wreck danger zones (ground mode only)
        if (!this.airModeActive && this._dangerZones.length > 0) {
          this._drawDangerZones(ctx, rect, now);
        }

        // 3. Vector route layers (with optional 3-tier recommendation highlight)
        for (const layer of this.vectorLayers) {
          if (!layer || !layer.visible) continue;
          const layerColor = layer.color || "#00e5ff";
          const elements = Array.isArray(layer.elements) ? layer.elements : [];
          elements.forEach((el, elIdx) => {
            const isRec = this._recommendedIds.has(`${layer.id}:${elIdx}`);
            this._drawVectorElement(ctx, rect, el, layerColor, isRec, now);
          });
        }

        // 3a. Live 8111 corridor-density dynamic recommended route
        if (this.strategyTier !== "off" && Array.isArray(this._dynamicRoutes)) {
          for (const dyn of this._dynamicRoutes) {
            this._drawDynamicRoute(ctx, rect, dyn, now);
          }
        }
      }

      // 3b. Dynamic frontline band
      if (this.showFrontline && Array.isArray(this._frontlinePoints) && this._frontlinePoints.length >= 2) {
        this._drawFrontline(ctx, rect, now);
      }

      // 4. Live drawing draft preview
      if (this.editorDraft) {
        this._drawEditorDraft(ctx, rect, this.editorDraft);
      }

      // 5. Spawn points & Capture zones
      if (this.showSpawns) {
        for (const obj of this.objects) {
          if (obj.role === "spawn_ally" || obj.role === "spawn_enemy") {
            this._drawSpawn(ctx, rect, obj);
          }
        }
      }

      if (this.showCaps) {
        const capLabels = ["A", "B", "C", "D", "E"];
        let capIdx = 0;
        for (const obj of this.objects) {
          if (obj.role === "capture_zone") {
            const label = capLabels[capIdx] || String(capIdx + 1);
            capIdx += 1;
            this._drawCaptureZone(ctx, rect, obj, label, now);
          }
        }
      }

      // 6. Allies & Spotted Enemies (in air mode, ignore ground/naval units)
      if (this.showAllies) {
        for (const obj of this.objects) {
          if (obj.role === "ally") {
            if (this.airModeActive && global.WTTacticalEngine && !global.WTTacticalEngine.isAirUnit(obj)) continue;
            this._drawUnitMarker(ctx, rect, obj, obj.color || "#3b82f6", false, now);
          }
        }
      }

      if (this.showEnemies) {
        for (const obj of this.objects) {
          if (obj.role === "enemy") {
            if (this.airModeActive && global.WTTacticalEngine && !global.WTTacticalEngine.isAirUnit(obj)) continue;
            this._drawUnitMarker(ctx, rect, obj, "#ef4444", true, now);
          }
        }
      }

      // 6b. Squad / Team Map Pings (kept briefly with pulse + fade)
      const wallNow = Date.now();
      this._recentPings = this._recentPings.filter((p) => p.expiresAt > wallNow);
      for (const ping of this._recentPings) {
        this._drawMapPing(ctx, rect, ping, now, wallNow);
      }

      // 6c. Nearby Ally Disappearance Alerts (pure-rule proximity pulse + fade)
      this._allyAlerts = this._allyAlerts.filter((a) => a.expiresAt > wallNow);
      if (this.allyAlertEnabled) {
        for (const alert of this._allyAlerts) {
          this._drawAllyLossAlert(ctx, rect, alert, now, wallNow);
        }
      }

      // 6d. Persistent Own-Vehicle Wrecks (ground mode only)
      if (!this.airModeActive) {
        for (const wk of this._selfWrecks) {
          this._drawSelfWreck(ctx, rect, wk);
        }
      }

      // 7. Player trail & Player arrow
      if (this.showTrail && this.playerTrail.length > 0) {
        this._drawPlayerTrail(ctx, rect);
      }

      const player = this.objects.find((o) => o.role === "player");
      if (player) {
        // Draw at the eased position so the arrow glides with the follow camera.
        const drawn = this._renderPlayer ? { ...player, x: this._renderPlayer.x, y: this._renderPlayer.y } : player;
        this._drawPlayerMarker(ctx, rect, drawn);
      }

      // 8. Temporary tactical waypoint
      if (this.waypoint) {
        this._drawWaypoint(ctx, rect, this.waypoint, player, now);
      }

      // 9. Locked target rangefinder overlay
      if (this.lockedTarget) {
        const drawnPlayer = player
          ? (this._renderPlayer ? { ...player, x: this._renderPlayer.x, y: this._renderPlayer.y } : player)
          : null;
        this._drawTargetRangefinder(ctx, rect, this.lockedTarget, drawnPlayer, now);
      }

      ctx.restore(); // rotation
      ctx.restore(); // dpr transform
    }

    _drawOfflineGrid(ctx, rect) {
      ctx.fillStyle = "#101720";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

      ctx.strokeStyle = "rgba(148, 163, 184, 0.14)";
      ctx.lineWidth = 1;
      const cols = 8;
      ctx.font = "11px Consolas, monospace";
      ctx.fillStyle = "rgba(148, 163, 184, 0.45)";
      const letters = "ABCDEFGH";

      for (let i = 0; i <= cols; i++) {
        const gx = rect.x + (rect.w * i) / cols;
        const gy = rect.y + (rect.h * i) / cols;
        ctx.beginPath();
        ctx.moveTo(gx, rect.y);
        ctx.lineTo(gx, rect.y + rect.h);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(rect.x, gy);
        ctx.lineTo(rect.x + rect.w, gy);
        ctx.stroke();

        if (i < cols) {
          this._withUpright(ctx, gx + 5, rect.y + 14, (c, tx, ty) => {
            c.fillText(String(i + 1), tx, ty);
          });
          this._withUpright(ctx, rect.x + 5, gy + 16, (c, tx, ty) => {
            c.fillText(letters[i], tx, ty);
          });
        }
      }
    }

    _drawPillLabel(ctx, x, y, text, borderColor, offsetY) {
      if (!text) return;
      const dy = Number(offsetY) || 0;
      // offsetY is applied in *screen* space (after cancelling map rotation), so a
      // label meant to sit "above" a marker stays above it in heading-up mode.
      this._withUpright(ctx, x, y, (c, tx, ty0) => {
        const ty = ty0 + dy;
        c.save();
        c.font = "600 11.5px 'Microsoft YaHei', sans-serif";
        const padX = 7;
        const metrics = c.measureText(text);
        const boxW = metrics.width + padX * 2;
        const boxH = 20;
        const bx = tx - boxW / 2;
        const by = ty - boxH / 2;

        c.fillStyle = "rgba(10, 15, 22, 0.85)";
        c.strokeStyle = borderColor || "rgba(255, 255, 255, 0.25)";
        c.lineWidth = 1;
        c.beginPath();
        c.roundRect ? c.roundRect(bx, by, boxW, boxH, 4) : c.rect(bx, by, boxW, boxH);
        c.fill();
        c.stroke();

        c.fillStyle = "#e6edf3";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(text, tx, ty + 0.5);
        c.restore();
      });
    }

    _drawArrowHead(ctx, x, y, angle, size, color) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size, -size * 0.48);
      ctx.lineTo(-size * 0.72, 0);
      ctx.lineTo(-size, size * 0.48);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    setReferenceBounds(hint) {
      if (
        hint &&
        Array.isArray(hint.map_min) &&
        Array.isArray(hint.map_max) &&
        hint.map_min.length >= 2 &&
        hint.map_max.length >= 2
      ) {
        this.refBounds = {
          map_min: [Number(hint.map_min[0]), Number(hint.map_min[1])],
          map_max: [Number(hint.map_max[0]), Number(hint.map_max[1])],
        };
      } else {
        this.refBounds = null;
      }
    }

    _refToDisplayNorm(nx, ny) {
      const live = this.mapInfo;
      const ref = this.refBounds;
      if (
        !live ||
        !ref ||
        !Array.isArray(live.map_min) ||
        !Array.isArray(live.map_max) ||
        live.map_min.length < 2 ||
        live.map_max.length < 2
      ) {
        return [nx, ny];
      }
      const rMinX = ref.map_min[0];
      const rMinY = ref.map_min[1];
      const rMaxX = ref.map_max[0];
      const rMaxY = ref.map_max[1];
      const lMinX = Number(live.map_min[0]);
      const lMinY = Number(live.map_min[1]);
      const lMaxX = Number(live.map_max[0]);
      const lMaxY = Number(live.map_max[1]);

      if (
        Math.abs(rMinX - lMinX) <= 1 &&
        Math.abs(rMinY - lMinY) <= 1 &&
        Math.abs(rMaxX - lMaxX) <= 1 &&
        Math.abs(rMaxY - lMaxY) <= 1
      ) {
        return [nx, ny];
      }
      const rW = rMaxX - rMinX;
      const rH = rMaxY - rMinY;
      const lW = lMaxX - lMinX;
      const lH = lMaxY - lMinY;
      if (!Number.isFinite(rW) || !Number.isFinite(rH) || !Number.isFinite(lW) || !Number.isFinite(lH) || Math.abs(lW) < 1 || Math.abs(lH) < 1) {
        return [nx, ny];
      }
      const wx = rMinX + nx * rW;
      const wy = rMinY + ny * rH;
      return [(wx - lMinX) / lW, (wy - lMinY) / lH];
    }

    _refScaleFactors() {
      const live = this.mapInfo;
      const ref = this.refBounds;
      if (
        !live ||
        !ref ||
        !Array.isArray(live.map_min) ||
        !Array.isArray(live.map_max) ||
        live.map_min.length < 2 ||
        live.map_max.length < 2
      ) {
        return { sx: 1, sy: 1 };
      }
      const rW = Math.abs(ref.map_max[0] - ref.map_min[0]);
      const rH = Math.abs(ref.map_max[1] - ref.map_min[1]);
      const lW = Math.abs(Number(live.map_max[0]) - Number(live.map_min[0]));
      const lH = Math.abs(Number(live.map_max[1]) - Number(live.map_min[1]));
      if (lW < 1 || lH < 1 || rW < 1 || rH < 1) {
        return { sx: 1, sy: 1 };
      }
      return { sx: rW / lW, sy: rH / lH };
    }

    _isYellowSightline(el, color) {
      if (!el || el.kind !== "polyline" || el.arrow === false) return false;
      if (!Array.isArray(el.points) || el.points.length !== 2) return false;
      const c = String(color || "").trim().toLowerCase();
      if (
        c === "#fff143" ||
        c === "#f59e0b" ||
        c === "#facc15" ||
        c === "#fde047" ||
        c === "#fbbf24" ||
        c === "#eab308"
      ) {
        return true;
      }
      const m = /^#([0-9a-f]{6})$/.exec(c);
      if (!m) return false;
      const r = parseInt(m[1].slice(0, 2), 16);
      const g = parseInt(m[1].slice(2, 4), 16);
      const b = parseInt(m[1].slice(4, 6), 16);
      return r >= 220 && g >= 165 && b <= 110;
    }

    _drawVectorElement(ctx, rect, el, fallbackColor, isRecommended, now) {
      if (!el || !el.kind) return;
      const color = el.color || fallbackColor;

      if (el.kind === "ellipse" && Array.isArray(el.point)) {
        const [cx, cy] = this._refToDisplayNorm(el.point[0], el.point[1]);
        const { sx, sy } = this._refScaleFactors();
        const center = this.mapToScreen(cx, cy, rect);
        const rxPx = Math.max(4, (Number(el.rx) || 0.06) * sx * rect.w);
        const ryPx = Math.max(4, (Number(el.ry) || 0.04) * sy * rect.h);
        ctx.save();
        ctx.fillStyle = hexToRgba(color, 0.16);
        ctx.strokeStyle = hexToRgba(color, 0.9);
        ctx.lineWidth = 2.2;
        if (el.dashed) ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, rxPx, ryPx, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        if (el.label) {
          this._drawPillLabel(ctx, center.x, center.y, el.label, color);
        }
        return;
      }

      if (el.kind === "zone" && Array.isArray(el.point)) {
        const [cx, cy] = this._refToDisplayNorm(el.point[0], el.point[1]);
        const { sx } = this._refScaleFactors();
        const center = this.mapToScreen(cx, cy, rect);
        const radiusPx = Math.max(10, (Number(el.radius) || 0.06) * sx * rect.w);
        ctx.save();
        ctx.fillStyle = hexToRgba(color, 0.16);
        ctx.strokeStyle = hexToRgba(color, 0.85);
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        if (el.label) {
          this._drawPillLabel(ctx, center.x, center.y, el.label, color);
        }
        return;
      }

      if (el.kind === "marker" && Array.isArray(el.point)) {
        const [mx, my] = this._refToDisplayNorm(el.point[0], el.point[1]);
        const pt = this.mapToScreen(mx, my, rect);
        ctx.save();
        ctx.strokeStyle = "#0b0f14";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y - 8);
        ctx.lineTo(pt.x + 8, pt.y);
        ctx.lineTo(pt.x, pt.y + 8);
        ctx.lineTo(pt.x - 8, pt.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        if (el.label) {
          this._drawPillLabel(ctx, pt.x, pt.y, el.label, color, -20);
        }
        return;
      }

      if ((el.kind === "polyline" || el.kind === "curve") && Array.isArray(el.points) && el.points.length >= 2) {
        if (!isRecommended && this._isYellowSightline(el, color)) {
          const p0 = this._refToDisplayNorm(el.points[0][0], el.points[0][1]);
          const p1 = this._refToDisplayNorm(el.points[1][0], el.points[1][1]);
          const dx = p1[0] - p0[0];
          const dy = p1[1] - p0[1];
          const dist = Math.hypot(dx, dy);
          const { sx, sy } = this._refScaleFactors();
          const maxLen = (Number(el.maxLen) > 0 ? Number(el.maxLen) : this.maxSightlineNormLen) * ((sx + sy) * 0.5);
          const clamped = dist > maxLen && dist > 1e-6;
          const endNorm = clamped
            ? [p0[0] + (dx / dist) * maxLen, p0[1] + (dy / dist) * maxLen]
            : p1;
          const pStart = this.mapToScreen(p0[0], p0[1], rect);
          const pEnd = this.mapToScreen(endNorm[0], endNorm[1], rect);
          const width = clamp(Number(el.width) || 3, 1.5, 8);

          ctx.save();
          ctx.lineCap = "round";
          if (el.dashed) ctx.setLineDash([8, 6]);

          const haloGrad = ctx.createLinearGradient(pStart.x, pStart.y, pEnd.x, pEnd.y);
          haloGrad.addColorStop(0, "rgba(8, 12, 18, 0.45)");
          haloGrad.addColorStop(1, "rgba(8, 12, 18, 0.08)");
          ctx.strokeStyle = haloGrad;
          ctx.lineWidth = width + 2;
          ctx.beginPath();
          ctx.moveTo(pStart.x, pStart.y);
          ctx.lineTo(pEnd.x, pEnd.y);
          ctx.stroke();

          const shaftGrad = ctx.createLinearGradient(pStart.x, pStart.y, pEnd.x, pEnd.y);
          shaftGrad.addColorStop(0, hexToRgba(color, 0.92));
          shaftGrad.addColorStop(0.55, hexToRgba(color, 0.72));
          shaftGrad.addColorStop(1, hexToRgba(color, clamped ? 0.22 : 0.38));
          ctx.strokeStyle = shaftGrad;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(pStart.x, pStart.y);
          ctx.lineTo(pEnd.x, pEnd.y);
          ctx.stroke();
          ctx.restore();

          const angle = Math.atan2(pEnd.y - pStart.y, pEnd.x - pStart.x);
          this._drawArrowHead(ctx, pEnd.x, pEnd.y, angle, 10, hexToRgba(color, 0.82));

          if (el.label) {
            this._drawPillLabel(
              ctx,
              (pStart.x + pEnd.x) / 2,
              (pStart.y + pEnd.y) / 2,
              el.label,
              color,
              -16
            );
          }
          return;
        }

        const rawNorm =
          el.kind === "curve" && global.WTTacticalEngine
            ? global.WTTacticalEngine.sampleCurve(el.points, 10)
            : el.points;
        const pts = rawNorm.map((p) => {
          const [nx, ny] = this._refToDisplayNorm(p[0], p[1]);
          return this.mapToScreen(nx, ny, rect);
        });
        const width = clamp(Number(el.width) || 3, 1.5, 8);

        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        if (isRecommended) {
          const pulse = 0.55 + 0.45 * Math.sin((now || 0) * 0.006);
          ctx.strokeStyle = `rgba(16, 185, 129, ${(0.35 + pulse * 0.35).toFixed(2)})`;
          ctx.lineWidth = width + 7;
          ctx.beginPath();
          pts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.stroke();
        }

        // Subtle dark halo for readability over bright map regions
        ctx.strokeStyle = "rgba(8, 12, 18, 0.72)";
        ctx.lineWidth = width + 3;
        if (el.dashed) ctx.setLineDash([8, 6]);
        ctx.beginPath();
        pts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();

        ctx.strokeStyle = isRecommended ? "#34d399" : color;
        ctx.lineWidth = isRecommended ? width + 1 : width;
        ctx.beginPath();
        pts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
        ctx.restore();

        if (el.arrow !== false) {
          const pPrev = pts[pts.length - 2];
          const pLast = pts[pts.length - 1];
          const angle = Math.atan2(pLast.y - pPrev.y, pLast.x - pPrev.x);
          this._drawArrowHead(ctx, pLast.x, pLast.y, angle, 12, isRecommended ? "#34d399" : color);
        }

        if (el.label || isRecommended) {
          const midIdx = Math.floor(pts.length / 2);
          const anchor = pts[midIdx];
          const lbl = isRecommended ? `★ ${el.label || "推荐路线"}` : el.label;
          this._drawPillLabel(ctx, anchor.x, anchor.y, lbl, isRecommended ? "#34d399" : color, -16);
        }
      }
    }

    _drawDynamicRoute(ctx, rect, route, now) {
      if (!route || !Array.isArray(route.points) || route.points.length < 2) return;
      const sampled = global.WTTacticalEngine
        ? global.WTTacticalEngine.sampleCurve(route.points, 12)
        : route.points;
      const pts = sampled.map((p) => this.mapToScreen(p[0], p[1], rect));
      if (pts.length < 2) return;

      const pulse = 0.5 + 0.5 * Math.sin((now || 0) * 0.0055);
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.strokeStyle = `rgba(16, 185, 129, ${(0.24 + pulse * 0.24).toFixed(2)})`;
      ctx.lineWidth = 10;
      ctx.beginPath();
      pts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();

      ctx.strokeStyle = "rgba(8, 12, 18, 0.78)";
      ctx.lineWidth = 5.5;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      pts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();

      ctx.strokeStyle = "#34d399";
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      pts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.restore();

      const pPrev = pts[pts.length - 2];
      const pLast = pts[pts.length - 1];
      const angle = Math.atan2(pLast.y - pPrev.y, pLast.x - pPrev.x);
      this._drawArrowHead(ctx, pLast.x, pLast.y, angle, 13, "#34d399");

      if (route.label) {
        const anchor = pts[Math.floor(pts.length * 0.55)];
        this._drawPillLabel(ctx, anchor.x, anchor.y, route.label, "#34d399", -18);
      }
    }

    _drawEditorDraft(ctx, rect, draft) {
      if ((draft.kind === "polyline" || draft.kind === "curve") && Array.isArray(draft.points) && draft.points.length > 0) {
        const ctrlNorm = draft.hoverPoint ? [...draft.points, draft.hoverPoint] : [...draft.points];
        const sampled =
          draft.kind === "curve" && ctrlNorm.length >= 2 && global.WTTacticalEngine
            ? global.WTTacticalEngine.sampleCurve(ctrlNorm, 10)
            : ctrlNorm;
        const pts = sampled.map((p) => this.mapToScreen(p[0], p[1], rect));
        const ctrlPts = draft.points.map((p) => this.mapToScreen(p[0], p[1], rect));

        ctx.save();
        ctx.strokeStyle = draft.color || "#00e5ff";
        ctx.lineWidth = 3;
        if (draft.dashed) ctx.setLineDash([8, 6]);
        ctx.beginPath();
        pts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        for (const p of ctrlPts) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (draft.kind === "ellipse" && Array.isArray(draft.point)) {
        const c = this.mapToScreen(draft.point[0], draft.point[1], rect);
        const rxPx = Math.max(4, (Number(draft.rx) || 0) * rect.w);
        const ryPx = Math.max(4, (Number(draft.ry) || 0) * rect.h);
        ctx.save();
        ctx.fillStyle = hexToRgba(draft.color || "#00e5ff", 0.18);
        ctx.strokeStyle = draft.color || "#00e5ff";
        ctx.lineWidth = 2;
        if (draft.dashed) ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rxPx, ryPx, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Faint bounding box & center crosshair during drag
        ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(c.x - rxPx, c.y - ryPx, rxPx * 2, ryPx * 2);
        ctx.restore();
      } else if (draft.kind === "zone" && Array.isArray(draft.center)) {
        const c = this.mapToScreen(draft.center[0], draft.center[1], rect);
        const h = draft.hoverPoint ? this.mapToScreen(draft.hoverPoint[0], draft.hoverPoint[1], rect) : c;
        const radiusPx = Math.max(12, Math.hypot(h.x - c.x, h.y - c.y));
        ctx.save();
        ctx.fillStyle = hexToRgba(draft.color || "#ef4444", 0.18);
        ctx.strokeStyle = draft.color || "#ef4444";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(c.x, c.y, radiusPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    _drawSpawn(ctx, rect, obj) {
      const pt = this.mapToScreen(obj.x, obj.y, rect);
      const isEnemy = obj.role === "spawn_enemy";
      const fill = isEnemy ? "rgba(239, 68, 68, 0.24)" : "rgba(59, 130, 246, 0.24)";
      const stroke = isEnemy ? "rgba(239, 68, 68, 0.82)" : "rgba(59, 130, 246, 0.82)";
      const isAir = String(obj.type || "").includes("fighter") || String(obj.type || "").includes("bomber");
      const r = clamp(2.8 + (this.zoom - 1) * 1.0, 2.6, 5.2);

      ctx.save();
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      if (isAir) {
        ctx.moveTo(pt.x, pt.y - r * 1.25);
        ctx.lineTo(pt.x + r * 1.15, pt.y + r * 0.95);
        ctx.lineTo(pt.x - r * 1.15, pt.y + r * 0.95);
      } else {
        ctx.moveTo(pt.x, pt.y - r);
        ctx.lineTo(pt.x + r, pt.y);
        ctx.lineTo(pt.x, pt.y + r);
        ctx.lineTo(pt.x - r, pt.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = stroke;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _drawCaptureZone(ctx, rect, obj, label, now) {
      const pt = this.mapToScreen(obj.x, obj.y, rect);
      const rawColor = obj.color || "#ffffff";
      const isNeutral = rawColor.toLowerCase() === "#ffffff" || rawColor.toLowerCase() === "#eeeeee";
      const borderColor = isNeutral ? "#e2e8f0" : rawColor;

      ctx.save();
      if (Number(obj.blink) > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.009);
        ctx.strokeStyle = hexToRgba("#f59e0b", 0.35 + pulse * 0.55);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 17 + pulse * 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(11, 15, 20, 0.85)";
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y - 13);
      ctx.lineTo(pt.x + 13, pt.y);
      ctx.lineTo(pt.x, pt.y + 13);
      ctx.lineTo(pt.x - 13, pt.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      this._withUpright(ctx, pt.x, pt.y + 0.5, (c, tx, ty) => {
        c.fillStyle = borderColor;
        c.font = "bold 12px Consolas, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(label, tx, ty);
      });
      ctx.restore();
    }

    _drawKimiCatUnit(ctx, ptX, ptY, radius, angle, hasHeading, ringColor, fillBg, groundClass, iconTint) {
      const rot = (hasHeading ? angle : -Math.PI / 2) + Math.PI / 2;
      const rx = radius * 1.14;
      const ry = radius * 0.90;
      const isEnemy = ringColor === "#ef4444";
      const innerEarClr = isEnemy ? "rgba(251, 113, 133, 0.85)" : "rgba(253, 164, 175, 0.88)";

      ctx.save();
      ctx.translate(ptX, ptY);
      ctx.rotate(rot);

      // Hand-drawn cat head silhouette: two pointed ears pointing forward (-Y) + rounded chubby face
      const drawCatPath = () => {
        ctx.beginPath();
        // Start between ears at top center
        ctx.moveTo(-rx * 0.30, -ry * 0.86);
        // Left pointed ear
        ctx.quadraticCurveTo(-rx * 0.62, -ry * 1.56, -rx * 0.84, -ry * 1.60);
        ctx.quadraticCurveTo(-rx * 0.96, -ry * 1.15, -rx * 0.88, -ry * 0.50);
        // Left cheek -> chin -> right cheek
        ctx.bezierCurveTo(-rx * 1.16, -ry * 0.05, -rx * 1.05, ry * 0.92, 0, ry * 0.96);
        ctx.bezierCurveTo(rx * 1.05, ry * 0.92, rx * 1.16, -ry * 0.05, rx * 0.88, -ry * 0.50);
        // Right pointed ear
        ctx.quadraticCurveTo(rx * 0.96, -ry * 1.15, rx * 0.84, -ry * 1.60);
        ctx.quadraticCurveTo(rx * 0.62, -ry * 1.56, rx * 0.30, -ry * 0.86);
        // Forehead bridge between ears
        ctx.quadraticCurveTo(0, -ry * 0.95, -rx * 0.30, -ry * 0.86);
        ctx.closePath();
      };

      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      drawCatPath();
      ctx.fillStyle = fillBg;
      ctx.fill();
      ctx.strokeStyle = "#090d12";
      ctx.lineWidth = 3.2;
      ctx.stroke();

      drawCatPath();
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 1.9;
      ctx.stroke();

      // Inner ear triangles
      ctx.fillStyle = innerEarClr;
      ctx.beginPath();
      ctx.moveTo(-rx * 0.42, -ry * 0.92);
      ctx.lineTo(-rx * 0.72, -ry * 1.38);
      ctx.lineTo(-rx * 0.74, -ry * 0.76);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(rx * 0.42, -ry * 0.92);
      ctx.lineTo(rx * 0.72, -ry * 1.38);
      ctx.lineTo(rx * 0.74, -ry * 0.76);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Upright vehicle class / tank model icon in the center of the cat's face
      const tinted = this._getTintedClassIcon(groundClass, iconTint);
      this._withUpright(ctx, ptX, ptY + 0.5, (c, tx, ty) => {
        if (tinted) {
          const iconSize = radius * 1.32;
          c.drawImage(tinted, tx - iconSize / 2, ty - iconSize / 2, iconSize, iconSize);
        } else {
          // Clean miniature tank silhouette fallback (never an empty box)
          const s = radius * 0.55;
          c.fillStyle = iconTint || ringColor;
          c.fillRect(tx - s, ty - s * 0.15, s * 2, s * 0.65);
          c.fillRect(tx - s * 0.55, ty - s * 0.55, s * 1.1, s * 0.42);
          c.fillRect(tx + s * 0.45, ty - s * 0.42, s * 0.85, s * 0.18);
        }
      });
    }

    _drawTacticalUnitRing(ctx, ptX, ptY, radius, angle, hasHeading, ringColor, fillBg, groundClass, iconTint) {
      if (this.theme === "kimi") {
        this._drawKimiCatUnit(ctx, ptX, ptY, radius, angle, hasHeading, ringColor, fillBg, groundClass, iconTint);
        return;
      }
      ctx.save();
      ctx.translate(ptX, ptY);

      // Outer circular frame
      ctx.fillStyle = fillBg;
      ctx.strokeStyle = "#090d12";
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Upright BWiki ground class SVG inside circle (never upside-down)
      const tinted = this._getTintedClassIcon(groundClass, iconTint);
      if (tinted) {
        this._withUpright(ctx, ptX, ptY, (c, tx, ty) => {
          const iconSize = radius * 1.48;
          c.drawImage(tinted, tx - iconSize / 2, ty - iconSize / 2, iconSize, iconSize);
        });
      }

      // Draw directional pointer last so it sits cleanly atop the outer rim and never gets occluded
      if (hasHeading) {
        ctx.save();
        ctx.translate(ptX, ptY);
        ctx.rotate(angle);
        ctx.fillStyle = ringColor;
        ctx.strokeStyle = "#090d12";
        ctx.lineWidth = 1.6;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(radius + 7.8, 0);
        ctx.lineTo(radius - 0.5, -5.2);
        ctx.lineTo(radius + 1.2, 0);
        ctx.lineTo(radius - 0.5, 5.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    _drawUnitMarker(ctx, rect, obj, color, isEnemy, now) {
      const pt = this.mapToScreen(obj.x, obj.y, rect);
      const hasHeading =
        typeof obj.dx === "number" &&
        typeof obj.dy === "number" &&
        (Math.abs(obj.dx) > 1e-4 || Math.abs(obj.dy) > 1e-4);
      const angle = hasHeading ? Math.atan2(obj.dy, obj.dx) : -Math.PI / 2;

      const isAir =
        String(obj.type || "").toLowerCase() === "aircraft" ||
        /fighter|bomber|assault|heli/i.test(String(obj.icon || ""));

      ctx.save();
      if (isEnemy) {
        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(now * 0.006));
        ctx.strokeStyle = hexToRgba("#ef4444", pulse * 0.65);
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 13.5, 0, Math.PI * 2);
        ctx.stroke();

        if (obj.scouted || Number(obj.blink) > 0) {
          ctx.strokeStyle = hexToRgba("#facc15", 0.5 + pulse * 0.45);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 17, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (isAir) {
        ctx.translate(pt.x, pt.y);
        ctx.rotate(angle);
        ctx.fillStyle = color;
        ctx.strokeStyle = "#090d12";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-6, -5.5);
        ctx.lineTo(-3.5, 0);
        ctx.lineTo(-6, 5.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        const gc =
          obj.ground_class ||
          (global.WTVehicleMeta
            ? global.WTVehicleMeta.inferClassFromIcon(obj.icon, "medium_tank")
            : "medium_tank");
        const ringColor = isEnemy ? "#ef4444" : color || "#3b82f6";
        const bg = isEnemy ? "rgba(45, 12, 16, 0.88)" : "rgba(11, 20, 34, 0.88)";
        this._drawTacticalUnitRing(ctx, pt.x, pt.y, 10.0, angle, hasHeading, ringColor, bg, gc, ringColor);
      }
      ctx.restore();
    }

    _drawPlayerTrail(ctx, rect) {
      let totalEdges = 0;
      for (const seg of this.playerTrail) {
        if (seg.length >= 2) totalEdges += seg.length - 1;
      }
      if (totalEdges === 0) return;

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.4;

      let edgeIdx = 0;
      for (const seg of this.playerTrail) {
        if (seg.length < 2) continue;
        const pts = seg.map((p) => this.mapToScreen(p[0], p[1], rect));
        for (let i = 1; i < pts.length; i++) {
          edgeIdx += 1;
          const alpha = (edgeIdx / totalEdges) * 0.72;
          ctx.strokeStyle = `rgba(250, 204, 21, ${alpha.toFixed(2)})`;
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    _drawPlayerMarker(ctx, rect, player) {
      const pt = this.mapToScreen(player.x, player.y, rect);
      const angle = this.lastPlayerHeading;

      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(angle);

      // Subtle vision cone
      const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, 48);
      grad.addColorStop(0, "rgba(250, 204, 21, 0.24)");
      grad.addColorStop(1, "rgba(250, 204, 21, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 48, -0.38, 0.38);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      const isPlayerAir =
        this.airModeActive || (global.WTTacticalEngine && global.WTTacticalEngine.isAirUnit(player));
      if (isPlayerAir) {
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(angle);
        ctx.fillStyle = "#facc15";
        ctx.strokeStyle = "#090d12";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(-7, -6.5);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-7, 6.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        const gc = (this._playerMeta && this._playerMeta.groundClass) || "medium_tank";
        this._drawTacticalUnitRing(
          ctx,
          pt.x,
          pt.y,
          12.0,
          angle,
          true,
          "#facc15",
          "rgba(20, 18, 10, 0.92)",
          gc,
          "#fde047"
        );
      }

      if (this._playerMeta && this._playerMeta.shortName) {
        this._drawPillLabel(ctx, pt.x, pt.y, this._playerMeta.shortName, "#facc15", 22);
      }
    }

    _drawSelfWreck(ctx, rect, wk) {
      const pt = this.mapToScreen(wk.x, wk.y, rect);
      ctx.save();
      ctx.fillStyle = "rgba(28, 10, 14, 0.9)";
      ctx.strokeStyle = "#f43f5e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = "#fda4af";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pt.x - 4.5, pt.y - 4.5);
      ctx.lineTo(pt.x + 4.5, pt.y + 4.5);
      ctx.moveTo(pt.x + 4.5, pt.y - 4.5);
      ctx.lineTo(pt.x - 4.5, pt.y + 4.5);
      ctx.stroke();
      ctx.restore();

      const lbl = `#${wk.seq} 阵亡${wk.model ? " · " + wk.model : ""}`;
      this._drawPillLabel(ctx, pt.x, pt.y, lbl, "#f43f5e", -20);
    }

    _drawDangerZones(ctx, rect, now) {
      const wallNow = Date.now();
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
      const fadeFn = global.WTTacticalEngine && global.WTTacticalEngine.computeDangerFade;
      for (const dz of this._dangerZones) {
        const fade =
          typeof fadeFn === "function" && typeof dz.latestTs === "number"
            ? fadeFn(wallNow - dz.latestTs, dz.ttlMs || this.dangerZoneTtlMs)
            : typeof dz.alpha === "number"
              ? dz.alpha
              : 1;
        if (fade <= 0.01) continue;

        if ((dz.mode === "intersect" || dz.mode === "overlap") && Array.isArray(dz.pairs) && dz.pairs.length > 0) {
          const pairScale = 1 / Math.min(2.2, 1 + (dz.pairs.length - 1) * 0.35);
          const fillAlpha = (0.2 + pulse * 0.08) * fade * pairScale;
          const strokeAlpha = Math.min(0.95, (0.88 + pulse * 0.1) * fade);

          ctx.save();
          ctx.fillStyle = `rgba(250, 204, 21, ${fillAlpha.toFixed(3)})`;
          ctx.strokeStyle = `rgba(250, 204, 21, ${strokeAlpha.toFixed(3)})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);

          for (const pr of dz.pairs) {
            const p1 = this.mapToScreen(pr.x1, pr.y1, rect);
            const p2 = this.mapToScreen(pr.x2, pr.y2, rect);
            const rPx = Math.max(12, pr.rNorm * rect.w);
            const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            if (d >= rPx * 1.995) continue;

            ctx.beginPath();
            if (d <= 1) {
              ctx.arc(p1.x, p1.y, rPx, 0, Math.PI * 2);
            } else {
              const theta = Math.atan2(p2.y - p1.y, p2.x - p1.x);
              const halfAngle = Math.acos(clamp(d / (2 * rPx), -1, 1));
              ctx.arc(p1.x, p1.y, rPx, theta - halfAngle, theta + halfAngle);
              ctx.arc(p2.x, p2.y, rPx, theta + Math.PI - halfAngle, theta + Math.PI + halfAngle);
              ctx.closePath();
            }
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();

          const pt = this.mapToScreen(dz.x, dz.y, rect);
          const lblOffset = -Math.max(16, dz.radiusNorm * rect.w * 0.65) - 10;
          ctx.save();
          ctx.globalAlpha = clamp(fade, 0.15, 1);
          this._drawPillLabel(ctx, pt.x, pt.y, `高危交集区 ×${dz.count}`, "#facc15", lblOffset);
          ctx.restore();
        } else {
          const pt = this.mapToScreen(dz.x, dz.y, rect);
          const rPx = Math.max(16, dz.radiusNorm * rect.w);
          ctx.save();
          ctx.fillStyle = `rgba(250, 204, 21, ${((0.16 + pulse * 0.08) * fade).toFixed(3)})`;
          ctx.strokeStyle = `rgba(250, 204, 21, ${(0.95 * fade).toFixed(3)})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, rPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();

          ctx.save();
          ctx.globalAlpha = clamp(fade, 0.15, 1);
          this._drawPillLabel(ctx, pt.x, pt.y, `高危交火区 ×${dz.count}`, "#facc15", -rPx - 10);
          ctx.restore();
        }
      }
    }

    _drawFrontline(ctx, rect, now) {
      const sampled = global.WTTacticalEngine
        ? global.WTTacticalEngine.sampleCurve(this._frontlinePoints, 12)
        : this._frontlinePoints;
      if (!sampled || sampled.length < 2) return;
      const pts = sampled.map((p) => this.mapToScreen(p[0], p[1], rect));
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.003);

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.strokeStyle = `rgba(251, 146, 60, ${(0.18 + pulse * 0.08).toFixed(2)})`;
      ctx.lineWidth = 14;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();

      ctx.strokeStyle = "rgba(251, 146, 60, 0.85)";
      ctx.lineWidth = 2.2;
      ctx.setLineDash([9, 6]);
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.restore();
    }

    _drawWaypoint(ctx, rect, wp, player, now) {
      const pt = this.mapToScreen(wp.x, wp.y, rect);

      // Dashed vector line from player to temporary waypoint (skip if rangefinder already draws it)
      if (player && (!this.lockedTarget || this.lockedTarget.kind !== "waypoint")) {
        const pPt = this.mapToScreen(player.x, player.y, rect);
        ctx.save();
        ctx.strokeStyle = "rgba(245, 158, 11, 0.72)";
        ctx.lineWidth = 1.8;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(pPt.x, pPt.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
        ctx.restore();
      }

      const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
      ctx.save();
      // Outer pulsing ring
      ctx.strokeStyle = hexToRgba("#f59e0b", 0.45 + pulse * 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 13 + pulse * 5, 0, Math.PI * 2);
      ctx.stroke();

      // Inner target crosshair
      ctx.strokeStyle = "#fde047";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      ctx.moveTo(pt.x - 10, pt.y);
      ctx.lineTo(pt.x + 10, pt.y);
      ctx.moveTo(pt.x, pt.y - 10);
      ctx.lineTo(pt.x, pt.y + 10);
      ctx.stroke();
      ctx.restore();

      const dist = this.getWaypointDistanceMeters();
      const label = dist !== null ? `路标 ${dist}m` : "临时路标";
      this._drawPillLabel(ctx, pt.x, pt.y, label, "#f59e0b", -24);
    }

    _drawTargetRangefinder(ctx, rect, target, player, now) {
      const tPt = this.mapToScreen(target.x, target.y, rect);
      const accent = target.kind === "enemy" ? "#ef4444" : target.color || "#38bdf8";
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);

      // Lock brackets around target
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      const r = 13 + pulse * 2.5;
      const arm = 5;
      ctx.beginPath();
      // Top-left
      ctx.moveTo(tPt.x - r, tPt.y - r + arm);
      ctx.lineTo(tPt.x - r, tPt.y - r);
      ctx.lineTo(tPt.x - r + arm, tPt.y - r);
      // Top-right
      ctx.moveTo(tPt.x + r - arm, tPt.y - r);
      ctx.lineTo(tPt.x + r, tPt.y - r);
      ctx.lineTo(tPt.x + r, tPt.y - r + arm);
      // Bottom-right
      ctx.moveTo(tPt.x + r, tPt.y + r - arm);
      ctx.lineTo(tPt.x + r, tPt.y + r);
      ctx.lineTo(tPt.x + r - arm, tPt.y + r);
      // Bottom-left
      ctx.moveTo(tPt.x - r + arm, tPt.y + r);
      ctx.lineTo(tPt.x - r, tPt.y + r);
      ctx.lineTo(tPt.x - r, tPt.y + r - arm);
      ctx.stroke();
      ctx.restore();

      if (!player) return;

      const pPt = this.mapToScreen(player.x, player.y, rect);
      ctx.save();
      ctx.strokeStyle = hexToRgba(accent, 0.85);
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pPt.x, pPt.y);
      ctx.lineTo(tPt.x, tPt.y);
      ctx.stroke();
      ctx.restore();

      const distM = this._computeDistanceMeters(player.x, player.y, target.x, target.y);
      const bearing = this._computeRelativeBearing(player.x, player.y, target.x, target.y);
      const distText = distM !== null ? `${distM}m` : "--m";
      const midX = (pPt.x + tPt.x) / 2;
      const midY = (pPt.y + tPt.y) / 2;
      this._drawPillLabel(ctx, midX, midY, `${distText} · ${bearing.clock}点`, accent, -12);
    }

    _drawMapPing(ctx, rect, ping, now, wallNow) {
      const pt = this.mapToScreen(ping.x, ping.y, rect);
      const remaining = Math.max(0, ping.expiresAt - wallNow);
      const fade = remaining < 1500 ? remaining / 1500 : 1.0;
      const color = ping.color || "#facc15";
      const ripple = ((now * 0.0016) % 1);
      const rippleR = 6 + ripple * 16;

      ctx.save();
      ctx.globalAlpha = fade;

      // Expanding pulse ripple
      ctx.strokeStyle = hexToRgba("#fb923c", (1 - ripple) * 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, rippleR, 0, Math.PI * 2);
      ctx.stroke();

      // High-contrast target ring & center crosshair
      ctx.strokeStyle = "#0b0f14";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      ctx.moveTo(pt.x - 11, pt.y);
      ctx.lineTo(pt.x - 4, pt.y);
      ctx.moveTo(pt.x + 4, pt.y);
      ctx.lineTo(pt.x + 11, pt.y);
      ctx.moveTo(pt.x, pt.y - 11);
      ctx.lineTo(pt.x, pt.y - 4);
      ctx.moveTo(pt.x, pt.y + 4);
      ctx.lineTo(pt.x, pt.y + 11);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
      ctx.fill();

      this._drawPillLabel(ctx, pt.x, pt.y, ping.label || "小队标点", color, -20);
      ctx.restore();
    }

    _drawAllyLossAlert(ctx, rect, alert, now, wallNow) {
      const pt = this.mapToScreen(alert.x, alert.y, rect);
      const remaining = Math.max(0, alert.expiresAt - wallNow);
      const fade = remaining < 2000 ? remaining / 2000 : 1.0;
      const r1 = (now * 0.0018) % 1;
      const r2 = (now * 0.0018 + 0.5) % 1;

      ctx.save();
      ctx.globalAlpha = fade;

      // Two staggered expanding crimson/amber alert rings
      ctx.strokeStyle = hexToRgba("#f43f5e", (1 - r1) * 0.92);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 7 + r1 * 20, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = hexToRgba("#fb923c", (1 - r2) * 0.78);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 7 + r2 * 20, 0, Math.PI * 2);
      ctx.stroke();

      // High-contrast dark-haloed warning X + diamond
      ctx.strokeStyle = "#0b0f14";
      ctx.lineWidth = 4.4;
      ctx.beginPath();
      ctx.moveTo(pt.x - 6, pt.y - 6);
      ctx.lineTo(pt.x + 6, pt.y + 6);
      ctx.moveTo(pt.x + 6, pt.y - 6);
      ctx.lineTo(pt.x - 6, pt.y + 6);
      ctx.stroke();

      ctx.strokeStyle = "#fb7185";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(pt.x - 6, pt.y - 6);
      ctx.lineTo(pt.x + 6, pt.y + 6);
      ctx.moveTo(pt.x + 6, pt.y - 6);
      ctx.lineTo(pt.x - 6, pt.y + 6);
      ctx.stroke();

      ctx.strokeStyle = "#f43f5e";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y - 10);
      ctx.lineTo(pt.x + 10, pt.y);
      ctx.lineTo(pt.x, pt.y + 10);
      ctx.lineTo(pt.x - 10, pt.y);
      ctx.closePath();
      ctx.stroke();

      const countTag = alert.count > 1 ? ` ×${alert.count}` : "";
      const bearingTag = alert.bearingText ? ` · ${alert.bearingText}` : "";
      const label = `友军消失 ${alert.distM}m${bearingTag}${countTag}`;
      this._drawPillLabel(ctx, pt.x, pt.y, label, "#f43f5e", -24);
      ctx.restore();
    }
  }

  global.TacticalCanvas = TacticalCanvas;
})(window);
