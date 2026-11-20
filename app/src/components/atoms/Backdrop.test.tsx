import { afterEach, describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Dialog } from "@headlessui/react";
import { Backdrop } from "./Backdrop";
import { Modal } from "../molecules/Modal";
import useWindowChromeStore from "../../stores/WindowChromeStore";

const backdrops = () => useWindowChromeStore.getState().backdrops;

function DimmedDialog() {
  return (
    <Dialog open onClose={() => undefined}>
      <Backdrop />
    </Dialog>
  );
}

afterEach(() => {
  useWindowChromeStore.setState({ backdrops: 0 });
});

describe("Backdrop", () => {
  test("dims the window while it is mounted", () => {
    const { unmount } = render(<DimmedDialog />);
    expect(backdrops()).toBe(1);

    unmount();
    expect(backdrops()).toBe(0);
  });

  // A confirm opens over a dialog: closing it must leave the dialog's dim on.
  test("closing a backdrop over another keeps the window dimmed", () => {
    const outer = render(<DimmedDialog />);
    const inner = render(<DimmedDialog />);
    expect(backdrops()).toBe(2);

    inner.unmount();
    expect(backdrops()).toBe(1);

    outer.unmount();
    expect(backdrops()).toBe(0);
  });

  test("an open dialog counts as dimming the window, a closed one does not", () => {
    const dialog = (isOpen: boolean) => (
      <Modal isOpen={isOpen} onClose={() => undefined} title="Edit">
        body
      </Modal>
    );
    const { rerender } = render(dialog(false));
    expect(backdrops()).toBe(0);

    rerender(dialog(true));
    expect(backdrops()).toBe(1);
  });
});
