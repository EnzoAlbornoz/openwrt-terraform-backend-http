# terraform-backend-http

A [Terraform](https://developer.hashicorp.com/terraform/language/backend/http) /
[OpenTofu](https://opentofu.org/docs/language/settings/backends/http/) `http` state backend for
OpenWrt routers. It runs inside the router's existing web server (uhttpd) as a ucode handler under
`/terraform`, and stores states, with locking, on the router.

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

Create a user on the router (see [Users](#users)):

```sh
terraform-backend-user add ci
# Created user 'ci'. Its password, shown only this once:
# 9f2c...
```

Then configure the backend:

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

and pass the credentials through the environment, rather than writing them in the configuration:

```sh
export TF_HTTP_USERNAME=ci
export TF_HTTP_PASSWORD=9f2c...
```

Workspace and state names may contain letters, digits, `.`, `_` and `-`.

## Users

Every request must come over HTTPS, with the credentials of a user. Users are managed with
`terraform-backend-user` and stored in `/etc/config/terraform-backend`:

```sh
terraform-backend-user add ci home lab  # a user who may only access the workspaces home and lab
terraform-backend-user add admin        # a user who may access all workspaces
terraform-backend-user passwd ci        # replace the password of ci
terraform-backend-user del ci
terraform-backend-user list
```

Passwords are random tokens, shown once when created. Only a salted SHA-256 of them is stored, as
`sha256$<salt>$<hex digest>`.

To change the workspaces of a user:

```sh
uci add_list terraform-backend.ci.workspace='office'
uci del_list terraform-backend.ci.workspace='lab'
uci commit terraform-backend
```

Failed logins and denied workspaces are logged to syslog (`logread -e terraform-backend`).

On a trusted network, authentication can be turned off. Anyone who can reach the router can then
read and overwrite states, which often contain secrets. HTTPS is still required unless
`auth.allow_http` is set too.

```sh
uci set terraform-backend.auth.enabled='0'
uci commit terraform-backend
```

## Configure

Settings live in `/etc/config/terraform-backend`, and apply from the next request:

| Option                   | Default              | Description                                                     |
| ------------------------ | -------------------- | --------------------------------------------------------------- |
| `storage.state_dir`      | `/etc/terraform`     | Where states are stored                                         |
| `storage.lock_dir`       | `/var/run/terraform` | Where locks are kept (keep it on tmpfs)                         |
| `storage.max_state_size` | `16M`                | Largest accepted state, in bytes or with `K`/`M`                |
| `auth.enabled`           | `1`                  | Require the credentials of a user (see [Users](#users))         |
| `auth.allow_http`        | `0`                  | Also serve plain HTTP (only behind a proxy that terminates TLS) |

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
