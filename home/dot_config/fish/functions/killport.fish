function killport -a port
    if test -z "$port"
        echo "Usage: killport <port>" >&2
        return 1
    end
    set -l pids (lsof -ti tcp:$port 2>/dev/null)
    if test (count $pids) -eq 0
        echo "No process found on port $port"
        return 0
    end
    echo "Killing process(es) on port $port:"
    for pid in $pids
        echo "  → PID "(ps -p $pid -o pid=,comm= 2>/dev/null)
        if kill -9 $pid 2>/dev/null
            echo "    ✓ killed"
        else
            echo "    ✗ failed (permission denied?)"
        end
    end
end
