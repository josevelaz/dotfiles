function openv-clear -a environment
    test -n "$environment"; or set environment $OP_DEFAULT_ENVIRONMENT
    set -l file (__openv_cache_file $environment); or return 1
    rm -f $file; or return 1
    echo "openv: cleared cache for $environment"
end
