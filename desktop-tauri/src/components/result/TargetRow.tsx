import { Avatar, Group, Stack, Text } from "@mantine/core";
import type { TargetProfile } from "../../types";
import { openSteamProfilePage } from "../../core/external";

export function TargetRow({
  target,
  selectable = false,
  checked = true,
  disabled = false,
  onCheckedChange
}: {
  target: TargetProfile;
  selectable?: boolean;
  checked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  const profileUrl = target.profileUrl || (target.steamid64 ? `https://steamcommunity.com/profiles/${target.steamid64}` : "");
  return (
    <div className={`target-row ${selectable ? "is-selectable" : ""} ${selectable && !checked ? "is-muted" : ""}`}>
      <Group wrap="nowrap" align="center">
        {selectable ? (
          <button
            className="target-select"
            type="button"
            role="checkbox"
            aria-label={`计入 ${target.displayName || target.steamid64 || "目标账号"}`}
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onCheckedChange?.(!checked)}
          >
            <span aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className="target-avatar-link"
          aria-label={`打开 ${target.displayName || target.steamid64 || "目标账号"} 主页`}
          disabled={!profileUrl}
          onClick={() => void openSteamProfilePage(target.steamid64, profileUrl)}
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
