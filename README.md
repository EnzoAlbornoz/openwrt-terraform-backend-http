# terraform-backend-http

A [Terraform](https://developer.hashicorp.com/terraform/language/backend/http) /
[OpenTofu](https://opentofu.org/docs/language/settings/backends/http/) `http` state backend for
OpenWrt routers. It runs inside the router's existing web server (uhttpd) as a ucode handler under
`/terraform`, and stores states, with locking, on the router.

> [!WARNING]
> Version 0.1 has **no authentication**: anyone who can reach the router's web server can read and
> overwrite states, which often contain secrets. Only use it on a trusted network.

## Install

Add the package repository once, then install the package. New releases show up as regular package
upgrades.

**OpenWrt 25.12 and newer (apk):**

```sh
wget -O /etc/apk/keys/terraform-backend.pem https://enzoalbornoz.github.io/openwrt-terraform-backend-http/keys/apk.pem
echo 'https://enzoalbornoz.github.io/openwrt-terraform-backend-http/apk/packages.adb' >> /etc/apk/repositories.d/customfeeds.list
apk update
apk add terraform-backend-http
```

**OpenWrt 24.10 and older (opkg):**

```sh
wget -O /tmp/terraform-backend.pub https://enzoalbornoz.github.io/openwrt-terraform-backend-http/keys/usign.pub
opkg-key add /tmp/terraform-backend.pub
echo 'src/gz terraform https://enzoalbornoz.github.io/openwrt-terraform-backend-http/opkg' >> /etc/opkg/customfeeds.conf
opkg update
opkg install terraform-backend-http
```

To upgrade later: `apk update && apk upgrade terraform-backend-http`, or
`opkg update && opkg upgrade terraform-backend-http`.

Installing registers the handler with the main uhttpd instance and restarts it:

```
uci get uhttpd.main.ucode_prefix
# ... /terraform=/usr/share/ucode/terraform-backend/handler.uc
```

## Use

```hcl
terraform {
  backend "http" {
    address        = "https://192.168.1.1/terraform/<workspace>/<state>"
    lock_address   = "https://192.168.1.1/terraform/<workspace>/<state>/lock"
    unlock_address = "https://192.168.1.1/terraform/<workspace>/<state>/lock"
    lock_method    = "POST"
    unlock_method  = "DELETE"

    # uhttpd usually serves a self-signed certificate.
    skip_cert_verification = true
  }
}
```

Workspace and state names may contain letters, digits, `.`, `_` and `-`.

## Configure

Settings live in `/etc/config/terraform-backend`, and apply from the next request:

| Option                   | Default              | Description                                      |
| ------------------------ | -------------------- | ------------------------------------------------ |
| `storage.state_dir`      | `/etc/terraform`     | Where states are stored                          |
| `storage.lock_dir`       | `/var/run/terraform` | Where locks are kept (keep it on tmpfs)          |
| `storage.max_state_size` | `16M`                | Largest accepted state, in bytes or with `K`/`M` |

For example, to keep states on a USB drive instead of the flash:

```sh
uci set terraform-backend.storage.state_dir='/mnt/usb/terraform'
uci commit terraform-backend
```

`/etc/terraform` is kept across `sysupgrade`. Other state directories are not, unless you add them to
`/etc/sysupgrade.conf`.

To serve it under another prefix, change the uhttpd mapping:

```sh
uci del_list uhttpd.main.ucode_prefix='/terraform=/usr/share/ucode/terraform-backend/handler.uc'
uci add_list uhttpd.main.ucode_prefix='/tfstate=/usr/share/ucode/terraform-backend/handler.uc'
uci commit uhttpd
/etc/init.d/uhttpd restart
```

## Development

The handler is written in TypeScript and compiled to ucode, see [packages/handler](packages/handler).
Tools are managed with [mise](https://mise.jdx.dev):

```sh
mise install
aube install
cd packages/handler
aube run test
aube run build   # dist/index.uc
```

Packaging and releases are described in [openwrt/README.md](openwrt/README.md).
