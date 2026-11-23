function ga -a branch
    if test -z "$branch"
        echo "Usage: ga [branch name]"
        return 1
    end
    set -l wt_path ../(basename $PWD)--$branch
    git worktree add -b $branch $wt_path; or return
    command -q mise; and mise trust $wt_path
    cd $wt_path
end
