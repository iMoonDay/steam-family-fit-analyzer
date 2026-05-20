import { Button, MultiSelect, Stack, Text, TextInput } from "@mantine/core";
import { startTransition, useMemo, useState } from "react";
import type { SetStateAction } from "react";
import type { AnalysisReport, AppSettings, PriceMode } from "../types";
import type { ResultGameRow, ResultGameViewMode, ResultViewState, TableSortState } from "../appTypes";
import { GameListView } from "../components/result/GameListView";
import { buildResultGameRows } from "../core/report";

export function FamilyLibraryPage({
  report,
  message,
  tablePriceLabel,
  settings,
  priceMode,
  priceModeControlValue,
  viewState,
  busy,
  onPriceModeChange,
  onViewStateChange,
  onRefresh,
  onMessage
}: {
  report: AnalysisReport | null;
  message: string;
  tablePriceLabel: string;
  settings: AppSettings;
  priceMode: PriceMode;
  priceModeControlValue: PriceMode;
  viewState: ResultViewState;
  busy: boolean;
  onPriceModeChange: (priceMode: PriceMode) => void;
  onViewStateChange: (value: SetStateAction<ResultViewState>) => void;
  onRefresh: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const { searchQuery, viewMode, showAppId, tableSortByList } = viewState;
  const [contributorFilter, setContributorFilter] = useState<string[]>([]);
  const [acquiredFrom, setAcquiredFrom] = useState("");
  const [acquiredTo, setAcquiredTo] = useState("");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const games = useMemo(() => buildResultGameRows(report?.games.all || [], priceMode), [priceMode, report]);
  const contributorOptions = useMemo(() => buildContributorOptions(games), [games]);
  const filteredGames = useMemo(() => filterFamilyGames(games, {
    contributor: contributorFilter,
    acquiredFrom,
    acquiredTo,
    priceMin,
    priceMax
  }), [acquiredFrom, acquiredTo, contributorFilter, games, priceMax, priceMin]);
  const contributorCount = useMemo(() => {
    const contributors = new Set<string>();
    for (const game of games) {
      for (const owner of game.familyOwners) {
        contributors.add(owner);
      }
    }
    return contributors.size;
  }, [games]);
  const activeFilterCount = [
    contributorFilter.length ? contributorFilter : "",
    acquiredFrom || acquiredTo,
    priceMin || priceMax
  ].filter(Boolean).length;
  const cacheResetKey = useMemo(() => [
    settings.cacheDirectory,
    settings.locale,
    settings.storeCountry,
    report?.familyGameCount || 0,
    report?.warnings.join("\n") || ""
  ].join("|"), [report, settings.cacheDirectory, settings.locale, settings.storeCountry]);
  const statusMessageIsError = message.includes("失败") || message.includes("错误") || message.includes("失效") || message.includes("缺少");

  function handleShowAppIdChange(nextShowAppId: boolean) {
    startTransition(() => {
      onViewStateChange(current => {
        const nextTableSortByList = { ...current.tableSortByList };
        if (!nextShowAppId && nextTableSortByList.relativeNew?.key === "appid") {
          delete nextTableSortByList.relativeNew;
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
          relativeNew: nextSort
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

  function handleClearFilters() {
    setContributorFilter([]);
    setAcquiredFrom("");
    setAcquiredTo("");
    setPriceMin("");
    setPriceMax("");
  }

  return (
    <div className="family-library-page">
      <header className="family-library-head">
        <Stack gap={2} className="family-library-title-stack">
          <Text component="h1" className="title">家庭库</Text>
          {message ? (
            <Text className={`inline-status ${statusMessageIsError ? "is-error" : ""}`} size="xs">
              {message}
            </Text>
          ) : null}
        </Stack>
        <div className="family-library-actions">
          {report ? (
            <div className="family-library-stats" aria-label="家庭库统计">
              <span>{report.familyGameCount} 款</span>
              <span>{contributorCount} 位贡献者</span>
            </div>
          ) : null}
          <InlineSegmentedControl
            className="result-price-mode-control"
            value={priceModeControlValue}
            options={[
              { value: "original", label: "原价" },
              { value: "historyLow", label: "史低" }
            ]}
            disabled={busy}
            onChange={value => onPriceModeChange(value as PriceMode)}
          />
          <Button size="xs" color="steamBlue" variant="light" loading={busy} onClick={() => void onRefresh()}>
            刷新
          </Button>
        </div>
      </header>

      {report ? (
        <GameListView
          games={filteredGames}
          listKey="relativeNew"
          listLabel="家庭库"
          includeTargetOwners={false}
          tablePriceLabel={tablePriceLabel}
          settings={settings}
          busy={busy}
          searchQuery={searchQuery}
          viewMode={viewMode}
          showAppId={showAppId}
          tableSort={tableSortByList.relativeNew}
          cacheResetKey={cacheResetKey}
          toolbarStart={(
            <div className="family-filter-bar">
              <MultiSelect
                className="family-filter-contributor"
                size="xs"
                value={contributorFilter}
                data={contributorOptions}
                placeholder="贡献者"
                clearable
                searchable
                maxDropdownHeight={260}
                renderPill={item => item.value === contributorFilter[0] ? (
                  <span className="family-filter-summary-pill">已选 {contributorFilter.length} 个</span>
                ) : null}
                styles={{
                  pillsList: {
                    flexWrap: "nowrap",
                    overflow: "hidden",
                    minHeight: 26
                  },
                  inputField: {
                    minWidth: 24
                  }
                }}
                onChange={setContributorFilter}
              />
              <TextInput
                className="family-filter-date"
                size="xs"
                type="date"
                value={acquiredFrom}
                aria-label="入库起始时间"
                onChange={event => setAcquiredFrom(event.currentTarget.value)}
              />
              <TextInput
                className="family-filter-date"
                size="xs"
                type="date"
                value={acquiredTo}
                aria-label="入库结束时间"
                onChange={event => setAcquiredTo(event.currentTarget.value)}
              />
              <TextInput
                className="family-filter-price"
                size="xs"
                type="number"
                min={0}
                step={0.01}
                value={priceMin}
                placeholder={`最低${tablePriceLabel}`}
                aria-label={`最低${tablePriceLabel}`}
                onChange={event => setPriceMin(event.currentTarget.value)}
              />
              <TextInput
                className="family-filter-price"
                size="xs"
                type="number"
                min={0}
                step={0.01}
                value={priceMax}
                placeholder={`最高${tablePriceLabel}`}
                aria-label={`最高${tablePriceLabel}`}
                onChange={event => setPriceMax(event.currentTarget.value)}
              />
              <Button
                className="family-filter-clear"
                size="xs"
                variant="subtle"
                color="steamBlue"
                disabled={!activeFilterCount}
                onClick={handleClearFilters}
              >
                清空{activeFilterCount ? ` ${activeFilterCount}` : ""}
              </Button>
              <Text className="family-filter-count" size="xs" c="dimmed">
                {filteredGames.length} / {games.length}
              </Text>
            </div>
          )}
          onSearchQueryChange={handleSearchQueryChange}
          onViewModeChange={handleViewModeChange}
          onShowAppIdChange={handleShowAppIdChange}
          onTableSortChange={handleTableSortChange}
          onMessage={onMessage}
        />
      ) : (
        <section className="family-library-empty">
          <Stack gap={12} align="center">
            <Text c="dimmed">登录后可读取家庭库</Text>
            <Button color="steamBlue" loading={busy} onClick={() => void onRefresh()}>
              读取家庭库
            </Button>
          </Stack>
        </section>
      )}
    </div>
  );
}

type FamilyFilterState = {
  contributor: string[];
  acquiredFrom: string;
  acquiredTo: string;
  priceMin: string;
  priceMax: string;
};

function buildContributorOptions(games: ResultGameRow[]) {
  const contributors = new Map<string, string>();
  for (const game of games) {
    const ownerIds = game.familyOwners.length ? game.familyOwners : game.familyOwnerNames;
    ownerIds.forEach((ownerId, index) => {
      const label = game.familyOwnerNames[index] || ownerId;
      if (ownerId && label) {
        contributors.set(ownerId, label);
      }
    });
  }
  return Array.from(contributors.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN", { numeric: true, sensitivity: "base" }));
}

function filterFamilyGames(games: ResultGameRow[], filters: FamilyFilterState): ResultGameRow[] {
  const from = parseDateStart(filters.acquiredFrom);
  const to = parseDateEnd(filters.acquiredTo);
  const minPrice = parsePriceFilter(filters.priceMin);
  const maxPrice = parsePriceFilter(filters.priceMax);
  const hasPriceFilter = minPrice != null || maxPrice != null;

  return games.filter(game => {
    if (
      filters.contributor.length
      && !filters.contributor.some(contributor => (
        game.familyOwners.includes(contributor) || game.familyOwnerNames.includes(contributor)
      ))
    ) {
      return false;
    }
    if (from != null && (!game.familyAcquiredAt || game.familyAcquiredAt < from)) {
      return false;
    }
    if (to != null && (!game.familyAcquiredAt || game.familyAcquiredAt > to)) {
      return false;
    }
    if (hasPriceFilter) {
      const price = getComparablePrice(game);
      if (price == null) {
        return false;
      }
      if (minPrice != null && price < minPrice) {
        return false;
      }
      if (maxPrice != null && price > maxPrice) {
        return false;
      }
    }
    return true;
  });
}

function parseDateStart(value: string): number | null {
  if (!value) {
    return null;
  }
  const time = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

function parseDateEnd(value: string): number | null {
  if (!value) {
    return null;
  }
  const time = new Date(`${value}T23:59:59`).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

function parsePriceFilter(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getComparablePrice(game: ResultGameRow): number | null {
  if (!game.price || game.price.unavailable || game.price.initial == null) {
    return null;
  }
  return Number(game.price.initial || 0) / 100;
}

function InlineSegmentedControl({
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
