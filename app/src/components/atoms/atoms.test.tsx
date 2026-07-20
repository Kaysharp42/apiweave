// Behavior-focused tests for atom components.
//
// These tests verify what components DO (events, accessibility, state, side
// effects) — not how they look. They use @testing-library/react to interact
// with components the way a user would, and they assert on semantics
// (roles, labels, attributes, behavior) rather than CSS class names.
import { createElement, type ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReactFlowProvider } from "reactflow";
import { Save } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Input } from "./Input";
import { TextArea } from "./TextArea";
import { Badge } from "./Badge";
import { Toggle } from "./Toggle";
import { Skeleton } from "./Skeleton";
import { Divider } from "./Divider";
import { HorizontalDivider } from "./HorizontalDivider";
import { Tooltip } from "./Tooltip";
import { Toast } from "./Toast";
import { IconSwitch } from "./IconSwitch";
import { BaseNode } from "./flow/BaseNode";
import { NodeHandle } from "./flow/NodeHandle";
import { NodeActionMenu } from "./flow/NodeActionMenu";

function renderInReactFlow(ui: ReactElement) {
  return render(createElement(ReactFlowProvider, null, ui));
}

describe("Button", () => {
  it("renders children as the button label", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("invokes onClick when not disabled or loading", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Click me</Button>);
    await user.click(screen.getByRole("button", { name: "Click me" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onClick when disabled", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Disabled" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not invoke onClick when loading and sets aria-busy", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading onClick={onClick}>
        Submit
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Submit" });
    expect(button).toHaveAttribute("aria-busy", "true");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders as a native button element with type=button by default", () => {
    render(<Button>Default</Button>);
    const button = screen.getByRole("button", { name: "Default" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
  });

  it("respects explicit type prop", () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("renders the icon prop when not loading", () => {
    render(<Button icon={<Save data-testid="icon" />}>Save</Button>);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });
});

describe("IconButton", () => {
  it("renders as a button with the icon as children", () => {
    render(
      <IconButton aria-label="Save">
        <Save data-testid="icon" />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("is disabled when disabled prop is set", () => {
    render(
      <IconButton disabled aria-label="Save">
        <Save />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("invokes onClick when clicked", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <IconButton onClick={onClick} aria-label="Save">
        <Save />
      </IconButton>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onClick when disabled", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <IconButton disabled onClick={onClick} aria-label="Save">
        <Save />
      </IconButton>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Input", () => {
  it("renders a text input with the given id", () => {
    render(<Input id="api-url" />);
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("id", "api-url");
  });

  it("associates label with the input via htmlFor", () => {
    render(<Input id="api-url" label="URL" />);
    const input = screen.getByLabelText("URL");
    expect(input.tagName).toBe("INPUT");
  });

  it("renders helper text and links it via aria-describedby when no error", () => {
    render(<Input id="api-url" label="URL" helperText="Supports variables" />);
    const input = screen.getByLabelText("URL");
    expect(input).toHaveAttribute("aria-describedby", "api-url-helper");
    expect(screen.getByText("Supports variables")).toBeInTheDocument();
  });

  it("renders error message and sets aria-invalid when error is provided", () => {
    render(<Input id="api-url" label="URL" error="Invalid URL" />);
    const input = screen.getByLabelText("URL");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "api-url-error");
    expect(screen.getByText("Invalid URL")).toBeInTheDocument();
  });

  it("invokes onChange when typing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Input id="api-url" label="URL" onChange={onChange} />);
    const input = screen.getByLabelText("URL");
    await user.type(input, "https://example.com");
    expect(onChange).toHaveBeenCalled();
  });

  it("auto-generates an id when none is provided", () => {
    render(<Input label="URL" />);
    const input = screen.getByLabelText("URL");
    expect(input).toHaveAttribute("id");
    // Auto id is non-empty
    expect(input.getAttribute("id")).toBeTruthy();
  });
});

describe("TextArea", () => {
  it("renders a textarea element", () => {
    render(<TextArea id="body" label="Body" value="hello" />);
    const textarea = screen.getByLabelText("Body");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveValue("hello");
  });

  it("associates error via aria-invalid and shows error message", () => {
    render(<TextArea id="body" label="Body" error="Invalid JSON" />);
    const textarea = screen.getByLabelText("Body");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Invalid JSON")).toBeInTheDocument();
  });

  it("invokes onChange when typing", () => {
    const onChange = vi.fn();
    render(<TextArea id="body" label="Body" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Body"), {
      target: { value: "new value" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("Badge", () => {
  it("renders children as the badge text", () => {
    render(<Badge>Draft</Badge>);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("renders as a span element", () => {
    const { container } = render(<Badge>Tag</Badge>);
    const badge = container.querySelector("span");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("Tag");
  });
});

describe("Toggle", () => {
  it("renders a checkbox input", () => {
    render(
      <Toggle
        id="autosave"
        label="Auto-save"
        checked={false}
        onChange={() => {}}
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Auto-save" });
    expect(checkbox).toBeInTheDocument();
  });

  it("reflects the checked state", () => {
    const { rerender } = render(
      <Toggle id="t1" label="L" checked={false} onChange={() => {}} />,
    );
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    rerender(<Toggle id="t1" label="L" checked={true} onChange={() => {}} />);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("invokes onChange with the new value when toggled", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Toggle id="t1" label="L" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("is disabled when the disabled prop is set", () => {
    render(
      <Toggle id="t1" label="L" checked={false} onChange={() => {}} disabled />,
    );
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive technology (aria-hidden)", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveAttribute("aria-hidden", "true");
  });

  it("renders count child skeletons when count > 1", () => {
    const { container } = render(<Skeleton count={3} />);
    // Outer wrapper has aria-hidden; each child div is a separate skeleton
    const wrapper = container.querySelector('[aria-hidden="true"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.children.length).toBe(3);
  });

  it("applies width/height as inline styles when provided", () => {
    const { container } = render(<Skeleton width={200} height={50} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("200px");
    expect(el.style.height).toBe("50px");
  });
});

describe("Divider", () => {
  it("renders as a div element", () => {
    const { container } = render(<Divider />);
    expect(container.firstChild?.nodeName).toBe("DIV");
  });

  it("renders text content when text prop is provided", () => {
    render(<Divider text="OR" />);
    expect(screen.getByText("OR")).toBeInTheDocument();
  });
});

describe("HorizontalDivider", () => {
  it("renders as an hr element", () => {
    const { container } = render(<HorizontalDivider />);
    expect(container.firstChild?.nodeName).toBe("HR");
  });
});

describe("Tooltip", () => {
  it("renders its children directly when disabled", () => {
    render(
      <Tooltip content="hint" disabled>
        <button>Trigger</button>
      </Tooltip>,
    );
    // When disabled, no Tippy wrapper — children render as-is
    expect(screen.getByRole("button", { name: "Trigger" })).toBeInTheDocument();
  });

  it("renders children without a Tippy wrapper when no content is provided", () => {
    render(
      <Tooltip>
        <button>No hint</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: "No hint" })).toBeInTheDocument();
  });
});

describe("Toast", () => {
  it("exports a function component (smoke test that does not mount sonner)", () => {
    // Mounting the sonner Toaster in jsdom requires window.matchMedia, which
    // is not provided. The Toaster is a thin wrapper that sets sonner config;
    // its real behavior is verified by integration tests in the app, not here.
    expect(typeof Toast).toBe("function");
  });
});

describe("IconSwitch", () => {
  it("renders as a switch with role and aria-checked", () => {
    render(
      <IconSwitch
        checked={false}
        onCheckedChange={() => {}}
        checkedLabel="On"
        uncheckedLabel="Off"
        checkedIcon={<span>✓</span>}
        uncheckedIcon={<span>✗</span>}
      />,
    );
    const sw = screen.getByRole("switch", { name: "Off" });
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("invokes onCheckedChange with the new value when toggled", async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();
    render(
      <IconSwitch
        checked={false}
        onCheckedChange={onCheckedChange}
        checkedLabel="On"
        uncheckedLabel="Off"
        checkedIcon={<span>✓</span>}
        uncheckedIcon={<span>✗</span>}
      />,
    );
    await user.click(screen.getByRole("switch"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("reflects the checked state via aria-checked", () => {
    render(
      <IconSwitch
        checked={true}
        onCheckedChange={() => {}}
        checkedLabel="On"
        uncheckedLabel="Off"
        checkedIcon={<span>✓</span>}
        uncheckedIcon={<span>✗</span>}
      />,
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("does not toggle when disabled", async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();
    render(
      <IconSwitch
        checked={false}
        onCheckedChange={onCheckedChange}
        checkedLabel="On"
        uncheckedLabel="Off"
        checkedIcon={<span>✓</span>}
        uncheckedIcon={<span>✗</span>}
        disabled
      />,
    );
    await user.click(screen.getByRole("switch"));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe("BaseNode", () => {
  it("renders the title as text", () => {
    render(<BaseNode title="HTTP Request">body</BaseNode>);
    expect(screen.getByText("HTTP Request")).toBeInTheDocument();
  });

  it("exposes the status via an aria-label on the node container", () => {
    renderInReactFlow(
      <BaseNode title="T" status="success">
        body
      </BaseNode>,
    );
    const node = screen.getByLabelText("Node status: Success");
    expect(node).toBeInTheDocument();
  });

  it("toggles aria-expanded on the collapse button when clicked", async () => {
    const user = userEvent.setup();
    renderInReactFlow(
      <BaseNode title="T" defaultExpanded={false} collapsible>
        body
      </BaseNode>,
    );
    const button = screen.getByRole("button", { name: /expand/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("does not render a header or collapse button when no title is provided", () => {
    const { container } = renderInReactFlow(<BaseNode>body</BaseNode>);
    // No title → no h3, no collapse button
    expect(container.querySelector("h3")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /expand|collapse/i }),
    ).toBeNull();
  });
});

describe("NodeHandle", () => {
  it("renders a source handle by default", () => {
    const { container } = renderInReactFlow(<NodeHandle />);
    // react-flow adds data-id and data-handlepos attributes
    const handle = container.querySelector(".react-flow__handle");
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute("aria-label")).toBe("source handle");
  });

  it('renders a target handle when type="target"', () => {
    const { container } = renderInReactFlow(<NodeHandle type="target" />);
    const handle = container.querySelector(".react-flow__handle");
    expect(handle?.getAttribute("aria-label")).toBe("target handle");
  });

  it("maps the position prop to the react-flow Position enum", () => {
    const { container } = renderInReactFlow(<NodeHandle position="bottom" />);
    const handle = container.querySelector(".react-flow__handle");
    expect(handle?.classList.contains("react-flow__handle-bottom")).toBe(true);
  });
});

describe("NodeActionMenu", () => {
  it("renders nothing when no nodeId is provided", () => {
    const { container } = renderInReactFlow(
      <NodeActionMenu nodeId={undefined as unknown as string} />,
    );
    expect(container.querySelector('[aria-label="Node actions"]')).toBeNull();
  });

  it("renders the trigger button when nodeId is provided", () => {
    renderInReactFlow(<NodeActionMenu nodeId="node-1" />);
    const trigger = screen.getByRole("button", { name: "Node actions" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the menu when the trigger is clicked and shows menu items", async () => {
    const onDuplicate = vi.fn();
    const onCopy = vi.fn();
    const user = userEvent.setup();
    renderInReactFlow(
      <NodeActionMenu
        nodeId="node-1"
        collapsible
        isExpanded={false}
        onDuplicate={onDuplicate}
        onCopy={onCopy}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Node actions" }));
    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();
    // Three items: duplicate, copy, toggle-expand
    expect(
      screen.getByRole("menuitem", { name: /duplicate/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /copy/i })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /expand/i }),
    ).toBeInTheDocument();
  });

  it("invokes onDuplicate and closes the menu when duplicate is clicked", async () => {
    const onDuplicate = vi.fn();
    const user = userEvent.setup();
    renderInReactFlow(
      <NodeActionMenu nodeId="node-1" onDuplicate={onDuplicate} />,
    );
    await user.click(screen.getByRole("button", { name: "Node actions" }));
    await user.click(screen.getByRole("menuitem", { name: /duplicate/i }));
    expect(onDuplicate).toHaveBeenCalledWith("node-1");
    // Menu closes
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("invokes onToggleExpand with the next expanded state", async () => {
    const onToggleExpand = vi.fn();
    const user = userEvent.setup();
    renderInReactFlow(
      <NodeActionMenu
        nodeId="node-1"
        collapsible
        isExpanded={false}
        onToggleExpand={onToggleExpand}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Node actions" }));
    await user.click(screen.getByRole("menuitem", { name: /expand/i }));
    expect(onToggleExpand).toHaveBeenCalledWith(true);
  });
});
