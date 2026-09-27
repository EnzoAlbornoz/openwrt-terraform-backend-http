#
# Terraform/OpenTofu HTTP state backend, served by uhttpd's ucode plugin.
#
# The handler is written in TypeScript and compiled to ucode outside of the
# OpenWrt build (see packages/handler). Copy the compiled handler to
# files/handler.uc before building this package; the release workflow
# (.github/workflows/release.yml) does so, and sets PKG_VERSION from the tag.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=terraform-backend-http
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

PKG_MAINTAINER:=Enzo Coelho Albornoz <enzo@albornoz.com.br>
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/terraform-backend-http
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Web Servers/Proxies
  TITLE:=Terraform/OpenTofu HTTP state backend for uhttpd
  DEPENDS:=+uhttpd +uhttpd-mod-ucode +ucode-mod-digest +ucode-mod-fs +ucode-mod-log +ucode-mod-uci
  PKGARCH:=all
endef

define Package/terraform-backend-http/description
 Stores Terraform and OpenTofu states on the router, with locking, through
 their "http" backend. Served by uhttpd under /terraform; states are kept in
 /etc/terraform by default (see /etc/config/terraform-backend). Clients
 authenticate as users created with terraform-backend-user.
endef

define Package/terraform-backend-http/conffiles
/etc/config/terraform-backend
endef

define Build/Prepare
	@[ -f ./files/handler.uc ] || { \
		echo "files/handler.uc is missing: build packages/handler and copy dist/index.uc there" >&2; \
		exit 1; \
	}
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/terraform-backend-http/install
	$(INSTALL_DIR) $(1)/usr/share/ucode/terraform-backend
	$(INSTALL_DATA) ./files/handler.uc $(1)/usr/share/ucode/terraform-backend/handler.uc
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/terraform-backend-user $(1)/usr/sbin/terraform-backend-user
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/terraform-backend.config $(1)/etc/config/terraform-backend
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/terraform-backend.uci-defaults $(1)/etc/uci-defaults/90-terraform-backend
	$(INSTALL_DIR) $(1)/lib/upgrade/keep.d
	$(INSTALL_DATA) ./files/terraform-backend.keep $(1)/lib/upgrade/keep.d/terraform-backend
endef

# The uci-defaults script (run by default_postinst) registers the handler
# with uhttpd, which only reads its prefixes on start.
define Package/terraform-backend-http/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || /etc/init.d/uhttpd restart
exit 0
endef

define Package/terraform-backend-http/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

handler=/usr/share/ucode/terraform-backend/handler.uc

for entry in $$(uci -q get uhttpd.main.ucode_prefix); do
	case "$$entry" in
	*="$$handler") uci -q del_list uhttpd.main.ucode_prefix="$$entry" ;;
	esac
done

uci -q commit uhttpd
/etc/init.d/uhttpd restart
exit 0
endef

$(eval $(call BuildPackage,terraform-backend-http))
