// Behavior-focused tests for molecule components.
//
// These tests verify what components DO (events, accessibility, state, side
// effects) — not how they look. They use @testing-library/react to interact
// with components the way a user would, and they assert on semantics
// (roles, labels, attributes, behavior) rather than CSS class names.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Card } from "./Card";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { FormField } from "./FormField";
import { KeyValueEditor } from "./KeyValueEditor";
import { Modal } from "./Modal";
import { Panel } from "./Panel";
import { PanelTabs } from "./PanelTabs";
import { PromptDialog } from "./PromptDialog";
import { SearchInput } from "./SearchInput";
import { SlidePanel } from "./SlidePanel";
import { StatusBadge } from "./StatusBadge";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState";

describe("Panel", () => {
  it("renders the title and children", () => {
    render(<Panel title="Variables">content</Panel>);
    expect(
      screen.getByRole("heading", { name: "Variables" }),
    ).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("renders headerActions in the header", () => {
    render(
      <Panel title="P" headerActions={<button>Action</button>}>
        body
      </Panel>,
    );
    const heading = screen.getByRole("heading", { name: "P" });
    const header = heading.closest("div")?.parentElement;
    expect(
      within(header as HTMLElement).getByRole("button", { name: "Action" }),
    ).toBeInTheDocument();
  });

  it("renders footer when provided", () => {
    render(
      <Panel title="P" footer={<span>footer content</span>}>
        body
      </Panel>,
    );
    expect(screen.getByText("footer content")).toBeInTheDocument();
  });

  it("toggles collapse state when collapsible is true", async () => {
    const user = userEvent.setup();
    render(
      <Panel title="P" collapsible defaultExpanded>
        body
      </Panel>,
    );
    expect(screen.getByText("body")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /collapse panel/i }));
    // Body is removed when collapsed
    expect(screen.queryByText("body")).toBeNull();
  });

  it("respects defaultExpanded={false}", () => {
    render(
      <Panel title="P" collapsible defaultExpanded={false}>
        body
      </Panel>,
    );
    expect(screen.queryByText("body")).toBeNull();
    expect(
      screen.getByRole("button", { name: /expand panel/i }),
    ).toBeInTheDocument();
  });

  it("does not render a collapse button when not collapsible", () => {
    render(<Panel title="P">body</Panel>);
    expect(
      screen.queryByRole("button", { name: /collapse|expand/i }),
    ).toBeNull();
  });
});

describe("Card", () => {
  it("renders children directly (no header) when no title is provided", () => {
    render(<Card>content</Card>);
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("renders the title as a heading when provided", () => {
    render(<Card title="Settings">content</Card>);
    expect(
      screen.getByRole("heading", { name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("toggles collapse state when collapsible is true", async () => {
    const user = userEvent.setup();
    render(
      <Card title="S" collapsible defaultExpanded>
        body
      </Card>,
    );
    await user.click(screen.getByRole("button", { name: /collapse section/i }));
    expect(screen.queryByText("body")).toBeNull();
  });

  it("does not render a header when no title or actions provided", () => {
    const { container } = render(<Card>body</Card>);
    // No h4 element when there's no header
    expect(container.querySelector("h4")).toBeNull();
  });
});

describe("PanelTabs", () => {
  const tabs = [
    { key: "config", label: "Config" },
    { key: "output", label: "Output" },
  ];

  it("renders each tab as a button with role=tab", () => {
    render(<PanelTabs tabs={tabs} activeTab="config" onTabChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Config" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Output" })).toBeInTheDocument();
  });

  it("marks the active tab with aria-selected=true", () => {
    render(<PanelTabs tabs={tabs} activeTab="output" onTabChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "Output" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Config" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("invokes onTabChange with the new tab key when clicked", async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PanelTabs tabs={tabs} activeTab="config" onTabChange={onTabChange} />,
    );
    await user.click(screen.getByRole("tab", { name: "Output" }));
    expect(onTabChange).toHaveBeenCalledWith("output");
  });

  it("exposes a tablist role for the container", () => {
    render(<PanelTabs tabs={tabs} activeTab="config" onTabChange={() => {}} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });
});

describe("FormField", () => {
  it("renders the label", () => {
    render(
      <FormField label="URL">
        <input type="text" />
      </FormField>,
    );
    expect(screen.getByText("URL")).toBeInTheDocument();
  });

  it("shows a required indicator when required is true", () => {
    render(
      <FormField label="Email" required>
        <input type="email" />
      </FormField>,
    );
    // Required indicator is an asterisk in a span
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("renders the error message when error is provided", () => {
    render(
      <FormField label="URL" error="Invalid URL">
        <input id="url-input" type="text" />
      </FormField>,
    );
    expect(screen.getByText("Invalid URL")).toBeInTheDocument();
  });

  it("renders the hint when no error is provided", () => {
    render(
      <FormField label="URL" hint="Use https://">
        <input type="text" />
      </FormField>,
    );
    expect(screen.getByText("Use https://")).toBeInTheDocument();
  });

  it("prefers error over hint when both are provided", () => {
    render(
      <FormField label="URL" hint="Some hint" error="Some error">
        <input type="text" />
      </FormField>,
    );
    expect(screen.getByText("Some error")).toBeInTheDocument();
    expect(screen.queryByText("Some hint")).toBeNull();
  });
});

describe("Modal", () => {
  it("renders nothing when isOpen=false", () => {
    render(
      <Modal isOpen={false} onClose={() => {}} title="T">
        content
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders a dialog with content when isOpen=true", () => {
    render(
      <Modal isOpen onClose={() => {}} title="T">
        modal content
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("modal content")).toBeInTheDocument();
  });

  it("renders the title as a heading in the dialog", () => {
    render(
      <Modal isOpen onClose={() => {}} title="Confirm action">
        content
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Confirm action" }),
    ).toBeInTheDocument();
  });

  it("invokes onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal isOpen onClose={onClose} title="T">
        content
      </Modal>,
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render the close button when showClose is false", () => {
    render(
      <Modal isOpen onClose={() => {}} title="T" showClose={false}>
        content
      </Modal>,
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("renders the footer when provided", () => {
    render(
      <Modal isOpen onClose={() => {}} title="T" footer={<button>OK</button>}>
        content
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("renders nothing when open=false", () => {
    render(
      <ConfirmDialog
        open={false}
        onClose={() => {}}
        onConfirm={() => {}}
        message="Are you sure?"
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the title and message when open", () => {
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete item"
        message="This cannot be undone."
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete item")).toBeInTheDocument();
    expect(
      within(dialog).getByText("This cannot be undone."),
    ).toBeInTheDocument();
  });

  it("renders the default title when not provided", () => {
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        message="msg"
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("Are you sure?");
  });

  it("invokes onConfirm when the confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        message="msg"
        confirmLabel="Yes, do it"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Yes, do it" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("invokes onClose when the cancel button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={() => {}}
        message="msg"
        cancelLabel="No, go back"
      />,
    );
    await user.click(screen.getByRole("button", { name: "No, go back" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses custom confirm and cancel labels", () => {
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        message="msg"
        confirmLabel="Delete forever"
        cancelLabel="Keep it"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Delete forever" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeInTheDocument();
  });
});

describe("PromptDialog", () => {
  it("renders nothing when open=false", () => {
    render(
      <PromptDialog open={false} onClose={() => {}} onSubmit={() => {}} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders a dialog with a text input when open", () => {
    render(<PromptDialog open onClose={() => {}} onSubmit={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox")).toBeInTheDocument();
  });

  it("uses defaultValue as the initial input value", () => {
    render(
      <PromptDialog
        open
        onClose={() => {}}
        onSubmit={() => {}}
        defaultValue="preset"
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("preset");
  });

  it("disables the submit button when the input is empty or whitespace", () => {
    render(<PromptDialog open onClose={() => {}} onSubmit={() => {}} />);
    const submit = screen.getByRole("button", { name: "Create" });
    expect(submit).toBeDisabled();
  });

  it("invokes onSubmit with the trimmed value and onClose when the form is submitted", async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PromptDialog open onClose={onClose} onSubmit={onSubmit} />);
    await user.type(screen.getByRole("textbox"), "  hello  ");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit).toHaveBeenCalledWith("hello");
    expect(onClose).toHaveBeenCalled();
  });

  it("invokes onClose when the cancel button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <PromptDialog
        open
        onClose={onClose}
        onSubmit={() => {}}
        cancelLabel="Back"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("SlidePanel", () => {
  it("renders nothing when open=false", () => {
    render(
      <SlidePanel open={false} onClose={() => {}} title="P">
        body
      </SlidePanel>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the title and body when open", () => {
    render(
      <SlidePanel open onClose={() => {}} title="Settings">
        body content
      </SlidePanel>,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Settings")).toBeInTheDocument();
    expect(within(dialog).getByText("body content")).toBeInTheDocument();
  });

  it("invokes onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <SlidePanel open onClose={onClose} title="Settings">
        body
      </SlidePanel>,
    );
    await user.click(screen.getByRole("button", { name: "Close panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("SearchInput", () => {
  it("renders a textbox with the placeholder", () => {
    render(
      <SearchInput
        value=""
        onChange={() => {}}
        placeholder="Search workflows"
      />,
    );
    expect(screen.getByPlaceholderText("Search workflows")).toBeInTheDocument();
  });

  it("invokes onChange with the new value when typing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchInput value="" onChange={onChange} />);
    await user.type(screen.getByRole("textbox"), "a");
    expect(onChange).toHaveBeenCalled();
  });

  it("shows a clear button when value is non-empty and invokes onChange with empty string", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SearchInput value="auth" onChange={onChange} />);
    const clearButton = screen.getByRole("button", { name: "Clear search" });
    expect(clearButton).toBeInTheDocument();
    await user.click(clearButton);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("does not show a clear button when value is empty", () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });
});

describe("KeyValueEditor", () => {
  it("renders an input for each pair", () => {
    const pairs = [
      { key: "Content-Type", value: "application/json" },
      { key: "Authorization", value: "Bearer xyz" },
    ];
    render(<KeyValueEditor pairs={pairs} onChange={() => {}} />);
    const keyInputs = screen.getAllByLabelText(/^Key \d+$/);
    const valueInputs = screen.getAllByLabelText(/^Value \d+$/);
    expect(keyInputs).toHaveLength(2);
    expect(valueInputs).toHaveLength(2);
  });

  it("invokes onChange with the updated key when a key input changes", () => {
    const onChange = vi.fn();
    const pairs = [{ key: "foo", value: "bar" }];
    render(<KeyValueEditor pairs={pairs} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Key 1"), {
      target: { value: "baz" },
    });
    expect(onChange).toHaveBeenCalledWith([{ key: "baz", value: "bar" }]);
  });

  it("invokes onChange with the updated value when a value input changes", () => {
    const onChange = vi.fn();
    const pairs = [{ key: "foo", value: "bar" }];
    render(<KeyValueEditor pairs={pairs} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Value 1"), {
      target: { value: "qux" },
    });
    expect(onChange).toHaveBeenCalledWith([{ key: "foo", value: "qux" }]);
  });

  it("invokes onChange with a new pair when the add button is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<KeyValueEditor pairs={[]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenCalledWith([{ key: "", value: "" }]);
  });

  it("invokes onChange without the removed pair when a row remove button is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const pairs = [
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ];
    render(<KeyValueEditor pairs={pairs} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect(onChange).toHaveBeenCalledWith([{ key: "b", value: "2" }]);
  });

  it("hides the add and remove buttons when readOnly is true", () => {
    const pairs = [{ key: "a", value: "1" }];
    render(<KeyValueEditor pairs={pairs} onChange={() => {}} readOnly />);
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove row/i })).toBeNull();
  });
});

describe("EmptyState", () => {
  it("renders the title and description", () => {
    render(
      <EmptyState
        title="No pending invites"
        description="Invite people to your organization."
      />,
    );
    expect(
      screen.getByRole("heading", { name: "No pending invites" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Invite people to your organization."),
    ).toBeInTheDocument();
  });

  it("renders the action when provided", () => {
    render(
      <EmptyState
        title="Empty"
        description="desc"
        action={<button>Take action</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Take action" }),
    ).toBeInTheDocument();
  });
});

describe("WorkspaceEmptyState", () => {
  it("renders the welcome heading and description", () => {
    render(<WorkspaceEmptyState />);
    expect(
      screen.getByRole("heading", { name: /Welcome to APIWeave/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Build visual API test flows/i),
    ).toBeInTheDocument();
  });

  it("invokes onNewWorkflow when the New Workflow button is clicked", async () => {
    const onNewWorkflow = vi.fn();
    const user = userEvent.setup();
    render(<WorkspaceEmptyState onNewWorkflow={onNewWorkflow} />);
    await user.click(screen.getByRole("button", { name: /New Workflow/i }));
    expect(onNewWorkflow).toHaveBeenCalledTimes(1);
  });

  it("invokes onImport when the Import Workflow button is clicked", async () => {
    const onImport = vi.fn();
    const user = userEvent.setup();
    render(<WorkspaceEmptyState onImport={onImport} />);
    await user.click(screen.getByRole("button", { name: /Import Workflow/i }));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("invokes onOpenCollection when the Open Collection button is clicked", async () => {
    const onOpenCollection = vi.fn();
    const user = userEvent.setup();
    render(<WorkspaceEmptyState onOpenCollection={onOpenCollection} />);
    await user.click(screen.getByRole("button", { name: /Open Collection/i }));
    expect(onOpenCollection).toHaveBeenCalledTimes(1);
  });

  it("hides buttons whose handler is not provided", () => {
    render(<WorkspaceEmptyState onNewWorkflow={() => {}} />);
    expect(
      screen.queryByRole("button", { name: /Import Workflow/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Open Collection/i }),
    ).toBeNull();
  });
});

describe("StatusBadge", () => {
  it("renders a status role with the status label as accessible name", () => {
    render(<StatusBadge status="success" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveAttribute("aria-label", "Success");
  });

  it("uses the explicit label prop when provided", () => {
    render(<StatusBadge status="running" label="Executing" />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveAttribute("aria-label", "Executing");
    expect(screen.getByText("Executing")).toBeInTheDocument();
  });

  it("uses the default label for each status", () => {
    const cases: Array<
      ["idle" | "running" | "success" | "error" | "warning" | "info", string]
    > = [
      ["idle", "Idle"],
      ["running", "Running"],
      ["success", "Success"],
      ["error", "Failed"],
      ["warning", "Warning"],
      ["info", "Info"],
    ];
    for (const [status, label] of cases) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByRole("status")).toHaveAttribute("aria-label", label);
      unmount();
    }
  });
});
