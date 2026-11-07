import React from "react";
import { SegmentedControl, Tooltip } from "@mantine/core";
import { IconBorderAll, IconLayoutGrid } from "@tabler/icons-react";
import type { ArtworksView } from "@/userSettings";

export interface ArtworksViewToggleProps {
  value: ArtworksView;
  onChange: (value: ArtworksView) => void;
}

/**
 * The Table / Grid switch: two icons, controlled, and nothing else.
 *
 * Icon-only is a deliberate risk — two bare glyphs say nothing to a screen
 * reader and little to a first-time click — so each segment is a `Tooltip` whose
 * label is also the radio's accessible name (`aria-label`), and the group is
 * named "Artworks manage view" by its `role="radiogroup"`. A `SegmentedControl`
 * renders a radio group, so the arrow keys and the checked state come with it.
 *
 * It holds no state: the list owns the view and this reports a click, so a
 * toggle can never disagree with what is rendered.
 */
const ArtworksViewToggle: React.FC<ArtworksViewToggleProps> = ({
  value,
  onChange,
}) => (
  <SegmentedControl
    size="xs"
    value={value}
    onChange={(next) => {
      // The control's generic is `string`; only the two values it was given
      // can come back, so this narrows rather than casts.
      onChange(next === "grid" ? "grid" : "table");
    }}
    role="radiogroup"
    aria-label="Artworks manage view"
    data={[
      {
        value: "table",
        label: (
          <Tooltip label="Table" withArrow>
            <span>
              <IconBorderAll
                size={16}
                aria-label="Table"
                style={{ display: "block" }}
              />
            </span>
          </Tooltip>
        ),
      },
      {
        value: "grid",
        label: (
          <Tooltip label="Grid" withArrow>
            <span>
              <IconLayoutGrid
                size={16}
                aria-label="Grid"
                style={{ display: "block" }}
              />
            </span>
          </Tooltip>
        ),
      },
    ]}
  />
);

export default ArtworksViewToggle;
