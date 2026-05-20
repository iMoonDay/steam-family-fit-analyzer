import {
  Button,
  Group,
  ScrollArea,
  Stack,
  Text
} from "@mantine/core";
import { startTransition, useMemo } from "react";
import type { SetStateAction } from "react";
import type { AnalysisReport, AppSettings, PriceMode } from "../types";
import type {
  ResultGameListKey,
  ResultGameViewMode,
  ResultViewState,
  TableSortState
} from "../appTypes";
import { GameListView } from "../components/result/GameListView";
import { Metric } from "../components/result/ResultMetrics";
import { TargetRow } from "../components/result/TargetRow";
import { writeClipboard } from "../core/external";
import {
  buildResultGameRows,
  buildResultMetrics,
  buildReportTargetInput,
  filterReportBySelectedTargets,
  formatReportText
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

function SegmentedControl({
  className,
  value,
  options,
  disabled = false,
  onChange
}: {
  className: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className={`inline-segmented ${className}`} role="group">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "is-active" : ""}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function AnalysisResultPage({
  report,
  message,
  warningText,
  tablePriceLabel,
  settings,
  priceMode,
  priceModeControlValue,
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
  settings: AppSettings;
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
  const { searchQuery, activeGameList, viewMode, showAppId, selectedTargetIds, tableSortByList } = viewState;
  const targetIds = useMemo(() => report.targets.map(target => target.steamid64).filter(Boolean), [report]);
  const activeSelectedTargetIds = useMemo(() => {
    const validSelectedIds = selectedTargetIds.filter(steamid64 => targetIds.includes(steamid64));
    return validSelectedIds.length ? validSelectedIds : targetIds;
  }, [selectedTargetIds, targetIds]);
  const selectedTargetIdSet = useMemo(() => new Set(activeSelectedTargetIds), [activeSelectedTargetIds]);
  const effectiveReport = useMemo(
    () => filterReportBySelectedTargets(report, activeSelectedTargetIds),
    [activeSelectedTargetIds, report]
  );
  const includeTargetOwners = effectiveReport.targets.length > 1;
  const resultMetrics = useMemo(() => buildResultMetrics(effectiveReport, priceMode), [effectiveReport, priceMode]);
  const games = useMemo(() => buildResultGameRows(effectiveReport.games[activeGameList], priceMode), [activeGameList, effectiveReport, priceMode]);
  const cacheResetKey = useMemo(() => [
    settings.cacheDirectory,
    settings.locale,
    settings.storeCountry,
    effectiveReport.targets.map(target => target.steamid64).join(","),
    effectiveReport.games.all.length,
    effectiveReport.games.new.length,
    effectiveReport.games.relativeNew.length,
    effectiveReport.games.overlap.length
  ].join("|"), [effectiveReport, settings.cacheDirectory, settings.locale, settings.storeCountry]);
  const targetSelectionSummary = report.targets.length > 1
    ? `已计入 ${activeSelectedTargetIds.length} / ${report.targets.length}`
    : "";

  function handleShowAppIdChange(nextShowAppId: boolean) {
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

  function handleTableSortChange(nextSort: TableSortState) {
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

  function handleSearchQueryChange(nextSearchQuery: string) {
    onViewStateChange(current => ({
      ...current,
      searchQuery: nextSearchQuery
    }));
  }

  function handleViewModeChange(nextViewMode: ResultGameViewMode) {
    startTransition(() => {
      onViewStateChange(current => ({
        ...current,
        viewMode: nextViewMode
      }));
    });
  }

  async function handleCopyReport() {
    await writeClipboard(formatReportText(effectiveReport, priceMode));
    onMessage("已复制");
  }

  function handleTargetCheckedChange(steamid64: string, checked: boolean) {
    if (!steamid64) {
      return;
    }
    if (!checked && activeSelectedTargetIds.length <= 1) {
      onMessage("至少保留一个账号");
      return;
    }
    const nextSelectedTargetIds = checked
      ? Array.from(new Set([...activeSelectedTargetIds, steamid64]))
      : activeSelectedTargetIds.filter(targetId => targetId !== steamid64);
    startTransition(() => {
      onViewStateChange(current => ({
        ...current,
        selectedTargetIds: nextSelectedTargetIds
      }));
    });
  }

  return (
    <div className="analysis-result-layout">
      <aside className="result-data-pane">
        <div className="result-data-head">
          <Stack gap={2}>
            <Text component="h1" className="title">分析结果</Text>
            {message ? (
              <Text className={`inline-status ${message.includes("失败") || message.includes("错误") ? "is-error" : ""}`} size="xs">
                {message}
              </Text>
            ) : null}
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
            {targetSelectionSummary ? <Text size="xs" c="dimmed">{targetSelectionSummary}</Text> : null}
            {warningText ? <Text size="xs" c="orange">{warningText}</Text> : null}
          </Group>
          <ScrollArea.Autosize mah={360}>
            <Stack gap={0}>
              {report.targets.map(target => (
                <TargetRow
                  key={target.steamid64 || target.displayName}
                  target={target}
                  selectable={report.targets.length > 1}
                  checked={selectedTargetIdSet.has(target.steamid64)}
                  disabled={selectedTargetIdSet.has(target.steamid64) && activeSelectedTargetIds.length <= 1}
                  onCheckedChange={checked => handleTargetCheckedChange(target.steamid64, checked)}
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </section>
      </aside>

      <GameListView
        games={games}
        listKey={activeGameList}
        listLabel={getResultGameListLabel(activeGameList)}
        includeTargetOwners={includeTargetOwners}
        tablePriceLabel={tablePriceLabel}
        settings={settings}
        busy={busy}
        searchQuery={searchQuery}
        viewMode={viewMode}
        showAppId={showAppId}
        tableSort={tableSortByList[activeGameList]}
        cacheResetKey={cacheResetKey}
        toolbarStart={(
          <>
            <SegmentedControl
              className="game-list-tabs"
              value={activeGameList}
              options={[
                { value: "all", label: `全部 ${effectiveReport.games.all.length}` },
                { value: "new", label: `新增 ${effectiveReport.games.new.length}` },
                { value: "relativeNew", label: `相对新增 ${effectiveReport.games.relativeNew.length}` },
                { value: "overlap", label: `重复 ${effectiveReport.games.overlap.length}` }
              ]}
              onChange={value => startTransition(() => onViewStateChange(current => ({ ...current, activeGameList: value as ResultGameListKey })))}
            />
            <SegmentedControl
              className="result-price-mode-control"
              value={priceModeControlValue}
              options={[
                { value: "original", label: "原价" },
                { value: "historyLow", label: "史低" }
              ]}
              disabled={busy}
              onChange={value => onPriceModeChange(value as PriceMode)}
            />
          </>
        )}
        onSearchQueryChange={handleSearchQueryChange}
        onViewModeChange={handleViewModeChange}
        onShowAppIdChange={handleShowAppIdChange}
        onTableSortChange={handleTableSortChange}
        onCopyReport={handleCopyReport}
        onMessage={onMessage}
      />
    </div>
  );
}

function getResultGameListLabel(listKey: ResultGameListKey): string {
  if (listKey === "new") {
    return "新增";
  }
  if (listKey === "relativeNew") {
    return "相对新增";
  }
  if (listKey === "overlap") {
    return "重复";
  }
  return "全部";
}
