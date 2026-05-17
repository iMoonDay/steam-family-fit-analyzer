"use strict";

globalThis.SFFA_CREATE_COMPARE_DIALOG = function createCompareDialog(dependencies) {
  const {
    COMPARE_PRICE_RANGES,
    COMPARE_QUALITY_LEVELS,
    applyVisibleCoverImages,
    closeMenu,
    escapeAttr,
    escapeHtml,
    formatMoney,
    formatOriginalPriceText,
    formatPercent,
    getElements,
    getGameDisplayName,
    getLastReport,
    getNumberLocale,
    getOriginalPriceSortValue,
    getState,
    getTargetProfileDisplayName,
    isMultiTargetReport,
    scheduleVisibleCoverLoads,
    setStatus,
    t
  } = dependencies;
  let comparePriceRangeByTarget = {};

  function isCompareDialogOpen() {
    return Boolean(getElements().root?.classList.contains("is-compare-open"));
  }

  function openCompareDialog() {
    const lastReport = getLastReport();
    if (!lastReport || !isMultiTargetReport(lastReport)) {
      setStatus(t("noSummary"), "warn");
      return;
    }

    closeMenu();
    comparePriceRangeByTarget = {};
    renderCompareDialog(lastReport);
    getElements().root.classList.add("is-compare-open");
    if (getElements().compareSummary) {
      getElements().compareSummary.scrollTop = 0;
    }
    applyVisibleCoverImages();
    scheduleVisibleCoverLoads();
  }

  function closeCompareDialog() {
    getElements().root.classList.remove("is-compare-open");
    comparePriceRangeByTarget = {};
  }

  function renderCompareDialogIfOpen() {
    const lastReport = getLastReport();
    if (!isCompareDialogOpen() || !lastReport) {
      return;
    }
    if (lastReport.filtering?.running) {
      return;
    }

    const scrollTop = getElements().compareSummary?.scrollTop || 0;
    renderCompareDialog(lastReport);
    if (getElements().compareSummary) {
      getElements().compareSummary.scrollTop = scrollTop;
    }
    applyVisibleCoverImages();
    scheduleVisibleCoverLoads();
  }

  function renderCompareDialog(report) {
    const elements = getElements();
    if (!elements.compareSummary || !elements.compareBody || !elements.compareHint || !elements.compareTitle) {
      return;
    }

    if (!report || !isMultiTargetReport(report)) {
      elements.compareTitle.textContent = t("compareTitle");
      elements.compareHint.textContent = t("compareHint", { count: Array.isArray(report?.target?.targets) ? report.target.targets.length : 0 });
      elements.compareSummary.innerHTML = "";
      elements.compareBody.innerHTML = `<div class="sffa-compare-empty">${escapeHtml(t("compareNoData"))}</div>`;
      return;
    }

    elements.compareTitle.textContent = t("compareTitle");
    if (report?.filtering?.running) {
      elements.compareHint.textContent = t("compareLoadingHint");
      elements.compareSummary.innerHTML = renderCompareLoadingHtml(report);
      elements.compareBody.innerHTML = "";
      return;
    }

    const compare = buildCompareView(report);
    elements.compareHint.textContent = t("compareHint", { count: compare.targets.length });
    elements.compareSummary.innerHTML = compare.targets.map(target => renderCompareCardHtml(target, compare)).join("");
    elements.compareBody.innerHTML = "";
  }

  function renderCompareLoadingHtml(report) {
    const targets = Array.isArray(report?.target?.targets) ? report.target.targets : [];
    const percent = report?.filtering?.total
      ? formatPercent((report.filtering.processed || 0) / report.filtering.total)
      : formatPercent(0);
    const cards = targets.map(target => {
      const name = getTargetProfileDisplayName(target);
      const steamid64 = String(target?.steamid64 || "");
      const totalCount = Array.isArray(target?.gameAppids) ? target.gameAppids.length : 0;
      const statusText = target.selected === false ? t("compareExcluded") : "";
      return `
        <section class="sffa-compare-card">
          <div class="sffa-compare-card-head${statusText ? " has-status" : ""}">
            ${renderAvatarHtml(target?.avatar || "", name)}
            <div class="sffa-compare-card-title">
              <strong>${escapeHtml(name)}</strong>
              <span>${escapeHtml(steamid64 || "-")}</span>
              <span class="sffa-compare-card-summary">${escapeHtml(t("compareLoadingHint"))}</span>
            </div>
            ${statusText ? `<span class="sffa-compare-card-status">${escapeHtml(statusText)}</span>` : ""}
          </div>
          <div class="sffa-compare-card-stats">
            ${metricCardHtml(t("compareTotal"), totalCount, false)}
            ${metricCardHtml(t("progress"), percent, false, true)}
          </div>
          <div class="sffa-compare-card-empty">${escapeHtml(t("compareLoadingHint"))}</div>
        </section>
      `;
    }).join("");

    if (!cards) {
      return `<div class="sffa-compare-empty">${escapeHtml(t("compareLoadingHint"))}</div>`;
    }

    return cards;
  }

  function buildCompareView(report) {
    const targets = Array.isArray(report?.target?.targets) ? report.target.targets : [];
    const activeTargets = targets.length ? targets : [report?.target].filter(Boolean);
    const activeIdSet = new Set(activeTargets.map(target => String(target?.steamid64 || "")).filter(Boolean));
    const allGames = Array.isArray(report?.games?.all) ? report.games.all : [];
    const familySet = new Set(getState().familyLibrary.appidSet.map(String));
    const newIdSet = new Set((report?.games?.new || []).map(game => String(game.appid)));
    const overlapIdSet = new Set((report?.games?.overlap || []).map(game => String(game.appid)));
    const gameById = new Map();

    allGames.forEach(game => {
      const appid = String(game?.appid || "");
      if (!appid) {
        return;
      }
      const owners = Array.from(new Set((game.targetOwners || []).map(String).filter(steamid => activeIdSet.has(steamid))));
      if (!owners.length) {
        return;
      }
      gameById.set(appid, {
        ...game,
        appid,
        owners,
        ownerCount: owners.length
      });
    });

    const games = Array.from(gameById.values()).map(game => {
      const status = getCompareGameStatus(report, game.appid, familySet, newIdSet, overlapIdSet);
      const price = resolveCompareGamePrice(game);
      const groupKey = game.ownerCount === 1
        ? "exclusive"
        : game.ownerCount === activeTargets.length
          ? "all"
          : "partial";
      return {
        ...game,
        price,
        status,
        groupKey,
        statusLabel: getCompareStatusLabel(status),
        priceText: getCompareGamePriceText(price, status),
        statusClass: getCompareStatusClass(status)
      };
    }).sort(compareGameRows);

    const targetStats = activeTargets.map(target => buildCompareTargetStats(target, games, activeTargets.length));
    const statMax = {
      unique: Math.max(...targetStats.map(item => item.uniqueCount), 0),
      added: Math.max(...targetStats.map(item => item.uniqueAddedCount), 0),
      addedValue: Math.max(...targetStats.map(item => item.addedValue), 0),
      averageValue: Math.max(...targetStats.map(item => item.qualityValue), 0)
    };

    return {
      targets: activeTargets,
      targetStats,
      statMax
    };
  }

  function buildCompareTargetStats(target, games, targetTotal) {
    const steamid64 = String(target?.steamid64 || "");
    const ownedGames = games.filter(game => game.owners.includes(steamid64));
    const uniqueGames = ownedGames.filter(game => game.ownerCount === 1);
    const sharedGames = ownedGames.filter(game => game.ownerCount > 1);
    const newGames = ownedGames.filter(game => game.status === "new");
    const uniqueNewGames = newGames.filter(game => game.ownerCount === 1).sort(compareUniqueNewGames);
    const addedValue = newGames
      .map(game => resolveCompareGamePrice(game))
      .filter(price => price && !price.pending && !price.unavailable)
      .reduce((sum, price) => sum + Number(price?.initial || 0), 0);
    const qualityValue = newGames.length ? addedValue / newGames.length : 0;

    return {
      steamid64,
      displayName: getTargetProfileDisplayName(target),
      profileUrl: target?.profileUrl || "",
      avatar: target?.avatar || "",
      selected: target?.selected !== false,
      totalCount: Array.isArray(target?.gameAppids) ? target.gameAppids.length : ownedGames.length,
      uniqueCount: uniqueGames.length,
      sharedCount: sharedGames.length,
      addedCount: newGames.length,
      uniqueAddedCount: uniqueNewGames.length,
      addedValue,
      qualityValue,
      newGames,
      uniqueNewGames,
      ownedGames,
      targetTotal
    };
  }

  function renderCompareCardHtml(target, compare) {
    const stats = compare.targetStats.find(item => item.steamid64 === target.steamid64) || buildCompareTargetStats(target, [], compare.targets.length);
    const uniqueBest = compare.statMax.unique > 0;
    const addedBest = compare.statMax.added > 0;
    const addedValueBest = compare.statMax.addedValue > 0;
    const averageValueBest = compare.statMax.averageValue > 0;
    const selectedRange = getCompareSelectedPriceRange(stats.steamid64);
    const uniqueGames = Array.isArray(stats.uniqueNewGames) ? stats.uniqueNewGames : [];
    const filteredUniqueGames = selectedRange
      ? uniqueGames.filter(game => isCompareGameInPriceRange(game, selectedRange))
      : uniqueGames;
    const summaryText = getCompareTargetSummaryText(stats);
    const html = [
      metricCardHtml(`${t("compareUnique")}/${t("compareTotal")}`, `${stats.uniqueCount}/${stats.totalCount}`, uniqueBest && stats.uniqueCount === compare.statMax.unique, false, t("compareUniqueTip")),
      metricCardHtml(`${t("compareUniqueAdded")}/${t("compareAdded")}`, `${stats.uniqueAddedCount}/${stats.addedCount}`, addedBest && stats.uniqueAddedCount === compare.statMax.added, false, t("compareUniqueAddedTip")),
      metricCardHtml(t("addedValue"), formatMoney(Number(stats.addedValue || 0)), addedValueBest && stats.addedValue === compare.statMax.addedValue),
      metricCardHtml(t("compareAverageValue"), formatMoney(Number(stats.qualityValue || 0)), averageValueBest && stats.qualityValue === compare.statMax.averageValue),
      renderComparePriceRangeCards(stats, selectedRange)
    ].join("");

    const statusHtml = stats.selected ? "" : `<span class="sffa-compare-card-status">${escapeHtml(t("compareExcluded"))}</span>`;
    const emptyText = selectedRange ? t("compareNoRangeGames") : t("compareNoUniqueAdded");
    const uniqueGamesHtml = filteredUniqueGames.length
      ? filteredUniqueGames.map(game => renderCompareUniqueGameHtml(game)).join("")
      : `<div class="sffa-compare-card-empty">${escapeHtml(emptyText)}</div>`;
    const gamesCountText = selectedRange
      ? `${filteredUniqueGames.length}/${uniqueGames.length}`
      : String(uniqueGames.length);
    return `
      <section class="sffa-compare-card${stats.selected ? "" : " is-muted"}">
        <div class="sffa-compare-card-head${statusHtml ? " has-status" : ""}">
          ${renderAvatarHtml(stats.avatar, stats.displayName)}
          <div class="sffa-compare-card-title">
            <strong>${escapeHtml(stats.displayName)}</strong>
            <span>${escapeHtml(stats.steamid64 || "-")}</span>
            <span class="sffa-compare-card-summary">${escapeHtml(summaryText)}</span>
          </div>
          ${statusHtml}
        </div>
        <div class="sffa-compare-card-stats">
          ${html}
        </div>
        <div class="sffa-compare-card-games">
          <div class="sffa-compare-card-games-head">
            <strong>${escapeHtml(t("compareUniqueAdded"))}</strong>
            <span>${escapeHtml(gamesCountText)}</span>
          </div>
          <div class="sffa-compare-card-games-list">
            ${uniqueGamesHtml}
          </div>
        </div>
      </section>
    `;
  }

  function renderComparePriceRangeCards(stats, selectedRange) {
    const counts = getComparePriceRangeCounts(stats.uniqueNewGames || []);
    return `
      <div class="sffa-compare-price-ranges">
        ${COMPARE_PRICE_RANGES.map(range => {
      const active = selectedRange === range.key;
      return `
            <button class="sffa-compare-price-range${active ? " is-active" : ""}" type="button" data-sffa-compare-range="${escapeAttr(range.key)}" data-sffa-compare-target="${escapeAttr(stats.steamid64)}" aria-pressed="${active ? "true" : "false"}">
              <span>${escapeHtml(range.label)}</span>
              <strong>${escapeHtml(String(counts[range.key] || 0))}</strong>
            </button>
          `;
    }).join("")}
      </div>
    `;
  }

  function getComparePriceRangeCounts(games) {
    const counts = {};
    COMPARE_PRICE_RANGES.forEach(range => {
      counts[range.key] = 0;
    });
    (games || []).forEach(game => {
      const key = getCompareGamePriceRangeKey(game);
      if (key && Object.prototype.hasOwnProperty.call(counts, key)) {
        counts[key] += 1;
      }
    });
    return counts;
  }

  function getCompareGamePriceRangeKey(game) {
    const price = resolveCompareGamePrice(game);
    if (!price || price.pending || price.unavailable || price.initial == null) {
      return "";
    }
    const cents = Number(price.initial || 0);
    const range = COMPARE_PRICE_RANGES.find(item => cents >= item.min && cents < item.max);
    return range?.key || "";
  }

  function isCompareGameInPriceRange(game, rangeKey) {
    return getCompareGamePriceRangeKey(game) === rangeKey;
  }

  function getCompareSelectedPriceRange(steamid64) {
    return String(comparePriceRangeByTarget[String(steamid64 || "")] || "");
  }

  function handleCompareSummaryClick(event) {
    const button = event.target.closest("[data-sffa-compare-range]");
    const lastReport = getLastReport();
    if (!button || !lastReport) {
      return;
    }

    const steamid64 = String(button.dataset.sffaCompareTarget || "");
    const range = String(button.dataset.sffaCompareRange || "");
    if (!steamid64 || !range) {
      return;
    }

    if (comparePriceRangeByTarget[steamid64] === range) {
      delete comparePriceRangeByTarget[steamid64];
    } else {
      comparePriceRangeByTarget[steamid64] = range;
    }
    renderCompareDialog(lastReport);
  }

  function getCompareTargetSummaryText(stats) {
    const qualitySummary = getCompareTargetQualitySummaryText(stats);
    return qualitySummary;
  }

  function getCompareTargetQualitySummaryText(stats) {
    const count = Number(stats?.addedCount || 0);
    if (!count) {
      return t("compareQualityNone");
    }
    const qualityScore = getCompareTargetQualityScore(stats);
    const quality = getCompareTargetQualityLabel(qualityScore);
    return t("compareQualitySummary", { quality });
  }

  function getCompareTargetQualityScore(stats) {
    const count = Number(stats?.addedCount || 0);
    if (!count) {
      return 0;
    }
    const average = Number(stats?.addedValue || 0) / count;
    const multiplier = 1 + Math.log2(count + 1) * 0.2;
    return average * multiplier;
  }

  function getCompareTargetQualityLabel(scoreCents) {
    const value = Number(scoreCents || 0);
    const level = COMPARE_QUALITY_LEVELS.find(item => value < item.max) || COMPARE_QUALITY_LEVELS[COMPARE_QUALITY_LEVELS.length - 1];
    return {
      veryLow: t("compareQualityVeryLow"),
      low: t("compareQualityLow"),
      medium: t("compareQualityMedium"),
      high: t("compareQualityHigh"),
      veryHigh: t("compareQualityVeryHigh")
    }[level.key] || "-";
  }

  function metricCardHtml(label, value, highlight = false, wide = false, title = "") {
    const classes = ["sffa-compare-stat"];
    if (highlight) {
      classes.push("is-highlight");
    }
    if (wide) {
      classes.push("is-wide");
    }
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
    return `
      <div class="${classes.join(" ")}"${titleAttr}>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `;
  }

  function renderCompareUniqueGameHtml(game) {
    const priceClass = getComparePriceChipClass(game);
    const gameName = getGameDisplayName(game);
    return `
      <div class="sffa-compare-card-game" data-sffa-cover-appid="${escapeAttr(game.appid)}">
        <a class="sffa-compare-card-game-link" href="https://store.steampowered.com/app/${escapeAttr(game.appid)}/" target="_blank" rel="noopener" aria-label="${escapeAttr(gameName)}" title="${escapeAttr(gameName)}">
          <span class="sffa-compare-card-game-title">${escapeHtml(gameName)}</span>
          <span class="sffa-compare-card-game-price ${escapeAttr(priceClass)}">${escapeHtml(game.priceText)}</span>
        </a>
      </div>
    `;
  }

  function resolveCompareGamePrice(game) {
    if (game?.price && (typeof game.price.initial === "number" || game.price.pending || game.price.unavailable)) {
      return game.price;
    }
    return getState().storeCache?.[String(game?.appid || "")]?.price || null;
  }

  function getComparePriceChipClass(game) {
    if (game?.price?.pending) {
      return "is-pending";
    }
    if (game?.price?.unavailable) {
      return game?.status === "unsupported" ? "is-unsupported" : "is-no-value";
    }
    if (typeof game?.price?.initial === "number") {
      return game?.status === "new" ? "is-new" : "is-overlap";
    }
    return "is-no-value";
  }

  function renderAvatarHtml(avatarUrl, label) {
    if (avatarUrl) {
      return `<img class="sffa-avatar" src="${escapeAttr(avatarUrl)}" alt="">`;
    }
    return `<div class="sffa-avatar">${escapeHtml(getAvatarFallbackText(label))}</div>`;
  }

  function getAvatarFallbackText(label) {
    const text = String(label || "").trim();
    if (!text) {
      return "?";
    }
    return text.slice(0, 1).toUpperCase();
  }

  function getCompareGameStatus(report, appid, familySet, newIdSet, overlapIdSet) {
    const status = report?.classificationById?.[String(appid)]?.status;
    if (status) {
      return status;
    }
    if (newIdSet.has(String(appid))) {
      return "new";
    }
    if (overlapIdSet.has(String(appid)) || familySet.has(String(appid))) {
      return "overlap";
    }
    return "pending";
  }

  function getCompareStatusLabel(status) {
    return {
      new: t("compareAdded"),
      overlap: t("duplicatedGames"),
      noValue: t("noAddedValue"),
      unsupported: t("unsupported"),
      pending: t("pending")
    }[status] || t("compareStatus");
  }

  function getCompareStatusClass(status) {
    return {
      new: "new",
      overlap: "overlap",
      noValue: "no-value",
      unsupported: "unsupported",
      pending: "pending"
    }[status] || "pending";
  }

  function getCompareGamePriceText(price, status) {
    if (price?.pending || status === "pending") {
      return t("pending");
    }
    if (price?.unavailable || status === "unsupported") {
      return "N/A";
    }
    if (price && (typeof price.initial === "number" || price.isFree === true)) {
      return formatOriginalPriceText(price);
    }
    return t("loading");
  }

  function compareUniqueNewGames(left, right) {
    const leftPrice = getOriginalPriceSortValue(resolveCompareGamePrice(left));
    const rightPrice = getOriginalPriceSortValue(resolveCompareGamePrice(right));
    if (leftPrice !== rightPrice) {
      return rightPrice - leftPrice;
    }
    return String(getGameDisplayName(left) || "").localeCompare(String(getGameDisplayName(right) || ""), getNumberLocale(), { numeric: true, sensitivity: "base" });
  }

  function compareGameRows(left, right) {
    const groupOrder = {
      exclusive: 0,
      partial: 1,
      all: 2
    };
    const statusOrder = {
      new: 0,
      pending: 1,
      unsupported: 2,
      noValue: 3,
      overlap: 4
    };
    const leftGroup = groupOrder[left.groupKey] ?? 9;
    const rightGroup = groupOrder[right.groupKey] ?? 9;
    if (leftGroup !== rightGroup) {
      return leftGroup - rightGroup;
    }
    const leftStatus = statusOrder[left.status] ?? 9;
    const rightStatus = statusOrder[right.status] ?? 9;
    if (leftStatus !== rightStatus) {
      return leftStatus - rightStatus;
    }
    const leftPrice = Number(left.price?.initial || 0);
    const rightPrice = Number(right.price?.initial || 0);
    if (leftPrice !== rightPrice) {
      return rightPrice - leftPrice;
    }
    return String(getGameDisplayName(left) || "").localeCompare(String(getGameDisplayName(right) || ""), getNumberLocale(), { numeric: true, sensitivity: "base" });
  }

  return {
    closeCompareDialog,
    getComparePriceChipClass,
    getCompareStatusClass,
    handleCompareSummaryClick,
    isCompareDialogOpen,
    openCompareDialog,
    renderCompareDialogIfOpen
  };
};
