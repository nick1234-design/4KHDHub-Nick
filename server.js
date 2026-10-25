
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require("express");
const provider = require("./provider");
const playimdb = require("./playimdb");

const TMDB_API_KEY = process.env.TMDB_API_KEY;

const builder = new addonBuilder({
  id: "com.nick1234.4khdhub",
  version: "1.1.0",
  name: "4KHDHub Nick",
  description: "Movie and series streams from multiple providers",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"]
});

async function imdbToTmdb(imdbId, type) {
  if (!TMDB_API_KEY) {
    throw new Error("TMDB_API_KEY environment variable is missing");
  }

  const response = await fetch(
    `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?external_source=imdb_id&api_key=${TMDB_API_KEY}`
  );

  if (!response.ok) {
    throw new Error(`TMDB lookup failed: ${response.status}`);
  }

  const data = await response.json();
  const results = type === "series"
    ? data.tv_results
    : data.movie_results;

  return results && results.length ? results[0].id : null;
}

builder.defineStreamHandler(async ({ type, id }) => {
  try {
    const parts = id.split(":");
    const imdbId = parts[0];

    if (!/^tt\d+$/.test(imdbId)) {
      return { streams: [] };
    }

    const tmdbId = await imdbToTmdb(imdbId, type);

    if (!tmdbId) {
      return { streams: [] };
    }

    const season = parts[1] ? Number(parts[1]) : undefined;
    const episode = parts[2] ? Number(parts[2]) : undefined;

    const results = await Promise.allSettled([
      provider.getStreams(String(tmdbId), type, season, episode),
      playimdb.getStreams(String(tmdbId), type, season, episode)
    ]);

    const streams = results.flatMap((result, index) => {
      if (result.status !== "fulfilled" || !Array.isArray(result.value)) {
        console.error(
          `Provider ${index + 1} failed:`,
          result.status === "rejected" ? result.reason : "Invalid response"
        );
        return [];
      }

      return result.value;
    });

    return { streams };
  } catch (error) {
    console.error("Stream handler error:", error.message);
    return { streams: [] };
  }
});

const app = express();
app.use(getRouter(builder.getInterface()));

const port = Number(process.env.PORT) || 7000;
app.listen(port, "0.0.0.0", () => {
  console.log(`4KHDHub Nick listening on ${port}`);
});