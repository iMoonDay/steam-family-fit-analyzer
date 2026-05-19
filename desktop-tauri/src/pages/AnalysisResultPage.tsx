import {
  ActionIcon,
  Button,
  Group,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip
} from "@mantine/core";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { MouseEvent, SetStateAction } from "react";
import type { AnalysisReport, PriceMode } from "../types";
import type {
  GameContextMenuState,
  MoreMenuState,
  ResultGameListKey,
  ResultGameRow,
  ResultGameViewMode,
  ResultViewState,
  TableSortDirection,
  TableSortState
} from "../appTypes";
import { clearCache } from "../services/desktop";
import { MoreIcon } from "../components/icons";
import { GameCard } from "../components/result/GameCard";
import { GameTable } from "../components/result/GameTable";
import { GameContextMenu, ResultMoreMenu } from "../components/result/ResultMenus";
import { Metric } from "../components/result/ResultMetrics";
import { TargetRow } from "../components/result/TargetRow";
import { openExternalUrl, writeClipboard } from "../core/external";
import {
  buildResultGameRows,
  buildResultMetrics,
  buildReportTargetInput,
  buildTableSortSelectOptions,
  formatGameListText,
  formatReportText,
  matchesResultGameSearch,
  normalizeTableSortState,
  parseTableSortSelectValue,
  serializeTableSortState,
  sortTableGameRows
} from "../core/report";

export function EmptyResultPage({ onGoAnalysis }: { onGoAnalysis: () => void }) {
  return (
    <div className="empty-result-page">
      <Stack gap={12} align="center" maw={460}>
        <Text component="h1" className="title">暂无分析结果</Text>
        <Button color="steamBlue" onClick={onGoAnalysis}>
          前往分析
        </Button>
      </Stack>
    </div>
  );
}

export function AnalysisResultPage({
  report,
  message,
  warningText,
  tablePriceLabel,
  priceMode,
  priceModeControlValue,
  hasHistoryLowApiKey,
  viewState,
  busy,
  onPriceModeChange,
  onViewStateChange,
  onBack,
  onAnalyze,
  onMessage
}: {
  report: AnalysisReport;
  message: string;
  warningText: string;
  priceLabel: string;
  tablePriceLabel: string;
  priceMode: PriceMode;
  priceModeControlValue: PriceMode;
  hasHistoryLowApiKey: boolean;
  viewState: ResultViewState;
  busy: boolean;
  onPriceModeChange: (priceMode: PriceMode) => void;
  onViewStateChange: (value: SetStateAction<ResultViewState>) => void;
  onBack: () => void;
  onAnalyze: (inputOverride?: string) => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const { searchQuery, activeGameList, viewMode, showAppId, tableSortByList } = viewState;
  const [coverReloadTokens, setCoverReloadTokens] = useState<Record<string, number>>({});
  const [gameContextMenu, setGameContextMenu] = useState<GameContextMenuState | null>(null);
  const [moreMenu, setMoreMenu] = useState<MoreMenuState | null>(null);
  const includeTargetOwners = report.targets.length > 1;
  const resultMetrics = useMemo(() => buildResultMetrics(report, priceMode), [priceMode, report]);
  const games = useMemo(() => buildResultGameRows(report.games[activeGameList], priceMode), [activeGameList, priceMode, report]);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const tableSortOptions = useMemo(
    () => buildTableSortSelectOptions(activeGameList, includeTargetOwners, showAppId, tablePriceLabel),
    [activeGameList, includeTargetOwners, showAppId, tablePriceLabel]
  );
  const activeTableSort = normalizeTableSortState(tableSortByList[activeGameList], tableSortOptions);
  const sortSelectValue = serializeTableSortState(activeTableSort);
  const filteredGames = useMemo(() => {
    return games.filter(game => matchesResultGameSearch(game, deferredSearchQuery));
  }, [deferredSearchQuery, games]);
  const visibleGames = useMemo(() => sortTableGameRows(filteredGames, activeTableSort), [activeTableSort, filteredGames]);

  useEffect(() => {
    if (!gameContextMenu) {
      return;
    }

    const closeContextMenu = () => setGameContextMenu(null);
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
  }, [gameContextMenu]);

  useEffect(() => {
    if (!moreMenu) {
      return;
    }

    const closeMoreMenu = () => setMoreMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMoreMenu();
      }
    };

    window.addEventListener("pointerdown", closeMoreMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeMoreMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [moreMenu]);

  function handleGameContextMenu(event: MouseEvent<HTMLElement>, game: ResultGameRow) {
    event.preventDefault();
    event.stopPropagation();
    setGameContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 96),
      game
    });
  }

  function handleRefreshCover(game: ResultGameRow) {
    setCoverReloadTokens(tokens => ({
      ...tokens,
      [game.appid]: Date.now()
    }));
    setGameContextMenu(null);
  }

  function handleMoreMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMoreMenu(current => current ? null : {
      x: Math.max(12, Math.min(rect.right - 190, window.innerWidth - 206)),
      y: Math.min(rect.bottom + 8, window.innerHeight - 184)
    });
  }

  function handleToggleAppId() {
    const nextShowAppId = !showAppId;
    startTransition(() => {
      onViewStateChange(current => {
        const nextTableSortByList = { ...current.tableSortByList };
        if (!nextShowAppId && nextTableSortByList[activeGameList]?.key === "appid") {
          delete nextTableSortByList[activeGameList];
        }
        return {
          ...current,
          showAppId: nextShowAppId,
          tableSortByList: nextTableSortByList
        };
      });
    });
  }

  function handleTableSort(columnKey: string) {
    startTransition(() => {
      onViewStateChange(current => {
        const previous = normalizeTableSortState(current.tableSortByList[activeGameList], tableSortOptions);
        const direction: TableSortDirection = previous?.key === columnKey && previous.direction === "asc" ? "desc" : "asc";
        return {
          ...current,
          tableSortByList: {
            ...current.tableSortByList,
            [activeGameList]: { key: columnKey, direction }
          }
        };
      });
    });
  }

  function handleSortSelectChange(value: string | null) {
    const nextSort = parseTableSortSelectValue(value);
    startTransition(() => {
      onViewStateChange(current => ({
        ...current,
        tableSortByList: {
          ...current.tableSortByList,
          [activeGameList]: nextSort
        }
      }));
    });
  }

  async function handleCopyCurrentList() {
    await writeClipboard(formatGameListText(visibleGames));
    onMessage(`已复制当前列表：${visibleGames.length} 个游戏`);
  }

  async function handleCopyReport() {
    await writeClipboard(formatReportText(report, priceMode));
    onMessage("已复制分析报告");
  }

  async function handleClearCache() {
    await clearCache();
    onMessage("缓存已清理，下次分析会重新请求商店与价格数据");
  }

  return (
    <div className="analysis-result-layout">
      <aside className="result-data-pane">
        <div className="result-data-head">
          <Stack gap={2}>
            <Text component="h1" className="title">分析结果</Text>
            <Text className={`inline-status ${message.includes("失败") || message.includes("错误") ? "is-error" : ""}`} size="xs">
              {message}
            </Text>
          </Stack>
          <div className="result-actions">
            <Button size="xs" variant="subtle" color="steamBlue" onClick={onBack}>返回</Button>
            <Button size="xs" color="steamBlue" variant="light" loading={busy} onClick={() => void onAnalyze(buildReportTargetInput(report))}>
              重新分析
            </Button>
          </div>
        </div>

        <div className="result-metrics">
          {resultMetrics.map(metric => (
            <Metric
              key={metric.label}
              label={metric.label}
              value={metric.value}
              tooltipRows={metric.tooltipRows}
            />
          ))}
        </div>

        <section className="result-targets">
          <Group justify="space-between" className="result-head">
            <Text fw={700}>目标账号</Text>
            {warningText ? <Text size="xs" c="orange">{warningText}</Text> : null}
          </Group>
          <ScrollArea.Autosize mah={360}>
            <Stack gap={0}>
              {report.targets.map(target => <TargetRow key={target.steamid64 || target.displayName} target={target} />)}
            </Stack>
          </ScrollArea.Autosize>
        </section>
      </aside>

      <section className="result-games-pane">
        <div className="game-list-head">
          <div className="game-list-tab-row">
            <SegmentedControl
              className="game-list-tabs"
              size="xs"
              color="steamBlue"
              value={activeGameList}
              data={[
                { value: "all", label: `全部 ${report.games.all.length}` },
                { value: "new", label: `新增 ${report.games.new.length}` },
                { value: "relativeNew", label: `相对新增 ${report.games.relativeNew.length}` },
                { value: "overlap", label: `重复 ${report.games.overlap.length}` }
              ]}
              onChange={value => startTransition(() => onViewStateChange(current => ({ ...current, activeGameList: value as ResultGameListKey })))}
            />
            <SegmentedControl
              className="result-price-mode-control"
              size="xs"
              color="steamBlue"
              value={priceModeControlValue}
              data={[
                { value: "original", label: "原价" },
                {
                  value: "historyLow",
                  label: (
                    <Tooltip
                      label={hasHistoryLowApiKey ? "使用 IsThereAnyDeal 史低价格" : "史低需要先在配置中填写 IsThereAnyDeal API Key"}
                      withArrow
                      openDelay={250}
                    >
                      <span className="segmented-label-content">史低</span>
                    </Tooltip>
                  )
                }
              ]}
              disabled={busy}
              onChange={value => onPriceModeChange(value as PriceMode)}
            />
          </div>
          <div className="game-list-tools">
            <SegmentedControl
              className="game-view-toggle"
              size="xs"
              color="steamBlue"
              value={viewMode}
              data={[
                { value: "cover", label: "封面" },
                { value: "table", label: "表格" }
              ]}
              onChange={value => startTransition(() => onViewStateChange(current => ({ ...current, viewMode: value as ResultGameViewMode })))}
            />
            <Select
              className="game-sort"
              size="xs"
              value={sortSelectValue}
              data={tableSortOptions}
              onChange={handleSortSelectChange}
              allowDeselect={false}
            />
            <TextInput
              className="game-search"
              size="xs"
              value={searchQuery}
              onChange={event => onViewStateChange(current => ({ ...current, searchQuery: event.currentTarget.value }))}
              placeholder="搜索游戏名或 AppID"
            />
            <ActionIcon
              className="more-menu-button"
              size={30}
              radius="md"
              variant="light"
              color="steamBlue"
              aria-label="更多"
              onClick={handleMoreMenu}
            >
              <MoreIcon />
            </ActionIcon>
          </div>
        </div>

        {visibleGames.length ? (
          viewMode === "cover" ? (
            <ScrollArea className="game-scroll">
              <div className="game-card-grid">
                {visibleGames.map(game => (
                  <GameCard
                    key={game.appid}
                    game={game}
                    listKey={activeGameList}
                    showAppId={showAppId}
                    coverReloadToken={coverReloadTokens[game.appid] || 0}
                    onContextMenu={handleGameContextMenu}
                  />
                ))}
              </div>
            </ScrollArea>
          ) : (
            <GameTable
              games={visibleGames}
              listKey={activeGameList}
              includeTargetOwners={includeTargetOwners}
              showAppId={showAppId}
              priceLabel={tablePriceLabel}
              sort={activeTableSort}
              coverReloadTokens={coverReloadTokens}
              onSort={handleTableSort}
              onContextMenu={handleGameContextMenu}
            />
          )
        ) : (
          <ScrollArea className="game-scroll">
            <Text c="dimmed" p="md">没有匹配的游戏</Text>
          </ScrollArea>
        )}
      </section>

      {gameContextMenu ? (
        <GameContextMenu
          state={gameContextMenu}
          onOpenWebpage={game => {
            setGameContextMenu(null);
            void openExternalUrl(game.storeLink);
          }}
          onRefreshCover={handleRefreshCover}
        />
      ) : null}
      {moreMenu ? (
        <ResultMoreMenu
          state={moreMenu}
          showAppId={showAppId}
          onToggleAppId={handleToggleAppId}
          onCopyList={() => void handleCopyCurrentList().catch(error => onMessage(String(error))).finally(() => setMoreMenu(null))}
          onCopyReport={() => void handleCopyReport().catch(error => onMessage(String(error))).finally(() => setMoreMenu(null))}
          onClearCache={() => void handleClearCache().catch(error => onMessage(String(error))).finally(() => setMoreMenu(null))}
        />
      ) : null}
    </div>
  );
}

