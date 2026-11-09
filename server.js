const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require("express");

const playimdb = require("./playimdb");

// Independent provider modules copied from the working NuvioStreams provider
// implementations. PlayIMDb intentionally remains the original 4KHDHub-Nick file.
const showbox = require("./providers/Showbox");
const fourKHDHub = require("./providers/4khdhub");
const hdhub4u = require("./providers/hdhub4u");
const cinejoy = require("./providers/cinejoy");
const vaplayer = require("./providers/vaplayer");

const TMDB_API_KEY = process.env.TMDB_API_KEY;

const addonConfig = [
  { key: "enableShowbox", type: "checkbox", title: "Enable ShowBox", default: "checked" },
  { key: "enable4KHDHub", type: "checkbox", title: "Enable 4KHDHub", default: "checked" },
  { key: "enableHDHub4u", type: "checkbox", title: "Enable HDHub4u", default: "checked" },
  { key: "enablePlayIMDb", type: "checkbox", title: "Enable PlayIMDb", default: "checked" },
  { key: "enableCinejoy", type: "checkbox", title: "Enable Cinejoy", default: "checked" },
  { key: "enableVAplayer", type: "checkbox", title: "Enable VAplayer", default: "checked" },
  { key: "showboxCookies", type: "text", title: "ShowBox cookies (comma-separated)", default: "" },
  { key: "showboxRegion", type: "text", title: "ShowBox region (for example USA7)", default: "USA7" }
];

const builder = new addonBuilder({
  id: "com.nick1234.4khdhub",
  version: "2.0.0",
  name: "4KHDHub Nick",
  description: "Independent movie and series providers",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  config: addonConfig,
  behaviorHints: {
    configurable: true,
    adult: false,
    p2pNotSupported: true
  }
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
  const results = type === "series" ? data.tv_results : data.movie_results;
  return results && results.length ? results[0].id : null;
}

async function getTmdbMetadata(tmdbId, type) {
  const endpoint = type === "series" ? "tv" : "movie";
  const response = await fetch(
    `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`
  );

  if (!response.ok) {
    throw new Error(`TMDB metadata lookup failed: ${response.status}`);
  }

  const data = await response.json();
  const date = type === "series" ? data.first_air_date : data.release_date;
  return {
    title: type === "series" ? data.name : data.title,
    year: date ? Number(String(date).slice(0, 4)) : null
  };
}

function isEnabled(config, key) {
  // No saved config means all providers start enabled. In Stremio checkbox
  // configs, checked values arrive as "on" and unchecked values are omitted.
  if (!config || Object.keys(config).length === 0) return true;
  return config[key] === "on" || config[key] === true || config[key] === "true";
}

function withTimeout(label, task, milliseconds = 28000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      console.warn(`[${label}] Timed out after ${milliseconds}ms`);
      resolve([]);
    }, milliseconds);

    Promise.resolve()
      .then(task)
      .then(value => {
        clearTimeout(timer);
        resolve(Array.isArray(value) ? value : []);
      })
      .catch(error => {
        clearTimeout(timer);
        console.error(`[${label}] Provider error:`, error && error.message ? error.message : error);
        resolve([]);
      });
  });
}

// ShowBox's upstream implementation reads request settings from a global.
// Serialize ShowBox calls so two users' cookie settings cannot overwrite one another.
let showboxQueue = Promise.resolve();

function getShowboxStreams(tmdbId, sourceType, season, episode, config) {
  const run = async () => {
    const previousConfig = global.currentRequestConfig;
    const previousRegion = global.currentRequestRegionPreference;
    const cookies = String(config.showboxCookies || "")
      .split(/[\r\n,;]+/)
      .map(value => value.trim())
      .filter(Boolean);
    const region = String(config.showboxRegion || "USA7").trim() || "USA7";

    global.currentRequestConfig = { cookies };
    global.currentRequestRegionPreference = region;

    try {
      return await showbox.getStreamsFromTmdbId(
        sourceType,
        String(tmdbId),
        season,
        episode,
        region,
        cookies,
        null
      );
    } finally {
      global.currentRequestConfig = previousConfig;
      global.currentRequestRegionPreference = previousRegion;
    }
  };

  const result = showboxQueue.then(run, run);
  showboxQueue = result.then(() => undefined, () => undefined);
  return result;
}

builder.defineStreamHandler(async ({ type, id, config = {} }) => {
  try {
    const parts = String(id || "").split(":");
    const imdbId = parts[0];

    if (!/^tt\d+$/.test(imdbId)) {
      return { streams: [] };
    }

    const tmdbId = await imdbToTmdb(imdbId, type);
    if (!tmdbId) return { streams: [] };

    const season = parts[1] ? Number(parts[1]) : undefined;
    const episode = parts[2] ? Number(parts[2]) : undefined;
    const sourceType = type === "series" ? "tv" : "movie";
    const needsEpisode = sourceType === "tv";

    if (needsEpisode && (!Number.isInteger(season) || !Number.isInteger(episode))) {
      return { streams: [] };
    }

    const metadataPromise = getTmdbMetadata(tmdbId, type).catch(error => {
      console.error("[TMDB] Metadata lookup failed:", error.message);
      return { title: "", year: null };
    });

    // Keep the original PlayIMDb call and original Stremio media type unchanged.
    const tasks = [
      isEnabled(config, "enableShowbox")
        ? withTimeout("ShowBox", () => getShowboxStreams(tmdbId, sourceType, season, episode, config), 35000)
        : Promise.resolve([]),

      isEnabled(config, "enable4KHDHub")
        ? withTimeout("4KHDHub", () => fourKHDHub.getStreams(String(tmdbId), sourceType, season, episode))
        : Promise.resolve([]),

      isEnabled(config, "enableHDHub4u")
        ? withTimeout("HDHub4u", async () => {
            const metadata = await metadataPromise;
            if (!metadata.title) return [];
            return hdhub4u.getHDHub4uStreams(
              String(tmdbId),
              sourceType,
              metadata.title,
              metadata.year,
              season,
              episode
            );
          })
        : Promise.resolve([]),

      isEnabled(config, "enablePlayIMDb")
        ? Promise.resolve().then(() => playimdb.getStreams(String(tmdbId), type, season, episode))
        : Promise.resolve([]),

      isEnabled(config, "enableCinejoy")
        ? withTimeout("Cinejoy", () => cinejoy.getCinejoyStreams(String(tmdbId), sourceType, season, episode))
        : Promise.resolve([]),

      isEnabled(config, "enableVAplayer")
        ? withTimeout("VAplayer", () => vaplayer.getVAplayerStreams(String(tmdbId), sourceType, season, episode))
        : Promise.resolve([])
    ];

    const results = await Promise.allSettled(tasks);
    const streams = results.flatMap((result, index) => {
      if (result.status !== "fulfilled" || !Array.isArray(result.value)) {
        console.error(`Provider ${index + 1} failed:`, result.status === "rejected" ? result.reason : "Invalid response");
        return [];
      }
      return result.value;
    });

    return { streams };
  } catch (error) {
    console.error("Stream handler error:", error && error.message ? error.message : error);
    return { streams: [] };
  }
});

const app = express();
app.use(getRouter(builder.getInterface()));

const port = Number(process.env.PORT) || 7000;
if (require.main === module) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`4KHDHub Nick listening on ${port}`);
  });
}

module.exports = app;
