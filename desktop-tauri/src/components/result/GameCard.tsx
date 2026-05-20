import { memo } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type { ResultGameListKey, ResultGameRow } from "../../appTypes";
import { openSteamStorePage } from "../../core/external";
import {
  formatFamilyAcquiredAt,
  formatPrice,
  getGameCardOwnerTags,
  getReportGameStatusLabel,
  getSteamCoverUrl
} from "../../core/report";
import { OwnerTagList, StatusTag } from "./OwnerTags";

export const GameCard = memo(function GameCard({
  game,
  listKey,
  showAppId,
  coverReloadToken,
  coverCachePath,
  onContextMenu
}: {
  game: ResultGameRow;
  listKey: ResultGameListKey;
  showAppId: boolean;
  coverReloadToken: number;
  coverCachePath: string;
  onContextMenu: (event: MouseEvent<HTMLElement>, game: ResultGameRow) => void;
}) {
  const shouldShowStatusTag = listKey === "all" && getReportGameStatusLabel(game.status) !== "-";
  const acquiredAtText = listKey === "relativeNew" ? formatFamilyAcquiredAt(game.familyAcquiredAt) : "-";
  const shouldShowAcquiredAt = acquiredAtText !== "-";
  const priceText = formatPrice(game.price);
  const hasTopLeftBadge = shouldShowStatusTag || shouldShowAcquiredAt;
  return (
    <a
      className="game-card"
      data-game-appid={game.appid}
      href={game.storeLink}
      onClick={event => {
        event.preventDefault();
        void openSteamStorePage(game.appid, game.storeLink);
      }}
      onContextMenu={event => onContextMenu(event, game)}
      style={{ "--game-cover": `url("${getSteamCoverUrl(game, coverReloadToken, coverCachePath)}")` } as CSSProperties}
      aria-label={game.name}
      title={game.name}
    >
      <span className="game-card-media">
        {shouldShowStatusTag ? <span className="game-card-status-tag"><StatusTag status={game.status} /></span> : null}
        {shouldShowAcquiredAt ? <span className="game-card-date-tag">{acquiredAtText}</span> : null}
        {priceText !== "-" ? <span className="game-card-price-tag">{priceText}</span> : null}
        {showAppId ? <span className={`game-card-chip ${hasTopLeftBadge ? "has-top-left-badge" : ""}`}>ID {game.appid}</span> : null}
        <span className="game-card-overlay">
          <span className="game-card-title">{game.name}</span>
          <OwnerTagList owners={getGameCardOwnerTags(game, listKey)} className="game-card-owner-tags" />
        </span>
      </span>
    </a>
  );
});
