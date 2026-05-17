"use strict";

globalThis.SFFA_CREATE_LIBRARY_COMPARE = function createLibraryCompare(dependencies) {
  const {
    getCachedLocalizedName,
    getState,
    getTargetSteamIds,
    sortByName
  } = dependencies;

function compareLibraries(targetProfile, currentOwnedAppids = new Set()) {
  const familySet = new Set(getState().familyLibrary.appidSet.map(String));
  const currentOwnedSet = new Set(Array.from(currentOwnedAppids || []).map(String));
  const targetMap = new Map();
  targetProfile.games.forEach(game => {
    targetMap.set(String(game.appid), game);
  });

  const newGames = [];
  const overlapGames = [];
  const alreadyOwnedGames = [];
  let familyOverlapCount = 0;
  targetMap.forEach((game, appid) => {
    if (familySet.has(appid)) {
      familyOverlapCount += 1;
      const familyInfo = getState().familyLibrary.appInfoById[appid] || {};
      overlapGames.push({
        ...game,
        familyName: familyInfo.name || game.name,
        localizedName: getCachedLocalizedName(appid) || game.localizedName || "",
        owners: familyInfo.owners || [],
        targetOwners: game.targetOwners || getTargetSteamIds(targetProfile)
      });
    } else if (currentOwnedSet.has(appid)) {
      alreadyOwnedGames.push({
        ...game,
        targetOwners: game.targetOwners || getTargetSteamIds(targetProfile),
        price: null
      });
    } else {
      newGames.push({
        ...game,
        targetOwners: game.targetOwners || getTargetSteamIds(targetProfile),
        price: null
      });
    }
  });

  return {
    newGames: newGames.sort(sortByName),
    overlapGames: overlapGames.sort(sortByName),
    alreadyOwnedGames: alreadyOwnedGames.sort(sortByName),
    familyOnlyCount: Math.max(0, familySet.size - familyOverlapCount)
  };
}


  return { compareLibraries };
};
