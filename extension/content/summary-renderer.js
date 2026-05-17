"use strict";

globalThis.SFFA_CREATE_SUMMARY_RENDERER = function createSummaryRenderer(dependencies) {
  const {
    escapeAttr,
    escapeHtml,
    formatDateTime,
    formatMoney,
    formatPercent,
    getElements,
    getState,
    getTargetProfileDisplayName,
    t
  } = dependencies;

  function renderAutoFamilyRefreshButton() {
    const elements = getElements();
    if (!elements.autoFamilyRefreshBtn) {
      return;
    }
    const state = getState();
    const enabled = Boolean(state.autoFamilyRefreshEnabled);
    const lastTime = state.familyLibrary?.updatedAt ? formatDateTime(state.familyLibrary.updatedAt) : t("noCache");
    elements.autoFamilyRefreshBtn.textContent = enabled ? t("autoRefreshClose") : t("autoRefreshOpen");
    elements.autoFamilyRefreshBtn.title = t("autoRefreshTitle", { time: lastTime });
  }

  function renderFamilyMeta() {
    const state = getState();
    const count = state.familyLibrary.appidSet.length;
    const name = state.familyInfo?.family_name || t("notRefreshed");
    const time = state.familyLibrary.updatedAt ? formatDateTime(state.familyLibrary.updatedAt) : t("noCache");
    getElements().familyMeta.textContent = `${name} · ${count} · ${time}`;
  }

  function renderSummary(report) {
    const state = getState();
    const metrics = report?.metrics || {
      targetCount: 0,
      rawTargetCount: 0,
      filteredUnsupportedCount: 0,
      familyCount: state.familyLibrary.appidSet.length,
      newCount: 0,
      overlapCount: 0,
      overlapRate: 0,
      initialValue: 0,
      unpricedCount: 0,
      filteringProcessed: 0,
      filteringTotal: 0
    };

    const targetLabel = report?.target?.displayName || t("noSummary");
    const breakdown = report?.targetBreakdown || null;
    const filterValue = metrics.filteringTotal
      ? `${metrics.filteringProcessed || 0}/${metrics.filteringTotal}`
      : "0/0";
    getElements().summary.innerHTML = [
      metricHtml(t("targetAccount"), escapeHtml(targetLabel)),
      metricHtml(t("progress"), filterValue),
      metricHtml(t("tabs.family"), `${metrics.familyCount}`),
      metricHtml(t("totalGames"), formatSummaryMetric(breakdown?.targetCount, value => `${value}`, metrics.targetCount)),
      metricHtml(t("addedGames"), formatSummaryMetric(breakdown?.newCount, value => `${value}`, metrics.newCount)),
      metricHtml(t("addedValue"), formatSummaryMetric(breakdown?.initialValue, value => formatMoney(value), metrics.initialValue)),
      metricHtml(t("duplicatedGames"), formatSummaryMetric(breakdown?.overlapCount, value => `${value}`, metrics.overlapCount)),
      metricHtml(t("overlapRate"), formatSummaryMetric(breakdown?.overlapRate, value => formatPercent(value), metrics.overlapRate))
    ].join("");
  }

  function formatSummaryMetric(splitMetric, formatter, fallbackValue) {
    if (!splitMetric || !Array.isArray(splitMetric.parts) || splitMetric.parts.length <= 1) {
      return formatter(fallbackValue);
    }

    const parts = splitMetric.parts.map(value => formatter(value));
    const suffix = splitMetric.deduped ? ` (${escapeHtml(t("deduped"))})` : "";
    return `${parts.join(" + ")} = ${formatter(splitMetric.total)}${suffix}`;
  }

  function renderTargetProfile(report) {
    const elements = getElements();
    if (!report) {
      elements.profile.innerHTML = `<div class="sffa-empty">${escapeHtml(t("noSummary"))}</div>`;
      return;
    }

    const target = report.target || {};
    const targets = Array.isArray(target.targets) ? target.targets : [];
    if (targets.length > 1) {
      const rows = targets.map(profile => {
        const name = getTargetProfileDisplayName(profile);
        const checked = profile.selected === false ? "" : " checked";
        const nameHtml = profile.profileUrl
          ? `<a class="sffa-profile-link" href="${escapeAttr(profile.profileUrl)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`
          : escapeHtml(name);
        return `
          <div class="sffa-target-row">
            <input type="checkbox" data-sffa-target-toggle value="${escapeAttr(profile.steamid64 || "")}"${checked}>
            <span>${nameHtml} · ${escapeHtml(profile.steamid64 || "-")}</span>
          </div>
        `;
      }).join("");
      elements.profile.innerHTML = `
        <div class="sffa-profile-head">
          <button class="sffa-compare-btn" type="button" data-sffa-open-compare title="${escapeAttr(t("compare"))}" aria-label="${escapeAttr(t("compare"))}">${escapeHtml(t("compare"))}</button>
          <div>
            <div class="sffa-profile-name">${escapeHtml(target.displayName || t("targetAccountCount", { count: targets.length }))}</div>
          </div>
        </div>
        <div class="sffa-profile-row"><span>${escapeHtml(t("targetAccount"))}</span><span>${escapeHtml(t("targetAccountCount", { count: targets.length }))}</span></div>
        ${rows}
        <div class="sffa-profile-row"><span>${escapeHtml(t("time"))}</span><span>${formatDateTime(report.generatedAt)}</span></div>
      `;
      return;
    }

    const avatar = target.avatar
      ? `<img class="sffa-avatar" src="${escapeAttr(target.avatar)}" alt="">`
      : `<div class="sffa-avatar"></div>`;
    elements.profile.innerHTML = `
      <div class="sffa-profile-head">
        ${avatar}
        <div>
          <div class="sffa-profile-name">${escapeHtml(target.displayName || target.steamid64 || t("unknownAccount"))}</div>
          <a class="sffa-profile-link" href="${escapeAttr(target.profileUrl || "#")}" target="_blank" rel="noopener">${escapeHtml(t("openProfile"))}</a>
        </div>
      </div>
      <div class="sffa-profile-row"><span>SteamID</span><span>${escapeHtml(target.steamid64 || "-")}</span></div>
      <div class="sffa-profile-row"><span>${escapeHtml(t("time"))}</span><span>${formatDateTime(report.generatedAt)}</span></div>
      <div class="sffa-profile-row"><span>${escapeHtml(t("link"))}</span><span>${escapeHtml(target.profileUrl || "-")}</span></div>
    `;
  }

  function metricHtml(label, value) {
    return `<div class="sffa-metric"><span>${label}</span><strong>${value}</strong></div>`;
  }

  return {
    renderAutoFamilyRefreshButton,
    renderFamilyMeta,
    renderSummary,
    renderTargetProfile
  };
};
