import { createApp, getRouterParams, serve } from "./http.js";

// Routes are relative to the uhttpd prefix: /<workspace>/<state>
const app = createApp().all("/:workspace/:state", (event) => {
    const params = getRouterParams(event, { decode: true });

    // Handle the request based on workspace and state
    event.res.status = 501;

    return params["workspace"] + "/" + params["state"] + "\n";
});

serve(app);
