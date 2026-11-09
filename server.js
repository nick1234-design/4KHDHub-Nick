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
    adult: false
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
const addonInterface = builder.getInterface();

// Standalone provider configuration page. Do not call landingTemplate here:
// it is not exported by the pinned stremio-addon-sdk 1.6.x package and would
// crash the Vercel function during module initialization.
const configurePage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>4KHDHub Nick — Configuration</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#101116;color:#f5f5f7;font:16px system-ui,sans-serif}
main{max-width:620px;margin:32px auto;padding:24px}h1{margin:0 0 8px;font-size:28px}
p{color:#b9bac4;line-height:1.5}.panel{background:#1b1d25;border:1px solid #333642;border-radius:16px;padding:18px;margin:18px 0}
label{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #333642}
label:last-child{border:0}input[type=checkbox]{width:20px;height:20px;accent-color:#8b7cff}
input[type=text],textarea{width:100%;margin-top:8px;padding:12px;border-radius:9px;border:1px solid #454957;background:#11131a;color:white}
button,a.install{display:block;width:100%;text-align:center;background:#8b7cff;color:#11131a;border:0;border-radius:10px;padding:14px;font-weight:700;font-size:16px;text-decoration:none;margin-top:18px}
small{color:#aeb0bb}
</style></head>
<body><main>
<h1>4KHDHub Nick</h1><p>Choose which independent providers to use in Stremio.</p>
<section class="panel" id="providers">
<label><input type="checkbox" id="enableShowbox" checked> ShowBox</label>
<label><input type="checkbox" id="enable4KHDHub" checked> 4KHDHub</label>
<label><input type="checkbox" id="enableHDHub4u" checked> HDHub4u</label>
<label><input type="checkbox" id="enablePlayIMDb" checked> PlayIMDb</label>
<label><input type="checkbox" id="enableCinejoy" checked> Cinejoy</label>
<label><input type="checkbox" id="enableVAplayer" checked> VAplayer</label>
</section>
<section class="panel">
<label style="display:block">ShowBox cookies (optional)<textarea id="showboxCookies" rows="3" placeholder="Paste cookies separated by commas"></textarea></label>
<label style="display:block;border:0">ShowBox region<input type="text" id="showboxRegion" value="USA7"></label>
</section>
<button id="install">Install / Update in Stremio</button>
<p><small>Save your choices by installing this configured add-on. You can return here to change them later.</small></p>
<p><a id="manifest" style="color:#bcb2ff" href="/manifest.json">View base manifest</a></p>
</main>
<script>
(function(){
 const keys=['enableShowbox','enable4KHDHub','enableHDHub4u','enablePlayIMDb','enableCinejoy','enableVAplayer'];
 document.getElementById('install').addEventListener('click',function(){
   const config={};
   keys.forEach(function(k){if(document.getElementById(k).checked)config[k]='on';});
   const cookies=document.getElementById('showboxCookies').value.trim();
   const region=document.getElementById('showboxRegion').value.trim()||'USA7';
   if(cookies)config.showboxCookies=cookies;
   if(region)config.showboxRegion=region;
   const path='/'+encodeURIComponent(JSON.stringify(config))+'/manifest.json';
   const url=location.protocol+'//'+location.host+path;
   document.getElementById('manifest').href=path;
   location.href='stremio://'+location.host+path;
 });
})();
</script></body></html>`;

app.get("/", (_req, res) => res.redirect("/configure"));
app.get("/configure", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(configurePage);
});

app.use(getRouter(addonInterface));

const port = Number(process.env.PORT) || 7000;
if (require.main === module) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`4KHDHub Nick listening on ${port}`);
  });
}

module.exports = app;
