# Implementation Spec Output Reference

Use this exact structure for every implementation specification.

```md
# Implementation Spec: <Feature Name>

## 1. Summary

A concise description of the requested change.

## 2. Problem

Describe the current problem, user pain, business need, and existing limitations.

## 3. Desired Outcome

Describe what success looks like after implementation.

## 4. Scope

### In Scope

List capabilities that must be delivered.

### Out of Scope

List capabilities explicitly excluded.

## 5. Current System Context

### Existing Behavior

Describe current behavior.

### Relevant Components

List known files, modules, services, workflows, or systems.

### Existing Patterns To Preserve

List architecture patterns, conventions, or constraints.

### Assumptions

List assumptions where information is missing.

## 6. Functional Requirements

- FR-001: ...
- FR-002: ...

Requirements must be atomic, testable, and implementation agnostic.

## 7. Non-Functional Requirements

- NFR-001: ...
- NFR-002: ...

Only include relevant non-functional requirements.

## 8. Technical Guidance

This section provides context for future planning agents.

### Relevant Areas Likely Affected
### Existing Integrations
### Data Considerations
### API / Interface Considerations
### Architectural Considerations

Do not prescribe a final implementation.
Do not generate a task list.
Do not generate implementation steps.

## 9. Edge Cases

- EC-001: ...
- EC-002: ...

Cover invalid input, missing data, authorization failures, concurrency concerns, state transitions, and recovery scenarios when relevant.

## 10. Risks and Unknowns

### Risks

- RISK-001: ...
- RISK-002: ...

### Unknowns

- UNKNOWN-001: ...
- UNKNOWN-002: ...

Document ambiguities, assumptions, dependencies, and unanswered questions.

## 11. Verification Matrix

| ID | Requirement | Verification Approach |
|----|-------------|----------------------|
| FR-001 | ... | Unit Test / Integration Test / End-to-End Test / Manual Validation / Code Review / Monitoring Validation |

Include all functional requirements, non-functional requirements, and edge cases.

## 12. Acceptance Criteria

- [ ] Concise checklist derived from requirements and verification matrix.
```
