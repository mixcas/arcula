import React, { useState } from "react";
import { Box, Text, Textarea, TextInput } from "@mantine/core";

interface EditableCellProps {
  /** The committed value for this cell. */
  value: string;
  /** Multi-line fields (notes) get a textarea. */
  multiline?: boolean;
  /**
   * The live validation message for this cell, e.g. "Artist name is required".
   * `undefined` means the cell is fine. When set, the cell is framed in red
   * and the message is shown beneath the value.
   */
  errorMessage?: string;
  /** Extra line under the value, e.g. "converted from 03/04/2024". */
  hint?: string;
  /** Called with the new value when the inline edit is committed. */
  onCommit: (value: string) => void;
}

/**
 * Click-to-edit table cell for the review step.
 *
 * Renders a plain, clickable text node by default so the datatable stays
 * light; clicking swaps in a text input (or textarea for multiline fields)
 * that commits on Enter/blur and cancels on Escape. The draft is local state,
 * so typing never re-renders the parent or the datatable — only a commit
 * bubbles up through `onCommit`.
 *
 * Cells with an `errorMessage` get a red dashed frame, bold red value (an
 * empty value stays the "—" dash but is now impossible to miss inside the
 * frame) and the message text itself, so a failing required field like an
 * empty `artistName` announces itself instead of hiding behind a lone dash.
 */
const EditableCell: React.FC<EditableCellProps> = ({
  value,
  multiline = false,
  errorMessage,
  hint,
  onCommit,
}) => {
  const [editing, setEditing] = useState(false);
  // Local draft while editing; seeded from the committed value only when an
  // edit starts, so a commit that happens in another cell cannot clobber the
  // draft being typed here.
  const [draft, setDraft] = useState("");

  if (editing) {
    const commit = () => {
      setEditing(false);
      onCommit(draft);
    };
    const cancel = () => {
      setEditing(false);
      setDraft("");
    };

    const sharedProps = {
      value: draft,
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => setDraft(e.currentTarget.value),
      onBlur: commit,
      // Mantine draws its own red ring + inline message while editing, so the
      // fix target stays just as obvious in the input as it was in the cell.
      error: errorMessage || undefined,
      autoFocus: true,
      onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        e.currentTarget.select(),
      styles: { root: { minWidth: 140 } },
    };

    if (multiline) {
      return (
        <Textarea
          {...sharedProps}
          minRows={2}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter commits a textarea; Enter alone inserts a newline.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              cancel();
            }
          }}
        />
      );
    }

    return (
      <TextInput
        {...sharedProps}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            cancel();
          }
        }}
      />
    );
  }

  return (
    <Box
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      style={{
        cursor: "text",
        minWidth: 60,
        // An errored cell becomes its own red region (frame + wash + bold red
        // text) so it is visible even when—especially when—the value is empty
        // and all that's left to display is the "—" dash.
        ...(errorMessage
          ? {
              background: "var(--mantine-color-red-0)",
              border: "1px dashed var(--mantine-color-red-6)",
              borderRadius: 4,
              padding: "2px 6px",
            }
          : undefined),
      }}
      aria-label={value || "empty value, click to edit"}
    >
      <Text
        size="sm"
        c={errorMessage ? "red" : value ? undefined : "dimmed"}
        fw={errorMessage ? 600 : undefined}
      >
        {value || "—"}
      </Text>
      {errorMessage ? (
        <Text size="xs" c="red" fw={500}>
          {errorMessage}
        </Text>
      ) : null}
      {hint ? (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      ) : null}
    </Box>
  );
};

export default EditableCell;
