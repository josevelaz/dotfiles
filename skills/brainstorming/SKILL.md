---
name: brainstorming
description: Brainstorm ideas with the user by exploring an idea tree in rounds. Use when the user wants to generate and refine possible approaches, concepts, or creative directions.
---

Explore with the user until the **option space** contains distinct, useful directions. Map it as an **idea tree**: the goal is the trunk, different approaches are branches, and variations or combinations are twigs.

Work the tree in **rounds**. The **frontier** is every promising direction that can be explored now. In each round, present a diverse set of frontier ideas, explain in one sentence what makes each idea distinct, and ask which ideas attract, repel, or spark a new direction. Then wait for the user's response.

Format each idea like this:

```
💡 **I1 — <idea title>**: <concise description>

➡️ <why this direction earns a branch>
```

Each response reshapes the tree. Expand ideas the user selects, combine ideas whose strengths reinforce each other, and replace weak branches with directions suggested by the user's reactions. Keep contrasting branches alive long enough for the user to compare genuinely different possibilities.

Finding facts is your job. Inspect the environment or dispatch a sub-agent when an idea depends on information you can obtain. Mark unresolved facts as assumptions and continue exploring branches that do not depend on them. The user's tastes, priorities, and trade-offs guide which branches survive.

The session is done when every surfaced branch is expanded, combined, parked, or rejected, and the user confirms the shortlist needs no further exploration. Summarize the shortlist, the strongest hybrid, and the key trade-off that separates them. Wait for the user to choose what happens next.
