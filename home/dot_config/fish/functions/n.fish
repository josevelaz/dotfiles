# nvim on the current directory, or on the given files.
function n
    if test (count $argv) -eq 0
        command nvim .
    else
        command nvim $argv
    end
end
