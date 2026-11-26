/* Pure-rule v2.0 tactical computation engine (zero AI):
 * - Catmull-Rom smooth curve interpolation
 * - Multi-wreck overlapping yellow high-danger zones
 * - Time-smoothed dynamic frontline band
 * - 3-tier dynamic route recommendation (conservative / balanced / aggressive)
 */

(function (global) {
  "use strict";

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  /**
   * Catmull-Rom spline sampler for smooth flank curves.
   */
  function sampleCurve(points, segsPerSpan) {
    if (!Array.isArray(points) || points.length < 2) return points || [];
    if (points.length === 2) return points;
    const segs = Math.max(4, segsPerSpan || 10);
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const steps = i === points.length - 2 ? segs : segs - 1;
      for (let s = 0; s <= steps; s++) {
        const t = s / segs;
        const t2 = t * t;
        const t3 = t2 * t;
        const x =
          0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const y =
          0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        out.push([clamp(x, 0, 1), clamp(y, 0, 1)]);
      }
    }
    return out;
  }

  function mapMetersSize(mapInfo) {
    if (mapInfo && Array.isArray(mapInfo.map_min) && Array.isArray(mapInfo.map_max)) {
      const w = Math.abs(Number(mapInfo.map_max[0]) - Number(mapInfo.map_min[0]));
      const h = Math.abs(Number(mapInfo.map_max[1]) - Number(mapInfo.map_min[1]));
      if (w > 0 && h > 0) return { w, h };
    }
    return { w: 2048, h: 2048 };
  }

  /**
   * Detect overlapping wreck influence zones (radiusM, default 80m).
   * Two wrecks within 2 * radiusM overlap -> highlight cluster in yellow.
   */
  function computeDangerZones(wrecks, mapInfo, radiusM, nowMs) {
    const now = nowMs || Date.now();
    const rMeters = clamp(Number(radiusM) || 80, 30, 250);
    const { w } = mapMetersSize(mapInfo);
    const rNorm = clamp(rMeters / w, 0.015, 0.14);
    const overlapDist = rNorm * 2.0;

    const valid = (wrecks || []).filter(
      (wk) => wk && typeof wk.x === "number" && typeof wk.y === "number" && (wk.isSelf || now - wk.ts <= 240000)
    );
    if (valid.length < 2) return [];

    const visited = new Array(valid.length).fill(false);
    const zones = [];

    for (let i = 0; i < valid.length; i++) {
      if (visited[i]) continue;
      const queue = [i];
      visited[i] = true;
      const cluster = [];
      while (queue.length > 0) {
        const idx = queue.shift();
        cluster.push(valid[idx]);
        for (let j = 0; j < valid.length; j++) {
          if (visited[j]) continue;
          if (Math.hypot(valid[idx].x - valid[j].x, valid[idx].y - valid[j].y) <= overlapDist) {
            visited[j] = true;
            queue.push(j);
          }
        }
      }
      if (cluster.length >= 2) {
        let sx = 0;
        let sy = 0;
        let hasSelf = false;
        let maxR = rNorm;
        for (const c of cluster) {
          sx += c.x;
          sy += c.y;
          if (c.isSelf) hasSelf = true;
        }
        const cx = sx / cluster.length;
        const cy = sy / cluster.length;
        for (const c of cluster) {
          maxR = Math.max(maxR, Math.hypot(c.x - cx, c.y - cy) + rNorm * 0.72);
        }
        zones.push({
          x: cx,
          y: cy,
          radiusNorm: clamp(maxR, rNorm, 0.18),
          count: cluster.length,
          hasSelf,
        });
      }
    }
    return zones;
  }

  function isHostileHex(color) {
    if (!color || typeof color !== "string") return false;
    const h = color.trim().replace("#", "");
    if (h.length !== 6) return false;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return r >= 150 && r > b + 50 && r > g + 35;
  }

  /**
   * Compute a time-smoothed frontline curve from surviving ground allies (low SPAA weight),
   * capture zone ownership, and visible enemy positions.
   */
  function computeFrontline(objects, prevPoints, alpha) {
    const list = Array.isArray(objects) ? objects : [];
    const allySpawns = [];
    const enemySpawns = [];
    const allies = [];
    const enemies = [];
    const caps = [];

    for (const o of list) {
      if (!o || typeof o.x !== "number" || typeof o.y !== "number") continue;
      if (o.role === "spawn_ally") allySpawns.push(o);
      else if (o.role === "spawn_enemy") enemySpawns.push(o);
      else if (o.role === "capture_zone") caps.push(o);
      else if (o.role === "enemy") enemies.push(o);
      else if (o.role === "ally" || o.role === "player") {
        const typeLow = String(o.type || "").toLowerCase();
        const iconLow = String(o.icon || "").toLowerCase();
        if (typeLow === "aircraft" || /fighter|bomber|assault|heli/.test(iconLow)) continue;
        let w = 1.0;
        if (o.ground_class === "spaa" || iconLow.includes("spaa")) w = 0.2;
        else if (o.ground_class === "heavy_tank" || o.ground_class === "medium_tank") w = 1.25;
        else if (o.role === "player") w = 0.9;
        allies.push({ x: o.x, y: o.y, w });
      }
    }

    if (allies.length === 0 && caps.length === 0) return null;

    // Determine battle axis from ally spawns -> enemy spawns (fallback vertical)
    let axX = 0;
    let axY = -1;
    let centerX = 0.5;
    let centerY = 0.5;

    if (allySpawns.length > 0 && enemySpawns.length > 0) {
      const aMean = allySpawns.reduce((acc, p) => [acc[0] + p.x / allySpawns.length, acc[1] + p.y / allySpawns.length], [0, 0]);
      const eMean = enemySpawns.reduce((acc, p) => [acc[0] + p.x / enemySpawns.length, acc[1] + p.y / enemySpawns.length], [0, 0]);
      const dx = eMean[0] - aMean[0];
      const dy = eMean[1] - aMean[1];
      const len = Math.hypot(dx, dy);
      if (len > 0.05) {
        axX = dx / len;
        axY = dy / len;
      }
      centerX = (aMean[0] + eMean[0]) / 2;
      centerY = (aMean[1] + eMean[1]) / 2;
    } else if (caps.length > 0) {
      centerX = caps.reduce((s, c) => s + c.x, 0) / caps.length;
      centerY = caps.reduce((s, c) => s + c.y, 0) / caps.length;
    }

    // Perpendicular lateral axis
    const latX = -axY;
    const latY = axX;

    const toLocal = (px, py) => {
      const rx = px - centerX;
      const ry = py - centerY;
      return {
        lat: rx * latX + ry * latY,
        fwd: rx * axX + ry * axY,
      };
    };

    const allyLocals = allies.map((a) => ({ ...toLocal(a.x, a.y), w: a.w }));
    const enemyLocals = enemies.map((e) => toLocal(e.x, e.y));
    const capLocals = caps.map((c) => ({
      ...toLocal(c.x, c.y),
      hostile: isHostileHex(c.color),
    }));

    const slices = 7;
    const latSpan = 0.42;
    const rawPts = [];

    for (let i = 0; i < slices; i++) {
      const latTarget = -latSpan + (2 * latSpan * i) / (slices - 1);
      let num = 0;
      let den = 0;

      // Project weighted ally vanguard
      for (const a of allyLocals) {
        const dLat = Math.abs(a.lat - latTarget);
        const k = Math.exp(-(dLat * dLat) / (2 * 0.14 * 0.14)) * a.w;
        num += (a.fwd + 0.035) * k;
        den += k;
      }
      // Capture zone anchor
      for (const c of capLocals) {
        const dLat = Math.abs(c.lat - latTarget);
        const k = Math.exp(-(dLat * dLat) / (2 * 0.16 * 0.16)) * 0.7;
        const capBias = c.hostile ? c.fwd - 0.03 : c.fwd + 0.03;
        num += capBias * k;
        den += k;
      }
      // Visible enemies pull frontline slightly back toward contact midpoint
      for (const e of enemyLocals) {
        const dLat = Math.abs(e.lat - latTarget);
        const k = Math.exp(-(dLat * dLat) / (2 * 0.15 * 0.15)) * 0.55;
        num += (e.fwd - 0.03) * k;
        den += k;
      }

      const fwd = den > 1e-4 ? clamp(num / den, -0.45, 0.45) : 0;
      const wx = clamp(centerX + latTarget * latX + fwd * axX, 0.03, 0.97);
      const wy = clamp(centerY + latTarget * latY + fwd * axY, 0.03, 0.97);
      rawPts.push([wx, wy]);
    }

    const smoothAlpha = clamp(Number(alpha) || 0.14, 0.05, 0.5);
    if (!Array.isArray(prevPoints) || prevPoints.length !== rawPts.length) {
      return rawPts;
    }
    return rawPts.map((pt, idx) => [
      prevPoints[idx][0] + (pt[0] - prevPoints[idx][0]) * smoothAlpha,
      prevPoints[idx][1] + (pt[1] - prevPoints[idx][1]) * smoothAlpha,
    ]);
  }

  function minDistToPoints(pt, candidates) {
    let best = Infinity;
    for (const c of candidates) {
      const d = Math.hypot(pt[0] - c.x, pt[1] - c.y);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * Score preset/custom polyline & curve routes for Conservative / Balanced / Aggressive tiers.
   */
  function recommendRoutes(tier, vectorLayers, objects, dangerZones, playerMeta, mapInfo) {
    if (!tier || tier === "off") {
      return { ids: new Set(), bestId: "", tip: "" };
    }

    const allies = [];
    const heavyMidAllies = [];
    const caps = [];
    let player = null;

    for (const o of objects || []) {
      if (!o || typeof o.x !== "number" || typeof o.y !== "number") continue;
      if (o.role === "player") player = o;
      else if (o.role === "capture_zone") caps.push(o);
      else if (o.role === "ally") {
        const iconLow = String(o.icon || "").toLowerCase();
        if (String(o.type || "").toLowerCase() === "aircraft" || /fighter|bomber|assault|heli/.test(iconLow)) continue;
        allies.push(o);
        if (o.ground_class === "heavy_tank" || o.ground_class === "medium_tank" || iconLow.includes("heavy") || iconLow.includes("medium")) {
          heavyMidAllies.push(o);
        }
      }
    }

    const { w } = mapMetersSize(mapInfo);
    const maxSafeDist = 260 / w;
    const candidates = [];

    for (const layer of vectorLayers || []) {
      if (!layer || !layer.visible) continue;
      const elems = Array.isArray(layer.elements) ? layer.elements : [];
      elems.forEach((el, idx) => {
        if (!el || (el.kind !== "polyline" && el.kind !== "curve") || !Array.isArray(el.points) || el.points.length < 2) {
          return;
        }
        const pts = el.points;
        const start = pts[0];
        const mid = pts[Math.floor(pts.length / 2)];
        const end = pts[pts.length - 1];

        let allyNearMid = 0;
        let heavyNearMid = 0;
        for (const a of allies) {
          if (Math.hypot(a.x - mid[0], a.y - mid[1]) <= maxSafeDist || Math.hypot(a.x - end[0], a.y - end[1]) <= maxSafeDist) {
            allyNearMid += 1;
          }
        }
        for (const h of heavyMidAllies) {
          if (Math.hypot(h.x - mid[0], h.y - mid[1]) <= maxSafeDist) {
            heavyNearMid += 1;
          }
        }

        let dangerHits = 0;
        for (const dz of dangerZones || []) {
          for (const p of pts) {
            if (Math.hypot(p[0] - dz.x, p[1] - dz.y) <= dz.radiusNorm) {
              dangerHits += 1;
              break;
            }
          }
        }

        const capDist = caps.length > 0 ? minDistToPoints(end, caps) : 0.25;
        const playerDist = player ? Math.hypot(start[0] - player.x, start[1] - player.y) : 0.2;
        const isFlank = layer.category === "flank" || /绕|侧|flank|偷/i.test(String(el.label || "") + String(layer.name || ""));
        const isFast = playerMeta && playerMeta.mobility === "fast";

        let score = 0;
        if (tier === "conservative") {
          score += heavyNearMid * 2.4 + allyNearMid * 1.4;
          score -= dangerHits * 5.0;
          if (isFlank && allyNearMid === 0) score -= 2.2;
          score -= playerDist * 1.5;
        } else if (tier === "balanced") {
          score += allyNearMid * 1.3 + heavyNearMid * 0.8;
          score += Math.max(0, 1.5 - capDist * 4.0);
          score -= dangerHits * 3.5;
          if (isFlank && isFast) score += 0.9;
          score -= playerDist * 1.2;
        } else if (tier === "aggressive") {
          score += isFlank ? 2.6 : 0.4;
          if (isFast) score += 1.4;
          if (heavyMidAllies.length >= 2) score += 1.0; // frontline engaged -> solo flank viable
          score += allyNearMid === 0 ? 0.6 : 0.3;
          score -= dangerHits * 4.2; // still avoid yellow wreck deadzones
          score -= playerDist * 0.8;
        }

        candidates.push({
          key: `${layer.id}:${idx}`,
          label: el.label || layer.name || "推荐走线",
          score,
          dangerHits,
          allyNearMid,
          heavyNearMid,
        });
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    const ids = new Set();
    for (const c of candidates.slice(0, 2)) {
      if (c.score > -1.5) ids.add(c.key);
    }

    const best = candidates[0];
    const vName = playerMeta && playerMeta.shortName ? playerMeta.shortName : "当前载具";
    let tip = "";
    if (!best) {
      tip = "当前地图暂无参考走线，可在右侧绘制或导入 WTMAP 战术码";
    } else if (tier === "conservative") {
      tip = `保守档 (${vName})：依托重/中坦主力二线推进，已避开无人侧翼与标黄高危区`;
    } else if (tier === "balanced") {
      tip = `平衡档 (${vName})：优先半侧翼交叉火力，兼顾输出角度与回防抢点`;
    } else {
      tip = `激进档 (${vName})：主力接火期间高机动大纵深穿插，绕开标黄残骸死区`;
    }

    return { ids, bestId: best ? best.key : "", tip };
  }

  global.WTTacticalEngine = {
    sampleCurve,
    computeDangerZones,
    computeFrontline,
    recommendRoutes,
  };
})(window);
