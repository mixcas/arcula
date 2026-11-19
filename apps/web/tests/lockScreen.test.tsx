// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import * as rtl from "@testing-library/react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import LockScreen from "@/components/LockScreen";
import { ApiRequestError } from "@/services/api";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: query === "" || query === "(min-width: 36em)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

/**
 * The shared lock screen takes its attempt from the caller: `onUnlock` is a
 * plain function here, which is the whole point of the extraction. Nothing in
 * this file mocks a service, because the component has none to call.
 */
const renderLock = (
  props: Partial<React.ComponentProps<typeof LockScreen>> = {},
) => {
  const onUnlock = vi.fn<(password: string) => Promise<void>>();
  onUnlock.mockResolvedValue(undefined);
  rtl.render(
    <MantineProvider>
      <LockScreen noun="catalogue" onUnlock={onUnlock} {...props} />
    </MantineProvider>,
  );
  return { onUnlock };
};

const submit = async (password: string) => {
  await userEvent.type(await screen.findByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
};

/**
 * Submit the form without its button.
 *
 * Enter in the field only implicitly submits while the button is enabled, so
 * it cannot exercise the guards that hold when the button is disabled — an
 * empty field, or an attempt already in flight.
 */
const submitForm = () => {
  const form = screen.getByLabelText("Password").closest("form");
  if (!form) throw new Error("the password field is not in a form");
  fireEvent.submit(form);
};

afterEach(() => {
  cleanup();
});

describe("LockScreen — what it shows", () => {
  it("names the document it was given and states what the password opens", () => {
    renderLock({ name: "Flores Solares" });

    expect(screen.getByText("This catalogue is protected")).toBeVisible();
    expect(screen.getByText("Flores Solares")).toBeVisible();
    expect(
      screen.getByText("Enter its password to view the works."),
    ).toBeVisible();
  });

  it("still asks for the password when the refusal named no document", () => {
    // A refusal whose detail is absent or reshaped is still a challenge: the
    // screen must not wait for a name it may never get.
    renderLock();

    expect(screen.getByText("This catalogue is protected")).toBeVisible();
    expect(
      screen.getByText("Enter its password to view the works."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect(screen.queryByText("Flores Solares")).not.toBeInTheDocument();
  });

  it("words a selection's screen as a selection", () => {
    // The second caller must not fork the copy: the noun is the only thing
    // that changes, and it changes in every sentence.
    renderLock({ noun: "selection", name: "Summer" });

    expect(screen.getByText("This selection is protected")).toBeVisible();
  });
});

describe("LockScreen — the attempt", () => {
  it("hands the password to the caller and leaves the outcome to it", async () => {
    const { onUnlock } = renderLock({ name: "Flores Solares" });

    await submit("open-sesame");

    expect(onUnlock).toHaveBeenCalledWith("open-sesame");
    // Success is the caller's business — its reload replaces this screen. The
    // component itself must not claim the document was opened.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not attempt an empty password", () => {
    const { onUnlock } = renderLock();
    const button = screen.getByRole("button", { name: "Unlock" });

    expect(button).toBeDisabled();
    submitForm();

    expect(onUnlock).not.toHaveBeenCalled();
  });

  it("attempts once while an attempt is in flight", async () => {
    let settle: () => void = () => undefined;
    const { onUnlock } = renderLock();
    onUnlock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );

    await submit("open-sesame");
    submitForm();
    expect(onUnlock).toHaveBeenCalledTimes(1);

    settle();
    await screen.findByRole("button", { name: "Unlock" });
  });

  it("clears the last refusal when another attempt is made", async () => {
    const { onUnlock } = renderLock();
    onUnlock.mockRejectedValueOnce(
      new ApiRequestError(403, "invalid-password", "That is not the password"),
    );
    await submit("nope");
    await screen.findByText("That is not the password for this catalogue.");

    submitForm();

    await waitFor(() =>
      expect(
        screen.queryByText("That is not the password for this catalogue."),
      ).not.toBeInTheDocument(),
    );
  });

  it("says the password is wrong, in its own words, and stays to try again", async () => {
    const { onUnlock } = renderLock({ name: "Flores Solares" });
    onUnlock.mockRejectedValue(
      new ApiRequestError(403, "invalid-password", "That is not the password"),
    );

    await submit("nope");

    expect(
      await screen.findByText("That is not the password for this catalogue."),
    ).toBeVisible();
    // The prompt is still there, and the button is usable again: a refused
    // attempt is not a dead end.
    const button = screen.getByRole("button", { name: "Unlock" });
    expect(button).toBeVisible();
    expect(button).toBeEnabled();
  });

  it("words a selection's refusal as a selection", async () => {
    const { onUnlock } = renderLock({ noun: "selection" });
    onUnlock.mockRejectedValue(
      new ApiRequestError(403, "invalid-password", "That is not the password"),
    );

    await submit("nope");

    expect(
      await screen.findByText("That is not the password for this selection."),
    ).toBeVisible();
  });

  it("prints the spent window in the server's words", async () => {
    // Only the server knows the window, and it states it without a countdown;
    // the screen must not paraphrase it into something less true.
    const { onUnlock } = renderLock();
    onUnlock.mockRejectedValue(
      new ApiRequestError(
        429,
        "too-many-attempts",
        "Too many failed attempts. Try again once this 10-minute window has passed.",
      ),
    );

    await submit("nope");

    expect(
      await screen.findByText(/this 10-minute window has passed/),
    ).toBeVisible();
  });

  it.each([
    ["catalogue", "Could not unlock this catalogue. Try again."],
    ["selection", "Could not unlock this selection. Try again."],
  ] as const)(
    "keeps a generic line for a failure it cannot explain (%s)",
    async (noun, message) => {
      const { onUnlock } = renderLock({ noun });
      onUnlock.mockRejectedValue(new TypeError("network down"));

      await submit("open-sesame");

      expect(await screen.findByText(message)).toBeVisible();
    },
  );
});
