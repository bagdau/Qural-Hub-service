#!/bin/sh
# DNS для кэша плиток карты. По умолчанию публичные DNS, затем встроенный DNS Docker; свои — через TILE_DNS="10.0.0.1 10.0.0.2".
R="${TILE_DNS:-1.1.1.1 8.8.8.8 127.0.0.11}"
echo "resolver $R valid=300s ipv6=off;" > /tmp/resolver.conf
echo "11-resolver: $R"
