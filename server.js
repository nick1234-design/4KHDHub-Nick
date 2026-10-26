
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require("express");
const provider = require("./provider");
const playimdb = require("./playimdb");
const fourKHDHub = require("./4khdhub-extractor");

const TMDB_API_KEY = process.env.TMDB_API_KEY;

const builder = new addonBuilder({
  id: "com.nick1234.4khdhub",
  version: "1.2.0",
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

async function getTmdbTitle(tmdbId, type) {
  const endpoint = type === "series" ? "tv" : "movie";
  const response = await fetch(
    `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`
  );

  if (!response.ok) {
    throw new Error(`TMDB title lookup failed: ${response.status}`);
  }

  const data = await response.json();
  return type === "series" ? data.name : data.title;
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(candidate, query) {
  const a = normalizeTitle(candidate);
  const b = normalizeTitle(query);

  if (!a || !b) return 0;
  if (a === b) return 100;

  const queryWords = b.split(" ");
  const candidateWords = a.split(" ");
  const matched = queryWords.filter(word =>
    candidateWords.some(other => other === word)
  ).length;

  let score = (matched / queryWords.length) * 70;

  if (a.includes(b) || b.includes(a)) {
    score += 20;
  }

  score -= Math.min(10, Math.abs(a.length - b.length) / 5);
  return score;
}

async function get4KHDHubStreams(title, type, season, episode) {
  try {
    const results = await fourKHDHub.searchContent(title);

    if (!Array.isArray(results) || results.length === 0) {
      return [];
    }

    const ranked = results
      .map(result => ({
        ...result,
        score: titleScore(result.title, title)
      }))
      .sort((a, b) => b.score - a.score);

    const match = ranked[0];

    // Avoid returning streams for a clearly different title.
    if (!match || match.score < 65) {
      console.log("4KHDHub: no confident title match");
      return [];
    }

    const content = await fourKHDHub.loadContent(match.url);

    if (!content || content.type !== type) {
      return [];
    }

    let downloadLinks = [];

    if (type === "movie") {
      downloadLinks = content.downloadLinks || [];
    } else {
      if (!Number.isInteger(season) || !Number.isInteger(episode)) {
        return [];
      }

      const selectedEpisode = (content.episodes || []).find(item =>
        item.season === season && item.episode === episode
      );

      if (!selectedEpisode) {
        return [];
      }

      downloadLinks = selectedEpisode.downloadLinks || [];
    }

    if (!downloadLinks.length) {
      return [];
    }

    const links = await fourKHDHub.extractStreamingLinks(downloadLinks);

    if (!Array.isArray(links)) {
      return [];
    }

    return links
      .filter(link =>
        link &&
        typeof link.url === "string" &&
        /^https?:\/\//i.test(link.url)
      )
      .map(link => ({
        name: "4KHDHub",
        title: `4KHDHub | ${link.name || "Direct link"}${link.quality ? ` | ${link.quality}p` : ""}`,
        url: link.url
      }));
  } catch (error) {
    console.error("4KHDHub provider failed:", error.message);
    return [];
  }
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
      playimdb.getStreams(String(tmdbId), type, season, episode),
      (async () => {
        const title = await getTmdbTitle(tmdbId, type);
        if (!title) return [];

        // Keep slow extraction from blocking the response indefinitely.
        return Promise.race([
          get4KHDHubStreams(title, type, season, episode),
          new Promise(resolve =>
            setTimeout(() => resolve([]), 12000)
          )
        ]);
      })()
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