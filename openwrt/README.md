# OpenWrt packaging

How the handler becomes an installable OpenWrt package, and how releases are published. For
installing and using the package, see the [main README](../README.md).

## Layout

```
openwrt/
├── feed/                         OpenWrt package feed
│   └── terraform-backend-http/
│       ├── Makefile              package definition (version, dependencies, install steps)
│       └── files/
│           ├── handler.uc                        compiled handler (not committed, see below)
│           ├── terraform-backend-user            user management CLI → /usr/sbin
│           ├── terraform-backend.config          default settings → /etc/config/terraform-backend
│           ├── terraform-backend.uci-defaults    registers /terraform with uhttpd on install
│           └── terraform-backend.keep            keeps /etc/terraform across sysupgrade
└── keys/                         public keys the package repositories are signed with
    ├── be6b587fbd94bc4f          usign key (opkg), named after its fingerprint
    └── openwrt-terraform-backend-http.pub        ECDSA key (apk)
```

The package does not compile anything. The handler is TypeScript compiled to ucode outside of the
OpenWrt build (see [packages/handler](../packages/handler)), and the Makefile only installs the result.
It must be copied to `files/handler.uc` before building; the build stops with an error otherwise. The
file is git-ignored.

The package is architecture independent (`PKGARCH:=all`), so a single build works on every router.

## Releasing

1. Publish a GitHub release with a tag like `v1.2.3`. Only plain versions are accepted, because apk
   rejects anything else in `PKG_VERSION`: `v1.2.3-rc1` fails the build.
2. The [release workflow](../.github/workflows/release.yml) then:
   1. checks (format, lint, tests) and builds the handler;
   2. builds the package with the OpenWrt SDK, with `PKG_VERSION` taken from the tag:
      - `.ipk` with the 24.10 SDK, for opkg;
      - `.apk` with the 25.12 SDK, for apk;
   3. attaches both packages to the release;
   4. publishes the signed repositories on GitHub Pages:

      | Path     | Contents                                    |
      | -------- | ------------------------------------------- |
      | `/opkg/` | opkg repository (OpenWrt 24.10 and older)   |
      | `/apk/`  | apk repository (OpenWrt 25.12 and newer)    |
      | `/keys/` | the two public keys from `openwrt/keys/`    |

Pages only holds the latest release. Older packages stay available as release assets.

Running the workflow manually (*Actions → Release → Run workflow*) builds and signs the packages
without publishing them, and keeps the `PKG_VERSION` of the Makefile. The packages can be downloaded
from the run's artifacts (`repo-opkg`, `repo-apk`).

## One-time setup

### Signing keys

Routers only accept signed repositories: opkg checks a usign signature, apk an ECDSA one. The
private keys go into repository secrets, the public keys into `keys/`.

> [!WARNING]
> Replacing a key breaks upgrades on every router that already trusts the old one, until the new
> public key is installed there. Only do it when a key is lost or leaked.

**usign** (opkg). `usign` ships with every OpenWrt router, so the easiest place to run it is a router:

```sh
usign -G -s /tmp/key-build -p /tmp/key-build.pub -c "terraform-backend-http"
usign -F -p /tmp/key-build.pub   # prints the fingerprint, e.g. be6b587fbd94bc4f
cat /tmp/key-build               # → secret USIGN_PRIVATE_KEY (both lines)
cat /tmp/key-build.pub           # → openwrt/keys/<fingerprint>
rm /tmp/key-build
```

The public key file is named after its fingerprint, as `opkg-key` does. With a new key, update that
name in the [release workflow](../.github/workflows/release.yml) (step *Add public keys*) and in
the install instructions of the [main README](../README.md).

**apk** (OpenSSL is included with Git for Windows):

```sh
openssl ecparam -name prime256v1 -genkey -noout -out apk-private.pem
openssl ec -in apk-private.pem -pubout -out openwrt/keys/openwrt-terraform-backend-http.pub
cat apk-private.pem              # → secret APK_PRIVATE_KEY
rm apk-private.pem
```

Add both secrets under *Settings → Secrets and variables → Actions*, and commit both public keys.
Without a secret, the workflow fails with *Missing the opkg/apk signing key secret*.

### GitHub Pages

1. *Settings → Pages → Build and deployment → Source*: **GitHub Actions**.
2. *Settings → Environments → github-pages → Deployment branches and tags*: add a tag rule `v*`.
   Releases deploy from their tag, which the default rule (default branch only) rejects.

## Building locally

With an [OpenWrt SDK](https://openwrt.org/docs/guide-developer/using_the_sdk) (24.10 for `.ipk`,
25.12 or newer for `.apk`), on Linux or WSL.

First build the handler and copy it into the feed, from the repository root:

```sh
cd packages/handler && aube run build && cd ../..
cp packages/handler/dist/index.uc openwrt/feed/terraform-backend-http/files/handler.uc
```

Then, in the SDK directory (`src-link` needs an absolute path):

```sh
echo "src-link terraform /path/to/repo/openwrt/feed" >> feeds.conf
./scripts/feeds update terraform
./scripts/feeds install -p terraform terraform-backend-http
make package/terraform-backend-http/compile V=s
```

The package ends up in `bin/packages/<arch>/terraform/`. To try it on a router, copy it over and
install it with `opkg install ./terraform-backend-http_*.ipk` or
`apk add --allow-untrusted ./terraform-backend-http-*.apk`.
