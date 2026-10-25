
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const provider = require("./provider");

const builder = new addonBuilder({
  id: "com.nick1234.4khdhub",
  version: "1.0.0",
  name: "4KHDHub Nick",
  description: "Personal 4KHDHub movie and series add-on",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  try {
    const [imdbId, season, episode] = id.split(":");
    const tmdbId = imdbId.replace(/^tt/, "");

    const streams = await provider.getStreams(
      tmdbId,
      type,
      season ? Number(season) : undefined,
      episode ? Number(episode) : undefined
    );

    return { streams };
  } catch (error) {
    console.error("Stream handler error:", error);
    return { streams: [] };
  }
});

const addonInterface = builder.getInterface();
const express = require("express");
const app = express();

app.use(getRouter(addonInterface));

const port = process.env.PORT || 7000;
app.listen(port, () => {
  console.log(`4KHDHub Nick listening on port ${port}`);
});