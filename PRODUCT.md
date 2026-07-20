# Product

## Register

product

## Users

API developers, QA engineers, and DevOps professionals who need to build, run, and inspect API test workflows. They are in a development or testing context — iterating on API contracts, debugging integration flows, or setting up CI/CD pipelines. They expect precision, speed, and transparency; not hand-holding.

## Product Purpose

APIWeave is a self-hostable, open-source visual workspace for API testing. Users assemble test workflows on a ReactFlow canvas from drag-and-drop nodes, chain requests with extracted variables and dynamic functions, run them against scoped environments, and inspect results node by node. Projects group workflows into ordered runs. The product exists to make API testing visual, scriptable, and CI-friendly — replacing ad-hoc Postman collections and brittle shell scripts with a repeatable, inspectable test graph.

## Brand Personality

Precise, minimal, professional. A developer tool that earns trust through clarity, not decoration.

- **Voice**: Direct, technical, no fluff. Instructions are commands, not suggestions.
- **Tone**: Neutral and confident. Never chatty, never opaque.
- **Emotional goal**: The user feels in control. The tool stays out of the way and shows exactly what's happening.

## Anti-references

The existing DESIGN_SYSTEM.md (app/DESIGN_SYSTEM.md) defines 10 explicit forbidden patterns that are incorporated by reference:

1. No hardcoded hex/rgb in components — all colors reference design tokens
2. No `any` type — TypeScript strict mode is non-negotiable
3. No manual save buttons — 700ms debounced auto-save only
4. No WorkflowContext bypass — all canvas state flows through WorkflowContext
5. No emoji UI icons — Lucide icons exclusively
6. No color-only status — multi-channel encoding (color + icon + text + border)
7. No raw duplicated styled patterns — reuse existing atoms/molecules
8. No landing-page horizontal journey patterns in the app shell
9. No arbitrary magic numbers — spacing/sizing/colors use design tokens
10. No inline font-family declarations — use Tailwind classes

Additionally: no gradient text, no glassmorphism as default, no SaaS hero-metric templates, no side-stripe borders, and no identical card grids.

## Design Principles

Derived from the project philosophy (AGENTS.md):

1. **Craft, don't code.** Every function name should sing. Every abstraction should feel natural. Simplify ruthlessly — elegance is achieved when there's nothing left to take away.

2. **Think Different.** Question every assumption. What would the most elegant solution look like from zero?

3. **Obsess Over Details.** Read the codebase. Understand the patterns, the soul of the code. Leave it better than you found it.

4. **Iterate Relentlessly.** The first version is never good enough. Refine until it's insanely great.

5. **Earn trust through clarity.** The interface should make the system's state and behavior transparent. No surprises, no mystery meat. Every action has a visible, predictable effect.

## Accessibility & Inclusion

WCAG 2.1 AA is the baseline. This includes:
- Minimum 4.5:1 contrast for body text, 3:1 for large text
- Non-text content (icons, focus indicators) at 3:1 minimum
- Keyboard-navigable interfaces with visible focus indicators
- `prefers-reduced-motion` support — all non-essential animations disabled
- Multi-channel status encoding (never color alone)
- Screen-reader compatible semantics (ARIA roles, labels on interactive elements)
