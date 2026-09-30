/**
 * Basicx's Mantine theme.
 *
 * Applied by a nested `MantineProvider` scoped to `.skin-scope` — see the
 * isolation note in `src/skins/types.ts`. Everything here is *presentation*: no
 * layout, no component logic.
 *
 * The numbers are the written spec rather than values eyeballed off a
 * screenshot:
 *
 *   bodycopy  1.05rem / weight 550 / line-height 1.2 / rgba(0,0,0,.85)
 *   .caption  0.8rem  / weight 450 / line-height 1.2
 *   ::part(slideshow-nav)  size 30px, inset 15px,
 *                          icon rgba(255,255,255,.9), stroke 1.5px,
 *                          background rgba(87,87,87,.35), radius 50%
 *
 * Weights and line-heights are applied at the call site (`fw={550} lh={1.2}`)
 * rather than baked into the theme, because the two roles differ in weight and
 * a theme-level default would have to be overridden in half the places it is
 * used. Only the *sizes* are theme tokens, since those are what
 * `<Text size="bodycopy">` resolves.
 */

import { Carousel } from "@mantine/carousel";
import { createTheme, rem } from "@mantine/core";
import type { MantineThemeOverride } from "@mantine/core";

/**
 * The one family Basicx uses.
 *
 * `headings.fontFamily` is set explicitly and not left to inherit: Mantine
 * deep-merges a nested theme over its parent, so without this line a `Title`
 * anywhere in the skin would pick up `BBH Bartle` from the app theme — the one
 * place a second family could leak in. It would also be the wrong family on its
 * own terms, since BBH Bartle ships a single 400 weight and a 550 heading would
 * be synthesized as faux bold.
 *
 * Darker Grotesque is a variable font loaded at `wght@300..900` in index.html,
 * so 550 and 450 are real instances rather than interpolated ones. Nothing in
 * Basicx goes below 300, which is where that font starts to smear.
 */
const FONT_FAMILY = '"Darker Grotesque", sans-serif';

export const basicxTheme: MantineThemeOverride = createTheme({
  fontFamily: FONT_FAMILY,
  headings: {
    fontFamily: FONT_FAMILY,
    // The spec sets no heading weight; inherit the app theme's 400 rather than
    // let Mantine's default bold apply to a family that would have to fake it.
    fontWeight: "400",
  },
  fontSizes: {
    // Semantic role names rather than overriding `md`/`sm`: a skin that
    // re-pointed the existing keys would make `<Text size="md">` mean two
    // different things depending on which side of `.skin-scope` it sat.
    bodycopy: rem("16.8px"),
    caption: rem("12.8px"),
  },
  components: {
    /**
     * The slideshow controls.
     *
     * Mantine's default is a white circle with a shadow at 0.6 opacity; the
     * reference is a translucent grey circle with a white chevron and no shadow.
     * That belongs in the theme rather than in `BasicxSection`, because it is a
     * property of the skin and not of the one component that happens to render
     * a carousel — a second carousel anywhere in Basicx should look the same
     * without being told to.
     *
     * `controlSize`/`controlsOffset` are defaults here too, and can still be
     * overridden per instance.
     *
     * The spec's dimmed-on-press state is not reproduced: a `styles` object
     * cannot express a pseudo-class, and ActionIcon already applies Mantine's
     * own `:active` transform, which is the same affordance.
     */
    Carousel: Carousel.extend({
      defaultProps: {
        controlSize: 30,
        controlsOffset: 15,
      },
      styles: {
        control: {
          backgroundColor: "rgba(87, 87, 87, 0.35)",
          boxShadow: "none",
          opacity: 1,
          color: "rgba(255, 255, 255, 0.9)",
        },
      },
    }),
  },
});
