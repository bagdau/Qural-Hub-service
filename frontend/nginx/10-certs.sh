#!/bin/sh
# Сертификат для HTTPS: свой из /etc/nginx/certs (папка certs/ проекта), иначе встроенный для localhost.
mkdir -p /tmp/certs
if [ -s /etc/nginx/certs/server.crt ] && [ -s /etc/nginx/certs/server.key ]; then
  cp /etc/nginx/certs/server.crt /etc/nginx/certs/server.key /tmp/certs/
  echo "10-certs: используется сертификат из certs/"
else
  cp /opt/default-certs/server.crt /opt/default-certs/server.key /tmp/certs/
  echo "10-certs: certs/ пуст, используется встроенный сертификат для localhost (см. scripts/make_cert.sh)"
fi
