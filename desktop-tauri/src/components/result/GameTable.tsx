import { ScrollArea } from "@mantine/core";
import { memo } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type { GameTableColumn, ResultGameListKey, ResultGameRow, TableSortState } from "../../appTypes";
import { openSteamStorePage } from "../../core/external";
import { formatPrice, getFamilyOwnerTags, getSteamCoverUrl, getTargetOwnerTags } from "../../core/report";
import { OwnerTagList, StatusTag } from "./OwnerTags";

export const GameTable = memo(function GameTable({
  games,
  listKey,
  includeTargetOwners,
  showAppId,
  priceLabel,
  sort,
  coverReloadTokens,
  coverCachePaths,
  onSort,
  onContextMenu
}: {
  games: ResultGameRow[];
  listKey: ResultGameListKey;
  includeTargetOwners: boolean;
  showAppId: boolean;
  priceLabel: string;
  sort?: TableSortState;
  coverReloadTokens: Record<string, number>;
  coverCachePaths: Record<string, string>;
  onSort: (columnKey: string) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>, game: ResultGameRow) => void;
}) {
  const columns = buildGameTableColumns(listKey, includeTargetOwners, showAppId, priceLabel, coverReloadTokens, coverCachePaths);
  const tableStyle = {
    "--game-table-columns": getGameTableColumnsTemplate(listKey, includeTargetOwners, showAppId)
  } as CSSProperties;

  return (
    <ScrollArea className="game-table-wrap" type="always" scrollbarSize={10}>
      <div className="game-table-frame" role="table" aria-label="游戏列表" style={tableStyle}>
        <div className="game-table-head" role="row">
          {columns.map(column => (
            <span key={column.key}>
              {column.sortable === false ? column.label : (
                <button
                  type="button"
                  className={`game-table-sort ${sort?.key === column.key ? "is-active" : ""} ${sort?.key === column.key && sort.direction === "desc" ? "is-desc" : ""}`}
                  onClick={() => onSort(column.key)}
                >
                  <span>{column.label}</span>
                  <span className="game-table-sort-indicator" aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
        </div>
        {games.map(game => (
          <a
            key={game.appid}
            className="game-table-row"
            href={game.storeLink}
            role="row"
            title={game.name}
            onClick={event => {
              event.preventDefault();
              void openSteamStorePage(game.appid, game.storeLink);
            }}
            onContextMenu={event => onContextMenu(event, game)}
          >
            {columns.map(column => (
              <span key={column.key} className={column.className}>
                {column.render(game)}
              </span>
            ))}
          </a>
        ))}
      </div>
    </ScrollArea>
  );
});

function buildGameTableColumns(
  listKey: ResultGameListKey,
  includeTargetOwners: boolean,
  showAppId: boolean,
  priceLabel: string,
  coverReloadTokens: Record<string, number>,
  coverCachePaths: Record<string, string>
): GameTableColumn[] {
  const appidColumn: GameTableColumn = {
    key: "appid",
    label: "AppID",
    className: "game-table-appid",
    render: game => game.appid
  };
  const nameColumn: GameTableColumn = {
    key: "name",
    label: "游戏",
    className: "game-table-name",
    render: game => (
      <>
        <span
          className="game-table-cover"
          style={{ "--game-cover": `url("${getSteamCoverUrl(game, coverReloadTokens[game.appid] || 0, coverCachePaths[game.appid] || "")}")` } as CSSProperties}
          aria-hidden="true"
        />
        <span className="game-table-title">{game.name}</span>
      </>
    )
  };
  const targetOwnersColumn: GameTableColumn = {
    key: "targetOwners",
    label: "拥有者",
    className: "game-table-owner-cell",
    render: game => <OwnerTagList owners={getTargetOwnerTags(game)} />
  };
  const familyOwnersColumn: GameTableColumn = {
    key: "owners",
    label: "贡献者",
    className: "game-table-owner-cell",
    render: game => <OwnerTagList owners={getFamilyOwnerTags(game)} />
  };
  const statusColumn: GameTableColumn = {
    key: "status",
    label: "状态",
    className: "game-table-status-cell",
    render: game => <StatusTag status={game.status} />
  };
  const priceColumn: GameTableColumn = {
    key: "price",
    label: priceLabel,
    className: "game-table-price",
    render: game => formatPrice(game.price)
  };

  if (listKey === "all") {
    const columns = includeTargetOwners
      ? [nameColumn, targetOwnersColumn, statusColumn]
      : [nameColumn, statusColumn];
    return showAppId ? [...columns, appidColumn] : columns;
  }
  if (listKey === "new") {
    const columns = includeTargetOwners
      ? [nameColumn, targetOwnersColumn, priceColumn]
      : [nameColumn, priceColumn];
    return showAppId ? [...columns, appidColumn] : columns;
  }
  if (listKey === "relativeNew") {
    const columns = [nameColumn, familyOwnersColumn, priceColumn];
    return showAppId ? [...columns, appidColumn] : columns;
  }
  const columns = [nameColumn, familyOwnersColumn];
  return showAppId ? [...columns, appidColumn] : columns;
}

function getGameTableColumnsTemplate(listKey: ResultGameListKey, includeTargetOwners: boolean, showAppId: boolean): string {
  if (listKey === "all" || listKey === "new") {
    if (includeTargetOwners) {
      return showAppId
        ? "minmax(0, 5fr) minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1.2fr)"
        : "minmax(0, 5fr) minmax(0, 2fr) minmax(0, 1.4fr)";
    }
    return showAppId
      ? "minmax(0, 6fr) minmax(0, 1.5fr) minmax(0, 1.2fr)"
      : "minmax(0, 6fr) minmax(0, 1.5fr)";
  }
  if (listKey === "relativeNew") {
    return showAppId
      ? "minmax(0, 5fr) minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1.2fr)"
      : "minmax(0, 5fr) minmax(0, 2fr) minmax(0, 1.4fr)";
  }
  return showAppId
    ? "minmax(0, 5fr) minmax(0, 3fr) minmax(0, 1.2fr)"
    : "minmax(0, 5fr) minmax(0, 3fr)";
}
