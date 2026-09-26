import { createApp, getRouterParam, serve, throwHTTPError } from "./http.js";

// Routes are relative to the uhttpd prefix: /<workspace>/<state>
const app = createApp()
    // Authentication Middleware
    .use((event, next) => {
        // TODO: Implement authentication logic here
        // TODO: Not intended to do now
        const authorization = event.req.headers["authorization"];
        if (!authorization) throwHTTPError(401);

        return next();
    })
    // Try Lock Terraform State
    .post("/:workspace/:state/lock", (event) => {})
    // Try Unlock Terraform State
    .delete("/:workspace/:state/lock", (event) => {})
    // Read Terraform State
    .get("/:workspace/:state", (event) => {
        const workspace = getRouterParam(event, "workspace", { decode: true });
        const state = getRouterParam(event, "state", { decode: true });

        return workspace + "/" + state + "\n";
    })
    // Write Terraform State
    .post("/:workspace/:state", (event) => {})
    // Delete Terraform State
    .delete("/:workspace/:state", (event) => {});

serve(app);
