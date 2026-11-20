/**
 * Renders a public view in its skin.
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
 *
 * ## Two document shapes, one boundary
 *
 * A Catalogue page hands over the document and its own address. A Selection has
 * no Catalogue document to hand over: it renders in its source Catalogue's
 * **presentation** (`skin`, `skinOptions`) and its own address, and it must not
 * receive a path to the Catalogue at all. The props are therefore a union on
 * `view`, so the selection branch cannot accidentally link a Catalogue that may
 * be private or gone.
 */

import React from "react";
import { MantineProvider } from "@mantine/core";

import type { Catalogue } from "@arcula/shared";
import { resolveSkin, resolveSkinOptions } from "@/skins/registry";
import type { SkinOptions, SkinProps, SkinSubject } from "@/skins/types";

/**
 * The wrapper element's class *and* the selector the provider writes to. One
 * constant because the two must agree and nothing else should know either.
 */
const SKIN_SCOPE = ".skin-scope";

interface CatalogueHostProps {
  view: "home" | "artwork";
  /**
   * What the skin presents. The shell builds it from the document it loaded —
   * the Catalogue's name and optional description.
   */
  subject: SkinSubject;
  catalogue: Catalogue;
  artworks: SkinProps["artworks"];
  cataloguePath: string;
  artworkPath: SkinProps["artworkPath"];
}

interface SelectionHostProps {
  view: "selection";
  /**
   * The Selection's own name and description, with its source Catalogue's name
   * as the credit line. Never the Catalogue document.
   */
  subject: SkinSubject;
  artworks: SkinProps["artworks"];
  /** The canonical public path of the Selection, for its own links. */
  selectionPath: string;
  artworkPath: SkinProps["artworkPath"];
  /**
   * The source Catalogue's stored skin and raw option bag. Resolved here
   * through the same registry a Catalogue's page uses, so a Selection renders
   * in the Catalogue's presentation without carrying a document for it.
   */
  skin?: string;
  skinOptions?: SkinOptions;
}

export type SkinHostProps = CatalogueHostProps | SelectionHostProps;

const SkinHost: React.FC<SkinHostProps> = (props) => {
  if (props.view === "selection") {
    const skin = resolveSkin(props.skin);
    const { options } = resolveSkinOptions(skin, props.skinOptions);

    return (
      <div className="skin-scope">
        <MantineProvider theme={skin.theme} cssVariablesSelector={SKIN_SCOPE}>
          <skin.Selection
            view="selection"
            subject={props.subject}
            artworks={props.artworks}
            options={options}
            selectionPath={props.selectionPath}
            artworkPath={props.artworkPath}
          />
        </MantineProvider>
      </div>
    );
  }

  const { catalogue } = props;
  const skin = resolveSkin(catalogue.skin);
  const { options } = resolveSkinOptions(skin, catalogue.skinOptions);

  // Shared props, then the view's own. Written as two elements rather than a
  // variable holding the component: the slots are typed to their own member
  // of the `SkinProps` union, so the branch is also what tells the compiler
  // which `view` literal matches which component.
  const shared = {
    subject: props.subject,
    artworks: props.artworks,
    options,
    artworkPath: props.artworkPath,
  };

  return (
    <div className="skin-scope">
      <MantineProvider theme={skin.theme} cssVariablesSelector={SKIN_SCOPE}>
        {props.view === "artwork" ? (
          <skin.Artwork
            {...shared}
            view="artwork"
            catalogue={catalogue}
            cataloguePath={props.cataloguePath}
          />
        ) : (
          <skin.Home
            {...shared}
            view="home"
            catalogue={catalogue}
            cataloguePath={props.cataloguePath}
          />
        )}
      </MantineProvider>
    </div>
  );
};

export default SkinHost;
