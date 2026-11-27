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
   * Compute a time-smoothed frontline curve anchored to the forward-most ground allies,
   * bounded strictly within the active ground combat zone and indented behind empty sectors or danger zones.
   */
  function computeFrontline(objects, prevPoints, alpha, dangerZones) {
    const list = Array.isArray(objects) ? objects : [];
    const allySpawns = [];
    const enemySpawns = [];
    const allies = [];
    const enemies = [];
    const caps = [];

    for (const o of list) {
      if (!o || typeof o.x !== "number" || typeof o.y !== "number") continue;
      const typeLow = String(o.type || "").toLowerCase();
      const iconLow = String(o.icon || "").toLowerCase();
      const isAir =
        typeLow === "aircraft" ||
        /fighter|bomber|assault|heli|airfield/.test(typeLow) ||
        /fighter|bomber|assault|heli|airfield/.test(iconLow);
      if (o.role === "spawn_ally") {
        if (!isAir) allySpawns.push(o);
      } else if (o.role === "spawn_enemy") {
        if (!isAir) enemySpawns.push(o);
      } else if (o.role === "capture_zone") {
        caps.push(o);
      } else if (o.role === "enemy") {
        if (!isAir) enemies.push(o);
      } else if (o.role === "ally" || o.role === "player") {
        if (isAir) continue;
        let w = 1.0;
        if (o.ground_class === "spaa" || iconLow.includes("spaa")) w = 0.25;
        else if (o.ground_class === "heavy_tank" || o.ground_class === "medium_tank") w = 1.25;
        else if (o.role === "player") w = 1.0;
        allies.push({ x: o.x, y: o.y, w });
      }
    }

    if (allies.length === 0 && caps.length === 0) return null;

    // Determine battle axis from ground ally spawns -> ground enemy spawns (fallback caps/vertical)
    let axX = 0;
    let axY = -1;
    let centerX = 0.5;
    let centerY = 0.5;
    let rawSpan = 0.45;

    if (allySpawns.length > 0 && enemySpawns.length > 0) {
      const aMean = allySpawns.reduce((acc, p) => [acc[0] + p.x / allySpawns.length, acc[1] + p.y / allySpawns.length], [0, 0]);
      const eMean = enemySpawns.reduce((acc, p) => [acc[0] + p.x / enemySpawns.length, acc[1] + p.y / enemySpawns.length], [0, 0]);
      const dx = eMean[0] - aMean[0];
      const dy = eMean[1] - aMean[1];
      const len = Math.hypot(dx, dy);
      if (len > 0.05) {
        axX = dx / len;
        axY = dy / len;
        rawSpan = len;
      }
      centerX = (aMean[0] + eMean[0]) / 2;
      centerY = (aMean[1] + eMean[1]) / 2;
    } else if (caps.length > 0) {
      centerX = caps.reduce((s, c) => s + c.x, 0) / caps.length;
      centerY = caps.reduce((s, c) => s + c.y, 0) / caps.length;
      if (allies.length > 0) {
        const aMeanX = allies.reduce((s, a) => s + a.x, 0) / allies.length;
        const aMeanY = allies.reduce((s, a) => s + a.y, 0) / allies.length;
        const dx = centerX - aMeanX;
        const dy = centerY - aMeanY;
        const len = Math.hypot(dx, dy);
        if (len > 0.04) {
          axX = dx / len;
          axY = dy / len;
          rawSpan = Math.max(0.25, len * 2);
        }
      }
    }

    const battleSpan = Math.max(0.14, rawSpan);
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

    // Ground combat bounding box & dynamic lateral span (never draw into ocean/off-map voids)
    const groundAnchors = [...allySpawns, ...enemySpawns, ...caps, ...allies, ...enemies];
    let gMinX = 1, gMaxX = 0, gMinY = 1, gMaxY = 0;
    let latMin = Infinity, latMax = -Infinity;
    for (const g of groundAnchors) {
      if (g.x < gMinX) gMinX = g.x;
      if (g.x > gMaxX) gMaxX = g.x;
      if (g.y < gMinY) gMinY = g.y;
      if (g.y > gMaxY) gMaxY = g.y;
      const loc = toLocal(g.x, g.y);
      if (loc.lat < latMin) latMin = loc.lat;
      if (loc.lat > latMax) latMax = loc.lat;
    }
    gMinX = clamp(gMinX - 0.025, 0.03, 0.97);
    gMaxX = clamp(gMaxX + 0.025, 0.03, 0.97);
    gMinY = clamp(gMinY - 0.025, 0.03, 0.97);
    gMaxY = clamp(gMaxY + 0.025, 0.03, 0.97);
    if (!Number.isFinite(latMin) || !Number.isFinite(latMax) || latMax - latMin < 0.08) {
      latMin = -0.25;
      latMax = 0.25;
    } else {
      latMin = clamp(latMin - 0.02, -0.44, 0.44);
      latMax = clamp(latMax + 0.02, -0.44, 0.44);
    }

    const allyLocals = allies.map((a) => ({ ...toLocal(a.x, a.y), w: a.w }));
    const enemyLocals = enemies.map((e) => toLocal(e.x, e.y));
    const capLocals = caps.map((c) => ({
      ...toLocal(c.x, c.y),
      hostile: isHostileHex(c.color),
    }));
    const dzLocals = (Array.isArray(dangerZones) ? dangerZones : []).map((dz) => ({
      ...toLocal(dz.x, dz.y),
      r: Math.max(0.05, Number(dz.radiusNorm) || 0.07),
      count: Number(dz.count) || 2,
    }));

    const allyRearFwd = allySpawns.length > 0
      ? allySpawns.reduce((s, p) => s + toLocal(p.x, p.y).fwd, 0) / allySpawns.length
      : (allyLocals.length > 0 ? Math.min(...allyLocals.map((a) => a.fwd)) - 0.05 * battleSpan : -0.4 * battleSpan);
    const enemyRearFwd = enemySpawns.length > 0
      ? enemySpawns.reduce((s, p) => s + toLocal(p.x, p.y).fwd, 0) / enemySpawns.length
      : (capLocals.length > 0 ? Math.max(...capLocals.map((c) => c.fwd)) + 0.15 * battleSpan : 0.4 * battleSpan);
    const minFwd = Math.min(allyRearFwd, enemyRearFwd) + 0.06 * battleSpan;
    const maxFwd = Math.max(allyRearFwd, enemyRearFwd) - 0.06 * battleSpan;

    const slices = 15;
    const bandW = clamp((latMax - latMin) * 0.13, 0.025, 0.075);
    const capBandW = Math.max(bandW * 1.25, 0.055);
    const sliceData = [];

    for (let i = 0; i < slices; i++) {
      const latTarget = latMin + ((latMax - latMin) * i) / (slices - 1);
      let allyNum = 0;
      let allyDen = 0;
      let maxAllyFwd = -Infinity;
      let localAllySupport = 0;

      for (const a of allyLocals) {
        const dLat = Math.abs(a.lat - latTarget);
        const k = Math.exp(-(dLat * dLat) / (2 * bandW * bandW)) * a.w;
        allyNum += a.fwd * k;
        allyDen += k;
        localAllySupport += k;
        if (dLat <= bandW * 1.6 && a.fwd > maxAllyFwd) {
          maxAllyFwd = a.fwd;
        }
      }

      let capEnemyNum = 0;
      let capEnemyDen = 0;
      for (const c of capLocals) {
        const dLat = Math.abs(c.lat - latTarget);
        const k = Math.exp(-(dLat * dLat) / (2 * capBandW * capBandW)) * 0.75;
        const capBias = c.hostile ? c.fwd - 0.025 * battleSpan : c.fwd + 0.025 * battleSpan;
        capEnemyNum += capBias * k;
        capEnemyDen += k;
      }
      for (const e of enemyLocals) {
        const dLat = Math.abs(e.lat - latTarget);
        const k = Math.exp(-(dLat * dLat) / (2 * capBandW * capBandW)) * 0.6;
        capEnemyNum += (e.fwd - 0.025 * battleSpan) * k;
        capEnemyDen += k;
      }

      sliceData.push({
        latTarget,
        localAllySupport,
        allyMeanFwd: allyDen > 1e-4 ? allyNum / allyDen : null,
        maxAllyFwd: Number.isFinite(maxAllyFwd) ? maxAllyFwd : null,
        capEnemyFwd: capEnemyDen > 1e-4 ? capEnemyNum / capEnemyDen : null,
      });
    }

    const supportedFwds = sliceData
      .filter((s) => s.localAllySupport >= 0.25 && s.maxAllyFwd !== null)
      .map((s) => 0.68 * s.maxAllyFwd + 0.32 * s.allyMeanFwd + 0.022 * battleSpan)
      .sort((a, b) => a - b);
    const fallbackFwd = supportedFwds.length > 0
      ? supportedFwds[Math.floor(supportedFwds.length / 2)]
      : 0;

    const rawPts = [];
    for (const s of sliceData) {
      let fwd;
      if (s.localAllySupport >= 0.25 && s.maxAllyFwd !== null) {
        const vanguardFwd = 0.68 * s.maxAllyFwd + 0.32 * s.allyMeanFwd + 0.022 * battleSpan;
        fwd = s.capEnemyFwd !== null ? 0.82 * vanguardFwd + 0.18 * s.capEnemyFwd : vanguardFwd;
      } else {
        const baseFwd = s.capEnemyFwd !== null ? 0.5 * s.capEnemyFwd + 0.5 * fallbackFwd : fallbackFwd;
        fwd = baseFwd - (0.25 - s.localAllySupport) * 0.32 * battleSpan;
      }

      for (const dz of dzLocals) {
        const dLat = Math.abs(s.latTarget - dz.lat);
        const spanR = Math.max(bandW * 1.4, dz.r * 1.2);
        if (dLat < spanR * 2.0) {
          const pressure = clamp(0.08 + dz.count * 0.02, 0.09, 0.2) * battleSpan;
          fwd -= Math.exp(-(dLat * dLat) / (2 * spanR * spanR)) * pressure;
        }
      }

      fwd = clamp(fwd, minFwd, maxFwd);
      const wx = clamp(centerX + s.latTarget * latX + fwd * axX, gMinX, gMaxX);
      const wy = clamp(centerY + s.latTarget * latY + fwd * axY, gMinY, gMaxY);
      rawPts.push([wx, wy]);
    }

    const smoothAlpha = clamp(Number(alpha) || 0.24, 0.05, 0.5);
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
   * Score live 8111 corridors from surviving ally distribution & active spawn,
   * generate dynamic flank/push routes, and highlight aligned static routes.
   */
  function recommendRoutes(tier, vectorLayers, objects, dangerZones, playerMeta, mapInfo, activeSpawn) {
    if (!tier || tier === "off") {
      return { ids: new Set(), dynamicRoutes: [], bestId: "", tip: "" };
    }

    const allies = [];
    const allySpawns = [];
    const enemySpawns = [];
    const caps = [];
    let player = null;

    for (const o of objects || []) {
      if (!o || typeof o.x !== "number" || typeof o.y !== "number") continue;
      const typeLow = String(o.type || "").toLowerCase();
      const iconLow = String(o.icon || "").toLowerCase();
      const isAir =
        typeLow === "aircraft" ||
        /fighter|bomber|assault|heli|airfield/.test(typeLow) ||
        /fighter|bomber|assault|heli|airfield/.test(iconLow);
      if (o.role === "player") player = o;
      else if (o.role === "spawn_ally") { if (!isAir) allySpawns.push(o); }
      else if (o.role === "spawn_enemy") { if (!isAir) enemySpawns.push(o); }
      else if (o.role === "capture_zone") caps.push(o);
      else if (o.role === "ally" && !isAir) allies.push(o);
    }

    const origin = player || activeSpawn || (allySpawns.length > 0 ? allySpawns[0] : null);
    if (!origin) {
      return { ids: new Set(), dynamicRoutes: [], bestId: "", tip: "等待 8111 己方位置或出生点数据..." };
    }

    // Determine battle axis from active/mean ally spawn -> enemy spawn (handles top/bottom/left/right spawns)
    const aRef = activeSpawn || (allySpawns.length > 0
      ? {
          x: allySpawns.reduce((s, p) => s + p.x, 0) / allySpawns.length,
          y: allySpawns.reduce((s, p) => s + p.y, 0) / allySpawns.length,
        }
      : { x: origin.x, y: origin.y });

    let eRef = null;
    if (enemySpawns.length > 0) {
      eRef = {
        x: enemySpawns.reduce((s, p) => s + p.x, 0) / enemySpawns.length,
        y: enemySpawns.reduce((s, p) => s + p.y, 0) / enemySpawns.length,
      };
    } else if (caps.length > 0) {
      const capMeanX = caps.reduce((s, c) => s + c.x, 0) / caps.length;
      const capMeanY = caps.reduce((s, c) => s + c.y, 0) / caps.length;
      eRef = { x: clamp(2 * capMeanX - aRef.x, 0.08, 0.92), y: clamp(2 * capMeanY - aRef.y, 0.08, 0.92) };
    } else {
      eRef = { x: clamp(1 - aRef.x, 0.1, 0.9), y: clamp(1 - aRef.y, 0.1, 0.9) };
    }

    const rawDx = eRef.x - aRef.x;
    const rawDy = eRef.y - aRef.y;
    const rawLen = Math.hypot(rawDx, rawDy);
    const axX = rawLen > 0.05 ? rawDx / rawLen : 0;
    const axY = rawLen > 0.05 ? rawDy / rawLen : -1;
    const latX = -axY;
    const latY = axX;
    const battleSpan = Math.max(0.16, rawLen);
    const centerX = (aRef.x + eRef.x) / 2;
    const centerY = (aRef.y + eRef.y) / 2;

    const toLocal = (px, py) => {
      const rx = px - centerX;
      const ry = py - centerY;
      return {
        lat: rx * latX + ry * latY,
        fwd: rx * axX + ry * axY,
      };
    };

    const gAnchors = [...allySpawns, ...enemySpawns, ...caps, ...allies];
    if (player) gAnchors.push(player);
    let gMinX = 1, gMaxX = 0, gMinY = 1, gMaxY = 0;
    let latMin = Infinity, latMax = -Infinity;
    for (const g of gAnchors) {
      if (g.x < gMinX) gMinX = g.x;
      if (g.x > gMaxX) gMaxX = g.x;
      if (g.y < gMinY) gMinY = g.y;
      if (g.y > gMaxY) gMaxY = g.y;
      const loc = toLocal(g.x, g.y);
      if (loc.lat < latMin) latMin = loc.lat;
      if (loc.lat > latMax) latMax = loc.lat;
    }
    gMinX = clamp(gMinX - 0.015, 0.03, 0.97);
    gMaxX = clamp(gMaxX + 0.015, 0.03, 0.97);
    gMinY = clamp(gMinY - 0.015, 0.03, 0.97);
    gMaxY = clamp(gMaxY + 0.015, 0.03, 0.97);
    const combatLatHalf = Number.isFinite(latMin) && Number.isFinite(latMax)
      ? clamp((latMax - latMin) * 0.5, 0.07, 0.34)
      : 0.25;
    const laneThresh = combatLatHalf * 0.35;

    const classifyLane = (lat) => {
      if (lat < -laneThresh) return "left";
      if (lat > laneThresh) return "right";
      return "center";
    };

    // Weighted ally density per corridor (discount spawn-lingering allies, emphasize forward units)
    const laneStats = {
      left: { name: "左翼", allyCount: 0, heavyCount: 0, capPull: 0, dangerZones: 0, dangerWrecks: 0 },
      center: { name: "中路", allyCount: 0, heavyCount: 0, capPull: 0, dangerZones: 0, dangerWrecks: 0 },
      right: { name: "右翼", allyCount: 0, heavyCount: 0, capPull: 0, dangerZones: 0, dangerWrecks: 0 },
    };

    for (const a of allies) {
      const iconLow = String(a.icon || "").toLowerCase();
      let classW = 0.85;
      let isHeavyMid = false;
      if (a.ground_class === "spaa" || iconLow.includes("spaa")) {
        classW = 0.3;
      } else if (
        a.ground_class === "heavy_tank" ||
        a.ground_class === "medium_tank" ||
        iconLow.includes("heavy") ||
        iconLow.includes("medium")
      ) {
        classW = 1.0;
        isHeavyMid = true;
      }

      const prog = ((a.x - aRef.x) * axX + (a.y - aRef.y) * axY) / battleSpan;
      const nearSpawn = allySpawns.length > 0 && minDistToPoints([a.x, a.y], allySpawns) < 0.12;
      let progW = 1.0;
      if (prog < 0.18 || nearSpawn) progW = 0.35;
      else if (prog >= 0.32) progW = 1.15;

      const loc = toLocal(a.x, a.y);
      const lane = classifyLane(loc.lat);
      laneStats[lane].allyCount += classW * progW;
      if (isHeavyMid && prog >= 0.18) {
        laneStats[lane].heavyCount += 1;
      }
    }

    const capsByLane = { left: [], center: [], right: [] };
    for (const c of caps) {
      const loc = toLocal(c.x, c.y);
      const lane = classifyLane(loc.lat);
      const hostile = isHostileHex(c.color);
      const pull = hostile ? 1.3 : 0.8;
      laneStats[lane].capPull = Math.max(laneStats[lane].capPull, pull);
      capsByLane[lane].push({ cap: c, hostile, lat: loc.lat, fwd: loc.fwd });
    }

    for (const dz of dangerZones || []) {
      const loc = toLocal(dz.x, dz.y);
      const lane = classifyLane(loc.lat);
      laneStats[lane].dangerZones += 1;
      laneStats[lane].dangerWrecks += Number(dz.count) || 2;
    }

    const isFast = Boolean(playerMeta && playerMeta.mobility === "fast");
    const flankLatMag = combatLatHalf * (tier === "aggressive" ? 0.85 : 0.72);
    const lanes = ["left", "center", "right"];
    const dynamicCandidates = [];

    const deflectDanger = (pt) => {
      let x = clamp(pt[0], gMinX, gMaxX);
      let y = clamp(pt[1], gMinY, gMaxY);
      for (const dz of dangerZones || []) {
        const dx = x - dz.x;
        const dy = y - dz.y;
        const d = Math.hypot(dx, dy);
        const safeR = dz.radiusNorm + 0.04;
        if (d < safeR) {
          const latProj = dx * latX + dy * latY;
          const sign = latProj >= 0 ? 1 : -1;
          const push = safeR - d + 0.02;
          x = clamp(x + sign * latX * push, gMinX, gMaxX);
          y = clamp(y + sign * latY * push, gMinY, gMaxY);
        }
      }
      return [x, y];
    };

    for (const lane of lanes) {
      const st = laneStats[lane];
      const latTarget = lane === "left" ? -flankLatMag : lane === "right" ? flankLatMag : 0;
      const isFlank = lane !== "center";

      let endPt;
      const laneCaps = capsByLane[lane];
      if (laneCaps.length > 0) {
        laneCaps.sort((a, b) => Number(b.hostile) - Number(a.hostile));
        const chosen = laneCaps[0].cap;
        endPt = [clamp(chosen.x + latTarget * 0.14 * latX, gMinX, gMaxX), clamp(chosen.y + latTarget * 0.14 * latY, gMinY, gMaxY)];
      } else {
        const endFwd = tier === "aggressive" ? 0.25 * battleSpan : 0.14 * battleSpan;
        endPt = [
          clamp(centerX + latTarget * latX + endFwd * axX, gMinX, gMaxX),
          clamp(centerY + latTarget * latY + endFwd * axY, gMinY, gMaxY),
        ];
      }

      const originLoc = toLocal(origin.x, origin.y);
      const endLoc = toLocal(endPt[0], endPt[1]);
      const p1Fwd = originLoc.fwd + (endLoc.fwd - originLoc.fwd) * 0.34;
      const p2Fwd = originLoc.fwd + (endLoc.fwd - originLoc.fwd) * 0.68;

      const rawP1 = [
        originLoc.lat * 0.25 * latX + centerX + latTarget * 0.85 * latX + p1Fwd * axX,
        originLoc.lat * 0.25 * latY + centerY + latTarget * 0.85 * latY + p1Fwd * axY,
      ];
      const rawP2 = [
        centerX + latTarget * 1.05 * latX + p2Fwd * axX,
        centerY + latTarget * 1.05 * latY + p2Fwd * axY,
      ];

      const p0 = [clamp(origin.x, gMinX, gMaxX), clamp(origin.y, gMinY, gMaxY)];
      const p1 = deflectDanger(rawP1);
      const p2 = deflectDanger(rawP2);
      const p3 = deflectDanger(endPt);
      const ctrlPts = [p0, p1, p2, p3];
      const sampled = sampleCurve(ctrlPts, 8);

      let dangerHits = 0;
      for (const dz of dangerZones || []) {
        for (const p of sampled) {
          if (Math.hypot(p[0] - dz.x, p[1] - dz.y) <= dz.radiusNorm) {
            dangerHits += 1;
            break;
          }
        }
      }

      let score = 0;
      const ac = st.allyCount;
      if (ac <= 1.0) {
        if (tier === "aggressive") {
          score += 4.0 + (isFast ? 1.6 : 0) + (isFlank ? 0.8 : 0);
        } else if (tier === "balanced") {
          score += 1.9 + (isFast ? 0.7 : 0) + (isFlank ? 0.3 : 0);
        } else {
          score += 1.3 + (isFast ? 0.4 : 0);
        }
      } else if (ac < 3.0) {
        if (tier === "conservative") {
          score += 2.4 + st.heavyCount * 1.2;
        } else if (tier === "balanced") {
          score += 1.5 + st.heavyCount * 0.6;
        } else {
          score += 0.4;
        }
      } else if (ac < 4.0) {
        score -= tier === "aggressive" ? 2.0 : 1.4;
      } else {
        const extra = ac - 3.0;
        score -= tier === "aggressive" ? 2.2 + extra * 2.2 : 1.4 + extra * 1.8;
      }

      score += st.capPull * (tier === "conservative" ? 0.7 : 1.3);
      score -= st.dangerZones * (tier === "conservative" ? 1.8 : 1.2);
      score -= dangerHits * (tier === "conservative" ? 4.5 : tier === "balanced" ? 3.2 : 2.4);
      score -= Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 0.6;

      let reasonTag = `可走${st.name}支援 · 交叉火力`;
      if (ac <= 1.0) {
        reasonTag = isFast
          ? `${st.name}空间较大 · 可快速切入`
          : isFlank
            ? `${st.name}空间较大 · 可侧翼补防`
            : `${st.name}缺口 · 可适度补位`;
      } else if (ac >= 3.0) {
        reasonTag = `${st.name}偏挤 · 谨慎跟进`;
      } else if (tier === "conservative" && st.heavyCount >= 1) {
        reasonTag = `${st.name}稳健 · 依托主力`;
      }

      dynamicCandidates.push({
        id: `dyn:${lane}`,
        lane,
        laneName: st.name,
        allyCount: ac,
        points: ctrlPts,
        score,
        label: `★ ${reasonTag}`,
      });
    }

    dynamicCandidates.sort((a, b) => b.score - a.score);
    const bestDyn = dynamicCandidates[0];
    if (bestDyn) {
      const avoidDangerLane = lanes
        .filter((l) => l !== bestDyn.lane && laneStats[l].dangerWrecks > 0)
        .map((l) => ({ lane: l, ...laneStats[l] }))
        .sort((a, b) => b.dangerWrecks - a.dangerWrecks)[0];
      const crowdedLane = lanes
        .filter((l) => l !== bestDyn.lane && laneStats[l].allyCount >= 3.0)
        .map((l) => ({ lane: l, ...laneStats[l] }))
        .sort((a, b) => b.allyCount - a.allyCount)[0];

      const chosenSt = laneStats[bestDyn.lane];
      if (avoidDangerLane && chosenSt.allyCount <= 1.0) {
        bestDyn.label = `★ 避开${avoidDangerLane.name}高危 · 可走${bestDyn.laneName}补防`;
      } else if (avoidDangerLane) {
        bestDyn.label = `★ 避开${avoidDangerLane.name}高危 · 可走${bestDyn.laneName}支援`;
      } else if (crowdedLane && chosenSt.allyCount <= 1.0) {
        bestDyn.label = `★ 避开${crowdedLane.name}偏挤 · ${bestDyn.laneName}可补防`;
      }
      bestDyn._avoidDangerLane = avoidDangerLane || null;
      bestDyn._crowdedLane = crowdedLane || null;
    }
    const dynamicRoutes = bestDyn ? [bestDyn] : [];

    // Also evaluate visible static reference routes ONLY if aligned with current spawn -> enemy direction and chosen lane
    const staticCandidates = [];
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
        const vdx = end[0] - start[0];
        const vdy = end[1] - start[1];
        const vlen = Math.hypot(vdx, vdy);
        if (vlen < 0.04) return;
        const align = (vdx * axX + vdy * axY) / vlen;
        if (align <= 0.2) return; // filter out opposite-spawn / reverse routes

        const midLane = classifyLane(toLocal(mid[0], mid[1]).lat);
        if (bestDyn && midLane !== bestDyn.lane) return;
        const laneAc = laneStats[midLane].allyCount;

        let dangerHits = 0;
        for (const dz of dangerZones || []) {
          for (const p of pts) {
            if (Math.hypot(p[0] - dz.x, p[1] - dz.y) <= dz.radiusNorm) {
              dangerHits += 1;
              break;
            }
          }
        }

        let sScore = align * 1.4;
        if (laneAc <= 1.0) sScore += tier === "conservative" ? 0.2 : 2.6;
        else if (laneAc >= 4.0) sScore -= 2.8;
        else if (laneAc >= 3.0) sScore -= 1.2;
        else sScore += 1.0;

        const isFlank = layer.category === "flank" || /绕|侧|flank|偷/i.test(String(el.label || "") + String(layer.name || ""));
        if (isFlank && isFast) sScore += 1.0;
        sScore -= dangerHits * 3.5;
        sScore -= Math.hypot(start[0] - origin.x, start[1] - origin.y) * 1.1;

        staticCandidates.push({ key: `${layer.id}:${idx}`, score: sScore });
      });
    }

    staticCandidates.sort((a, b) => b.score - a.score);
    const ids = new Set();
    if (staticCandidates[0] && staticCandidates[0].score > 0) {
      ids.add(staticCandidates[0].key);
    }

    const vName = playerMeta && playerMeta.shortName ? playerMeta.shortName : "当前载具";
    const summary = `左${laneStats.left.allyCount.toFixed(1)}/中${laneStats.center.allyCount.toFixed(1)}/右${laneStats.right.allyCount.toFixed(1)}人`;
    let tip = "";
    if (bestDyn) {
      const parts = [];
      if (bestDyn._avoidDangerLane) {
        parts.push(`避开${bestDyn._avoidDangerLane.name}高危(×${bestDyn._avoidDangerLane.dangerWrecks})`);
      }
      if (bestDyn._crowdedLane) {
        parts.push(`${bestDyn._crowdedLane.name}偏挤`);
      }
      const action =
        bestDyn.allyCount <= 1.0
          ? `可考虑走${bestDyn.laneName}补防`
          : `可走${bestDyn.laneName}交叉支援`;
      parts.push(action);
      tip = `${vName} (${summary}) · 参考：${parts.join("，")}`;
    }

    return { ids, dynamicRoutes, bestId: bestDyn ? bestDyn.id : "", tip };
  }

  global.WTTacticalEngine = {
    sampleCurve,
    computeDangerZones,
    computeFrontline,
    recommendRoutes,
  };
})(window);
