/**
 * Renders a collection's public view in its skin.
 *
 * This is the whole of the skin boundary in the running app: the shell has
 * loaded the data and decided what is visible, and everything past this
 * component is presentation the skin owns outright.
 *
 * ## The scope class is the isolation mechanism
 *
 * `MantineProvider`'s `cssVariablesSelector` defaults to `:root` (verified in
 * `@mantine/core@9`), so a nested provider with a different theme overwrites the
 * *whole application's* `--mantine-*` variables for as long as it is mounted.
 * A skin's type scale and control styling would then apply to `/manage` too.
 * Pointing the selector at a class on a wrapper element emits the variables onto
 * that subtree instead, which is the difference between a theme that is
 * isolated and one that merely happens not to collide today.
 *
 * The cost is the rule already documented on `SkinDefinition`: a skin may not
 * use a portaled Mantine component, because `document.body` is outside the
 * scope and would fall back to the app theme. `Modal`, `Drawer`, `Menu`,
 * `Popover`, `Select`, `Combobox`, `Tooltip` and `Notifications` are all
 * excluded; everything Basicx uses is not.
 */

import React from "react";
import { MantineProvider } from "@mantine/core";

import { resolveSkin, resolveSkinOptions } from "@/skins/registry";
import type { SkinProps, SkinView } from "@/skins/types";

/**
 * The wrapper element's class *and* the selector the provider writes to. One
 * constant because the two must agree and nothing else should know either.
 */
const SKIN_SCOPE = ".skin-scope";

interface SkinHostProps {
  view: SkinView;
  collection: SkinProps["collection"];
  artworks: SkinProps["artworks"];
  collectionPath: string;
  artworkPath: SkinProps["artworkPath"];
}

const SkinHost: React.FC<SkinHostProps> = ({
  view,
  collection,
  artworks,
  collectionPath,
  artworkPath,
}) => {
  const skin = resolveSkin(collection.skin);
  const { options } = resolveSkinOptions(skin, collection.skinOptions);
  const View = view === "artwork" ? skin.Artwork : skin.Home;

  return (
    <div className="skin-scope">
      <MantineProvider theme={skin.theme} cssVariablesSelector={SKIN_SCOPE}>
        <View
          collection={collection}
          artworks={artworks}
          view={view}
          options={options}
          collectionPath={collectionPath}
          artworkPath={artworkPath}
        />
      </MantineProvider>
    </div>
  );
};

export default SkinHost;
