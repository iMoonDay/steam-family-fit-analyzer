import { Avatar, Group, Stack, Text } from "@mantine/core";
import type { TargetProfile } from "../../types";
import { openExternalUrl } from "../../core/external";

export function TargetRow({ target }: { target: TargetProfile }) {
  const profileUrl = target.profileUrl || (target.steamid64 ? `https://steamcommunity.com/profiles/${target.steamid64}` : "");
  return (
    <div className="target-row">
      <Group wrap="nowrap" align="center">
        <button
          type="button"
          className="target-avatar-link"
          aria-label={`打开 ${target.displayName || target.steamid64 || "目标账号"} 主页`}
          disabled={!profileUrl}
          onClick={() => void openExternalUrl(profileUrl)}
        >
          <Avatar src={target.avatar || null} radius="md" size={42}>
            {(target.displayName || target.steamid64 || "?").slice(0, 1)}
          </Avatar>
        </button>
        <Stack gap={2} className="target-copy">
          <Text fw={700} truncate>{target.displayName || target.steamid64}</Text>
          <Text size="xs" c="dimmed" truncate>
            {target.steamid64} · {target.gameCount} 个公开游戏
          </Text>
        </Stack>
      </Group>
    </div>
  );
}
