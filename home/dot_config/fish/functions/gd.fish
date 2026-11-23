function gd
    gum confirm "Remove worktree and branch?"; or return
    set -l cwd (pwd)
    set -l worktree (basename $cwd)
    set -l parts (string split -m1 -- -- $worktree)
    test (count $parts) -eq 2; or return
    cd ../$parts[1]
    git worktree remove $cwd --force; or return 1
    git branch -D $parts[2]
end
