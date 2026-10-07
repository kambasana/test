# Code review checklist

Before approving a change, the reviewer confirms:

1. The change does one thing and its description says what and why.
2. Every new behaviour has a unit test; the tests fail without the change.
3. Inputs from outside the module are checked for range and type.
4. No secrets, keys or personal data appear in code, logs or test data.
5. Error paths are handled, not swallowed; resources are released on every path.
6. Timing-sensitive code states its limits (for example "completes within 5 ms").
7. Names match the glossary; no dead code or commented-out blocks.
8. The traceability table is updated if a requirement is affected.
