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

      if (this.tool === "polyline") {
        if (!this.draft || this.draft.kind !== "polyline") {
          this.draft = {
            kind: "polyline",
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
      this.draft.hoverPoint = [round4(nx), round4(ny)];
      this.onDraftChange(this.draft);
    }

    finishLine() {
      if (!this.draft || this.draft.kind !== "polyline") return false;
      if (this.draft.points.length < 2) {
        this.cancelDraft();
        return false;
      }
      const layer = this._ensureTargetLayer();
      layer.elements.push({
        kind: "polyline",
        arrow: true,
        dashed: this.dashed,
        width: 3,
        color: this.color,
        label: this.label,
        points: this.draft.points,
      });
      this.draft = null;
      this.onDraftChange(null);
      this.onChange();
      this.onToast("走线已添加到图层（记得点击保存到本地）");
      return true;
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
