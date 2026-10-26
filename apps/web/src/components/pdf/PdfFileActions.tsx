/**
 * **Download** and **Open PDF**: the one pair of controls for a finished file.
 *
 * The viewer offers them on exactly one surface per layout — the bar on a
 * desktop, the card under it on a phone — so the pair belongs to neither and is
 * defined once here, where both can render it without either depending on the
 * other.
 */

import React from "react";
import { Button, Group } from "@mantine/core";
import { IconDownload, IconExternalLink } from "@tabler/icons-react";

const PdfFileActions: React.FC<{ url: string; fileName: string }> = ({
  url,
  fileName,
}) => (
  <Group gap="sm" wrap="nowrap">
    <Button
      component="a"
      href={url}
      download={fileName}
      leftSection={<IconDownload size={16} />}
    >
      Download
    </Button>
    <Button
      variant="light"
      leftSection={<IconExternalLink size={16} />}
      onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
    >
      Open PDF
    </Button>
  </Group>
);

export default PdfFileActions;
