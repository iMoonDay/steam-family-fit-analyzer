import { ActionIcon, Group, Stack, Text, Tooltip } from "@mantine/core";
import { HelpIcon } from "./icons";
import { helpLinks, type HelpLinkKey } from "../core/help";

export function FieldLabel({ label, helpKey, onOpenHelp }: {
  label: string;
  helpKey: HelpLinkKey;
  onOpenHelp: (url: string) => void;
}) {
  const help = helpLinks[helpKey];
  const ariaLabel = help.steps.join(" ");
  return (
    <Group gap={6}>
      <span>{label}</span>
      <Tooltip label={<HelpSteps steps={help.steps} />} multiline w={340} withArrow>
        <ActionIcon
          size={18}
          radius="xl"
          variant="light"
          color="steamBlue"
          aria-label={ariaLabel}
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            onOpenHelp(help.url);
          }}
        >
          <HelpIcon />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

export function HelpSteps({ steps }: { steps: readonly string[] }) {
  return (
    <Stack gap={5}>
      {steps.map(step => (
        <Text key={step} size="xs" lh={1.45}>
          {step}
        </Text>
      ))}
    </Stack>
  );
}
