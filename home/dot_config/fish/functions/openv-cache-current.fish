# Replace the default environment's cache with the current values of VARIABLE...
function openv-cache-current
    if test (count $argv) -eq 0
        echo "Usage: openv-cache-current VARIABLE..." >&2
        return 1
    end
    set -l environment $OP_DEFAULT_ENVIRONMENT
    set -l file (__openv_cache_file $environment); or return 1
    set -l dir (path dirname $file)
    if not mkdir -p -m 700 $dir; or not chmod 700 $dir
        echo "openv: error: could not prepare the cache directory" >&2
        return 1
    end
    set -l tmp (umask 077; mktemp $dir/.$environment.XXXXXX); or return 1
    for variable in $argv
        if not string match -qr '^[A-Za-z_][A-Za-z0-9_]*$' -- $variable; or not set -q $variable
            rm -f $tmp
            echo "openv: error: variable is not set: $variable" >&2
            return 1
        end
        set -gx $variable $$variable
        printf '%s=%s\n' $variable "$$variable" >>$tmp
    end
    if not chmod 600 $tmp; or not mv -f $tmp $file
        rm -f $tmp
        echo "openv: error: could not update the cache" >&2
        return 1
    end
    echo "openv: cached current values for $environment"
end
