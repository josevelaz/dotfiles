function _herdr_ratio -a a b
    awk -v a=$a -v b=$b 'BEGIN { printf "%.4f", a / b }'
end
