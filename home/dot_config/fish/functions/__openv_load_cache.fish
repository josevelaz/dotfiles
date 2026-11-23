# Export every KEY=VALUE line of a cache file, dropping one layer of quotes.
function __openv_load_cache -a environment
    set -l file (__openv_cache_file $environment); or return 1
    test -r $file; or return 1
    while read -l line
        set -l kv (string split -m1 = -- $line)
        string match -qr '^[A-Za-z_][A-Za-z0-9_]*$' -- $kv[1]; or continue
        set -l value $kv[2]
        if string match -qr '^(["\']).*\1$' -- $value
            set value (string sub -s 2 -e -1 -- $value)
        end
        set -gx $kv[1] $value
    end <$file
end
