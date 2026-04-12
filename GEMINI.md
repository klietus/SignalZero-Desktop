# Gemini CLI Development Mandates

## 1. Engineering Excellence
- **Surgical Updates:** Perform precise, targeted modifications. Do not perform "drive-by" refactoring of unrelated code unless explicitly directed.
- **Idiomatic Consistency:** Rigorously analyze and mirror the existing codebase's patterns, naming conventions, and architectural style.
- **Type Rigor:** Enforce strict type safety. In TypeScript, avoid `any`; in Python, use type hints and Pydantic where appropriate.
- **Simplicity Over Complexity:** Favor readable, maintainable code over "clever" or overly abstract solutions. Remove redundant logic and "just-in-case" code.

## 2. Professional Workflow
- **Evidence-Based Debugging:** Before fixing a bug, you MUST create a reproduction script or test case that fails in the current state to verify the fix later.
- **Comprehensive Research:** Use `grep_search` and `glob` to understand the blast radius of any change. Validate assumptions by reading relevant interface definitions and usage sites before editing.
- **Atomic Execution:** Structure work into logical, incremental steps. Verify each step before proceeding to the next.
- **Strategic Communication:** Briefly state the technical rationale (the *why* and *how*) before executing significant modifications.

## 3. Testing & Validation
- **Mandatory Testing:** Every feature and bug fix requires corresponding automated tests. A task is incomplete without verification logic.
- **Zero Regressions:** Run existing test suites relevant to the changed area to ensure no side effects were introduced.
- **Static Analysis:** Always execute project-native linting and type-checking (e.g., `npm run lint`, `tsc`, `ruff check`) after modifications to ensure structural integrity.

## 4. Context & Efficiency
- **Turn Optimization:** Use parallel tool calls for independent searches or reads. Minimize unnecessary turns by requesting sufficient context (before/after/context lines) in search results.
- **Surgical Reading:** Avoid reading entire large files. Use line-limited `read_file` or `grep_search` with context flags to minimize token usage.

## 5. Security & Integrity
- **Credential Sanitization:** Never print, log, or commit secrets, API keys, or `.env` files. Rigorously protect the `.git` directory and system configurations.
- **System Safety:** Provide a brief explanation of any shell command that modifies the filesystem or system state before execution.

## 6. Skills & Extensions
- **Skill Activation:** Proactively identify and activate specialized skills (via `activate_skill`) when the task aligns with their domain (e.g., `test-driven-development`, `security-best-practices`).
- **Expert Guidance:** Once a skill is activated, its instructions and resources MUST be treated as expert procedural guidance, taking precedence over general defaults.
- **Dynamic Discovery:** Use the `find-skills` skill to search for and install new capabilities when current tools are insufficient for a specific architectural or domain requirement.
