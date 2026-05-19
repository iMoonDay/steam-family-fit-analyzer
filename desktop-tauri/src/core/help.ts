export const helpLinks = {
  steamApiKey: {
    url: "https://steamcommunity.com/dev/apikey",
    steps: [
      "1. 打开 Steam Web API Key 页面，并确认已登录要用于分析的 Steam 账号。",
      "2. 如果页面已经显示 Key，复制那串 32 位密钥；如果还没有 Key，按页面提示注册域名后再复制。",
      "3. 回到这里手动粘贴 Key。这个字段不会由自动配置脚本读取。"
    ]
  },
  itadApiKey: {
    url: "https://isthereanydeal.com/apps/",
    steps: [
      "1. 打开 IsThereAnyDeal Apps 页面，并登录你的 ITAD 账号。",
      "2. 创建一个应用，或进入已有应用详情，找到 API Key。",
      "3. 复制完整 Key 后粘贴到这里；只有使用 Steam 史低价格模式时才需要它。"
    ]
  },
  currentSteamId64: {
    url: "https://steamid.io/",
    steps: [
      "1. 打开 SteamID 查询页。",
      "2. 粘贴你的 Steam 个人主页地址、好友码或自定义 ID 并查询。",
      "3. 复制结果里的 steamID64，也就是 17 位数字，粘贴到这里。"
    ]
  },
  familyAccessToken: {
    url: "https://store.steampowered.com/account/familymanagement",
    steps: [
      "1. 优先点击上方“前往获取”，它会打开 Steam 家庭管理页并复制一次性脚本。",
      "2. 在已登录 Steam 的家庭管理页，把脚本粘贴到地址栏或控制台执行。",
      "3. 成功后桌面端会自动回填 Access Token、SteamID64 和家庭组 ID。"
    ]
  }
} as const;

export type HelpLinkKey = keyof typeof helpLinks;

export const browserConfigHelpSteps = [
  "1. 点击“前往获取”后，桌面端会启动 10 分钟本地回调，并把一次性脚本复制到剪贴板。",
  "2. 浏览器打开 Steam 家庭管理页后，确认已登录，再把剪贴板里的脚本粘贴到地址栏或控制台执行。",
  "3. 执行成功后会自动回填家庭库 Access Token、当前 SteamID64 和家庭组 ID；Steam Web API Key 仍需在字段旁帮助页手动复制。"
] as const;
