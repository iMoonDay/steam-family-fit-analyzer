import {
  ActionIcon,
  ScrollArea,
  Select,
  Text,
  TextInput
} from "@mantine/core";
import { save as selectSavePath } from "@tauri-apps/plugin-dialog";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject
} from "react";
import type { AppSettings } from "../../types";
import type {
  GameContextMenuState,
  MoreMenuState,
  PosterSettings,
  PosterSortMode,
  ResultGameListKey,
  ResultGameRow,
  ResultGameViewMode,
  TableSortDirection,
  TableSortState
} from "../../appTypes";
import { MoreIcon, PosterControlIcon } from "../icons";
import { cacheCovers, savePngFile } from "../../services/desktop";
import { openSteamStorePage, writeClipboard } from "../../core/external";
import {
  buildGameCoverPosterFilename,
  buildListPosterSortModes,
  defaultPosterSettings,
  getPosterSortModeLabel,
  normalizePosterColumns,
  normalizePosterScalePercent,
  normalizePosterSettings,
  renderGameCoverPoster
} from "../../core/poster";
import {
  buildTableSortSelectOptions,
  formatGameListText,
  formatGameNamesText,
  getSteamCoverUrl,
  matchesResultGameSearch,
  normalizeTableSortState,
  parseTableSortSelectValue,
  serializeTableSortState,
  sortTableGameRows
} from "../../core/report";
import { GameCard } from "./GameCard";
import { GameTable } from "./GameTable";
import { GameContextMenu, ResultMoreMenu } from "./ResultMenus";

export function GameListView({
  games,
  listKey,
  listLabel,
  includeTargetOwners,
  tablePriceLabel,
  settings,
  busy,
  searchQuery,
  viewMode,
  showAppId,
  tableSort,
  toolbarStart,
  cacheResetKey,
  onSearchQueryChange,
  onViewModeChange,
  onShowAppIdChange,
  onTableSortChange,
  onCopyReport,
  onMessage
}: {
  games: ResultGameRow[];
  listKey: ResultGameListKey;
  listLabel: string;
  includeTargetOwners: boolean;
  tablePriceLabel: string;
  settings: AppSettings;
  busy: boolean;
  searchQuery: string;
  viewMode: ResultGameViewMode;
  showAppId: boolean;
  tableSort?: TableSortState;
  toolbarStart?: ReactNode;
  cacheResetKey: string;
  onSearchQueryChange: (value: string) => void;
  onViewModeChange: (value: ResultGameViewMode) => void;
  onShowAppIdChange: (value: boolean) => void;
  onTableSortChange: (value: TableSortState) => void;
  onCopyReport?: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const coverScrollViewportRef = useRef<HTMLDivElement | null>(null);
  const [coverReloadTokens, setCoverReloadTokens] = useState<Record<string, number>>({});
  const [coverCachePaths, setCoverCachePaths] = useState<Record<string, string>>({});
  const [coverCacheFailedAppids, setCoverCacheFailedAppids] = useState<Record<string, number>>({});
  const [viewportCoverAppids, setViewportCoverAppids] = useState<string[]>([]);
  const [gameContextMenu, setGameContextMenu] = useState<GameContextMenuState | null>(null);
  const [moreMenu, setMoreMenu] = useState<MoreMenuState | null>(null);
  const [posterDialogOpen, setPosterDialogOpen] = useState(false);
  const [posterSettings, setPosterSettings] = useState<PosterSettings>(defaultPosterSettings);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const tableSortOptions = useMemo(
    () => buildTableSortSelectOptions(listKey, includeTargetOwners, showAppId, tablePriceLabel, viewMode),
    [includeTargetOwners, listKey, showAppId, tablePriceLabel, viewMode]
  );
  const posterSortModes = useMemo(
    () => buildListPosterSortModes(listKey, includeTargetOwners),
    [includeTargetOwners, listKey]
  );
  const activeTableSort = useMemo(
    () => normalizeTableSortState(tableSort, tableSortOptions),
    [tableSort, tableSortOptions]
  );
  const sortSelectValue = useMemo(() => serializeTableSortState(activeTableSort), [activeTableSort]);
  const filteredGames = useMemo(
    () => games.filter(game => matchesResultGameSearch(game, deferredSearchQuery)),
    [deferredSearchQuery, games]
  );
  const visibleGames = useMemo(
    () => sortTableGameRows(filteredGames, activeTableSort),
    [activeTableSort, filteredGames]
  );

  useEffect(() => {
    setCoverCachePaths({});
    setCoverCacheFailedAppids({});
  }, [cacheResetKey]);

  useEffect(() => {
    if (viewMode !== "cover") {
      setViewportCoverAppids([]);
      return;
    }

    const root = coverScrollViewportRef.current;
    if (!root) {
      setViewportCoverAppids(visibleGames.slice(0, 30).map(game => game.appid));
      return;
    }

    let timer = 0;
    const syncVisibleAppids = () => {
      const grid = root.querySelector<HTMLElement>(".game-card-grid");
      const firstCard = grid?.querySelector<HTMLElement>(".game-card");
      if (!grid || !firstCard) {
        setViewportCoverAppids([]);
        return;
      }

      const styles = window.getComputedStyle(grid);
      const gap = Number.parseFloat(styles.rowGap || styles.gap || "0") || 0;
      const cardWidth = firstCard.offsetWidth || 156;
      const cardHeight = firstCard.offsetHeight || Math.round(cardWidth * 1.5);
      const rowHeight = Math.max(1, cardHeight + gap);
      const columnCount = Math.max(1, Math.floor((grid.clientWidth + gap) / (cardWidth + gap)));
      const overscanRows = 2;
      const startRow = Math.max(0, Math.floor(root.scrollTop / rowHeight) - overscanRows);
      const endRow = Math.ceil((root.scrollTop + root.clientHeight) / rowHeight) + overscanRows;
      const startIndex = startRow * columnCount;
      const endIndex = Math.min(visibleGames.length, endRow * columnCount);
      const next = visibleGames.slice(startIndex, endIndex).map(game => game.appid);
      setViewportCoverAppids(current => current.length === next.length && current.every((appid, index) => appid === next[index]) ? current : next);
    };
    const scheduleSync = (delay = 160) => {
      if (timer) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = 0;
        syncVisibleAppids();
      }, delay);
    };

    const handleScroll = () => scheduleSync();
    const resizeObserver = new ResizeObserver(() => scheduleSync(80));
    resizeObserver.observe(root);
    root.addEventListener("scroll", handleScroll, { passive: true });
    scheduleSync(0);
    return () => {
      resizeObserver.disconnect();
      root.removeEventListener("scroll", handleScroll);
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [viewMode, visibleGames]);

  useEffect(() => {
    const coverRequests = new Map<string, { appid: string; url: string }>();
    const queueCover = (game: ResultGameRow) => {
      if (coverCachePaths[game.appid] || coverCacheFailedAppids[game.appid]) {
        return;
      }
      coverRequests.set(game.appid, {
        appid: game.appid,
        url: game.coverUrl ? getSteamCoverUrl(game, coverReloadTokens[game.appid] || 0) : ""
      });
    };
    if (viewMode !== "cover" || !viewportCoverAppids.length) {
      return;
    }
    const viewportAppids = new Set(viewportCoverAppids);
    visibleGames.filter(game => viewportAppids.has(game.appid)).forEach(queueCover);
    const covers = Array.from(coverRequests.values());
    if (!covers.length) {
      return;
    }

    let disposed = false;
    void cacheCovers(settings, covers)
      .then(result => {
        if (disposed) {
          return;
        }
        if (result.covers.length) {
          setCoverCachePaths(current => {
            const next = { ...current };
            for (const cover of result.covers) {
              next[cover.appid] = cover.filePath;
            }
            return next;
          });
        }
        const cachedAppids = new Set(result.covers.map(cover => cover.appid));
        const failedAppids = covers
          .map(cover => cover.appid)
          .filter(appid => !cachedAppids.has(appid));
        if (failedAppids.length) {
          setCoverCacheFailedAppids(current => {
            const now = Date.now();
            const next = { ...current };
            for (const appid of failedAppids) {
              next[appid] = now;
            }
            return next;
          });
        }
      })
      .catch(error => {
        if (!disposed) {
          const now = Date.now();
          setCoverCacheFailedAppids(current => {
            const next = { ...current };
            for (const cover of covers) {
              next[cover.appid] = now;
            }
            return next;
          });
          console.warn("封面后台缓存失败", error);
        }
      });

    return () => {
      disposed = true;
    };
  }, [coverCacheFailedAppids, coverCachePaths, coverReloadTokens, settings, viewMode, viewportCoverAppids, visibleGames]);

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

  useEffect(() => {
    if (!posterDialogOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPosterDialogOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [posterDialogOpen]);

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
    const reloadToken = Date.now();
    setCoverCachePaths(current => {
      const next = { ...current };
      delete next[game.appid];
      return next;
    });
    setCoverCacheFailedAppids(current => {
      const next = { ...current };
      delete next[game.appid];
      return next;
    });
    setCoverReloadTokens(tokens => ({
      ...tokens,
      [game.appid]: reloadToken
    }));
    setGameContextMenu(null);
    void cacheCovers(settings, [{
      appid: game.appid,
      url: getSteamCoverUrl(game, reloadToken),
      force: true
    }])
      .then(result => {
        const cover = result.covers.find(item => item.appid === game.appid);
        if (cover) {
          setCoverCachePaths(current => ({
            ...current,
            [game.appid]: cover.filePath
          }));
          return;
        }
        if (result.warnings.length) {
          onMessage(`封面失败：${result.warnings[0]}`);
        }
      })
      .catch(error => {
        onMessage(error instanceof Error ? error.message : String(error));
      });
  }

  function handleReloadCurrentListCovers() {
    if (!visibleGames.length) {
      onMessage("没有封面");
      setMoreMenu(null);
      return;
    }

    const reloadToken = Date.now();
    const appids = new Set(visibleGames.map(game => game.appid));
    setMoreMenu(null);
    setCoverCachePaths(current => {
      const next = { ...current };
      for (const appid of appids) {
        delete next[appid];
      }
      return next;
    });
    setCoverCacheFailedAppids(current => {
      const next = { ...current };
      for (const appid of appids) {
        delete next[appid];
      }
      return next;
    });
    setCoverReloadTokens(current => {
      const next = { ...current };
      for (const appid of appids) {
        next[appid] = reloadToken;
      }
      return next;
    });

    void cacheCovers(settings, visibleGames.map(game => ({
      appid: game.appid,
      url: game.coverUrl ? getSteamCoverUrl(game, reloadToken) : "",
      force: true
    })))
      .then(result => {
        if (result.covers.length) {
          setCoverCachePaths(current => {
            const next = { ...current };
            for (const cover of result.covers) {
              next[cover.appid] = cover.filePath;
            }
            return next;
          });
        }
        if (result.warnings.length) {
          onMessage(`部分失败：${result.warnings[0]}`);
          return;
        }
        onMessage(`已重载 ${result.covers.length} / ${visibleGames.length}`);
      })
      .catch(error => {
        onMessage(error instanceof Error ? error.message : String(error));
      });
  }

  function handleMoreMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMoreMenu(current => current ? null : {
      x: Math.max(12, Math.min(rect.right - 190, window.innerWidth - 206)),
      y: Math.min(rect.bottom + 8, window.innerHeight - 220)
    });
  }

  function handleTableSort(columnKey: string) {
    const direction: TableSortDirection = activeTableSort.key === columnKey && activeTableSort.direction === "asc" ? "desc" : "asc";
    onTableSortChange({ key: columnKey, direction });
  }

  function handleSortSelectChange(value: string | null) {
    onTableSortChange(parseTableSortSelectValue(value));
  }

  async function handleCopyCurrentList() {
    await writeClipboard(formatGameListText(visibleGames));
    onMessage(`已复制 ${visibleGames.length} 个`);
  }

  async function handleCopyGameNames() {
    await writeClipboard(formatGameNamesText(visibleGames));
    onMessage(`已复制 ${visibleGames.length} 个`);
  }

  function handleOpenListPosterDialog() {
    if (!visibleGames.length) {
      onMessage("没有封面");
      setMoreMenu(null);
      return;
    }
    setMoreMenu(null);
    setPosterSettings(current => normalizePosterSettings(current, posterSortModes));
    setPosterDialogOpen(true);
  }

  function handlePosterSettingsChange(settings: PosterSettings) {
    setPosterSettings(normalizePosterSettings(settings, posterSortModes));
  }

  async function handleSaveListPoster(nextPosterSettings: PosterSettings) {
    const normalizedSettings = normalizePosterSettings(nextPosterSettings, posterSortModes);
    setPosterSettings(normalizedSettings);
    setPosterDialogOpen(false);
    const outputPath = await selectSavePath({
      defaultPath: buildGameCoverPosterFilename(listLabel, normalizedSettings),
      filters: [{ name: "PNG 图片", extensions: ["png"] }]
    });
    if (!outputPath) {
      return;
    }

    onMessage("整理封面");
    const result = await cacheCovers(settings, visibleGames.map(game => ({
      appid: game.appid,
      url: game.coverUrl ? getSteamCoverUrl(game, coverReloadTokens[game.appid] || 0) : ""
    })));
    const nextCoverPaths = { ...coverCachePaths };
    for (const cover of result.covers) {
      nextCoverPaths[cover.appid] = cover.filePath;
    }
    if (result.covers.length) {
      setCoverCachePaths(nextCoverPaths);
    }

    onMessage("生成图片");
    const coverUrlsByAppid = Object.fromEntries(visibleGames.map(game => [
      game.appid,
      nextCoverPaths[game.appid] ? getSteamCoverUrl(game, coverReloadTokens[game.appid] || 0, nextCoverPaths[game.appid]) : ""
    ]));
    const dataUrl = await renderGameCoverPoster({
      games: visibleGames,
      listLabel,
      coverUrlsByAppid,
      settings: normalizedSettings
    });
    await savePngFile(ensurePngFilePath(outputPath), dataUrl);
    onMessage(result.warnings.length
      ? `已保存 ${visibleGames.length} 个，部分缺图`
      : `已保存 ${visibleGames.length} 个`);
  }

  return (
    <section className="result-games-pane">
      <div className="game-list-head">
        {toolbarStart ? (
          <div className="game-list-tab-row">
            {toolbarStart}
          </div>
        ) : null}
        <div className="game-list-tools">
          <InlineSegmentedControl
            className="game-view-toggle"
            value={viewMode}
            options={[
              { value: "cover", label: "封面" },
              { value: "table", label: "表格" }
            ]}
            onChange={value => onViewModeChange(value as ResultGameViewMode)}
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
            onChange={event => onSearchQueryChange(event.currentTarget.value)}
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
          <ScrollArea className="game-scroll" viewportRef={coverScrollViewportRef}>
            <div className="game-card-grid">
              {visibleGames.map(game => (
                <GameCard
                  key={game.appid}
                  game={game}
                  listKey={listKey}
                  showAppId={showAppId}
                  coverReloadToken={coverReloadTokens[game.appid] || 0}
                  coverCachePath={coverCachePaths[game.appid] || ""}
                  onContextMenu={handleGameContextMenu}
                />
              ))}
            </div>
          </ScrollArea>
        ) : (
          <GameTable
            games={visibleGames}
            listKey={listKey}
            includeTargetOwners={includeTargetOwners}
            showAppId={showAppId}
            priceLabel={tablePriceLabel}
            sort={activeTableSort}
            coverReloadTokens={coverReloadTokens}
            coverCachePaths={coverCachePaths}
            onSort={handleTableSort}
            onContextMenu={handleGameContextMenu}
          />
        )
      ) : (
        <ScrollArea className="game-scroll">
          <Text c="dimmed" p="md">没有匹配的游戏</Text>
        </ScrollArea>
      )}

      {gameContextMenu ? (
        <GameContextMenu
          state={gameContextMenu}
          onOpenWebpage={game => {
            setGameContextMenu(null);
            void openSteamStorePage(game.appid, game.storeLink);
          }}
          onRefreshCover={handleRefreshCover}
        />
      ) : null}
      {moreMenu ? (
        <ResultMoreMenu
          state={moreMenu}
          showAppId={showAppId}
          onToggleAppId={() => onShowAppIdChange(!showAppId)}
          onReloadCovers={handleReloadCurrentListCovers}
          onSaveListPoster={handleOpenListPosterDialog}
          onCopyList={() => void handleCopyCurrentList().catch(error => onMessage(String(error))).finally(() => setMoreMenu(null))}
          onCopyNames={() => void handleCopyGameNames().catch(error => onMessage(String(error))).finally(() => setMoreMenu(null))}
          onCopyReport={onCopyReport ? () => void onCopyReport().catch(error => onMessage(String(error))).finally(() => setMoreMenu(null)) : undefined}
        />
      ) : null}
      {posterDialogOpen ? (
        <ListPosterDialog
          settings={normalizePosterSettings(posterSettings, posterSortModes)}
          sortModes={posterSortModes}
          listLabel={listLabel}
          gameCount={visibleGames.length}
          busy={busy}
          onSettingsChange={handlePosterSettingsChange}
          onClose={() => setPosterDialogOpen(false)}
          onConfirm={settings => void handleSaveListPoster(settings).catch(error => onMessage(error instanceof Error ? error.message : String(error)))}
        />
      ) : null}
    </section>
  );
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

function ListPosterDialog({
  settings,
  sortModes,
  listLabel,
  gameCount,
  busy,
  onSettingsChange,
  onClose,
  onConfirm
}: {
  settings: PosterSettings;
  sortModes: PosterSortMode[];
  listLabel: string;
  gameCount: number;
  busy: boolean;
  onSettingsChange: (settings: PosterSettings) => void;
  onClose: () => void;
  onConfirm: (settings: PosterSettings) => void;
}) {
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [draftColumns, setDraftColumns] = useState<number | null>(null);
  const [draftScalePercent, setDraftScalePercent] = useState<number | null>(null);
  const columnsTrackRef = useRef<HTMLDivElement | null>(null);
  const scaleTrackRef = useRef<HTMLDivElement | null>(null);
  const normalizedSettings = normalizePosterSettings(settings, sortModes);

  const columns = draftColumns ?? normalizedSettings.columns;
  const scalePercent = draftScalePercent ?? normalizedSettings.scalePercent;

  function commitColumns(value: number) {
    setDraftColumns(null);
    onSettingsChange({
      ...normalizedSettings,
      columns: normalizePosterColumns(value)
    });
  }

  function commitScalePercent(value: number) {
    setDraftScalePercent(null);
    onSettingsChange({
      ...normalizedSettings,
      scalePercent: normalizePosterScalePercent(value)
    });
  }

  function changeSortMode(sortMode: PosterSortMode) {
    onSettingsChange({
      ...normalizedSettings,
      sortMode
    });
    setSortMenuOpen(false);
  }

  function updateSliderFromPointer(
    ref: RefObject<HTMLDivElement | null>,
    clientX: number,
    min: number,
    max: number,
    onDraft: (value: number) => void
  ) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      return;
    }
    const progress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onDraft(Math.round(min + progress * (max - min)));
  }

  function handleSliderPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    ref: RefObject<HTMLDivElement | null>,
    min: number,
    max: number,
    onDraft: (value: number) => void,
    onCommit: (value: number) => void
  ) {
    event.preventDefault();
    (ref.current as HTMLElement | null)?.setPointerCapture(event.pointerId);
    let lastValue = 0;
    updateSliderFromPointer(ref, event.clientX, min, max, (v) => { lastValue = v; onDraft(v); });
    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      updateSliderFromPointer(ref, moveEvent.clientX, min, max, (v) => { lastValue = v; onDraft(v); });
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      onCommit(lastValue);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function handleColumnsKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      commitColumns(columns - 1);
    }
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      commitColumns(columns + 1);
    }
    if (event.key === "Home") {
      event.preventDefault();
      commitColumns(1);
    }
    if (event.key === "End") {
      event.preventDefault();
      commitColumns(50);
    }
  }

  function handleScaleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const current = draftScalePercent ?? normalizedSettings.scalePercent;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      commitScalePercent(current - 5);
    }
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      commitScalePercent(current + 5);
    }
    if (event.key === "Home") {
      event.preventDefault();
      commitScalePercent(40);
    }
    if (event.key === "End") {
      event.preventDefault();
      commitScalePercent(100);
    }
  }

  return (
    <div className="poster-dialog-overlay" role="presentation">
      <button className="poster-dialog-backdrop" type="button" aria-label="关闭封面图设置" onClick={onClose} />
      <section className="poster-dialog" role="dialog" aria-modal="true" aria-label="游戏封面图设置">
        <header className="poster-dialog-head">
          <div>
            <strong>游戏封面图设置</strong>
            <span>{listLabel} / {gameCount} 款游戏</span>
          </div>
          <button className="poster-dialog-close" type="button" aria-label="关闭" onClick={onClose}>
            <PosterControlIcon type="close" />
          </button>
        </header>

        <div className="poster-dialog-body">
          <label className="poster-field">
            <span>每行列数</span>
            <div className="poster-slider-row">
              <div
                ref={columnsTrackRef}
                className="poster-slider"
                role="slider"
                tabIndex={0}
                aria-label="每行列数"
                aria-valuemin={1}
                aria-valuemax={50}
                aria-valuenow={columns}
                aria-valuetext={`${columns} 列`}
                onPointerDown={event => handleSliderPointerDown(event, columnsTrackRef, 1, 50, setDraftColumns, commitColumns)}
                onKeyDown={handleColumnsKeyDown}
              >
                <span
                  className="poster-slider-fill"
                  style={{ width: `${((columns - 1) / 49) * 100}%` }}
                />
                <span
                  className="poster-slider-thumb"
                  style={{ left: `${((columns - 1) / 49) * 100}%` }}
                />
              </div>
              <strong>{columns}</strong>
            </div>
          </label>

          <label className="poster-field">
            <span>排序方式</span>
            <div className={`poster-sort-wrap ${sortMenuOpen ? "is-open" : ""}`}>
              <button
                className="poster-sort-select"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={sortMenuOpen}
                onClick={() => setSortMenuOpen(open => !open)}
              >
                {getPosterSortModeLabel(normalizedSettings.sortMode)}
              </button>
              {sortMenuOpen ? (
                <div className="poster-sort-menu" role="listbox">
                  {sortModes.map(mode => (
                    <button
                      key={mode}
                      type="button"
                      role="option"
                      aria-selected={mode === normalizedSettings.sortMode}
                      className={mode === normalizedSettings.sortMode ? "is-active" : ""}
                      onClick={() => changeSortMode(mode)}
                    >
                      {getPosterSortModeLabel(mode)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </label>

          <label className="poster-field">
            <span>尺寸缩放</span>
            <div className="poster-slider-row">
              <div
                ref={scaleTrackRef}
                className="poster-slider"
                role="slider"
                tabIndex={0}
                aria-label="尺寸缩放"
                aria-valuemin={40}
                aria-valuemax={100}
                aria-valuenow={scalePercent}
                aria-valuetext={`${scalePercent}%`}
                onPointerDown={event => handleSliderPointerDown(event, scaleTrackRef, 40, 100, setDraftScalePercent, commitScalePercent)}
                onKeyDown={handleScaleKeyDown}
              >
                <span
                  className="poster-slider-fill"
                  style={{ width: `${((scalePercent - 40) / 60) * 100}%` }}
                />
                <span
                  className="poster-slider-thumb"
                  style={{ left: `${((scalePercent - 40) / 60) * 100}%` }}
                />
              </div>
              <strong>{scalePercent}%</strong>
            </div>
          </label>
        </div>

        <footer className="poster-dialog-actions">
          <button className="poster-dialog-reset" type="button" disabled={busy} onClick={() => onSettingsChange(defaultPosterSettings)}>重置</button>
          <button className="poster-dialog-secondary" type="button" onClick={onClose}>取消</button>
          <button className="poster-dialog-primary" type="button" disabled={busy} onClick={() => onConfirm(normalizedSettings)}>
            生成图片
          </button>
        </footer>
      </section>
    </div>
  );
}

function ensurePngFilePath(path: string): string {
  return /\.png$/i.test(path) ? path : `${path}.png`;
}
