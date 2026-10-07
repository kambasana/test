# Requirements and traceability

- Requirement ids look like `REQ-<AREA>-nnn` (for example `REQ-LOG-004`).
- Each requirement is one testable sentence using "shall", with a verification method (T, A, I or D).
- The traceability table has the columns: requirement id, short text, verification method, test case id(s), status.
- Status is one of: not run, passed, failed, blocked.
- A requirement with no test case is a gap and must be listed under open points.
- When a requirement changes, every linked test case is reviewed in the same change record.
