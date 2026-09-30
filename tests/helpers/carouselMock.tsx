/**
 * A stand-in for `@mantine/carousel`, for jsdom tests.
 *
 * embla measures real element rects, and jsdom reports every one as zero, so a
 * real `Carousel` initialises against nothing. What the component tests assert
 * is the *skin's* decisions — a section per artwork, the footer naming the one
 * in view, no navigation affordances for a single photo — and none of those is
 * an embla behaviour. The real component's geometry is the library's, exercised
 * by the build.
 *
 * `Carousel.extend` is part of Mantine's component contract and the skin's theme
 * calls it, so a mock without it would fail at import time on a limitation of
 * the mock rather than on anything about the skin under test.
 *
 * Exported as a factory because `vi.mock`'s hoisting means a shared module's
 * *bindings* are not available inside the factory — only its functions.
 */
export const carouselMock = () => {
  const Carousel = ({
    children,
    withControls,
  }: {
    children?: React.ReactNode;
    withControls?: boolean;
  }) => (
    <div
      data-testid="carousel"
      data-with-controls={String(Boolean(withControls))}
    >
      {children}
    </div>
  );
  Carousel.Slide = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  // `extend` is a property of Mantine's own component type, so assigning it
  // here is inherently outside what the declared type can express. The single
  // assertion below is the one unavoidable cast in this file, and it is why
  // this lives in a helper rather than in each test's factory.
  Object.assign(Carousel, {
    extend: (config: Record<string, unknown>): Record<string, unknown> =>
      config,
  });
  return { Carousel };
};
