function compress -a target
    set target (string trim -r -c / -- $target)
    tar -czf $target.tar.gz $target
end
