/**
 * Basicx's registration.
 *
 * The only place a skin is wired into the app: the registry imports this, and
 * nothing else imports it directly.
 */

import BasicxSkin from "./BasicxSkin";
import { basicxTheme } from "./theme";
import { BASICX_OPTION_SPECS } from "./options";
import type { SkinDefinition } from "@/skins/types";

export const basicxSkin: SkinDefinition = {
  id: "basicx",
  label: "Basicx",
  options: BASICX_OPTION_SPECS,
  theme: basicxTheme,
  Home: BasicxSkin,
  Artwork: BasicxSkin,
  // Present only so a test can prove the registry falls back; not a real skin.
};

export { basicxTheme } from "./theme";
export { BASICX_OPTION_SPECS } from "./options";
export type { BasicxOptions } from "./options";
