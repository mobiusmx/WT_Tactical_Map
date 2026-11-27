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
   * Smooth time-based fade curve for danger zones (default 120s total TTL).
   * Holds clear in the first 40% (1.0 -> 0.92), then eases out smoothly to 0.
   */
  function computeDangerFade(ageMs, ttlMs) {
    const ttl = Math.max(1000, Number(ttlMs) || 120000);
    const progress = clamp((Number(ageMs) || 0) / ttl, 0, 1);
    if (progress >= 1) return 0;
    if (progress <= 0.4) {
      return 1 - progress * 0.2;
    }
    const t = (progress - 0.4) / 0.6;
    return 0.92 * Math.pow(1 - t, 1.5);
  }

  function sampleLensPoints(x1, y1, x2, y2, rNorm, steps = 8) {
    const d = Math.hypot(x2 - x1, y2 - y1);
    const pts = [];
    if (d <= 1e-5) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        pts.push([x1 + Math.cos(a) * rNorm, y1 + Math.sin(a) * rNorm]);
      }
      return pts;
    }
    if (d >= rNorm * 1.995) return pts;
    const theta = Math.atan2(y2 - y1, x2 - x1);
    const halfAngle = Math.acos(clamp(d / (2 * rNorm), -1, 1));
    for (let i = 0; i <= steps; i++) {
      const a = theta - halfAngle + (2 * halfAngle * i) / steps;
      pts.push([x1 + Math.cos(a) * rNorm, y1 + Math.sin(a) * rNorm]);
    }
    for (let i = 0; i <= steps; i++) {
      const a = theta + Math.PI - halfAngle + (2 * halfAngle * i) / steps;
      pts.push([x2 + Math.cos(a) * rNorm, y2 + Math.sin(a) * rNorm]);
    }
    return pts;
  }

  function computeConvexHull(points) {
    if (!Array.isArray(points) || points.length < 3) return [];
    const sorted = points
      .slice()
      .sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  /**
   * Detect danger zones from wrecks in two modes:
   * - "intersect" (default): draw circles of adapted radius around wrecks, extract overlapping
   *   lens intersections, and cluster-merge adjacent/shared intersections into unified zones.
   * - "circle": original large-circle connected-component cluster danger zones (capped <= 150m).
   */
  function computeDangerZones(wrecks, mapInfo, radiusM, nowMs, options) {
    const now = nowMs || Date.now();
    const rawMode = options && options.mode;
    const mode = rawMode === "circle" || rawMode === "cluster" ? "circle" : "intersect";
    const ttlMs = clamp(Number(options && options.ttlMs) || 120000, 20000, 300000);
    const rMeters = clamp(Number(radiusM) || 90, 30, 250);
    const { w } = mapMetersSize(mapInfo);
    const largeMapScale = w > 2000 ? clamp(1 + ((w - 2000) / 2200) * 0.85, 1.0, 2.0) : 1.0;
    const effectiveRMeters = rMeters * largeMapScale;
    const rNorm = clamp(effectiveRMeters / w, 0.028, 0.15);

    const valid = (wrecks || []).filter(
      (wk) =>
        wk &&
        typeof wk.x === "number" &&
        typeof wk.y === "number" &&
        typeof wk.ts === "number" &&
        now - wk.ts >= 0 &&
        now - wk.ts <= ttlMs
    );
    if (valid.length < 2) return [];

    const zones = [];

    if (mode === "intersect") {
      const overlapEdge = rNorm * 1.98;
      const allPairs = [];
      for (let i = 0; i < valid.length; i++) {
        for (let j = i + 1; j < valid.length; j++) {
          const a = valid[i];
          const b = valid[j];
          if (Math.hypot(a.x - b.x, a.y - b.y) < overlapEdge) {
            allPairs.push({
              i,
              j,
              x1: a.x,
              y1: a.y,
              x2: b.x,
              y2: b.y,
              mx: (a.x + b.x) * 0.5,
              my: (a.y + b.y) * 0.5,
              rNorm,
              latestTs: Math.max(a.ts, b.ts),
            });
          }
        }
      }
      if (allPairs.length === 0) return [];

      const mergeDist = Math.max(rNorm * 1.65, clamp(135 / w, 0.042, 0.12));
      const visitedPairs = new Array(allPairs.length).fill(false);

      for (let pi = 0; pi < allPairs.length; pi++) {
        if (visitedPairs[pi]) continue;
        const queue = [pi];
        visitedPairs[pi] = true;
        const groupPairs = [];

        while (queue.length > 0) {
          const curIdx = queue.shift();
          const p = allPairs[curIdx];
          groupPairs.push(p);
          for (let pj = 0; pj < allPairs.length; pj++) {
            if (visitedPairs[pj]) continue;
            const q = allPairs[pj];
            const sharesWreck = p.i === q.i || p.i === q.j || p.j === q.i || p.j === q.j;
            const nearMid = Math.hypot(p.mx - q.mx, p.my - q.my) <= mergeDist;
            if (sharesWreck || nearMid) {
              visitedPairs[pj] = true;
              queue.push(pj);
            }
          }
        }

        const memberSet = new Set();
        let hasSelf = false;
        let latestTs = 0;
        let sx = 0;
        let sy = 0;
        for (const pr of groupPairs) {
          memberSet.add(pr.i);
          memberSet.add(pr.j);
          if (valid[pr.i].isSelf || valid[pr.j].isSelf) hasSelf = true;
          if (pr.latestTs > latestTs) latestTs = pr.latestTs;
          sx += pr.mx;
          sy += pr.my;
        }
        const alpha = computeDangerFade(now - latestTs, ttlMs);
        if (alpha <= 0.01) continue;

        const cx = sx / groupPairs.length;
        const cy = sy / groupPairs.length;
        let maxMidDist = 0;
        for (const pr of groupPairs) {
          const dMid = Math.hypot(pr.mx - cx, pr.my - cy);
          if (dMid > maxMidDist) maxMidDist = dMid;
        }

        let hull = null;
        if (groupPairs.length >= 2) {
          const allPts = [];
          for (const pr of groupPairs) {
            const pts = sampleLensPoints(pr.x1, pr.y1, pr.x2, pr.y2, pr.rNorm, 8);
            for (const pt of pts) allPts.push(pt);
          }
          const h = computeConvexHull(allPts);
          if (h.length >= 3) hull = h;
        }

        zones.push({
          mode: "intersect",
          x: cx,
          y: cy,
          radiusNorm: clamp(maxMidDist + rNorm * 0.55, rNorm * 0.45, 0.18),
          rNorm,
          count: memberSet.size,
          hasSelf,
          latestTs,
          ttlMs,
          alpha,
          pairs: groupPairs,
          hull,
        });
      }
      return zones;
    }

    // Mode 2 ("circle"): original large-circle connected-component clusters (strictly capped <= 150m)
    const maxCircleMeters = clamp(Math.max(135, rMeters * 1.45), 130, 150);
    const maxCircleNorm = clamp(maxCircleMeters / w, 0.032, 0.105);
    const overlapDist = Math.min(rNorm * 2.0, maxCircleNorm * 1.6);
    const visited = new Array(valid.length).fill(false);

    for (let i = 0; i < valid.length; i++) {
      if (visited[i]) continue;
      const seed = valid[i];
      const queue = [i];
      visited[i] = true;
      const cluster = [];
      while (queue.length > 0) {
        const idx = queue.shift();
        cluster.push(valid[idx]);
        for (let j = 0; j < valid.length; j++) {
          if (visited[j]) continue;
          if (
            Math.hypot(valid[idx].x - valid[j].x, valid[idx].y - valid[j].y) <= overlapDist &&
            Math.hypot(valid[j].x - seed.x, valid[j].y - seed.y) <= maxCircleNorm * 1.35
          ) {
            visited[j] = true;
            queue.push(j);
          }
        }
      }
      if (cluster.length < 2) continue;

      let sx = 0;
      let sy = 0;
      let hasSelf = false;
      let latestTs = 0;
      for (const c of cluster) {
        sx += c.x;
        sy += c.y;
        if (c.isSelf) hasSelf = true;
        if (c.ts > latestTs) latestTs = c.ts;
      }
      const alpha = computeDangerFade(now - latestTs, ttlMs);
      if (alpha <= 0.01) continue;

      const cx = sx / cluster.length;
      const cy = sy / cluster.length;
      const minR = Math.min(rNorm, maxCircleNorm);
      let maxR = minR;
      for (const c of cluster) {
        maxR = Math.max(maxR, Math.hypot(c.x - cx, c.y - cy) + minR * 0.72);
      }
      zones.push({
        mode: "circle",
        x: cx,
        y: cy,
        radiusNorm: clamp(maxR, minR, maxCircleNorm),
        count: cluster.length,
        hasSelf,
        latestTs,
        ttlMs,
        alpha,
      });
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

  function isDroneVehicle(vehicleType, obj) {
    const parts = [vehicleType];
    if (obj && typeof obj === "object") {
      parts.push(obj.type, obj.icon, obj.name, obj.shortName);
    }
    const text = parts
      .filter((v) => v !== undefined && v !== null && v !== "")
      .join(" ")
      .toLowerCase();
    if (!text) return false;
    return /(uav|ucav|drone|recon_micro|micro_uav|scout_uav|mq[_-]?1|mq[_-]?9|predator|reaper|orion|wing[_-]?loong|wingloong|forpost|lancet|switchblade|bayraktar|tb2|hermes|korsar|granat|orlan)/.test(
      text
    );
  }

  /**
   * Detect scout/attack drone flight from ground-mode kinematics:
   * - speedKmh >= 115 (ground tanks never sustain 115+ km/h)
   * - sustained >= 29 m/s (~105 km/h) map velocity
   */
  function isKinematicDroneFlight(opts) {
    if (!opts || opts.airModeActive || !opts.wasGroundPlayer) return false;
    const speedKmh = Number(opts.speedKmh) || 0;
    const impliedSpeedMps = Number(opts.impliedSpeedMps) || 0;
    if (speedKmh >= 115) return true;
    if (impliedSpeedMps >= 29 && impliedSpeedMps <= 220) {
      return true;
    }
    return false;
  }

  /**
   * Classify a single player position delta into "ground" | "drone" | "jump"
   * using exact floating-point meters so slow 8Hz movement is never lost to rounding.
   */
  function classifyGroundStep(opts) {
    if (!opts) return { kind: "jump", meters: 0 };
    const dx = Number(opts.dxNorm) || 0;
    const dy = Number(opts.dyNorm) || 0;
    const mapWidthM = Math.max(100, Number(opts.mapWidthM) || 2048);
    const dtSec = Number(opts.dtSec) || 0;
    const speedKmh = Number(opts.speedKmh) || 0;
    const airModeActive = Boolean(opts.airModeActive);
    const droneWindowActive = Boolean(opts.droneWindowActive);

    const stepM = Math.hypot(dx, dy) * mapWidthM;
    if (!Number.isFinite(stepM) || stepM <= 0 || stepM > 180 || dtSec <= 0 || dtSec > 5.0) {
      return { kind: "jump", meters: 0 };
    }
    const impliedMps = dtSec >= 0.04 ? stepM / dtSec : 0;
    if (droneWindowActive || (!airModeActive && (speedKmh >= 115 || impliedMps >= 29))) {
      return { kind: "drone", meters: stepM };
    }
    return { kind: "ground", meters: stepM };
  }

  function isAirUnit(obj) {
    if (!obj || typeof obj !== "object") return false;
    const typeLow = String(obj.type || "").toLowerCase();
    const iconLow = String(obj.icon || "").toLowerCase();
    if (typeLow === "aircraft" || typeLow === "helicopter") return true;
    if (/(airdefence|spaa|aa_gun|flak|tank|ship|boat|destroyer|cruiser|battleship|bunker|pillbox)/.test(`${typeLow} ${iconLow}`)) {
      return false;
    }
    return /(fighter|bomber|assault|attacker|interceptor|heli|plane|aircraft)/.test(iconLow);
  }

  function detectAirBattle(state) {
    if (!state || state.status !== "active") return false;
    const tel = state.telemetry || {};
    const army = String(tel.army || "").toLowerCase();
    if (army.includes("air") || army.includes("heli")) return true;
    if (typeof tel.speed_kmh === "number" && tel.speed_kmh >= 170) return true;

    const objs = Array.isArray(state.objects) ? state.objects : [];
    const player = objs.find((o) => o && o.role === "player");
    if (player && isAirUnit(player)) return true;

    const info = state.map_info;
    if (info && Array.isArray(info.map_min) && Array.isArray(info.map_max)) {
      const wMeters = Math.abs(Number(info.map_max[0]) - Number(info.map_min[0]));
      if (wMeters >= 14000) return true;
    }

    let hasAirObj = false;
    let hasGroundSpawn = false;
    for (const o of objs) {
      if (!o) continue;
      const tLow = String(o.type || "").toLowerCase();
      if (o.role === "airfield" || tLow === "airfield" || tLow === "bombing_point" || tLow === "defending_point") {
        hasAirObj = true;
      }
      if ((o.role === "spawn_ally" || o.role === "spawn_enemy") && tLow.includes("tank")) {
        hasGroundSpawn = true;
      }
    }
    return hasAirObj && !hasGroundSpawn;
  }

  /**
   * Classify the first valid spawned vehicle of a match ("ground" | "air" | null).
   * Returns null while still on the spawn selection screen or in a drone.
   */
  function classifyInitialSpawnMode(state) {
    if (!state || state.status !== "active") return null;
    const tel = state.telemetry || {};
    const objs = Array.isArray(state.objects) ? state.objects : [];
    const player = objs.find((o) => o && o.role === "player");
    const playerOnMap = Boolean(
      player &&
        typeof player.x === "number" &&
        typeof player.y === "number" &&
        player.x >= 0 &&
        player.x <= 1 &&
        player.y >= 0 &&
        player.y <= 1
    );
    const hasTelVehicle = tel.valid !== false && Boolean(tel.vehicle_type || tel.army);
    if (!playerOnMap && !hasTelVehicle) return null;
    if (isDroneVehicle(tel.vehicle_type, player)) return null;

    const army = String(tel.army || "").toLowerCase();
    if (/(tank|ground|ship|navy|fleet|boat)/.test(army)) return "ground";
    if (/(air|heli)/.test(army) || (player && isAirUnit(player))) return "air";
    if (typeof tel.speed_kmh === "number" && tel.speed_kmh >= 170) return "air";
    return "ground";
  }

  /**
   * Decide whether a match settlement should be recorded in history:
   * - Filters zero/negligible-move empty transitional records (e.g. just spawned / map load)
   * - Filters placeholder vehicle/map records without real activity
   * - Deduplicates rapid repeated settlements for the same map + vehicle
   */
  function shouldRecordMatchSettlement(payload, lastSettled, options) {
    if (!payload || typeof payload !== "object") {
      return { accept: false, reason: "empty_zero_move" };
    }
    const now = Number(options && options.nowMs) || Date.now();
    const durSec = Math.max(0, Number(payload.duration_sec) || 0);
    const distM = Math.max(0, Number(payload.distance_m) || 0);
    const deaths = Math.max(0, Number(payload.self_deaths) || 0);
    const allyLosses = Math.max(0, Number(payload.nearby_ally_losses) || 0);
    const mapName = String(payload.map_name || "").trim();
    const vehicle = String(payload.vehicle || "").trim();
    const vLow = vehicle.toLowerCase();

    const isPlaceholderVehicle =
      !vLow || vLow === "未知载具" || vLow === "unknown" || vLow === "tankmodel" || vLow === "载具";
    const isUnknownMap = !mapName || mapName === "未知地图" || mapName.toLowerCase() === "unknown";

    if (deaths === 0) {
      if (distM < 15 && durSec < 30) {
        return { accept: false, reason: "empty_zero_move" };
      }
      if ((isPlaceholderVehicle || isUnknownMap) && distM < 15 && allyLosses === 0) {
        return { accept: false, reason: "placeholder_empty" };
      }
    }

    if (lastSettled && typeof lastSettled.ts === "number") {
      const elapsed = now - lastSettled.ts;
      const sameMap =
        mapName.toLowerCase() === String(lastSettled.map_name || "").trim().toLowerCase();
      const sameVehicle =
        vLow === String(lastSettled.vehicle || "").trim().toLowerCase();
      if (elapsed >= 0 && sameMap && sameVehicle) {
        if (
          elapsed <= 20000 &&
          (deaths === 0 ||
            (deaths === (Number(lastSettled.self_deaths) || 0) &&
              Math.abs(distM - (Number(lastSettled.distance_m) || 0)) <= 15))
        ) {
          return { accept: false, reason: "duplicate_short_window" };
        }
        if (
          deaths === 0 &&
          elapsed <= 60000 &&
          Math.abs(distM - (Number(lastSettled.distance_m) || 0)) <= 15 &&
          deaths === (Number(lastSettled.self_deaths) || 0)
        ) {
          return { accept: false, reason: "duplicate_near_identical" };
        }
      }
    }

    return { accept: true, reason: "ok" };
  }

  /**
   * Determine whether live telemetry still belongs to the same active match session
   * (e.g. brief 8111 flicker or camera switch when launching / losing a scout UAV),
   * vs a genuinely new match (map reload, map signature change, or >=8s standby in hangar).
   */
  function shouldContinueSameMatch(session, live, nowMs) {
    if (!session || !session.active) return false;
    const now = Number(nowMs) || Date.now();
    const standbyElapsed = session.standbySinceTs
      ? Math.max(0, now - session.standbySinceTs)
      : 0;
    if (standbyElapsed >= 8000) return false;

    const sigA = String(session.mapSignature || "");
    const sigB = String((live && live.map_signature) || "");
    if (sigA && sigB && sigA !== sigB) return false;

    const genA = session.mapGeneration;
    const genB = live ? live.map_generation : null;
    if (
      genA !== null &&
      genA !== undefined &&
      genB !== null &&
      genB !== undefined &&
      genA !== genB
    ) {
      return false;
    }

    const idA = String(session.mapId || "");
    const idB = String((live && live.matched_map_id) || "");
    if (idA && idB && idA !== idB) return false;

    return true;
  }

  /**
   * Compute a time-smoothed frontline curve anchored strictly ahead of the forward-most
   * ground allies along frontDir = normalize(enemyCenter - allyCenter), bowing inward
   * only in unheld corridors or danger-zone gaps.
   */
  function computeFrontline(objects, prevPoints, alpha, dangerZones, options) {
    const airMode = Boolean(options && options.airMode);
    const excludePlayer = Boolean(options && options.excludePlayer);
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
      const isAir = isAirUnit(o);
      const isAirSpawn = /fighter|bomber|assault|heli|airfield/.test(`${typeLow} ${iconLow}`);
      if (airMode) {
        if (o.role === "spawn_ally" || (o.role === "airfield" && !isHostileHex(o.color))) {
          if (isAirSpawn || o.role === "airfield") allySpawns.push(o);
        } else if (o.role === "spawn_enemy" || (o.role === "airfield" && isHostileHex(o.color))) {
          if (isAirSpawn || o.role === "airfield") enemySpawns.push(o);
        } else if (o.role === "capture_zone") {
          caps.push(o);
        } else if (o.role === "enemy") {
          if (isAir) enemies.push(o);
        } else if (o.role === "ally" || o.role === "player") {
          if (o.role === "ally" && !isAir) continue;
          allies.push({ x: o.x, y: o.y, w: 1.0 });
        }
        continue;
      }

      if (o.role === "spawn_ally") {
        if (!isAir && !isAirSpawn) allySpawns.push(o);
      } else if (o.role === "spawn_enemy") {
        if (!isAir && !isAirSpawn) enemySpawns.push(o);
      } else if (o.role === "capture_zone") {
        caps.push(o);
      } else if (o.role === "enemy") {
        if (!isAir) enemies.push(o);
      } else if (o.role === "ally" || o.role === "player") {
        if (isAir || isDroneVehicle("", o)) continue;
        if (o.role === "player" && excludePlayer) continue;
        let w = 1.0;
        if (o.ground_class === "spaa" || iconLow.includes("spaa")) w = 0.25;
        else if (o.ground_class === "heavy_tank" || o.ground_class === "medium_tank") w = 1.25;
        else if (o.role === "player") w = 1.0;
        allies.push({ x: o.x, y: o.y, w });
      }
    }

    if (allies.length === 0 && caps.length === 0) return null;

    // 1. Dynamic allyCenter & enemyCenter -> frontDir = normalize(enemyCenter - allyCenter)
    let allyCenter = null;
    if (allySpawns.length > 0) {
      allyCenter = {
        x: allySpawns.reduce((s, p) => s + p.x, 0) / allySpawns.length,
        y: allySpawns.reduce((s, p) => s + p.y, 0) / allySpawns.length,
      };
    } else if (allies.length > 0) {
      allyCenter = {
        x: allies.reduce((s, p) => s + p.x, 0) / allies.length,
        y: allies.reduce((s, p) => s + p.y, 0) / allies.length,
      };
    } else {
      allyCenter = { x: 0.5, y: 0.85 };
    }

    let enemyCenter = null;
    if (enemySpawns.length > 0) {
      enemyCenter = {
        x: enemySpawns.reduce((s, p) => s + p.x, 0) / enemySpawns.length,
        y: enemySpawns.reduce((s, p) => s + p.y, 0) / enemySpawns.length,
      };
    } else {
      const hostileCaps = caps.filter((c) => isHostileHex(c.color));
      const refCaps = hostileCaps.length > 0 ? hostileCaps : caps;
      if (refCaps.length > 0) {
        const cx = refCaps.reduce((s, c) => s + c.x, 0) / refCaps.length;
        const cy = refCaps.reduce((s, c) => s + c.y, 0) / refCaps.length;
        const dx = cx - allyCenter.x;
        const dy = cy - allyCenter.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.04) {
          enemyCenter = {
            x: clamp(allyCenter.x + dx * 1.5, 0.05, 0.95),
            y: clamp(allyCenter.y + dy * 1.5, 0.05, 0.95),
          };
        }
      }
      if (!enemyCenter && enemies.length > 0) {
        enemyCenter = {
          x: enemies.reduce((s, e) => s + e.x, 0) / enemies.length,
          y: enemies.reduce((s, e) => s + e.y, 0) / enemies.length,
        };
      }
      if (!enemyCenter) {
        enemyCenter = { x: 1 - allyCenter.x, y: 1 - allyCenter.y };
      }
    }

    const rawDx = enemyCenter.x - allyCenter.x;
    const rawDy = enemyCenter.y - allyCenter.y;
    const rawLen = Math.hypot(rawDx, rawDy);
    const axX = rawLen > 0.04 ? rawDx / rawLen : 0;
    const axY = rawLen > 0.04 ? rawDy / rawLen : -1;
    const latX = -axY;
    const latY = axX;
    const battleSpan = Math.max(0.14, rawLen);
    const centerX = (allyCenter.x + enemyCenter.x) / 2;
    const centerY = (allyCenter.y + enemyCenter.y) / 2;

    const toLocal = (px, py) => {
      const rx = px - centerX;
      const ry = py - centerY;
      return {
        lat: rx * latX + ry * latY,
        fwd: rx * axX + ry * axY,
      };
    };

    // Ground combat bounding box & dynamic lateral span
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
    const capLocals = caps.map((c) => ({
      ...toLocal(c.x, c.y),
      hostile: isHostileHex(c.color),
    }));
    const dzLocals = (airMode ? [] : Array.isArray(dangerZones) ? dangerZones : []).map((dz) => ({
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
    const minFwdBound = allyRearFwd + 0.05 * battleSpan;
    const maxFwdBound = Math.max(minFwdBound + 0.05, enemyRearFwd - 0.04 * battleSpan);

    // 2. Per-slice forward vanguard envelope (15 slices across [latMin, latMax])
    const slices = 15;
    const bandW = clamp((latMax - latMin) * 0.12, 0.024, 0.068);
    const maxAllyFwds = new Array(slices).fill(null);

    for (let i = 0; i < slices; i++) {
      const latTarget = latMin + ((latMax - latMin) * i) / (slices - 1);
      let bestFwd = -Infinity;
      for (const a of allyLocals) {
        if (Math.abs(a.lat - latTarget) <= bandW * 1.35 && a.fwd > bestFwd) {
          bestFwd = a.fwd;
        }
      }
      if (Number.isFinite(bestFwd)) {
        maxAllyFwds[i] = bestFwd;
      }
    }

    const supportedIndices = [];
    for (let i = 0; i < slices; i++) {
      if (maxAllyFwds[i] !== null) supportedIndices.push(i);
    }
    const supportedSorted = supportedIndices.map((i) => maxAllyFwds[i] + 0.025 * battleSpan).sort((a, b) => a - b);
    const medianFwd = supportedSorted.length > 0
      ? supportedSorted[Math.floor(supportedSorted.length / 2)]
      : 0;

    const baseFwds = new Array(slices);
    for (let i = 0; i < slices; i++) {
      const latTarget = latMin + ((latMax - latMin) * i) / (slices - 1);
      if (maxAllyFwds[i] !== null) {
        baseFwds[i] = maxAllyFwds[i] + 0.025 * battleSpan;
      } else {
        // Interpolate between nearest left and right supported slices, then pull inward toward allyCenter
        let leftIdx = -1;
        let rightIdx = -1;
        for (let k = i - 1; k >= 0; k--) {
          if (maxAllyFwds[k] !== null) { leftIdx = k; break; }
        }
        for (let k = i + 1; k < slices; k++) {
          if (maxAllyFwds[k] !== null) { rightIdx = k; break; }
        }
        let interpFwd = medianFwd;
        if (leftIdx >= 0 && rightIdx >= 0) {
          const t = (i - leftIdx) / (rightIdx - leftIdx);
          const lf = maxAllyFwds[leftIdx] + 0.025 * battleSpan;
          const rf = maxAllyFwds[rightIdx] + 0.025 * battleSpan;
          interpFwd = lf + (rf - lf) * t;
        } else if (leftIdx >= 0) {
          interpFwd = maxAllyFwds[leftIdx] + 0.025 * battleSpan;
        } else if (rightIdx >= 0) {
          interpFwd = maxAllyFwds[rightIdx] + 0.025 * battleSpan;
        }

        let fwd = interpFwd - 0.13 * battleSpan;
        for (const dz of dzLocals) {
          const dLat = Math.abs(latTarget - dz.lat);
          const spanR = Math.max(bandW * 1.4, dz.r * 1.2);
          if (dLat < spanR * 2.0) {
            const pressure = clamp(0.06 + dz.count * 0.015, 0.07, 0.15) * battleSpan;
            fwd -= Math.exp(-(dLat * dLat) / (2 * spanR * spanR)) * pressure;
          }
        }
        baseFwds[i] = fwd;
      }
    }

    // Light 3-point spatial smoothing, then hard re-enforce forward vanguard invariant
    const rawPts = [];
    for (let i = 0; i < slices; i++) {
      const latTarget = latMin + ((latMax - latMin) * i) / (slices - 1);
      const prevF = baseFwds[Math.max(0, i - 1)];
      const curF = baseFwds[i];
      const nextF = baseFwds[Math.min(slices - 1, i + 1)];
      let fwd = 0.2 * prevF + 0.6 * curF + 0.2 * nextF;

      if (maxAllyFwds[i] !== null) {
        fwd = Math.max(fwd, maxAllyFwds[i] + 0.018 * battleSpan);
      }

      const upperBound = maxAllyFwds[i] !== null
        ? Math.max(maxFwdBound, maxAllyFwds[i] + 0.018 * battleSpan)
        : maxFwdBound;
      fwd = clamp(fwd, minFwdBound, upperBound);

      const wx = clamp(centerX + latTarget * latX + fwd * axX, gMinX, gMaxX);
      const wy = clamp(centerY + latTarget * latY + fwd * axY, gMinY, gMaxY);
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
  function recommendRoutes(tier, vectorLayers, objects, dangerZones, playerMeta, mapInfo, activeSpawn, options) {
    if (!tier || tier === "off") {
      return { ids: new Set(), dynamicRoutes: [], bestId: "", tip: "" };
    }
    const airMode = Boolean(options && options.airMode);
    const activeDangerZones = airMode ? [] : (Array.isArray(dangerZones) ? dangerZones : []);

    const allies = [];
    const allySpawns = [];
    const enemySpawns = [];
    const caps = [];
    let player = null;

    for (const o of objects || []) {
      if (!o || typeof o.x !== "number" || typeof o.y !== "number") continue;
      const typeLow = String(o.type || "").toLowerCase();
      const iconLow = String(o.icon || "").toLowerCase();
      const isAir = isAirUnit(o);
      const isAirSpawn = /fighter|bomber|assault|heli|airfield/.test(`${typeLow} ${iconLow}`);
      if (o.role === "player") {
        player = o;
      } else if (airMode) {
        if (o.role === "spawn_ally" || (o.role === "airfield" && !isHostileHex(o.color))) {
          if (isAirSpawn || o.role === "airfield") allySpawns.push(o);
        } else if (o.role === "spawn_enemy" || (o.role === "airfield" && isHostileHex(o.color))) {
          if (isAirSpawn || o.role === "airfield") enemySpawns.push(o);
        } else if (o.role === "capture_zone") {
          caps.push(o);
        } else if (o.role === "ally" && isAir) {
          allies.push(o);
        }
      } else {
        if (o.role === "spawn_ally") { if (!isAir && !isAirSpawn) allySpawns.push(o); }
        else if (o.role === "spawn_enemy") { if (!isAir && !isAirSpawn) enemySpawns.push(o); }
        else if (o.role === "capture_zone") caps.push(o);
        else if (o.role === "ally" && !isAir) allies.push(o);
      }
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

    for (const dz of activeDangerZones) {
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
      for (const dz of activeDangerZones) {
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
      for (const dz of activeDangerZones) {
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
        for (const dz of activeDangerZones) {
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

    const vName = playerMeta && playerMeta.shortName ? playerMeta.shortName : (airMode ? "当前战机" : "当前载具");
    const unitNoun = airMode ? "机" : "人";
    const modePrefix = airMode ? "空域 " : "";
    const summary = `${modePrefix}左${laneStats.left.allyCount.toFixed(1)}/中${laneStats.center.allyCount.toFixed(1)}/右${laneStats.right.allyCount.toFixed(1)}${unitNoun}`;
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
    isDroneVehicle,
    isKinematicDroneFlight,
    classifyGroundStep,
    isAirUnit,
    detectAirBattle,
    classifyInitialSpawnMode,
    shouldRecordMatchSettlement,
    shouldContinueSameMatch,
    computeDangerFade,
    computeDangerZones,
    computeFrontline,
    recommendRoutes,
  };
})(window);
