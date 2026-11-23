# yazi, then cd into the directory it was left in.
function y
    set -l tmp (mktemp -t yazi-cwd.XXXXXX)
    command yazi $argv --cwd-file=$tmp
    set -l cwd (command cat -- $tmp)
    if test -n "$cwd"; and test "$cwd" != "$PWD"; and test -d "$cwd"
        builtin cd -- $cwd
    end
    command rm -f -- $tmp
end
