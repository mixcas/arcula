import {
  Card,
  Container,
  createTheme,
  Paper,
  rem,
  Select,
} from "@mantine/core";
import type { MantineThemeOverride } from "@mantine/core";

const CONTAINER_SIZES: Record<string, string> = {
  xxs: rem("200px"),
  xs: rem("300px"),
  sm: rem("400px"),
  md: rem("500px"),
  lg: rem("600px"),
  xl: rem("1400px"),
  xxl: rem("1600px"),
};

export const mantineTheme: MantineThemeOverride = createTheme({
  /** Put your mantine theme override here */
  // Body text, used by every Mantine component. Both families are loaded by
  // <link> in index.html. Darker Grotesque is a variable font (wght 300..900),
  // so every weight Mantine asks for — 400 body, 500/600/700 for labels,
  // buttons and table headers — resolves to a real instance rather than a
  // synthesised one. Note the floor is 300, so `fontWeight: 200` would smear.
  fontFamily: '"Darker Grotesque", sans-serif',
  // Title, and Text size="h1".."h6". BBH Bartle ships a single weight (400), so
  // it is pinned here: Mantine defaults headings to 700, which the browser
  // cannot satisfy and would answer with a synthesised faux bold, smearing the
  // display letterforms.
  headings: {
    fontFamily: '"BBH Bartle", sans-serif',
    fontWeight: "400",
  },
  fontSizes: {
    xs: rem("14px"),
    sm: rem("16px"),
    md: rem("18px"),
    lg: rem("20px"),
    xl: rem("22px"),
    "2xl": rem("26px"),
    "3xl": rem("32px"),
    "4xl": rem("38px"),
    "5xl": rem("50px"),
  },
  spacing: {
    "3xs": rem("4px"),
    "2xs": rem("8px"),
    xs: rem("12px"),
    sm: rem("16px"),
    md: rem("18px"),
    lg: rem("24px"),
    xl: rem("28px"),
    "2xl": rem("32px"),
    "3xl": rem("36px"),
  },
  primaryColor: "gray",
  defaultRadius: 0,
  components: {
    /** Put your mantine component override here */
    Container: Container.extend({
      vars: (_, { size, fluid }) => ({
        root: {
          "--container-size": fluid
            ? "100%"
            : size !== undefined && size in CONTAINER_SIZES
              ? CONTAINER_SIZES[size]
              : rem(size),
        },
      }),
    }),
    Paper: Paper.extend({
      defaultProps: {
        shadow: "sm",
        radius: "sm",
      },
    }),

    Card: Card.extend({
      defaultProps: {
        p: "xl",
        shadow: "xl",
        radius: "var(--mantine-radius-default)",
        withBorder: true,
      },
    }),
    Select: Select.extend({
      defaultProps: {
        checkIconPosition: "right",
      },
    }),
  },
  other: {
    style: "mantine",
  },
});
