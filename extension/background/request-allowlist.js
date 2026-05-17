export const REQUEST_ALLOWLIST = [
  {
    host: "api.steampowered.com",
    pathPrefixes: [
      "/IFamilyGroupsService/GetFamilyGroupForUser/",
      "/IFamilyGroupsService/GetSharedLibraryApps/",
      "/IPlayerService/GetPlayerLinkDetails/",
      "/IPlayerService/GetOwnedGames/",
      "/ISteamUser/ResolveVanityURL/",
      "/ISteamUser/GetPlayerSummaries/",
      "/IStoreBrowseService/GetItems/"
    ]
  },
  {
    host: "store.steampowered.com",
    exactPaths: [
      "/"
    ],
    pathPrefixes: [
      "/api/appdetails"
    ]
  },
  {
    host: "steamcommunity.com",
    pathPrefixes: [
      "/dev/apikey"
    ]
  }
];
