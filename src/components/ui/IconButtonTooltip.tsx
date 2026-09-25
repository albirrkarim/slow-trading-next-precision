import { IconButton, Tooltip, type IconButtonProps, type TooltipProps } from "@mui/material";

export interface IconButtonTooltipProps extends IconButtonProps {
  tooltipMaxWidth?: number;
  tooltipTitle?: TooltipProps["title"];
}

export default function IconButtonTooltip({
  tooltipMaxWidth,
  tooltipTitle,
  ...iconButtonProps
}: IconButtonTooltipProps) {
  if (!tooltipTitle) {
    return <IconButton component="div" {...iconButtonProps} />;
  }

  return (
    <Tooltip
      title={tooltipTitle}
      arrow
      placement="bottom-start"
      slotProps={
        tooltipMaxWidth
          ? {
              tooltip: {
                sx: {
                  maxWidth: `min(${tooltipMaxWidth}px, calc(100vw - 32px))`,
                },
              },
            }
          : undefined
      }
    >
      <span> {/* Ensures Tooltip works if IconButton is disabled */}
        <IconButton component="div" aria-label={tooltipTitle} {...iconButtonProps} />
      </span>
    </Tooltip>
  );
}
