tmux \
    new-session  'compass watch /path/to/project1/compass/' \; \
    split-window 'compass watch /path/to/project2/compass/' \; \
    detach-client
