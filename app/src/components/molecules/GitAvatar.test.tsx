import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { GitAvatar } from "./GitAvatar";

const OCTO = { provider: "github", host: "github.com", login: "octo-cat" } as const;
const HUBOT = { provider: "github", host: "github.com", login: "hubot" } as const;

describe("GitAvatar", () => {
  it("shows the initials while the picture loads, and only the picture once it has", () => {
    const { container } = render(<GitAvatar account={OCTO} />);
    const image = container.querySelector("img");

    expect(container.textContent).toBe("OC");
    expect(image?.getAttribute("src")).toBe("https://github.com/octo-cat.png?size=128");
    expect(image?.className).toContain("opacity-0");

    fireEvent.load(image!);

    expect(container.textContent).toBe("");
    expect(container.querySelector("img")?.className).not.toContain("opacity-0");
  });

  it("keeps the initials for good when the picture fails, and tries afresh for another account", () => {
    const { container, rerender } = render(<GitAvatar account={OCTO} />);

    fireEvent.error(container.querySelector("img")!);

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("OC");

    rerender(<GitAvatar account={HUBOT} />);

    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://github.com/hubot.png?size=128");
    expect(container.textContent).toBe("HU");
  });

  it("requests no picture for a GitLab account", () => {
    const { container } = render(<GitAvatar account={{ provider: "gitlab", host: "gitlab.com", login: "tanuki" }} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("TA");
  });
});
