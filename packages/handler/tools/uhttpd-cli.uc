// Runs a uhttpd ucode handler from the ucode CLI, standing in for uhttpd's
// ucode plugin: loads the handler as a template, then calls handle_request().
//
//   ucode [-L <module dir>]... tools/uhttpd-cli.uc dist/index.uc ['{"REQUEST_METHOD":"GET",...}']
//
// Static imports in the handler resolve through the CLI's module search path:
// the defaults (/usr/lib/ucode/*.so, /usr/share/ucode/*.uc) plus every `-L`.

global.uhttpd = {
	send: function(...args) {
		for (let arg in args)
			print(arg);
	},
	recv: function(len) {
		return null;
	},
	urlencode: function(str) {
		return str;
	},
	urldecode: function(str) {
		return str;
	},
	flush: function() {},
	docroot: "/www",
};
global.uhttpd.sendc = global.uhttpd.send;

loadfile(ARGV[0], { raw_mode: false })();
handle_request(json(ARGV[1] ?? '{ "REQUEST_METHOD": "GET" }'));
