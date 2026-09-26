import { pathSegments, send, serve } from "./http.js";

global.handle_request = serve((req) => {
    // Parse URL as /<workspace>/<state> format
    const path = pathSegments(req);

    if (path == null || length(path) != 2) {
        send(req, 404);
        return;
    }

    const workspace = path[0] as string;
    const state = path[1] as string;

    // Handle the request based on workspace and state
    send(req, 501, workspace + "/" + state + "\n", "text/plain");
});
