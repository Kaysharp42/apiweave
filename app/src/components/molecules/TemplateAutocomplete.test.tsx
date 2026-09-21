// Behaviour of the `{{…}}` completion as a user meets it: type, pick, keep
// typing. Rendered without a WorkflowProvider on purpose — the suggestion
// list then holds only the dynamic functions and the response paths, which is
// also the assertion that a field carrying this never throws outside a
// workflow. The matching and insertion rules themselves are covered by
// `utils/templateAutocomplete.test.ts`.
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplateTextArea } from "./TemplateAutocomplete";

function Field({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <TemplateTextArea
      aria-label="Request URL"
      value={value}
      onValueChange={setValue}
    />
  );
}

describe("TemplateTextArea", () => {
  it("stays out of the way until a reference is opened", async () => {
    const user = userEvent.setup();
    render(<Field />);

    await user.type(screen.getByLabelText("Request URL"), "https://api/");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("offers matching references once the braces are typed", async () => {
    const user = userEvent.setup();
    render(<Field />);

    await user.type(screen.getByLabelText("Request URL"), "{{{{uuid");

    expect(
      screen.getByRole("option", { name: /uuid\(\)/ }),
    ).toBeInTheDocument();
  });

  it("completes the reference on Enter, braces closed", async () => {
    const user = userEvent.setup();
    render(<Field />);
    const field = screen.getByLabelText("Request URL");

    await user.type(field, "id={{{{uuid");
    await user.keyboard("{Enter}");

    expect(field).toHaveValue("id={{uuid()}}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("leaves the caret after the reference, ready for the next character", async () => {
    const user = userEvent.setup();
    render(<Field />);
    const field = screen.getByLabelText("Request URL");

    await user.type(field, "{{{{uuid");
    await user.keyboard("{Enter}");
    await user.keyboard("/x");

    expect(field).toHaveValue("{{uuid()}}/x");
  });

  it("closes on Escape without changing the text", async () => {
    const user = userEvent.setup();
    render(<Field />);
    const field = screen.getByLabelText("Request URL");

    await user.type(field, "{{{{uuid");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field).toHaveValue("{{uuid");
  });

  it("inserts the suggestion that was clicked", async () => {
    const user = userEvent.setup();
    render(<Field />);
    const field = screen.getByLabelText("Request URL");

    await user.type(field, "{{{{prev.response.st");
    await user.click(screen.getByRole("option", { name: /statusCode/ }));

    expect(field).toHaveValue("{{prev.response.statusCode}}");
  });
});
