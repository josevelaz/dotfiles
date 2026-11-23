# Path of the cached values for a 1Password environment (KEY=VALUE lines).
function __openv_cache_file -a environment
    test -n "$environment"; or set environment $OP_DEFAULT_ENVIRONMENT
    if not string match -qr '^[A-Za-z0-9_-]+$' -- $environment
        echo "openv: invalid environment ID: $environment" >&2
        return 1
    end
    set -l cache (set -q XDG_CACHE_HOME; and echo $XDG_CACHE_HOME; or echo $HOME/.cache)
    echo $cache/fish/op-environments/$environment.env
end
