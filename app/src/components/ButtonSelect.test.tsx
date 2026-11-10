import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ButtonSelect from "./ButtonSelect";

const OPTIONS = [
  { value: "", label: "No environment" },
  { value: "env-dev", label: "Development" },
  { value: "env-prod", label: "Production" },
];

describe("ButtonSelect", () => {
  it("opens on click and picks an option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ButtonSelect options={OPTIONS} value="" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "No environment" }));
    await user.click(screen.getByRole("option", { name: "Production" }));

    expect(onChange).toHaveBeenCalledWith("env-prod");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("is operable from the keyboard: arrows open and move, Enter picks", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ButtonSelect options={OPTIONS} value="" onChange={onChange} />);

    await user.tab();
    expect(screen.getByRole("button", { name: "No environment" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("env-dev");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<ButtonSelect options={OPTIONS} value="env-dev" />);

    const trigger = screen.getByRole("button", { name: "Development" });
    await user.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("marks the selected option", async () => {
    const user = userEvent.setup();
    render(<ButtonSelect options={OPTIONS} value="env-prod" />);

    await user.click(screen.getByRole("button", { name: "Production" }));

    expect(screen.getByRole("option", { name: "Production" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "Development" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("names an icon-only trigger after what it chooses and the current choice", () => {
    render(
      <ButtonSelect
        options={OPTIONS}
        value="env-prod"
        label="Environment"
        icon={<svg />}
        iconOnly
      />,
    );

    expect(
      screen.getByRole("button", { name: "Environment: Production" }),
    ).toBeInTheDocument();
  });

  it("falls back to the placeholder when the value matches no option", () => {
    render(
      <ButtonSelect options={OPTIONS} value="gone" placeholder="Pick one" />,
    );

    expect(screen.getByRole("button", { name: "Pick one" })).toBeInTheDocument();
  });
});
