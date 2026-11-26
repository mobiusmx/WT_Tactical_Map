/* Ground vehicle metadata & BWiki SVG icon mapping (local embedded assets, zero external requests) */

(function (global) {
  "use strict";

  const CLASS_ICONS = {
    light_tank: "/icons/WT_type_ground_light_tank.svg",
    medium_tank: "/icons/WT_type_ground_medium_tank.svg",
    heavy_tank: "/icons/WT_type_ground_heavy_tank.svg",
    tank_destroyer: "/icons/WT_type_ground_tank_destroyer.svg",
    spaa: "/icons/WT_type_ground_spaa.svg",
  };

  const CLASS_LABELS = {
    light_tank: "轻坦",
    medium_tank: "中坦",
    heavy_tank: "重坦",
    tank_destroyer: "坦歼",
    spaa: "防空",
  };

  const EXACT_VEHICLES = {
    us_m18_hellcat: { shortName: "M18", groundClass: "light_tank", mobility: "fast" },
    us_m18_hellcat_black_cat: { shortName: "M18", groundClass: "light_tank", mobility: "fast" },
    us_m41_walker_bulldog: { shortName: "M41A1", groundClass: "light_tank", mobility: "fast" },
    us_m24_chaffee: { shortName: "M24", groundClass: "light_tank", mobility: "fast" },
    us_m56_scorpion: { shortName: "M56", groundClass: "tank_destroyer", mobility: "fast" },
    us_t92: { shortName: "T92", groundClass: "light_tank", mobility: "fast" },
    us_m50_ontos: { shortName: "M50", groundClass: "tank_destroyer", mobility: "fast" },
    us_t34: { shortName: "T34", groundClass: "heavy_tank", mobility: "heavy" },
    us_t29: { shortName: "T29", groundClass: "heavy_tank", mobility: "heavy" },
    us_t26e5: { shortName: "T26E5", groundClass: "heavy_tank", mobility: "heavy" },
    us_m26_pershing: { shortName: "M26", groundClass: "medium_tank", mobility: "medium" },
    us_m4a3e8_76w_sherman: { shortName: "M4A3", groundClass: "medium_tank", mobility: "medium" },
    ussr_t_34_85_zis_53: { shortName: "T34", groundClass: "medium_tank", mobility: "medium" },
    ussr_t_34_1942: { shortName: "T34", groundClass: "medium_tank", mobility: "medium" },
    ussr_t_44: { shortName: "T44", groundClass: "medium_tank", mobility: "fast" },
    ussr_is_2_1944: { shortName: "IS-2", groundClass: "heavy_tank", mobility: "heavy" },
    ussr_bmp_1: { shortName: "BMP-1", groundClass: "light_tank", mobility: "fast" },
    ussr_bmp_2: { shortName: "BMP-2", groundClass: "light_tank", mobility: "fast" },
    ussr_pt_76b: { shortName: "PT-76", groundClass: "light_tank", mobility: "medium" },
    germ_pzkpfw_vi_ausf_h1_tiger: { shortName: "Tiger", groundClass: "heavy_tank", mobility: "heavy" },
    germ_pzkpfw_vi_ausf_b_tiger_iip: { shortName: "Tiger II", groundClass: "heavy_tank", mobility: "heavy" },
    germ_pzkpfw_v_ausf_a_panther: { shortName: "Panther", groundClass: "medium_tank", mobility: "medium" },
    germ_lekpz_m41: { shortName: "M41", groundClass: "light_tank", mobility: "fast" },
    germ_ru_251: { shortName: "Ru 251", groundClass: "light_tank", mobility: "fast" },
    germ_puma_sdkfz_234_2: { shortName: "Puma", groundClass: "light_tank", mobility: "fast" },
    uk_fv4202: { shortName: "FV4202", groundClass: "medium_tank", mobility: "medium" },
    cn_type_62: { shortName: "62式", groundClass: "light_tank", mobility: "fast" },
    cn_ztz_59a: { shortName: "59式", groundClass: "medium_tank", mobility: "medium" },
  };

  function inferClassFromIcon(icon, fallback) {
    const low = String(icon || "").toLowerCase();
    if (low.includes("spaa") || low.includes("aaa")) return "spaa";
    if (low.includes("heavy")) return "heavy_tank";
    if (low.includes("medium")) return "medium_tank";
    if (low.includes("light") || low.includes("wheeled") || low.includes("recon")) return "light_tank";
    if (low.includes("destroyer") || low.includes("spg") || low.includes("atgm")) return "tank_destroyer";
    return fallback || "medium_tank";
  }

  function resolvePlayerVehicle(rawType, fallbackIcon) {
    const raw = String(rawType || "").trim();
    const low = raw.toLowerCase();
    if (!low) {
      const gc = inferClassFromIcon(fallbackIcon, "medium_tank");
      return { shortName: "", groundClass: gc, mobility: gc === "light_tank" ? "fast" : "medium" };
    }

    if (EXACT_VEHICLES[low]) {
      return EXACT_VEHICLES[low];
    }
    for (const [k, v] of Object.entries(EXACT_VEHICLES)) {
      if (low.includes(k) || k.includes(low)) {
        return v;
      }
    }

    // Heuristic rules for unseen War Thunder internal vehicle names
    let groundClass = inferClassFromIcon(fallbackIcon, "");
    let mobility = "medium";

    if (/m18|m41|m24|m3_stuart|m22|t92|hstv|hstvl|rdf|xm8|bmp|bmd|pt_76|2s25|sprut|ru_251|radkampfwagen|puma|sdkfz_234|luchs|begleit|tam|amx_13|ebr|aml|elc|type_16|ztq|vbc|centauro|dardo|cv90|strf|vickers|warrior|rooikat|fox|scimitar/.test(low)) {
      groundClass = groundClass || "light_tank";
      mobility = "fast";
    } else if (/spaa|wirbel|ostwind|kugel|gepard|flak|zsu|shilka|tunguska|pantsir|m16|m19|m42|m163|m247|adats|york|marksman|falcon|veak|lvkv|pgz|sidam|otomatic|amx_13_dca|roland|strela|osa/.test(low)) {
      groundClass = groundClass || "spaa";
      mobility = "medium";
    } else if (/tiger|konigstiger|maus|is_1|is_2|is_3|is_4|is_6|is_7|kv_1|kv_2|kv_85|t_10|t29|t30|t32|t34|t26e|m6a1|m103|churchill|conqueror|caernarvon|black_prince|somua|lorraine_40|char_25|arl_44|b1_bis/.test(low)) {
      groundClass = groundClass || "heavy_tank";
      mobility = "heavy";
    } else if (/m56|m50|m10|m36|t28|t95|hellcat|wolverine|jackson|su_85|su_100|su_122|su_152|isu_|asu_|obj_268|jagd|stug|stuh|hetzer|nashorn|dicker|emil|ferdinand|elefant|waffentrager|kanonenjagd|raketen|achilles|archer|tortoise|fv4005|charioteer|ho_ri|iko|ikv|udes|pvkv|bandkanon|bkan/.test(low)) {
      groundClass = groundClass || "tank_destroyer";
      mobility = /m56|m50|asu_|waffentrager|ikv|udes/.test(low) ? "fast" : "medium";
    } else {
      groundClass = groundClass || "medium_tank";
    }

    // Build clean short display name (e.g. us_m41a1_walker -> M41A1, ussr_t_34_85 -> T-34-85)
    const stripped = low.replace(/^(us|ussr|germ|uk|jp|cn|it|fr|sw|il)_/, "");
    const parts = stripped.split("_").filter(Boolean);
    let shortName = "";
    if (parts.length >= 2 && /^(t|is|kv|su|isu|asu|bt|pt|zsu|bmp|bmd|m|pzkpfw|sdkfz|strv|ikv|cv|ztz|ptz|pgz|type|amx|arl|b1|centauro)$/.test(parts[0])) {
      shortName = (parts[0] + (parts[1].length <= 4 ? "-" + parts[1] : "")).toUpperCase();
    } else if (parts.length >= 1) {
      shortName = parts[0].toUpperCase();
    }
    if (shortName.length > 9) {
      shortName = shortName.slice(0, 9);
    }

    return { shortName, groundClass, mobility };
  }

  function getIconUrl(groundClass) {
    return CLASS_ICONS[groundClass] || CLASS_ICONS.medium_tank;
  }

  global.WTVehicleMeta = {
    CLASS_ICONS,
    CLASS_LABELS,
    inferClassFromIcon,
    resolvePlayerVehicle,
    getIconUrl,
  };
})(window);
