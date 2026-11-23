# Split a herdr pane and print the new pane id. Usage: _herdr_split <pane> <right|down> <ratio> <cwd>
function _herdr_split
    herdr pane split $argv[1] --direction $argv[2] --ratio $argv[3] --cwd $argv[4] --no-focus | jq -r .result.pane.pane_id
end
