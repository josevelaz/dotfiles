function oai-lb
    docker volume create oai-lb-data
    docker run -d --name oai-lb \
        -p 2455:2455 -p 1455:1455 \
        -v codex-lb-data:/var/lib/codex-lb \
        ghcr.io/soju6/codex-lb:latest
end
