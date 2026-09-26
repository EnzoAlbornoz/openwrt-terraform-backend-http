global.handle_request = function (_env) {
    uhttpd.send("Status: 204 No Content\r\n\r\n");
};
