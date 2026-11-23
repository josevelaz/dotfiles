function sqz_run
    $argv 2>&1 | SQZ_CMD="$argv" sqz compress
end
