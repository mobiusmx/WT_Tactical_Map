/* Interactive vector route drawing & editing controller */

(function (global) {
  "use strict";

  function round4(n) {
    return Math.round(Number(n) * 10000) / 10000;
  }

  class RouteEditor {
    constructor(options) {
      this.onChange = options.onChange || (() => {});
      this.onDraftChange = options.onDraftChange || (() => {});
      this.onToolChange = options.onToolChange || (() => {});
      this.onToast = options.onToast || (() => {});

      this.enabled = false;
      this.tool = "browse";
      this.targetLayerId = "";
      this.color = "#00e5ff";
      this.dashed = false;
      this.label = "";

      this.draft = null;
      this._layersRef = [];
    }

    setLayers(layers) {
      this._layersRef = Array.isArray(layers) ? layers : [];
      if (!this._layersRef.some((l) => l.id === this.targetLayerId)) {
        this.targetLayerId = this._layersRef[0] ? this._layersRef[0].id : "";
      }
    }

    setEnabled(enabled) {
      this.enabled = !!enabled;
      if (!this.enabled) {
        this.cancelDraft();
        this.setTool("browse");
      } else if (this.tool === "browse") {
        this.setTool("polyline");
      }
    }

    setTool(tool) {
      if (this.draft && this.tool !== tool) {
        this.cancelDraft();
      }
      this.tool = tool || "browse";
      this.onToolChange(this.tool);
    }

    setTargetLayerId(id) {
      this.targetLayerId = id;
    }

    setColor(color) {
      this.color = color || "#00e5ff";
      if (this.draft) {
        this.draft.color = this.color;
        this.onDraftChange(this.draft);
      }
    }

    setDashed(dashed) {
      this.dashed = !!dashed;
      if (this.draft) {
        this.draft.dashed = this.dashed;
        this.onDraftChange(this.draft);
      }
    }

    setLabel(label) {
      this.label = String(label || "").trim();
    }

    _ensureTargetLayer() {
      let layer = this._layersRef.find((l) => l.id === this.targetLayerId);
      if (!layer) {
        if (this._layersRef.length === 0) {
          layer = {
            id: "custom_route_" + Date.now(),
            name: "自定义战术走线",
            category: "custom",
            color: this.color,
            visible: true,
            elements: [],
          };
          this._layersRef.push(layer);
        } else {
          layer = this._layersRef[0];
        }
        this.targetLayerId = layer.id;
      }
      layer.visible = true;
      if (!Array.isArray(layer.elements)) {
        layer.elements = [];
      }
      return layer;
    }

    handleClick(nx, ny) {
      if (!this.enabled || this.tool === "browse") return;
      const x = round4(nx);
      const y = round4(ny);

      if (this.tool === "polyline" || this.tool === "curve") {
        if (!this.draft || this.draft.kind !== this.tool) {
          this.draft = {
            kind: this.tool,
            color: this.color,
            dashed: this.dashed,
            label: this.label,
            points: [[x, y]],
            hoverPoint: [x, y],
          };
        } else {
          this.draft.points.push([x, y]);
          this.draft.hoverPoint = [x, y];
        }
        this.onDraftChange(this.draft);
        return;
      }

      if (this.tool === "marker") {
        const layer = this._ensureTargetLayer();
        layer.elements.push({
          kind: "marker",
          icon: "sniper",
          color: this.color,
          label: this.label || "架枪卡点",
          point: [x, y],
        });
        this.onChange();
        this.onToast("已添加卡点标记（记得点击保存到本地）");
        return;
      }

      if (this.tool === "ellipse") {
        if (!this.draft || this.draft.kind !== "ellipse") {
          this.draft = {
            kind: "ellipse",
            stage: 1,
            color: this.color,
            dashed: this.dashed,
            label: this.label || "椭圆区域",
            point: [x, y],
            axisEnd: null,
            rx: 0.02,
            ry: 0.01,
            rotation: 0,
            hoverPoint: [x, y],
          };
          this.onDraftChange(this.draft);
          return;
        }
        const cx = this.draft.point[0];
        const cy = this.draft.point[1];
        if (this.draft.stage === 1) {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.hypot(dx, dy);
          const rx = Math.max(0.012, Math.min(0.5, dist));
          const rotation = dist > 1e-5 ? Math.atan2(dy, dx) : 0;
          this.draft.stage = 2;
          this.draft.axisEnd = [x, y];
          this.draft.rx = round4(rx);
          this.draft.rotation = round4(rotation);
          this.draft.ry = round4(Math.max(0.012, Math.min(0.5, rx * 0.45)));
          this.draft.hoverPoint = [x, y];
          this.onDraftChange(this.draft);
          return;
        }
        if (this.draft.stage === 2) {
          const rot = Number(this.draft.rotation) || 0;
          const perp = Math.abs(-(x - cx) * Math.sin(rot) + (y - cy) * Math.cos(rot));
          const ry = Math.max(0.01, Math.min(0.5, perp));
          const layer = this._ensureTargetLayer();
          layer.elements.push({
            kind: "ellipse",
            color: this.color,
            dashed: this.dashed,
            label: this.label || "椭圆区域",
            point: [cx, cy],
            rx: round4(this.draft.rx),
            ry: round4(ry),
            rotation: round4(rot),
          });
          this.draft = null;
          this.onDraftChange(null);
          this.onChange();
          this.onToast("已添加倾斜椭圆区域（记得点击保存到本地）");
          return;
        }
      }

      if (this.tool === "zone") {
        if (!this.draft || this.draft.kind !== "zone") {
          this.draft = {
            kind: "zone",
            color: this.color,
            label: this.label || "高危交火区",
            center: [x, y],
            hoverPoint: [x, y],
          };
          this.onDraftChange(this.draft);
        } else {
          const cx = this.draft.center[0];
          const cy = this.draft.center[1];
          const radius = Math.max(0.025, Math.min(0.35, Math.hypot(x - cx, y - cy)));
          const layer = this._ensureTargetLayer();
          layer.elements.push({
            kind: "zone",
            color: this.color,
            label: this.label || "高危交火区",
            point: [cx, cy],
            radius: round4(radius),
          });
          this.draft = null;
          this.onDraftChange(null);
          this.onChange();
          this.onToast("已添加交火区圆圈（记得点击保存到本地）");
        }
      }
    }

    handleMove(nx, ny) {
      if (!this.draft) return;
      const hx = round4(nx);
      const hy = round4(ny);
      this.draft.hoverPoint = [hx, hy];
      if (this.draft.kind === "ellipse" && Array.isArray(this.draft.point)) {
        const cx = this.draft.point[0];
        const cy = this.draft.point[1];
        if (this.draft.stage === 1) {
          const dx = hx - cx;
          const dy = hy - cy;
          const dist = Math.hypot(dx, dy);
          const rx = Math.max(0.012, Math.min(0.5, dist));
          const rotation = dist > 1e-5 ? Math.atan2(dy, dx) : 0;
          this.draft.rx = round4(rx);
          this.draft.rotation = round4(rotation);
          this.draft.ry = round4(Math.max(0.01, Math.min(0.25, rx * 0.45)));
        } else if (this.draft.stage === 2) {
          const rot = Number(this.draft.rotation) || 0;
          const perp = Math.abs(-(hx - cx) * Math.sin(rot) + (hy - cy) * Math.cos(rot));
          this.draft.ry = round4(Math.max(0.01, Math.min(0.5, perp)));
        }
      }
      this.onDraftChange(this.draft);
    }

    _computeEllipseGeom(startPt, curPt, opts) {
      const x0 = startPt[0];
      const y0 = startPt[1];
      const x1 = curPt[0];
      const y1 = curPt[1];
      const fromCenter = Boolean(opts && opts.fromCenter);
      const equalRatio = Boolean(opts && opts.equalRatio);

      let cx = fromCenter ? x0 : (x0 + x1) / 2;
      let cy = fromCenter ? y0 : (y0 + y1) / 2;
      let rx = fromCenter ? Math.abs(x1 - x0) : Math.abs(x1 - x0) / 2;
      let ry = fromCenter ? Math.abs(y1 - y0) : Math.abs(y1 - y0) / 2;

      if (equalRatio) {
        const r = Math.max(rx, ry);
        rx = r;
        ry = r;
      }
      return {
        point: [round4(cx), round4(cy)],
        rx: round4(Math.min(0.5, rx)),
        ry: round4(Math.min(0.5, ry)),
      };
    }

    handleDragStart(nx, ny, opts) {
      if (!this.enabled || this.tool !== "ellipse") return;
      const x = round4(nx);
      const y = round4(ny);
      this.draft = {
        kind: "ellipse",
        color: this.color,
        dashed: this.dashed,
        label: this.label || "椭圆区域",
        start: [x, y],
        point: [x, y],
        rx: 0,
        ry: 0,
        fromCenter: Boolean(opts && opts.fromCenter),
        equalRatio: Boolean(opts && opts.equalRatio),
      };
      this.onDraftChange(this.draft);
    }

    handleDragMove(nx, ny, opts) {
      if (!this.draft || this.draft.kind !== "ellipse") return;
      const geom = this._computeEllipseGeom(this.draft.start, [round4(nx), round4(ny)], opts);
      this.draft.point = geom.point;
      this.draft.rx = geom.rx;
      this.draft.ry = geom.ry;
      this.draft.fromCenter = Boolean(opts && opts.fromCenter);
      this.draft.equalRatio = Boolean(opts && opts.equalRatio);
      this.onDraftChange(this.draft);
    }

    handleDragEnd(nx, ny, opts) {
      if (!this.draft || this.draft.kind !== "ellipse") return;
      const geom = this._computeEllipseGeom(this.draft.start, [round4(nx), round4(ny)], opts);
      if (geom.rx < 0.008 && geom.ry < 0.008) {
        this.cancelDraft();
        return;
      }
      const layer = this._ensureTargetLayer();
      layer.elements.push({
        kind: "ellipse",
        color: this.color,
        dashed: this.dashed,
        label: this.label || "椭圆区域",
        point: geom.point,
        rx: geom.rx,
        ry: geom.ry,
      });
      this.draft = null;
      this.onDraftChange(null);
      this.onChange();
      this.onToast("已添加椭圆区域（记得点击保存到本地）");
    }

    finishLine() {
      if (this.draft && this.draft.kind === "ellipse") {
        this.cancelDraft();
        return false;
      }
      if (!this.draft || (this.draft.kind !== "polyline" && this.draft.kind !== "curve")) return false;
      if (this.draft.points.length < 2) {
        this.cancelDraft();
        return false;
      }
      const layer = this._ensureTargetLayer();
      layer.elements.push({
        kind: this.draft.kind,
        arrow: true,
        dashed: this.dashed,
        width: 3,
        color: this.color,
        label: this.label,
        points: this.draft.points,
      });
      const wasCurve = this.draft.kind === "curve";
      this.draft = null;
      this.onDraftChange(null);
      this.onChange();
      this.onToast(wasCurve ? "曲线已添加到图层（记得点击保存到本地）" : "走线已添加到图层（记得点击保存到本地）");
      return true;
    }

    clearLayer() {
      this.cancelDraft();
      const layer = this._layersRef.find((l) => l.id === this.targetLayerId);
      if (layer && Array.isArray(layer.elements) && layer.elements.length > 0) {
        layer.elements = [];
        this.onChange();
        this.onToast("已清空当前图层绘制元素");
      }
    }

    cancelDraft() {
      if (this.draft) {
        this.draft = null;
        this.onDraftChange(null);
      }
    }

    undo() {
      if (this.draft) {
        if (this.draft.kind === "polyline" && this.draft.points.length > 1) {
          this.draft.points.pop();
          this.onDraftChange(this.draft);
          return;
        }
        this.cancelDraft();
        return;
      }

      const layer = this._layersRef.find((l) => l.id === this.targetLayerId);
      if (layer && Array.isArray(layer.elements) && layer.elements.length > 0) {
        layer.elements.pop();
        this.onChange();
      }
    }

    deleteElement(index) {
      const layer = this._layersRef.find((l) => l.id === this.targetLayerId);
      if (!layer || !Array.isArray(layer.elements)) return;
      if (index >= 0 && index < layer.elements.length) {
        layer.elements.splice(index, 1);
        this.onChange();
      }
    }
  }

  global.RouteEditor = RouteEditor;
})(window);
