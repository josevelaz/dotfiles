# Herdr Agent Tree Display

The Herdr sidebar now displays agents in a tree structure when using `herdr agent` to spawn child agents.

## Configuration

Updated `~/.config/herdr/config.toml`:

```toml
[ui.sidebar.agents]
row_gap = 1
rows = [
  ["state_icon", { token = "state_text", fg = "#9ccfd8", bold = true }],
  [{ token = "$indent", fg = "#6e6a86" }, { token = "pane", fg = "#f6c177", bold = true }],
  [{ token = "$branch", fg = "#c4a7e7" }, { token = "$git_status", fg = "#f6c177" }],
  [{ token = "workspace", dim = true }, { token = "agent", dim = true }, { token = "$parent", dim = true, fg = "#908caa" }],
]
```

This adds:
- `$indent` - Tree structure prefix (├─ symbols)
- `$parent` - Parent agent name
- `$depth` - Hierarchy depth (not shown but tracked)

## Usage

When spawning a child agent from pi, report the hierarchy metadata:

```bash
# Create a new pane and start an agent
NEW_PANE=$(herdr pane split --current --direction right --cwd "$PWD" --no-focus | \
  jq -r '.result.pane.pane_id')

# Start the agent
herdr agent start child-agent --kind codex --pane "$NEW_PANE"

# Report parent hierarchy (depth 1 = direct child)
herdr-report-agent-parent "$NEW_PANE" "loom" 1
```

For nested agents (grandchildren):

```bash
# From within a child agent that spawns another agent
herdr-report-agent-parent "$NEW_PANE" "shuttle" 2
```

## Helper Script

The `herdr-report-agent-parent` script is available at:
`~/.local/bin/herdr-report-agent-parent`

Usage:
```bash
herdr-report-agent-parent <pane-id> <parent-name> <depth>
```

## Example Sidebar Output

```
● working
├─ workflow_bridge_coder
  main ~108 ?12
  pldc-review-accelerator pi parent=loom

● idle
  shuttle-refactor
  main clean
  weave pi parent=loom

● working
  ├─ db-migration-task
    feature/db-refactor ~5
    myapp pi parent=shuttle
```

## Integration with pi/Herdr skill

You can integrate this into the Herdr skill by having pi automatically report parent metadata when delegating:

1. After `herdr agent start`, call `herdr-report-agent-parent`
2. Track the current agent's depth in context
3. Pass depth + 1 to child agents
