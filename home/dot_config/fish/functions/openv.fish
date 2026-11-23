function openv
    argparse q/quiet -- $argv; or return
    set -l environment $argv[1]
    test -n "$environment"; or set environment $OP_DEFAULT_ENVIRONMENT
    __openv_load_cache $environment; and return
    if set -q _flag_quiet
        command -q op; or return 0
        op whoami >/dev/null 2>&1; or return 0
        openv-refresh $environment 2>/dev/null
        return 0
    end
    openv-refresh $environment
end
