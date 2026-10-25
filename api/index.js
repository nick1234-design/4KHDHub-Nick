
const express = require("express");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const provider = require("../provider");

const TMDB_API_KEY = process.env.TMDB_API_KEY;

const builder = new addonBuilder({
  id: "com.nick1234.4khdhub",
  version: "1.0.0",
  name: "4KHDHub Nick",
  description: "Movie and series streams",
  resources: ["stream"],
  types: ["movie", "series"],
  idPrefixes: ["tt"]
});

async function imdbToTmdb(imdbId, type) {
  if (!TMDB_API_KEY) {
    throw new Error("TMDB_API_KEY is missing");
  }

  const url =
    `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}` +
    `?external_source=imdb_id&api_key=${encodeURIComponent(TMDB_API_KEY)}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`TMDB lookup failed: ${response.status}`);
  }

  const data = await response.json();
  const results =
    type === "series" ? data.tv_results : data.movie_results;

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

    const streams = await provider.getStreams(
      String(tmdbId),
      type,
      season,
      episode
    );

    return { streams: Array.isArray(streams) ? streams : [] };
  } catch (error) {
    console.error("Stream handler error:", error.message);
    return { streams: [] };
  }
});

const app = express();
app.use(getRouter(builder.getInterface()));

module.exports = app;