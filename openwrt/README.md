# OpenWrt packaging

- `feed/` is an OpenWrt package feed with the `terraform-backend-http` package. Its Makefile
  installs the compiled handler, it does not build it: copy `packages/handler/dist/index.uc` to
  `feed/terraform-backend-http/files/handler.uc` first.
- `keys/` holds the public keys the package repositories are signed with.

## Releasing

Publish a GitHub release with a tag like `v1.2.3`. The
[release workflow](../.github/workflows/release.yml) then:

1. tests and builds the handler;
2. builds the package with the OpenWrt SDK, as `.ipk` (24.10, opkg) and `.apk` (25.12, apk), with
   `PKG_VERSION` taken from the tag;
3. attaches both to the release, and publishes the signed repositories on GitHub Pages
   (`/opkg`, `/apk`, `/keys`).

Pages only holds the latest release. Running the workflow manually builds the packages without
publishing them.

## One-time setup

### Signing keys

Routers only accept signed repositories, with a usign key for opkg and an ECDSA key for apk.
Private keys go into repository secrets, public keys into `keys/`.

**usign** (opkg). `usign` ships with every OpenWrt router, so the easiest place to run it is the
router:

```sh
usign -G -s /tmp/key-build -p /tmp/key-build.pub -c "terraform-backend-http"
cat /tmp/key-build       # → secret USIGN_PRIVATE_KEY (both lines)
cat /tmp/key-build.pub   # → openwrt/keys/usign.pub
rm /tmp/key-build
```

**apk** (OpenSSL is included with Git for Windows):

```sh
openssl ecparam -name prime256v1 -genkey -noout -out apk-private.pem
openssl ec -in apk-private.pem -pubout -out openwrt/keys/apk.pem
cat apk-private.pem      # → secret APK_PRIVATE_KEY
rm apk-private.pem
```

Add the secrets under *Settings → Secrets and variables → Actions*, and commit both public keys.

### GitHub Pages

1. *Settings → Pages → Build and deployment → Source*: **GitHub Actions**.
2. *Settings → Environments → github-pages → Deployment branches and tags*: add a tag rule `v*`.
   Releases deploy from their tag, which the default rule (default branch only) rejects.

## Building locally

With an [OpenWrt SDK](https://openwrt.org/docs/guide-developer/using_the_sdk):

```sh
echo "src-link terraform /path/to/repo/openwrt/feed" >> feeds.conf
./scripts/feeds update terraform
./scripts/feeds install -p terraform terraform-backend-http
make package/terraform-backend-http/compile V=s
```
