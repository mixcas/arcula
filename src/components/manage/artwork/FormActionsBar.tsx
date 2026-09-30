/**
 * The fixed Save/Cancel bar both artwork forms end in.
 *
 * The two forms are 350 and 455 lines of fields, and on a laptop the last of
 * them — `currentValue` — is below the fold. A form whose Save button is only
 * reachable by scrolling to the bottom of it is a form people stop trusting, so
 * the actions are pinned.
 *
 * ## Why this is not `AppShell.Footer`
 *
 * `ManageLayout` is an `AppShell` shared by every `/manage` route, so a footer
 * there would put Save and Cancel on the collection page, the settings page and
 * the import too. A bar the two forms choose to render is one line in each
 * file and cannot appear anywhere it has no meaning.
 *
 * ## Why `BAR_HEIGHT` is exported
 *
 * The bar is `position: fixed`, so it occupies no space in the flow and would
 * otherwise sit permanently on top of the last field and the error alerts. The
 * forms add `BAR_HEIGHT` of bottom padding to make room. Two numbers that must
 * agree are one exported constant — see the `paddingBottom` use in
 * `ArtworkAddPage` and `ArtworkEditPage`.
 *
 * The padding is the reason the error alerts stay in the form flow instead of
 * moving into the bar: they are content, they can be three lines tall, and
 * squeezing them into a 60px strip would truncate the message that matters.
 */
import React from "react";
import { Box, Button, Group } from "@mantine/core";
import { Link } from "react-router-dom";

/**
 * Height of the bar, and the bottom padding each form adds to clear it.
 *
 * 60px is the 40px button plus the 10px above and below (`sm` in this theme's
 * spacing scale). It must not change without both call sites being re-checked.
 */
export const BAR_HEIGHT = 60;

/**
 * Below Mantine's modal (200) and notifications (400), so a confirm dialog or
 * a toast is never hidden behind the bar it was raised over. Copied from
 * `--mantine-z-index-*` rather than hardcoded higher, because a modal opened
 * *from* this bar — the artwork table's delete dialog is not one, but a future
 * "discard changes?" prompt would be — has to sit above it.
 */
const BAR_Z = 100;

interface FormActionsBarProps {
  /**
   * The submit button's label. It says what will happen, so the two forms do
   * not read the same: one creates, one saves changes.
   */
  submitLabel: string;
  /** Mirrors `form.submitting`; the button is the busy indicator. */
  submitting: boolean;
  /** Where Cancel goes. A link, not a handler, so it is a real destination. */
  cancelTo: string;
}

const FormActionsBar: React.FC<FormActionsBarProps> = ({
  submitLabel,
  submitting,
  cancelTo,
}) => (
  <Box
    pos="fixed"
    bottom={0}
    left={0}
    right={0}
    h={BAR_HEIGHT}
    px="lg"
    // The app theme is dark, and a translucent bar would show the page scrolling
    // under it — including the text of the field being edited.
    bg="var(--mantine-color-body)"
    style={{
      zIndex: BAR_Z,
      borderTop: "1px solid var(--mantine-color-default-border)",
    }}
  >
    <Group h="100%" justify="flex-end">
      <Button type="submit" loading={submitting}>
        {submitLabel}
      </Button>
      <Button component={Link} to={cancelTo} variant="outline">
        Cancel
      </Button>
    </Group>
  </Box>
);

export default FormActionsBar;
