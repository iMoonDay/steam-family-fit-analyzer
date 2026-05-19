import type { CSSProperties } from "react";
import type { OwnerTagItem } from "../../appTypes";
import type { ReportGameStatus } from "../../types";
import { getOwnerTagHue, getReportGameStatusLabel } from "../../core/report";

export function OwnerTagList({ owners, className = "" }: { owners: OwnerTagItem[]; className?: string }) {
  if (!owners.length) {
    return "-";
  }

  return (
    <span className={`owner-tag-list ${className}`}>
      {owners.map(owner => (
        <span
          key={`${owner.id}-${owner.label}`}
          className="owner-tag"
          style={{ "--owner-tag-hue": getOwnerTagHue(owner.id || owner.label) } as CSSProperties}
          title={owner.id && owner.id !== owner.label ? owner.id : undefined}
        >
          {owner.label}
        </span>
      ))}
    </span>
  );
}

export function StatusTag({ status }: { status: ReportGameStatus }) {
  const label = getReportGameStatusLabel(status);
  if (label === "-") {
    return label;
  }

  return (
    <span className={`status-tag status-tag-${status}`}>
      {label}
    </span>
  );
}
