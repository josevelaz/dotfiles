function __openv_use_stale_cache -a environment reason
    if __openv_load_cache $environment
        echo "openv: warning: $reason; using cached values for $environment" >&2
        return 0
    end
    echo "openv: error: $reason and no usable cache exists for $environment" >&2
    return 1
end
