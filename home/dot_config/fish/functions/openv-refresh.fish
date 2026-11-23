function openv-refresh -a environment
    test -n "$environment"; or set environment $OP_DEFAULT_ENVIRONMENT
    set -l file (__openv_cache_file $environment); or return 1
    set -l dir (path dirname $file)
    if not mkdir -p -m 700 $dir; or not chmod 700 $dir
        __openv_use_stale_cache $environment "could not prepare the cache directory"
        return
    end
    set -l tmp (umask 077; mktemp $dir/.$environment.XXXXXX)
    or begin
        __openv_use_stale_cache $environment "could not create a cache file"
        return
    end
    if not op environment read $environment >$tmp
        rm -f $tmp
        __openv_use_stale_cache $environment "could not refresh from 1Password"
        return
    end
    if not chmod 600 $tmp; or not mv -f $tmp $file
        rm -f $tmp
        __openv_use_stale_cache $environment "could not update the cache"
        return
    end
    __openv_load_cache $environment
    or begin
        echo "openv: error: refreshed cache for $environment could not be loaded" >&2
        return 1
    end
end
