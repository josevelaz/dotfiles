tmux \
    new-session  'cd ~/repos/api/src && git switch master && composer install && php artisan serve' \; \
    split-window -h 'cd ~/repos/permissions && git switch master && npm install && npm run start' \; \
    split-window 'cd ~/repos/authservice && git switch master && npm install && npm run start' \; \
    split-window -h 'cd ~/repos/transactions && git switch master && npm install && npm run start' \; \
    split-window 'cd ~/repos/fattquery && git switch master && npm install && npm run start' \; \
