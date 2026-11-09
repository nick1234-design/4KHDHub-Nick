// Vercel serverless entry point. Keep all routes on the same current app
// so the legacy API handler cannot serve an outdated add-on without /configure.
module.exports = require("../server");
