import { ScrollArea, Text, Tooltip } from "@mantine/core";
import type { MetricTooltipRow } from "../../appTypes";

export function Metric({
  label,
  value,
  tooltipRows
}: {
  label: string;
  value: string;
  tooltipRows: MetricTooltipRow[];
}) {
  const content = (
    <div className="metric-cell">
      <Text size="xs" c="dimmed" fw={700}>{label}</Text>
      <Text className="metric-value">{value}</Text>
    </div>
  );

  if (tooltipRows.length <= 1) {
    return content;
  }

  return (
    <Tooltip label={<MetricTooltip rows={tooltipRows} />} multiline w={220} withArrow>
      {content}
    </Tooltip>
  );
}

function MetricTooltip({ rows }: { rows: MetricTooltipRow[] }) {
  return (
    <ScrollArea className="metric-tooltip" type="always" scrollbarSize={8}>
      <div className="metric-tooltip-list">
        {rows.map(row => (
          <div key={`${row.label}-${row.value}`} className="metric-tooltip-row">
            <span title={row.label}>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
