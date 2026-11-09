// Adapter that preserves the proven 4KHDHub-Nick PlayIMDb implementation.
// Nuvio's addon passes the original Stremio media type (movie/series) here.
const playimdb = require('../playimdb');

async function getPlayIMDbStreams(tmdbId, mediaType, season, episode) {
  if (!playimdb || typeof playimdb.getStreams !== 'function') return [];
  return playimdb.getStreams(String(tmdbId), mediaType, season, episode);
}

module.exports = { getPlayIMDbStreams };
