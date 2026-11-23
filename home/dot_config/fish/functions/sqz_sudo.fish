function sqz_sudo
    sudo $argv 2>&1 | SQZ_CMD="sudo $argv" sqz compress
end
