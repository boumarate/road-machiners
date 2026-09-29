# Egress proxy for agent containers. It lets CONNECT and HTTP through to the hosts in allowlist and denies the rest.
FROM alpine:3.22

RUN apk add --no-cache tinyproxy

COPY tinyproxy.conf /etc/tinyproxy/tinyproxy.conf
COPY allowlist /etc/tinyproxy/allowlist

EXPOSE 8888
USER tinyproxy
CMD ["tinyproxy", "-d", "-c", "/etc/tinyproxy/tinyproxy.conf"]
