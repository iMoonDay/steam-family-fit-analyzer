import { Button, Group, ScrollArea, Stack, Text, Textarea } from "@mantine/core";
import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import type { AnalysisHistoryEntry, HistoryContextMenuState } from "../appTypes";
import {
  formatHistoryAccountIds,
  formatHistoryAccountNames,
  formatHistoryAnalysisInput
} from "../core/storage";
import { writeClipboard } from "../core/external";
import { TrashIcon } from "../components/icons";

export function AnalysisPreparePage({
  targetInput,
  history,
  message,
  busy,
  onTargetInputChange,
  onAnalyze,
  onDeleteHistoryEntry,
  onMessage
}: {
  targetInput: string;
  history: AnalysisHistoryEntry[];
  message: string;
  busy: boolean;
  onTargetInputChange: (value: string) => void;
  onAnalyze: (inputOverride?: string) => Promise<void>;
  onDeleteHistoryEntry: (entryId: string) => void;
  onMessage: (message: string) => void;
}) {
  const [historyContextMenu, setHistoryContextMenu] = useState<HistoryContextMenuState | null>(null);

  useEffect(() => {
    if (!historyContextMenu) {
      return;
    }

    const closeContextMenu = () => setHistoryContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [historyContextMenu]);

  function handleHistoryContextMenu(event: MouseEvent<HTMLElement>, entry: AnalysisHistoryEntry) {
    event.preventDefault();
    event.stopPropagation();
    setHistoryContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 72),
      entry
    });
  }

  async function handleCopyHistoryEntry(entry: AnalysisHistoryEntry) {
    await writeClipboard(formatHistoryAnalysisInput(entry));
    setHistoryContextMenu(null);
    onMessage("已复制");
  }

  return (
    <div className="analysis-prepare-layout">
      <aside className="history-pane">
        <Group justify="space-between" align="center" className="history-head">
          <Text fw={700}>历史分析</Text>
        </Group>
        <ScrollArea className="history-scroll">
          <Stack gap={4}>
            {history.length ? history.map(entry => (
              <div
                key={entry.id}
                className="history-item"
                onContextMenu={event => handleHistoryContextMenu(event, entry)}
              >
                <button
                  type="button"
                  className="history-item-main"
                  disabled={busy}
                  onClick={() => void onAnalyze(entry.inputValue)}
                >
                  <span className="history-item-copy">
                    <span className="history-item-name">{formatHistoryAccountNames(entry)}</span>
                    <span className="history-item-id">{formatHistoryAccountIds(entry)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="history-delete"
                  aria-label="删除历史分析"
                  onClick={() => onDeleteHistoryEntry(entry.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            )) : (
              <Text className="history-empty" c="dimmed" size="sm">暂无历史分析</Text>
            )}
          </Stack>
        </ScrollArea>
        {historyContextMenu ? (
          <HistoryContextMenu
            state={historyContextMenu}
            onCopy={entry => void handleCopyHistoryEntry(entry).catch(error => onMessage(String(error)))}
          />
        ) : null}
      </aside>

      <section className="analysis-draft-pane">
        <section className="input-pane">
          <Group justify="space-between" mb="xs" align="flex-start">
            <Stack gap={2}>
              <Text component="h1" className="title">账号分析</Text>
              {message ? (
                <Text className={`inline-status ${message.includes("失败") || message.includes("错误") ? "is-error" : ""}`} size="xs">
                  {message}
                </Text>
              ) : null}
            </Stack>
            <Button color="steamBlue" loading={busy} onClick={() => void onAnalyze()}>开始分析</Button>
          </Group>
          <Textarea
            minRows={6}
            autosize
            value={targetInput}
            onChange={event => onTargetInputChange(event.currentTarget.value)}
            placeholder="SteamID64、好友码、个人主页 URL 或自定义 ID；多个账号用空格或换行分隔"
          />
        </section>

        <section className="analysis-blank-pane" aria-label="预留区域" />
      </section>
    </div>
  );
}

function HistoryContextMenu({
  state,
  onCopy
}: {
  state: HistoryContextMenuState;
  onCopy: (entry: AnalysisHistoryEntry) => void;
}) {
  return (
    <div
      className="context-menu"
      style={{ left: state.x, top: state.y }}
      role="menu"
      onPointerDown={event => event.stopPropagation()}
    >
      <button type="button" role="menuitem" onClick={() => onCopy(state.entry)}>
        复制
      </button>
    </div>
  );
}
