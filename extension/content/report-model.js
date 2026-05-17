"use strict";

globalThis.SFFA_CREATE_REPORT_MODEL = function createReportModel(dependencies) {
  const {
    getState,
    sortByName
  } = dependencies;

function buildReport(targetProfile, comparison) {
  const newGames = comparison.newGames;
  const allGames = (comparison.allGames || targetProfile.games || []).slice().sort(sortByName);
  const pendingNewGames = comparison.pendingNewGames || [];
  const unpricedGames = newGames.filter(game => game.price?.unavailable);
  const pricedGames = newGames.filter(game => game.price && !game.price.pending && !game.price.unavailable);
  const initialValue = pricedGames.reduce((sum, game) => sum + Number(game.price?.initial || 0), 0);
  const targetCount = allGames.length;
  const rawTargetCount = targetProfile.rawGameCount || targetCount;
  const familyCount = getState().familyLibrary.appidSet.length;
  const overlapCount = comparison.overlapGames.length;
  const classificationById = {};

  pendingNewGames.forEach(game => {
    classificationById[String(game.appid)] = { status: "pending" };
  });
  comparison.overlapGames.forEach(game => {
    classificationById[String(game.appid)] = { status: "overlap" };
  });
  (comparison.alreadyOwnedGames || []).forEach(game => {
    classificationById[String(game.appid)] = { status: "noValue" };
  });
  newGames.forEach(game => {
    classificationById[String(game.appid)] = { status: "new" };
  });

  return {
    target: {
      steamid64: targetProfile.steamid64,
      displayName: targetProfile.displayName,
      profileUrl: targetProfile.profileUrl,
      avatar: targetProfile.avatar || "",
      targets: targetProfile.targets || []
    },
    metrics: {
      targetCount,
      rawTargetCount,
      filteredUnsupportedCount: targetProfile.filteredUnsupportedCount || 0,
      familyCount,
      newCount: newGames.length,
      overlapCount,
      overlapRate: familyCount > 0 ? overlapCount / familyCount : 0,
      familyOnlyCount: comparison.familyOnlyCount,
      initialValue,
      unpricedCount: unpricedGames.length,
      filteringProcessed: 0,
      filteringTotal: targetCount
    },
    targetBreakdown: buildTargetBreakdown(targetProfile, comparison, newGames),
    games: {
      all: allGames,
      new: newGames,
      overlap: comparison.overlapGames,
      unpriced: unpricedGames
    },
    classificationById,
    filtering: {
      processed: 0,
      total: targetCount,
      running: targetCount > 0
    },
    generatedAt: Date.now()
  };
}

function buildTargetBreakdown(targetProfile, comparison, currentNewGames = []) {
  const targets = Array.isArray(targetProfile.targets) ? targetProfile.targets : [];
  const selectedTargets = targets.filter(target => target.selected !== false);
  if (selectedTargets.length <= 1) {
    return null;
  }

  const familySet = new Set(getState().familyLibrary.appidSet.map(String));
  const selectedIds = new Set(selectedTargets.map(target => String(target.steamid64 || "")));
  const allGames = (comparison.allGames || targetProfile.games || [])
    .filter(game => (game.targetOwners || []).map(String).some(steamid => selectedIds.has(steamid)));
  const overlapGames = (comparison.overlapGames || [])
    .filter(game => (game.targetOwners || []).map(String).some(steamid => selectedIds.has(steamid)));
  const allGameIds = new Set(allGames.map(game => String(game.appid)));
  const overlapGameIds = new Set(overlapGames.map(game => String(game.appid)));
  const newGames = (currentNewGames || [])
    .filter(game => (game.targetOwners || []).map(String).some(steamid => selectedIds.has(steamid)));
  const targetRows = selectedTargets.map(target => {
    const gameIds = Array.from(new Set((target.gameAppids || []).map(String)));
    const steamid64 = String(target.steamid64 || "");
    const targetNewGames = newGames.filter(game => (game.targetOwners || []).map(String).includes(steamid64));
    const pricedNewGames = targetNewGames.filter(game => game.price && !game.price.pending && !game.price.unavailable);
    return {
      steamid64,
      targetCount: gameIds.length,
      overlapCount: gameIds.filter(appid => familySet.has(appid)).length,
      newCount: targetNewGames.length,
      initialValue: pricedNewGames.reduce((sum, game) => sum + Number(game.price?.initial || 0), 0)
    };
  });

  const initialValue = newGames
    .filter(game => game.price && !game.price.pending && !game.price.unavailable)
    .reduce((sum, game) => sum + Number(game.price?.initial || 0), 0);
  return {
    targetCount: buildSplitMetric(targetRows.map(row => row.targetCount), allGameIds.size),
    newCount: buildSplitMetric(targetRows.map(row => row.newCount), newGames.length),
    initialValue: buildSplitMetric(targetRows.map(row => row.initialValue), initialValue),
    overlapCount: buildSplitMetric(targetRows.map(row => row.overlapCount), overlapGameIds.size),
    overlapRate: buildSplitMetric(
      targetRows.map(row => getState().familyLibrary.appidSet.length > 0 ? row.overlapCount / getState().familyLibrary.appidSet.length : 0),
      getState().familyLibrary.appidSet.length > 0 ? overlapGameIds.size / getState().familyLibrary.appidSet.length : 0,
      targetRows.reduce((sum, row) => sum + row.overlapCount, 0) !== overlapGameIds.size
    )
  };
}

function buildTargetBreakdownFromReport(report) {
  const targets = Array.isArray(report?.target?.targets) ? report.target.targets : [];
  if (targets.length <= 1) {
    return null;
  }

  return buildTargetBreakdown(
    {
      targets,
      games: report.games?.all || []
    },
    {
      allGames: report.games?.all || [],
      overlapGames: report.games?.overlap || []
    },
    report.games?.new || []
  );
}

function buildSplitMetric(parts, total, forceDeduped = false) {
  const numericParts = parts.map(value => Number(value || 0));
  const numericTotal = Number(total || 0);
  const partSum = numericParts.reduce((sum, value) => sum + value, 0);
  return {
    parts: numericParts,
    total: numericTotal,
    deduped: forceDeduped || Math.abs(partSum - numericTotal) > 1e-9
  };
}


  return {
    buildReport,
    buildTargetBreakdown,
    buildTargetBreakdownFromReport,
    buildSplitMetric
  };
};
